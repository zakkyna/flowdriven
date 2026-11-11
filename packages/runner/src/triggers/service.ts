import {
  type FlowManifest,
  parseManifest,
  type Trigger,
  type Value,
  validateManifest,
} from "@flowdriven/sdk";
import type { Begun, StartOptions } from "../engine.ts";
import { EngineError } from "../errors.ts";
import type { FlowRow, Store, TriggerOutcome, TriggerRow } from "../storage.ts";
import { DEFAULT_DAILY_CAP, GRACE_MS, OPEN_STATES, TICK_MS } from "./constants.ts";
import { checkEnable, inputsFromDefaults, preflight } from "./rules.ts";
import { dueSlots, nextSlot, scheduleOf, slotKey } from "./schedule.ts";

export type TriggerView = {
  flowId: string;
  index: number;
  kind: string;
  summary: string;
  state: "off" | "on" | "needs_ok" | "unavailable";
  canEnable: boolean;
  reason?: string;
  nextAtMs?: number;
  last?: { atMs: number; outcome: TriggerOutcome; runId?: string; detail?: string };
  firesToday: number;
  droppedToday: number;
  dailyCap: number;
};
export type FloodEvent = { flowId: string; flowName: string; day: string; cap: number };
export type PausedEvent = { flowId: string; index: number; flowName: string; pausedAt: string };
export type TriggerDeps = {
  store: Store;
  now: () => Date;
  dayOf: (date: Date) => string;
  projectDir: string;
  begin: (flowId: string, options: StartOptions) => Begun;
  every: (ms: number, fn: () => void) => () => void;
  watch: (path: string, onSignal: () => void) => (() => void) | undefined;
  summaryOf: (trigger: Trigger) => string;
  onFlood?: (event: FloodEvent) => void;
  onPaused?: (event: PausedEvent) => void;
};
export interface TriggerService {
  list(flowId: string): TriggerView[];
  setEnabled(flowId: string, index: number, enabled: boolean, hash: string): TriggerView;
  start(): void;
  stop(): void;
  tick(): Promise<void>;
  poke(): void;
  settled(): Promise<void>;
}
export function createTriggerService(deps: TriggerDeps): TriggerService {
  const { store } = deps;
  let chain = Promise.resolve();
  let cancel: (() => void) | undefined;
  let poked = false;
  const watchers = new Map<string, () => void>();
  const close = (id: string, index: number) => {
    const key = `${id}:${index}`;
    const fn = watchers.get(key);
    watchers.delete(key);
    if (fn) fn();
  };
  const flowOf = (id: string): { flow: FlowRow; manifest: FlowManifest } | undefined => {
    const flow = store.getFlow(id);
    if (!flow) return;
    const parsed = parseManifest(flow.manifest);
    if (!parsed.ok) return;
    return { flow, manifest: parsed.manifest };
  };
  const audit = (kind: string, detail: Value) =>
    store.appendAudit({ at: deps.now().toISOString(), kind, detail });
  const checked = (flow: FlowRow, manifest: FlowManifest, index: number) =>
    checkEnable({
      manifest,
      files: flow.files,
      index,
      projectDir: deps.projectDir,
      flowExists: (id) => !!store.getFlow(id),
      selfId: flow.id,
    });
  function view(flow: FlowRow, manifest: FlowManifest, index: number, trigger: Trigger): TriggerView {
    const row = store.getTrigger(flow.id, index);
    const valid = checked(flow, manifest, index);
    const supported =
      trigger.kind === "schedule" || trigger.kind === "file_change" || trigger.kind === "flow_done";
    const state: TriggerView["state"] = !supported
      ? "unavailable"
      : !row?.enabled
        ? "off"
        : row.hash === flow.hash && row.spec === JSON.stringify(trigger)
          ? "on"
          : "needs_ok";
    let reason: string | undefined =
      state === "unavailable"
        ? "Not available yet."
        : state === "needs_ok"
          ? "This flow changed. Turn the trigger on again to approve this version."
          : state === "off" && row?.pausedAt
            ? "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on."
            : undefined;
    if (!valid.ok && state !== "needs_ok") reason = valid.reason;
    const now = deps.now();
    const day = deps.dayOf(now);
    const next =
      state === "on" && trigger.kind === "schedule" && row
        ? nextSlot(scheduleOf(trigger), { afterMs: now.getTime(), anchorMs: Date.parse(row.enabledAt) })
        : undefined;
    const last = row?.lastFire;
    return {
      flowId: flow.id,
      index,
      kind: trigger.kind,
      summary: deps.summaryOf(trigger),
      state,
      canEnable: supported && valid.ok,
      ...(reason ? { reason } : {}),
      ...(next === undefined ? {} : { nextAtMs: next }),
      ...(last
        ? {
            last: {
              atMs: Date.parse(last.at),
              outcome: last.outcome,
              ...(last.runId ? { runId: last.runId } : {}),
              ...(last.detail ? { detail: last.detail } : {}),
            },
          }
        : {}),
      firesToday: store.counter(`runs:${flow.id}`, day),
      droppedToday: store.counter(`dropped:${flow.id}`, day),
      dailyCap: manifest.limits?.max_runs_per_day ?? DEFAULT_DAILY_CAP,
    };
  }
  function list(id: string): TriggerView[] {
    const found = flowOf(id);
    if (!found) return [];
    return found.manifest.triggers.flatMap((trigger, index) =>
      trigger.kind === "manual" ? [] : [view(found.flow, found.manifest, index, trigger)],
    );
  }
  function setEnabled(id: string, index: number, enabled: boolean, hash: string): TriggerView {
    const found = flowOf(id);
    if (!found) throw new EngineError("not_found", `There is no flow ${id}.`);
    const { flow, manifest } = found;
    const trigger = Number.isInteger(index) && index >= 0 ? manifest.triggers.at(index) : undefined;
    if (!trigger) throw new EngineError("not_found", "There is no such trigger.");
    if (hash !== flow.hash)
      throw new EngineError(
        "not_allowed",
        "This flow changed since you looked at it. Reload and check it again.",
      );
    const old = store.getTrigger(id, index);
    if (!enabled) {
      store.putTrigger(
        old
          ? { ...old, enabled: false }
          : {
              flowId: id,
              index,
              enabled: false,
              hash,
              spec: JSON.stringify(trigger),
              enabledAt: deps.now().toISOString(),
            },
      );
      close(id, index);
      audit("trigger_disabled", { flowId: id, index });
      return view(flow, manifest, index, trigger);
    }
    if (old?.enabled && old.hash === hash) return view(flow, manifest, index, trigger);
    const result = checked(flow, manifest, index);
    if (!result.ok) throw new EngineError("not_allowed", result.reason);
    const now = deps.now();
    store.putTrigger({
      flowId: id,
      index,
      enabled: true,
      hash,
      spec: JSON.stringify(trigger),
      enabledAt: now.toISOString(),
      cursorMs: now.getTime(),
    });
    audit("trigger_enabled", { flowId: id, index, kind: trigger.kind, hash });
    return view(flow, manifest, index, trigger);
  }
  function record(row: TriggerRow, outcome: TriggerOutcome, detail?: string, runId?: string): TriggerRow {
    if (outcome !== "started" && row.lastFire?.outcome === outcome && row.lastFire.detail === detail)
      return row;
    return {
      ...row,
      lastFire: {
        at: deps.now().toISOString(),
        outcome,
        ...(detail ? { detail } : {}),
        ...(runId ? { runId } : {}),
      },
    };
  }
  function fire(
    row: TriggerRow,
    flow: FlowRow,
    manifest: FlowManifest,
    trigger: Trigger,
    key: string,
    payload: Value,
    overlap: "skip" | "queue",
  ): TriggerRow {
    const now = deps.now();
    const day = deps.dayOf(now);
    const cap = manifest.limits?.max_runs_per_day ?? DEFAULT_DAILY_CAP;
    const runs = store.listRuns({ flowId: flow.id });
    const result = preflight({
      enabled: row.enabled,
      hashOk: row.hash === flow.hash && row.spec === JSON.stringify(trigger),
      r4Errors: validateManifest(manifest, { files: new Set(Object.keys(flow.files)) })
        .filter((i) => i.severity === "error")
        .map((i) => i.message),
      runsToday: store.counter(`runs:${flow.id}`, day),
      cap,
      open: runs.filter((r) => OPEN_STATES.some((s) => s === r.state)).length,
      queued: runs.filter((r) => r.state === "queued").length,
      overlap,
    });
    if (!result.ok && !result.consume) return record(row, result.outcome, result.detail);
    if (!store.claimKey(flow.id, row.index, key, now.toISOString())) return record(row, "duplicate");
    if (!result.ok) {
      if (result.outcome === "dropped_cap") {
        const n = store.increment(`dropped:${flow.id}`, day);
        if ([1, 10, 100, 1000].includes(n))
          audit("trigger_capped", { flowId: flow.id, day, cap, dropped: n });
        if (n === 1)
          try {
            deps.onFlood?.({ flowId: flow.id, flowName: manifest.name, day, cap });
          } catch {
            /* notification is optional */
          }
      }
      if (
        result.outcome === "refused" &&
        (row.lastFire?.outcome !== "refused" || row.lastFire.detail !== result.detail)
      )
        audit("trigger_refused", { flowId: flow.id, index: row.index, reason: result.detail });
      return record(row, result.outcome, result.detail);
    }
    const inputs = inputsFromDefaults(manifest);
    if (!inputs.ok) {
      if (row.lastFire?.outcome !== "refused" || row.lastFire.detail !== inputs.reason)
        audit("trigger_refused", { flowId: flow.id, index: row.index, reason: inputs.reason });
      return record(row, "refused", inputs.reason);
    }
    try {
      const begun = deps.begin(flow.id, {
        project: deps.projectDir,
        inputs: inputs.inputs,
        trigger: { kind: trigger.kind, payload },
      });
      return record(
        { ...row, recentRuns: [...(row.recentRuns ?? []), begun.run.id].slice(-3) },
        "started",
        undefined,
        begun.run.id,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      const outcome =
        e instanceof EngineError && (e.code === "not_allowed" || e.code === "invalid_input")
          ? "refused"
          : "error";
      if (outcome === "refused" && (row.lastFire?.outcome !== outcome || row.lastFire.detail !== message))
        audit("trigger_refused", { flowId: flow.id, index: row.index, reason: message });
      return record(row, outcome, message.slice(0, 200));
    }
  }
  function section(candidate: TriggerRow) {
    let row = store.getTrigger(candidate.flowId, candidate.index);
    if (!row?.enabled) return;
    try {
      const found = flowOf(row.flowId);
      if (!found) return;
      const { flow, manifest } = found;
      const trigger = manifest.triggers.at(row.index);
      if (!trigger || row.hash !== flow.hash || row.spec !== JSON.stringify(trigger)) {
        const updated = record(row, "needs_ok");
        if (updated !== row) store.putTrigger(updated);
        return;
      }
      if (trigger.kind !== "schedule") return;
      const now = deps.now().getTime();
      const anchor = Date.parse(row.enabledAt);
      const cursor = row.cursorMs ?? anchor;
      if (cursor > now + 86_400_000) {
        store.putTrigger({ ...record(row, "missed", "clock moved back"), cursorMs: now });
        return;
      }
      const spec = scheduleOf(trigger);
      const due = dueSlots(spec, { afterMs: cursor, uptoMs: now, anchorMs: anchor });
      if (due.latest === undefined) return;
      const onTime = now - due.latest <= GRACE_MS;
      if (!onTime && trigger.catch_up !== "once") row = record(row, "missed", `${due.slots} missed`);
      else
        row = fire(
          row,
          flow,
          manifest,
          trigger,
          slotKey(spec, due.latest),
          { slot: new Date(due.latest).toISOString(), missed: onTime ? due.slots - 1 : due.slots },
          trigger.overlap,
        );
      store.putTrigger({ ...row, cursorMs: due.latest });
    } catch (e) {
      const fresh = store.getTrigger(candidate.flowId, candidate.index);
      if (fresh?.enabled) {
        try {
          store.putTrigger(
            record(fresh, "error", (e instanceof Error ? e.message : "Unknown error").slice(0, 200)),
          );
        } catch {
          /* keep other triggers running */
        }
      }
    }
  }
  function tick(): Promise<void> {
    chain = chain
      .then(() => {
        for (const row of store.listTriggers()) if (row.enabled) section(row);
      })
      .catch(() => {});
    return chain;
  }
  function poke() {
    if (poked) return;
    poked = true;
    queueMicrotask(() => {
      poked = false;
      void tick();
    });
  }
  return {
    list,
    setEnabled,
    tick,
    poke,
    settled: async () => {
      await Promise.resolve();
      await chain;
    },
    start() {
      if (cancel) return;
      try {
        cancel = deps.every(TICK_MS, () => {
          void tick();
        });
        void tick();
      } catch {
        try {
          audit("trigger_start_failed", {});
        } catch {
          /* no throw */
        }
      }
    },
    stop() {
      try {
        cancel?.();
      } catch {
        /* no throw */
      }
      cancel = undefined;
      for (const fn of watchers.values())
        try {
          fn();
        } catch {
          /* no throw */
        }
      watchers.clear();
    },
  };
}
