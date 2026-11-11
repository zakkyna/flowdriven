import { randomUUID } from "node:crypto";
import { type FlowManifest, hasErrors, type Value, validateManifest } from "@flowdriven/sdk";
import type { CommandRunner } from "./checks/command.ts";
import { EngineError } from "./errors.ts";
import { runLeaf } from "./exec/leaf.ts";
import { runLoop } from "./exec/loop.ts";
import { makeScope } from "./exec/scope.ts";
import type { HarnessAdapter } from "./harness.ts";
import type { ApprovalState, RunState } from "./states.ts";
import type { ApprovalRow, AuditEntry, FlowRow, ItemRow, RunRow, StepRow, Store } from "./storage.ts";
export type EngineDeps = {
  store: Store;
  harness: HarnessAdapter;
  now?: () => Date;
  newId?: (prefix: string) => string;
  builtins?: Record<string, (args: Record<string, Value>, run: RunRow) => Promise<Record<string, Value>>>;
  readiness?: (m: FlowManifest) => { ready: boolean; reason?: string };
  runCommand?: CommandRunner;
};
export type ResolvedDeps = EngineDeps & {
  now: () => Date;
  newId: (prefix: string) => string;
  builtins: NonNullable<EngineDeps["builtins"]>;
};
export type StartOptions = {
  project: string;
  inputs?: Record<string, Value>;
  params?: Record<string, Value>;
  trigger?: { kind: string; payload?: Value };
};
export type RunView = {
  run: RunRow;
  manifest: FlowManifest;
  steps: StepRow[];
  items: ItemRow[];
  approvals: ApprovalRow[];
  audit: AuditEntry[];
};
export interface Engine {
  registerFlow(manifest: FlowManifest, hash: string, files?: Record<string, string>): FlowRow;
  startRun(flowId: string, options: StartOptions): Promise<RunRow>;
  answerAsk(approvalId: string, answer: { picks: string[] }): Promise<RunRow>;
  decide(approvalId: string, decision: "approve" | "reject"): Promise<RunRow>;
  resumeRun(runId: string): Promise<RunRow>;
  recoverAfterCrash(): Promise<RunRow[]>;
  isApproved(runId: string, tool: string, itemKey: string): boolean;
  getRun(runId: string): RunView;
  listRuns(filter?: { flowId?: string; state?: RunState }): RunRow[];
  listApprovals(filter?: { state?: ApprovalState; runId?: string }): ApprovalRow[];
}
export function createEngine(input: EngineDeps): Engine {
  const deps: ResolvedDeps = {
    ...input,
    now: input.now ?? (() => new Date()),
    newId: input.newId ?? ((prefix) => `${prefix}-${randomUUID()}`),
    builtins: input.builtins ?? {},
  };
  const { store, now } = deps;
  const runById = (id: string) => {
    const run = store.getRun(id);
    if (!run) throw new EngineError("not_found", "Run not found.");
    return run;
  };
  const flowFor = (run: RunRow) => {
    const flow = store.getFlow(run.flowId, run.flowHash);
    if (!flow) throw new EngineError("not_found", "Flow not found.");
    return flow;
  };
  function sweep() {
    for (const a of store
      .listApprovals({ state: "pending" })
      .filter((a) => a.kind === "result_sign_off" && a.expiresAt <= now().toISOString())
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))) {
      store.updateApproval(a.id, { state: "expired", resolvedAt: a.expiresAt });
      const row = store.getStep(a.runId, a.stepId, a.itemKey);
      if (row) store.upsertStep({ ...row, state: "failed", note: "The approval expired after 24 hours." });
      store.updateRun(a.runId, { state: "failed", endedAt: a.expiresAt });
    }
  }
  async function walk(run: RunRow): Promise<RunRow> {
    const manifest = flowFor(run).manifest as FlowManifest;
    for (const step of manifest.steps) {
      const row = store.getStep(run.id, step.id);
      if (row?.state === "passed" || row?.state === "skipped") continue;
      if ("for_each" in step) {
        const outcome = await runLoop(step, {
          deps,
          run: runById(run.id),
          manifest,
          scope: makeScope(runById(run.id), store.listSteps(run.id), manifest, store.listItems(run.id)),
        });
        if (outcome === "halt") return runById(run.id);
        continue;
      }
      const outcome = await runLeaf(step, {
        deps,
        run: runById(run.id),
        manifest,
        scope: makeScope(runById(run.id), store.listSteps(run.id), manifest, store.listItems(run.id)),
        itemKey: "",
      });
      if (outcome === "halt" || outcome === "failed") return runById(run.id);
    }
    store.updateRun(run.id, { state: "done", endedAt: now().toISOString() });
    return runById(run.id);
  }
  const unavailable = async (): Promise<never> => {
    throw new EngineError("unavailable", "not built yet");
  };
  return {
    registerFlow(manifest, hash, files = {}) {
      const issues = validateManifest(manifest, { files: new Set(Object.keys(files)) });
      if (hasErrors(issues))
        throw new EngineError(
          "invalid_input",
          issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message)
            .join("; "),
        );
      const row: FlowRow = {
        id: manifest.id,
        version: manifest.version,
        hash,
        manifest,
        files,
        registeredAt: now().toISOString(),
      };
      store.putFlow(row);
      return row;
    },
    async startRun(flowId, options) {
      store.purgeSeen(new Date(now().getTime() - 30 * 86400000).toISOString());
      const flow = store.getFlow(flowId);
      if (!flow) throw new EngineError("not_found", "Flow not found.");
      const manifest = flow.manifest as FlowManifest;
      const kind = options.trigger?.kind ?? "manual";
      if (kind !== "manual") {
        if (!manifest.triggers.some((t) => t.kind === kind))
          throw new EngineError("not_allowed", `This flow has no ${kind} trigger.`);
        const issues = validateManifest(manifest, { files: new Set(Object.keys(flow.files)) });
        if (hasErrors(issues))
          throw new EngineError(
            "not_allowed",
            issues
              .filter((i) => i.severity === "error")
              .map((i) => i.message)
              .join("; "),
          );
        const day = now().toISOString().slice(0, 10);
        const key = `runs:${flowId}`;
        if (store.counter(key, day) >= (manifest.limits?.max_runs_per_day ?? 24)) {
          store.appendAudit({ at: now().toISOString(), kind: "run_dropped", detail: { flowId, day } });
          throw new EngineError("not_allowed", "Daily run limit reached.");
        }
        store.increment(key, day);
      }
      const entries: [string, Value][] = [];
      for (const [id, decl] of Object.entries(manifest.params)) {
        const value = options.params && Object.hasOwn(options.params, id) ? options.params[id] : decl.default;
        if (value === undefined) continue;
        if (
          (decl.type === "number" && typeof value !== "number") ||
          (decl.type === "bool" && typeof value !== "boolean") ||
          ((decl.type === "text" || decl.type === "enum") && typeof value !== "string")
        )
          throw new EngineError("invalid_input", `Invalid parameter ${id}.`);
        entries.push([id, value as Value]);
      }
      for (const id of Object.keys(options.params ?? {}))
        if (!Object.hasOwn(manifest.params, id))
          throw new EngineError("invalid_input", `Unknown parameter ${id}.`);
      const inputs = options.inputs ?? {};
      for (const id of Object.keys(inputs)) {
        if (!manifest.inputs.some((decl) => decl.id === id))
          throw new EngineError("invalid_input", `Unknown input ${id}.`);
      }
      for (const decl of manifest.inputs)
        if (decl.required && !Object.hasOwn(inputs, decl.id))
          throw new EngineError("invalid_input", `Missing input ${decl.id}.`);
      const run: RunRow = {
        id: deps.newId("run"),
        flowId,
        flowHash: flow.hash,
        flowVersion: flow.version,
        state: "queued",
        project: options.project,
        inputs,
        params: Object.fromEntries(entries),
        ...(options.trigger ? { trigger: options.trigger } : {}),
        requirements: structuredClone(manifest.requirements),
        startedAt: now().toISOString(),
      };
      store.createRun(run);
      store.updateRun(run.id, { state: "checking" });
      const ready = deps.readiness?.(manifest);
      if (ready && !ready.ready) {
        store.updateRun(run.id, { state: "blocked", blockedReason: ready.reason ?? "Not ready." });
        return runById(run.id);
      }
      store.updateRun(run.id, { state: "running" });
      return walk(runById(run.id));
    },
    async answerAsk() {
      sweep();
      return unavailable();
    },
    resumeRun: unavailable,
    recoverAfterCrash: unavailable,
    async decide(id, decision) {
      sweep();
      const a = store.getApproval(id);
      if (!a) throw new EngineError("not_found", "Approval not found.");
      if (a.kind !== "result_sign_off") throw new EngineError("invalid_input", "Not a result sign-off.");
      if (a.state === "expired") throw new EngineError("not_allowed", "This approval expired.");
      if (a.state !== "pending") throw new EngineError("not_allowed", "This approval was already decided.");
      const run = runById(a.runId);
      if (run.state !== "waiting_approval")
        throw new EngineError("not_allowed", "Run is not waiting for approval.");
      if (decision !== "approve" && decision !== "reject")
        throw new EngineError("invalid_input", "Invalid decision.");
      const row = store.getStep(a.runId, a.stepId, a.itemKey);
      if (!row) throw new EngineError("not_found", "Step not found.");
      const at = now().toISOString();
      store.updateApproval(id, { state: decision === "approve" ? "approved" : "rejected", resolvedAt: at });
      if (decision === "approve") {
        const attempt = row.attempts.at(-1);
        if (attempt) attempt.exit = "ok";
        row.state = "passed";
        row.checks = row.checks.map((c) =>
          c.type === "user" && c.verdict === "pending" ? { ...c, verdict: "passed" } : c,
        );
        store.upsertStep(row);
        store.updateRun(run.id, { state: "running" });
        return walk(runById(run.id));
      }
      const attempt = row.attempts.at(-1);
      if (attempt) attempt.exit = "failed";
      row.state = "failed";
      store.upsertStep(row);
      if (a.itemKey) {
        const item = store.listItems(run.id).find((i) => i.key === a.itemKey && i.status === "running");
        if (item) store.upsertItem({ ...item, status: "failed" });
      }
      store.updateRun(run.id, { state: "failed", endedAt: at });
      for (const pending of store.listApprovals({ runId: run.id, state: "pending" }))
        store.updateApproval(pending.id, { state: "expired", resolvedAt: at });
      return runById(run.id);
    },
    isApproved(runId, tool, itemKey) {
      return store.hasGrant(runId, tool, itemKey);
    },
    getRun(id) {
      sweep();
      const run = runById(id);
      return {
        run,
        manifest: flowFor(run).manifest as FlowManifest,
        steps: store.listSteps(id),
        items: store.listItems(id),
        approvals: store.listApprovals({ runId: id }),
        audit: store.listAudit(id),
      };
    },
    listRuns(filter) {
      sweep();
      return store.listRuns(filter);
    },
    listApprovals(filter) {
      sweep();
      return store.listApprovals(filter);
    },
  };
}
