import { randomUUID } from "node:crypto";
import { type FlowManifest, hasErrors, type Value, validateManifest } from "@flowdriven/sdk";
import type { CommandRunner } from "./checks/command.ts";
import { EngineError } from "./errors.ts";
import { runAsk } from "./exec/ask.ts";
import { createChain } from "./exec/chain.ts";
import { runLeaf } from "./exec/leaf.ts";
import { runLoop } from "./exec/loop.ts";
import { createRecovery } from "./exec/recovery.ts";
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
export type Begun = { run: RunRow; settled: Promise<RunRow> };
export interface Engine {
  beginStart(flowId: string, options: StartOptions): Begun;
  beginAnswer(approvalId: string, answer: { picks: string[] }): Begun;
  beginDecide(approvalId: string, decision: "approve" | "reject"): Begun;
  beginResume(runId: string): Begun;
  beginRecover(): { runs: RunRow[]; settled: Promise<RunRow[]> };
  sweepExpired(): Promise<void>;
  shutdown(): void;
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
  const chain = createChain();
  let stopping = false;
  function assertRunning() {
    if (stopping) throw new EngineError("unavailable", "The engine is stopping.");
  }
  function enqueue(run: RunRow, task: () => Promise<RunRow>): Begun {
    return {
      run,
      settled: chain.enqueue(run.flowId, task, () => {
        try {
          return store.getRun(run.id) ?? run;
        } catch {
          return run;
        }
      }),
    };
  }
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
  function sweep(flowId?: string) {
    for (const a of store
      .listApprovals({ state: "pending" })
      .filter(
        (a) =>
          a.expiresAt <= now().toISOString() &&
          (flowId === undefined || store.getRun(a.runId)?.flowId === flowId),
      )
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))) {
      store.updateApproval(a.id, { state: "expired", resolvedAt: a.expiresAt });
      const row = store.getStep(a.runId, a.stepId, a.itemKey);
      if (a.kind === "ask") {
        if (row && a.onExpiry === "end") {
          store.upsertStep({
            ...row,
            state: "passed",
            outputs: { choice: [] },
            note: "nothing picked: the choice expired",
          });
          const manifest = flowFor(runById(a.runId)).manifest as FlowManifest;
          const index = manifest.steps.findIndex((step) => step.id === a.stepId);
          for (const step of manifest.steps.slice(index + 1)) {
            if (!store.getStep(a.runId, step.id))
              store.upsertStep({
                runId: a.runId,
                stepId: step.id,
                itemKey: "",
                state: "skipped",
                attempts: [],
                outputs: {},
                checks: [],
                note: "skipped: the run ended at an expired choice",
              });
          }
          store.updateRun(a.runId, { state: "done", endedAt: a.expiresAt });
        } else {
          if (row) store.upsertStep({ ...row, state: "failed", note: "The approval expired." });
          store.updateRun(a.runId, { state: "failed", endedAt: a.expiresAt });
        }
        continue;
      }
      if (row) store.upsertStep({ ...row, state: "failed", note: "The approval expired after 24 hours." });
      store.updateRun(a.runId, { state: "failed", endedAt: a.expiresAt });
    }
  }
  function blockError(runId: string, error: unknown): RunRow {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    store.updateRun(runId, { state: "blocked", blockedReason: `Internal error: ${message}` });
    store.appendAudit({ at: now().toISOString(), kind: "run_error", runId, detail: { message } });
    return runById(runId);
  }
  async function walk(run: RunRow): Promise<RunRow> {
    try {
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
        if (step.do === "ask") {
          const outcome = runAsk(step, {
            deps,
            run: runById(run.id),
            scope: makeScope(runById(run.id), store.listSteps(run.id), manifest, store.listItems(run.id)),
          });
          if (outcome === "halt" || outcome === "end") {
            if (outcome === "end") {
              const index = manifest.steps.findIndex((candidate) => candidate.id === step.id);
              for (const later of manifest.steps.slice(index + 1)) {
                if (!store.getStep(run.id, later.id))
                  store.upsertStep({
                    runId: run.id,
                    stepId: later.id,
                    itemKey: "",
                    state: "skipped",
                    attempts: [],
                    outputs: {},
                    checks: [],
                    note: "skipped: the run ended at a choice with no options",
                  });
              }
              store.updateRun(run.id, { state: "done", endedAt: now().toISOString() });
            }
            return runById(run.id);
          }
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
    } catch (error) {
      return blockError(run.id, error);
    }
  }
  async function checkAndWalk(run: RunRow): Promise<RunRow> {
    try {
      store.updateRun(run.id, { state: "checking" });
      const ready = deps.readiness?.(flowFor(run).manifest as FlowManifest);
      if (ready && !ready.ready) {
        store.updateRun(run.id, { state: "blocked", blockedReason: ready.reason ?? "Not ready." });
        return runById(run.id);
      }
      store.updateRun(run.id, { state: "running" });
      return await walk(runById(run.id));
    } catch (error) {
      return blockError(run.id, error);
    }
  }
  const recovery = createRecovery({
    deps,
    checkAndWalk,
    enqueue,
    assertRunning,
    sweep,
    blockError,
    flowFor: (run) => flowFor(run).manifest as FlowManifest,
  });
  function beginStart(flowId: string, options: StartOptions): Begun {
    assertRunning();
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
    }
    const entries: [string, Value][] = [];
    for (const [id, decl] of Object.entries(manifest.params)) {
      const value = options.params && Object.hasOwn(options.params, id) ? options.params[id] : decl.default;
      if (value === undefined) continue;
      if (
        (decl.type === "number" && typeof value !== "number") ||
        (decl.type === "bool" && typeof value !== "boolean") ||
        ((decl.type === "text" || decl.type === "enum") && typeof value !== "string") ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (decl.min !== undefined && (typeof value !== "number" || value < decl.min)) ||
        (decl.max !== undefined && (typeof value !== "number" || value > decl.max)) ||
        (decl.type === "enum" &&
          (!decl.options || typeof value !== "string" || !decl.options.includes(value))) ||
        (decl.options !== undefined && (typeof value !== "string" || !decl.options.includes(value)))
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
    const day = now().toISOString().slice(0, 10);
    const key = `runs:${flowId}`;
    if (kind !== "manual" && store.counter(key, day) >= (manifest.limits?.max_runs_per_day ?? 24)) {
      store.appendAudit({ at: now().toISOString(), kind: "run_dropped", detail: { flowId, day } });
      throw new EngineError("not_allowed", "Daily run limit reached.");
    }
    store.transaction(() => {
      store.purgeSeen(new Date(now().getTime() - 30 * 86400000).toISOString());
      store.createRun(run);
      if (kind !== "manual") store.increment(key, day);
    });
    return enqueue(run, () => checkAndWalk(run));
  }
  function beginAnswer(id: string, answer: { picks: string[] }): Begun {
    assertRunning();
    sweep();
    const a = store.getApproval(id);
    if (!a) throw new EngineError("not_found", "Approval not found.");
    if (a.kind !== "ask") throw new EngineError("invalid_input", "Not a choice.");
    if (a.state === "expired") throw new EngineError("not_allowed", "This approval expired.");
    if (a.state !== "pending") throw new EngineError("not_allowed", "This decision was already made.");
    const run = runById(a.runId);
    if (run.state !== "waiting_approval")
      throw new EngineError("not_allowed", "This run is no longer waiting for approval.");
    const payload = a.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !Array.isArray(payload.options) ||
      typeof a.maxPick !== "number"
    )
      throw new EngineError("invalid_input", "Invalid choice payload.");
    const options = payload.options.map((option) => {
      if (
        !option ||
        typeof option !== "object" ||
        Array.isArray(option) ||
        typeof option.key !== "string" ||
        !Object.hasOwn(option, "item") ||
        option.item === undefined
      )
        throw new EngineError("invalid_input", "Invalid choice option.");
      return { key: option.key, item: option.item };
    });
    if (
      !Array.isArray(answer.picks) ||
      answer.picks.some((pick) => typeof pick !== "string" || !options.some((o) => o.key === pick)) ||
      new Set(answer.picks).size !== answer.picks.length
    )
      throw new EngineError("invalid_input", "Invalid picks.");
    if (answer.picks.length > a.maxPick) throw new EngineError("invalid_input", "Too many picks.");
    const row = store.getStep(run.id, a.stepId);
    if (!row) throw new EngineError("not_found", "Step not found.");
    const at = now().toISOString();
    store.transaction(() => {
      store.updateApproval(id, { state: "approved", picks: answer.picks, resolvedAt: at });
      for (const tool of a.approves) for (const pick of answer.picks) store.addGrant(run.id, tool, pick);
      store.upsertStep({
        ...row,
        state: "passed",
        outputs: { choice: options.filter((o) => answer.picks.includes(o.key)).map((o) => o.item) },
      });
      store.appendAudit({
        at,
        kind: "ask_answered",
        runId: run.id,
        detail: { approvalId: id, picks: answer.picks },
      });
      store.updateRun(run.id, { state: "running" });
    });
    const updated = runById(run.id);
    return enqueue(updated, () => walk(updated));
  }
  function beginDecide(id: string, decision: "approve" | "reject"): Begun {
    assertRunning();
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
    store.transaction(() => {
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
      } else {
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
      }
    });
    const updated = runById(run.id);
    return decision === "approve"
      ? enqueue(updated, () => walk(updated))
      : { run: updated, settled: Promise.resolve(updated) };
  }
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
    beginStart,
    beginAnswer,
    beginDecide,
    ...recovery,
    async startRun(flowId, options) {
      return beginStart(flowId, options).settled;
    },
    async answerAsk(id, answer) {
      return beginAnswer(id, answer).settled;
    },
    async decide(id, decision) {
      return beginDecide(id, decision).settled;
    },
    async sweepExpired() {
      const flows = new Set(
        store
          .listApprovals({ state: "pending" })
          .filter((a) => a.expiresAt <= now().toISOString())
          .map((a) => runById(a.runId).flowId),
      );
      if (stopping) {
        for (const id of flows) sweep(id);
        return;
      }
      await Promise.all(
        [...flows].map((id) =>
          chain.enqueue(
            id,
            async () => {
              sweep(id);
            },
            () => undefined,
          ),
        ),
      );
    },
    shutdown() {
      if (stopping) return;
      stopping = true;
      chain.stop();
      try {
        deps.harness.stop?.();
      } catch {}
    },
    isApproved(runId, tool, itemKey) {
      const state = store.getRun(runId)?.state;
      return (state === "running" || state === "retrying") && store.hasGrant(runId, tool, itemKey);
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
