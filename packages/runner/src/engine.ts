import { randomUUID } from "node:crypto";
import {
  type FlowManifest,
  hasErrors,
  hasHiddenText,
  type Requirement,
  type Value,
  validateManifest,
} from "@flowdriven/sdk";
import type { CommandRunner } from "./checks/command.ts";
import { createGrantBook, digestCall, pickKeyUsable } from "./connectors/grants.ts";
import { EngineError } from "./errors.ts";
import { runAsk } from "./exec/ask.ts";
import { createChain } from "./exec/chain.ts";
import { anotherWayOf, skippedDependency } from "./exec/held.ts";
import { runLeaf } from "./exec/leaf.ts";
import { runLoop } from "./exec/loop.ts";
import { ownTextHash } from "./exec/own-text.ts";
import { createRecovery } from "./exec/recovery.ts";
import { itemScope, makeScope } from "./exec/scope.ts";
import type { HarnessAdapter } from "./harness.ts";
import type { Waiting } from "./keeper/types.ts";
import type { Routed } from "./router/types.ts";
import type { ApprovalState, RunState } from "./states.ts";
import type {
  ApprovalRow,
  AuditEntry,
  FlowRow,
  ItemRow,
  RunRow,
  StepRow,
  Store,
  UsageEventRow,
} from "./storage.ts";
import { localDay } from "./triggers/schedule.ts";
export type EngineDeps = {
  store: Store;
  harness: HarnessAdapter;
  now?: () => Date;
  dayOf?: (date: Date) => string;
  newId?: (prefix: string) => string;
  builtins?: Record<string, (args: Record<string, Value>, run: RunRow) => Promise<Record<string, Value>>>;
  routeOf?: (requirements: Requirement[]) => Routed[];
  readiness?: (
    m: FlowManifest,
    ctx?: { flowId: string; hash: string },
  ) => { ready: boolean; reason?: string };
  runCommand?: CommandRunner;
  keepAwake?: (pid: number) => void;
  clearNotice?: (id: string) => void;
  queue?: { waitingOf(runId: string): { stepId: string; itemKey: string; waiting: Waiting }[] };
};
export type ResolvedDeps = EngineDeps & {
  now: () => Date;
  dayOf: (date: Date) => string;
  newId: (prefix: string) => string;
  builtins: NonNullable<EngineDeps["builtins"]>;
  active: Map<string, Set<AbortController>>;
};
export type StartOptions = {
  project: string;
  inputs?: Record<string, Value>;
  params?: Record<string, Value>;
  trigger?: { kind: string; payload?: Value; index?: number };
};
export type RunView = {
  run: RunRow;
  manifest: FlowManifest;
  steps: StepRow[];
  items: ItemRow[];
  approvals: ApprovalRow[];
  audit: AuditEntry[];
  waiting?: ReturnType<Engine["waitingOf"]>;
  usage?: UsageEventRow[];
};
export type Begun = { run: RunRow; settled: Promise<RunRow> };
export interface Engine {
  beginStart(flowId: string, options: StartOptions): Begun;
  beginAnswer(approvalId: string, answer: { picks: string[] }): Begun;
  beginDecide(
    approvalId: string,
    decision: "approve" | "reject" | "edit" | "always_allow" | "another_way",
    edit?: { text: string; subject?: string },
    via?: "window" | "phone",
  ): Begun;
  beginDecideSimilar(ids: string[], group: string): void;
  beginResume(runId: string): Begun;
  beginRecover(): { runs: RunRow[]; settled: Promise<RunRow[]> };
  sweepExpired(): Promise<void>;
  stopRun(runId: string, by: "person" | "flow_deleted"): { run: RunRow; changed: boolean };
  shutdown(): void;
  registerFlow(manifest: FlowManifest, hash: string, files?: Record<string, string>): FlowRow;
  startRun(flowId: string, options: StartOptions): Promise<RunRow>;
  answerAsk(approvalId: string, answer: { picks: string[] }): Promise<RunRow>;
  decide(approvalId: string, decision: "approve" | "reject"): Promise<RunRow>;
  resumeRun(runId: string): Promise<RunRow>;
  recoverAfterCrash(): Promise<RunRow[]>;
  isApproved(runId: string, tool: string, itemKey: string): boolean;
  getRun(runId: string): RunView;
  waitingOf(runId: string): { run?: Waiting; steps: { stepId: string; itemKey: string; waiting: Waiting }[] };
  listRuns(filter?: { flowId?: string; state?: RunState }): RunRow[];
  listApprovals(filter?: { state?: ApprovalState; runId?: string }): ApprovalRow[];
}
export function createEngine(input: EngineDeps): Engine {
  const deps: ResolvedDeps = {
    ...input,
    active: new Map(),
    now: input.now ?? (() => new Date()),
    dayOf: input.dayOf ?? localDay,
    newId: input.newId ?? ((prefix) => `${prefix}-${randomUUID()}`),
    builtins: input.builtins ?? {},
  };
  const { store, now } = deps;
  const chain = createChain();
  const overlapping = new Set<string>();
  let stopping = false;
  function assertRunning() {
    if (stopping) throw new EngineError("unavailable", "The engine is stopping.");
  }
  function enqueue(run: RunRow, task: () => Promise<RunRow>): Begun {
    if (chain.pending(run.flowId)) overlapping.add(run.id);
    return {
      run,
      settled: chain.enqueue(
        run.flowId,
        () => {
          overlapping.delete(run.id);
          return store.getRun(run.id)?.state === "stopped" ? Promise.resolve(runById(run.id)) : task();
        },
        () => {
          overlapping.delete(run.id);
          try {
            return store.getRun(run.id) ?? run;
          } catch {
            return run;
          }
        },
      ),
    };
  }
  function waitingOf(runId: string): ReturnType<Engine["waitingOf"]> {
    const steps = deps.queue?.waitingOf(runId) ?? [];
    const run: Waiting | undefined = overlapping.has(runId)
      ? { reason: "flow_overlap" }
      : steps.at(0)?.waiting;
    return run ? { run, steps } : { steps };
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
  function sweep(_flowId?: string) {}
  function blockError(runId: string, error: unknown): RunRow {
    if (store.getRun(runId)?.state === "stopped") return runById(runId);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    store.updateRun(runId, { state: "blocked", blockedReason: `Internal error: ${message}` });
    store.appendAudit({ at: now().toISOString(), kind: "run_error", runId, detail: { message } });
    return runById(runId);
  }
  async function walk(run: RunRow): Promise<RunRow> {
    try {
      const manifest = flowFor(run).manifest as FlowManifest;
      for (const step of manifest.steps) {
        if (runById(run.id).state === "stopped") return runById(run.id);
        const row = store.getStep(run.id, step.id);
        if (row?.state === "passed" || row?.state === "skipped") continue;
        const dependency = skippedDependency(step, "", store.listSteps(run.id));
        if (dependency) {
          const previous = manifest.steps.find((candidate) => candidate.id === dependency.stepId);
          store.upsertStep({
            runId: run.id,
            stepId: step.id,
            itemKey: "",
            state: "skipped",
            attempts: [],
            outputs: {},
            checks: [],
            skipped: { because: "needs_skipped_result", stepId: dependency.stepId },
            note: `Skipped because ${previous?.title ?? dependency.stepId} was not done.`,
          });
          continue;
        }
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
            manifest,
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
      if (runById(run.id).state !== "stopped")
        store.updateRun(run.id, { state: "done", endedAt: now().toISOString() });
      return runById(run.id);
    } catch (error) {
      return blockError(run.id, error);
    }
  }
  async function checkAndWalk(run: RunRow): Promise<RunRow> {
    try {
      store.updateRun(run.id, { state: "checking" });
      const ready = deps.readiness?.(flowFor(run).manifest as FlowManifest, {
        flowId: run.flowId,
        hash: run.flowHash,
      });
      if (ready && !ready.ready) {
        store.updateRun(run.id, { state: "blocked", blockedReason: ready.reason ?? "Not ready." });
        return runById(run.id);
      }
      store.updateRun(run.id, { state: "running", cause: undefined });
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
      ...(deps.routeOf ? { routes: structuredClone(deps.routeOf(manifest.requirements)) } : {}),
      startedAt: now().toISOString(),
    };
    const day = deps.dayOf(now());
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
    if (a.state === "expired")
      throw new EngineError("conflict", "This approval expired.", { reason: "decision_expired" });
    if (a.state !== "pending")
      throw new EngineError("conflict", "This decision was already made.", {
        reason: "already_answered",
        params: { via: a.resolvedVia ?? "window" },
      });
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
    if (answer.picks.length > a.maxPick)
      throw new EngineError("invalid_input", "Too many picks.", {
        reason: "too_many_picks",
        params: { max: a.maxPick },
      });
    if (
      !Array.isArray(answer.picks) ||
      answer.picks.some((pick) => typeof pick !== "string" || !options.some((o) => o.key === pick)) ||
      new Set(answer.picks).size !== answer.picks.length
    )
      throw new EngineError("invalid_input", "Invalid picks.", { reason: "unknown_pick" });
    const row = store.getStep(run.id, a.stepId);
    if (!row) throw new EngineError("not_found", "Step not found.");
    const at = now().toISOString();
    store.transaction(() => {
      store.updateApproval(id, {
        state: "approved",
        picks: answer.picks,
        resolvedAt: at,
        resolvedVia: "window",
      });
      for (const tool of a.approves)
        for (const pick of answer.picks)
          if (pickKeyUsable(pick))
            store.putCallGrant({
              runId: run.id,
              stepId: "*",
              itemKey: pick,
              tool,
              digest: "*",
              kind: "pick",
              createdAt: at,
              approvalId: id,
            });
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
      store.appendAudit({
        at,
        kind: "decision_made",
        runId: run.id,
        detail: { approvalId: id, decision: "answer", via: "window" },
      });
      store.updateRun(run.id, { state: "running" });
    });
    const updated = runById(run.id);
    return enqueue(updated, () => walk(updated));
  }
  function beginDecide(
    id: string,
    decision: "approve" | "reject" | "edit" | "always_allow" | "another_way",
    edit?: { text: string; subject?: string },
    via: "window" | "phone" = "window",
    deferred?: Array<() => void>,
  ): Begun {
    const schedule = (run: RunRow, task: () => Promise<RunRow>): Begun => {
      if (!deferred) return enqueue(run, task);
      deferred.push(() => {
        enqueue(run, task);
      });
      return { run, settled: Promise.resolve(run) };
    };
    const continueStep = (run: RunRow, a: ApprovalRow, stopIfRemaining: boolean): Begun => {
      const remaining = store
        .listApprovals({ runId: run.id, state: "pending" })
        .filter((item) => item.stepId === a.stepId).length;
      if (remaining && stopIfRemaining) {
        store.updateRun(run.id, { state: "waiting_approval" });
        const updated = runById(run.id);
        return { run: updated, settled: Promise.resolve(updated) };
      }
      if (remaining) {
        store.updateRun(run.id, { state: "waiting_approval" });
        const updated = runById(run.id);
        return schedule(updated, async () => {
          const manifest = flowFor(updated).manifest as FlowManifest;
          const loop = manifest.steps.find(
            (step) => "for_each" in step && step.steps.some((nested) => nested.id === a.stepId),
          );
          const item = store
            .listItems(run.id)
            .find((entry) => entry.key === a.itemKey && entry.loopId === loop?.id);
          const nested =
            loop && "for_each" in loop ? loop.steps.find((step) => step.id === a.stepId) : undefined;
          if (!loop || !("for_each" in loop) || !item || !nested) return runById(run.id);
          const scope = makeScope(updated, store.listSteps(run.id), manifest, store.listItems(run.id));
          const outcome = await runLeaf(nested, {
            deps,
            run: updated,
            manifest,
            itemKey: a.itemKey,
            keepWaiting: true,
            scope: itemScope(scope, loop, item.item, store.listSteps(run.id), item.key),
          });
          if (outcome === "passed" && loop.steps.at(-1)?.id === nested.id)
            store.transaction(() => {
              store.upsertItem({ ...item, status: "passed" });
              if (loop.key !== undefined)
                store.markSeen(updated.flowId, loop.id, item.key, now().toISOString());
            });
          if (outcome === "passed" || outcome === "skipped")
            store.updateRun(run.id, { state: "waiting_approval" });
          return runById(run.id);
        });
      }
      const updated = runById(run.id);
      return schedule(updated, () => walk(updated));
    };
    assertRunning();
    sweep();
    const a = store.getApproval(id);
    if (!a) throw new EngineError("not_found", "Approval not found.");
    if (
      decision !== "another_way" &&
      a.kind !== "result_sign_off" &&
      a.kind !== "risky_action" &&
      a.kind !== "outside_flow"
    )
      throw new EngineError("invalid_input", "Not a result sign-off.");
    if (a.state === "expired")
      throw new EngineError("conflict", "This approval expired.", { reason: "decision_expired" });
    if (a.state !== "pending")
      throw new EngineError("conflict", "This approval was already decided.", {
        reason: "already_answered",
        params: { via: a.resolvedVia ?? "window" },
      });
    const run = runById(a.runId);
    if (run.state !== "waiting_approval")
      throw new EngineError("not_allowed", "Run is not waiting for approval.");
    if (
      decision !== "approve" &&
      decision !== "reject" &&
      decision !== "edit" &&
      decision !== "always_allow" &&
      decision !== "another_way"
    )
      throw new EngineError("invalid_input", "Invalid decision.");
    if (decision === "another_way") {
      if (via !== "window")
        throw new EngineError("not_allowed", "Caller is not allowed.", { reason: "caller_not_allowed" });
      if (a.kind !== "result_sign_off" && a.kind !== "risky_action" && a.kind !== "outside_flow")
        throw new EngineError("invalid_input", "Another way is not allowed for this decision.", {
          reason: "another_way_not_allowed",
        });
      const text = edit?.text;
      if (text === undefined || !text.trim())
        throw new EngineError("invalid_input", "Write the text first.", { reason: "empty_text" });
      if (text.length > 4000)
        throw new EngineError("invalid_input", "Keep it under 4,000 characters.", {
          reason: "text_too_long",
        });
      if (hasHiddenText(text) || /\p{Cf}/u.test(text))
        throw new EngineError("invalid_input", "Remove hidden characters.", {
          reason: "hidden_characters",
        });
    }
    let editedCall: { tool: string; input: Value; digest: string } | undefined;
    if (decision === "edit") {
      const call = a.call;
      if (
        a.kind !== "risky_action" ||
        !call ||
        !edit ||
        !call.input ||
        typeof call.input !== "object" ||
        Array.isArray(call.input)
      )
        throw new EngineError("invalid_input", "Only text can be edited.", { reason: "edit_not_allowed" });
      const input = call.input;
      for (const text of [edit.text, edit.subject]) {
        if (text === undefined) continue;
        if (!text.trim())
          throw new EngineError("invalid_input", "Write the text first.", { reason: "empty_text" });
        if (hasHiddenText(text) || /\p{Cf}/u.test(text))
          throw new EngineError("invalid_input", "Remove hidden characters.", {
            reason: "hidden_characters",
          });
      }
      const payload = a.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        (payload.kind !== "email" && payload.kind !== "text") ||
        (edit.subject !== undefined && !Object.hasOwn(input, "subject"))
      )
        throw new EngineError("invalid_input", "Only text can be edited.", { reason: "edit_not_allowed" });
      const bodyKey =
        typeof input.body === "string" ? "body" : typeof input.text === "string" ? "text" : undefined;
      if (!bodyKey)
        throw new EngineError("invalid_input", "Only text can be edited.", { reason: "edit_not_allowed" });
      const next = {
        ...input,
        [bodyKey]: edit.text,
        ...(edit.subject === undefined ? {} : { subject: edit.subject }),
      };
      editedCall = { tool: call.tool, input: next, digest: digestCall(call.tool, next) };
    }
    const row = store.getStep(a.runId, a.stepId, a.itemKey);
    if (!row) throw new EngineError("not_found", "Step not found.");
    const at = now().toISOString();
    const manifest = flowFor(run).manifest as FlowManifest;
    const touch =
      manifest.format === "flowdriven-flow/1.2"
        ? manifest.touches?.find((t) => t.id === a.touchId)
        : undefined;
    if (decision === "always_allow" && a.kind === "outside_flow")
      throw new EngineError("not_allowed", "Outside calls can only be approved once.", {
        reason: "outside_flow_once",
      });
    if (
      decision === "always_allow" &&
      (a.kind !== "risky_action" ||
        a.effect !== "change" ||
        !a.fixedPlace ||
        a.outside ||
        !a.place ||
        !["account", "folder"].includes(a.place.kind) ||
        !touch ||
        touch.effect !== "change" ||
        touch.place?.kind !== a.place.kind ||
        touch.place.value !== a.place.value)
    )
      throw new EngineError("not_allowed", "The place is not fixed.", { reason: "place_not_fixed" });
    if (a.kind === "risky_action" || a.kind === "outside_flow") {
      if (decision === "another_way") {
        const text = edit?.text ?? "";
        store.transaction(() => {
          store.updateApproval(id, {
            state: "another_way",
            anotherWayText: text,
            resolvedAt: at,
            resolvedVia: via,
          });
          store.appendAudit({
            at,
            kind: "decision_made",
            runId: run.id,
            detail: { approvalId: id, decision: "another_way", via },
          });
          store.upsertStep({
            ...row,
            state: "pending",
            attempts: [
              ...row.attempts,
              {
                number: row.attempts.length + 1,
                replan: false,
                worker: deps.harness.name,
                startedAt: a.createdAt,
                endedAt: at,
                exit: "failed",
                anotherWay: true,
              },
            ],
          });
          store.updateRun(run.id, {
            state: "running",
            decisionLines: [
              ...(store.getRun(run.id)?.decisionLines ?? []),
              { key: "report.anotherWay", params: { text } },
            ],
          });
        });
        return continueStep(run, a, false);
      }
      store.transaction(() => {
        const rule =
          decision === "always_allow" && a.place && touch
            ? store.makeRule({
                flowId: run.flowId,
                touchId: touch.id,
                effect: "change",
                place: a.place,
                sentence: touch.sentence,
                createdAt: at,
                createdBy: "always_allow",
                approvalId: a.id,
              })
            : undefined;
        if (rule) {
          store.appendAudit({
            at,
            kind: "rule_created",
            runId: run.id,
            detail: {
              ruleId: rule.id,
              flowId: run.flowId,
              touchId: rule.touchId,
              effect: rule.effect,
              placeKind: rule.place.kind,
              by: "always_allow",
              runId: run.id,
              stepId: a.stepId,
            },
          });
          if (a.chatId)
            store.putMessage({
              id: deps.newId("message"),
              chatId: a.chatId,
              seq: Math.max(0, ...store.listMessages(a.chatId).map((m) => m.seq)) + 1,
              at,
              role: "flowdriven",
              kind: "line",
              outside: false,
              line: { key: "chat.alwaysAllowed", params: { flow: manifest.name } },
            });
        }
        store.updateApproval(id, {
          state:
            decision === "always_allow"
              ? "allowed_always"
              : decision === "edit"
                ? "approved_edited"
                : decision === "approve"
                  ? "approved"
                  : "rejected",
          ...(rule ? { ruleId: rule.id } : {}),
          resolvedAt: at,
          resolvedVia: via,
          ...(editedCall && edit
            ? { editedText: edit.text, editedSubject: edit.subject, editedDigest: editedCall.digest }
            : {}),
        });
        if (decision !== "reject")
          for (const entry of a.approves) {
            const separator = entry.indexOf("#");
            if (separator < 0) continue;
            const qualified = entry.slice(0, separator);
            const full = qualified.indexOf(".mcp__");
            store.putCallGrant({
              runId: run.id,
              stepId: a.stepId,
              itemKey: a.itemKey,
              tool:
                a.kind === "outside_flow" && a.call
                  ? a.call.tool
                  : full < 0
                    ? qualified
                    : qualified.slice(full + 1),
              digest: editedCall?.digest ?? entry.slice(separator + 1),
              kind: deferred ? "similar" : "approve",
              createdAt: at,
              approvalId: id,
            });
          }
        store.appendAudit({
          at,
          kind: decision !== "reject" ? "call_approved" : "call_rejected",
          runId: run.id,
          detail: { approvalId: id, stepId: a.stepId, itemKey: a.itemKey, tool: a.call?.tool ?? "" },
        });
        store.appendAudit({
          at,
          kind: "decision_made",
          runId: run.id,
          detail: { approvalId: id, decision, via },
        });
        if (decision !== "reject") {
          store.updateRun(run.id, {
            decisionLines: [
              ...(store.getRun(run.id)?.decisionLines ?? []),
              {
                key:
                  decision === "edit"
                    ? "report.youApprovedEdited"
                    : a.kind === "outside_flow"
                      ? "report.approvedOnce"
                      : "report.youApproved",
                params: { title: a.summary },
              },
            ],
          });
          store.upsertStep({ ...row, state: "pending" });
          store.updateRun(run.id, { state: "running" });
        } else {
          store.upsertStep(
            a.kind === "outside_flow"
              ? { ...row, state: "pending" }
              : { ...row, state: "skipped", skipped: { because: "rejected", approvalId: id } },
          );
          if (a.itemKey && a.kind !== "outside_flow") {
            const item = store.listItems(run.id).find((i) => i.key === a.itemKey && i.status === "running");
            if (item)
              store.upsertItem({
                ...item,
                status: "skipped",
                skipped: { because: "rejected", approvalId: id },
              });
          }
          store.updateRun(run.id, {
            state: "running",
            decisionLines: [
              ...(store.getRun(run.id)?.decisionLines ?? []),
              { key: "report.youSaidNo", params: { title: a.summary } },
            ],
          });
        }
      });
      return continueStep(run, a, decision === "reject" && a.kind !== "outside_flow");
    }
    if (decision === "edit")
      throw new EngineError("invalid_input", "Only text can be edited.", { reason: "edit_not_allowed" });
    store.transaction(() => {
      if (decision === "another_way") {
        const text = edit?.text ?? "";
        store.updateApproval(id, {
          state: "another_way",
          anotherWayText: text,
          resolvedAt: at,
          resolvedVia: via,
        });
        store.appendAudit({
          at,
          kind: "decision_made",
          runId: run.id,
          detail: { approvalId: id, decision: "another_way", via },
        });
        const attempt = row.attempts.at(-1);
        if (attempt) {
          attempt.endedAt ??= at;
          attempt.exit = "failed";
          attempt.anotherWay = true;
        } else {
          row.attempts.push({
            number: 1,
            replan: false,
            worker: deps.harness.name,
            startedAt: a.createdAt,
            endedAt: at,
            exit: "failed",
            anotherWay: true,
          });
        }
        row.state = "pending";
        row.outputs = {};
        row.checks = [];
        delete row.ownerApproved;
        store.upsertStep(row);
        store.updateRun(run.id, {
          state: "running",
          decisionLines: [
            ...(store.getRun(run.id)?.decisionLines ?? []),
            { key: "report.anotherWay", params: { text } },
          ],
        });
        return;
      }
      store.updateApproval(id, {
        state: decision === "approve" ? "approved" : "rejected",
        resolvedAt: at,
        resolvedVia: via,
      });
      store.appendAudit({
        at,
        kind: "decision_made",
        runId: run.id,
        detail: { approvalId: id, decision, via },
      });
      if (decision === "approve") {
        const outsideAnotherWay = anotherWayOf(store, run.id, a.stepId, a.itemKey, { outsideOnly: true });
        store.updateRun(run.id, {
          decisionLines: [
            ...(store.getRun(run.id)?.decisionLines ?? []),
            { key: "report.youApproved", params: { title: a.summary } },
            ...(outsideAnotherWay === undefined
              ? []
              : [{ key: "report.didAnotherWay", params: { text: outsideAnotherWay } }]),
          ],
        });
      }
      if (decision === "approve") {
        const attempt = row.attempts.at(-1);
        if (attempt) attempt.exit = "ok";
        row.state = "passed";
        row.checks = row.checks.map((c) =>
          c.type === "user" && c.verdict === "pending" ? { ...c, verdict: "passed" } : c,
        );
        if (a.ownText) {
          const value = row.outputs[a.ownText.output];
          if (typeof value === "string" && ownTextHash(value) === a.ownText.hash) {
            const { output, hash } = a.ownText;
            row.ownerApproved = { output, hash, approvalId: a.id, at };
            store.appendAudit({
              at,
              kind: "own_text_approved",
              runId: run.id,
              detail: { stepId: a.stepId, itemKey: a.itemKey, hash },
            });
          } else {
            delete row.ownerApproved;
            store.appendAudit({
              at,
              kind: "own_text_changed",
              runId: run.id,
              detail: { stepId: a.stepId, itemKey: a.itemKey },
            });
          }
        }
        store.upsertStep(row);
        store.updateRun(run.id, { state: "running" });
      } else {
        row.state = "skipped";
        row.skipped = { because: "rejected", approvalId: id };
        store.upsertStep(row);
        if (a.itemKey) {
          const item = store.listItems(run.id).find((i) => i.key === a.itemKey && i.status === "running");
          if (item)
            store.upsertItem({
              ...item,
              status: "skipped",
              skipped: { because: "rejected", approvalId: id },
            });
        }
        store.updateRun(run.id, {
          state: "running",
          decisionLines: [
            ...(store.getRun(run.id)?.decisionLines ?? []),
            { key: "report.youSaidNo", params: { title: a.summary } },
          ],
        });
      }
    });
    return continueStep(run, a, decision !== "another_way");
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
      store.transaction(() => {
        store.putFlow(row);
        const head = store.getFlowHead(row.id);
        if (head && !head.deletedAt && head.headHash !== hash)
          store.putFlowHead({
            ...head,
            headHash: hash,
            origin: head.origin.kind === "demo" ? head.origin : { kind: "import" },
            updatedAt: row.registeredAt,
          });
      });
      return row;
    },
    stopRun(runId, by) {
      const run = runById(runId);
      if (["done", "failed", "stopped"].includes(run.state)) return { run, changed: false };
      const pending = store.listApprovals({ runId, state: "pending" });
      const at = now().toISOString();
      store.transaction(() => {
        store.updateRun(runId, { state: "stopped", stoppedBy: by, cause: { code: "stopped" }, endedAt: at });
        for (const step of store.listSteps(runId)) {
          if (step.state === "running" || step.state === "retrying")
            store.upsertStep({ ...step, state: "stopped" });
        }
        for (const approval of pending) {
          store.updateApproval(approval.id, { state: "expired", resolvedVia: "stop", resolvedAt: at });
          store.appendAudit({
            at,
            kind: "decision_expired",
            runId,
            detail: { approvalId: approval.id, runId, why: by === "person" ? "stop" : by },
          });
        }
        store.appendAudit({ at, kind: "run_stopped", runId, detail: { runId, by } });
      });
      for (const controller of deps.active.get(runId) ?? []) controller.abort();
      for (const approval of pending) deps.clearNotice?.(`approval:${approval.id}`);
      overlapping.delete(runId);
      return { run: runById(runId), changed: true };
    },
    beginStart,
    beginAnswer,
    beginDecide,
    beginDecideSimilar(ids, group) {
      const deferred: Array<() => void> = [];
      store.transaction(() => {
        const first = store.getApproval(ids[0] ?? "");
        if (!first) throw new EngineError("not_found", "Approval not found.");
        if (runById(first.runId).state !== "waiting_approval")
          throw new EngineError("not_allowed", "Run is not waiting for approval.");
        for (const id of ids) {
          store.updateRun(first.runId, { state: "waiting_approval" });
          beginDecide(id, "approve", undefined, "window", deferred);
        }
        store.appendAudit({
          at: now().toISOString(),
          kind: "decisions_batch",
          runId: first.runId,
          detail: { runId: first.runId, group, approvalIds: ids },
        });
      });
      for (const start of deferred) start();
    },
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
      return (
        (state === "running" || state === "retrying") && createGrantBook(store).has(runId, tool, itemKey)
      );
    },
    waitingOf,
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
        usage: store.listUsage({ runId: id }),
        waiting: waitingOf(id),
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
