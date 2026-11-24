import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  durationMs,
  type FlowManifest,
  parseManifest,
  type Trigger,
  type Value,
  validateManifest,
} from "@flowdriven/sdk";
import type { Begun, StartOptions } from "../engine.ts";
import { EngineError } from "../errors.ts";
import type { FlowRow, Store, TriggerOutcome, TriggerRow } from "../storage.ts";
import {
  DEFAULT_DAILY_CAP,
  DEFAULT_MAX_ITEMS,
  FLOW_DONE_PER_TICK,
  FLOW_DONE_WINDOW_MS,
  GRACE_MS,
  KEY_KEEP_MS,
  MAX_CHAIN_DEPTH,
  MAX_DEBOUNCE_WAIT_MS,
  MAX_SCAN_ENTRIES,
  OPEN_STATES,
  RESCAN_MS,
  SUPPORTED_KINDS,
  TICK_MS,
} from "./constants.ts";
import { checkEnable, inputsFromDefaults, payloadFiles, preflight, sanitizeText } from "./rules.ts";
import { diffSnapshot, mergeHandled, parseSnapshot, resolveRoot, scanFolder } from "./scan.ts";
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
export type PausedWhy = "blocked_runs" | "challenge";
export type PausedEvent = {
  flowId: string;
  index: number;
  flowName: string;
  pausedAt: string;
  why?: PausedWhy;
};
export const PAUSE_REASON = {
  blocked_runs: "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on.",
  challenge:
    "Paused: a site asked for a login or a robot check. Open the site in your browser, then turn it on.",
} as const;
export type TriggerDeps = {
  store: Store;
  now: () => Date;
  dayOf: (date: Date) => string;
  projectDir: string;
  home?: string;
  dataDir?: string;
  begin: (flowId: string, options: StartOptions) => Begun;
  every: (ms: number, fn: () => void) => () => void;
  watch: (path: string, onSignal: () => void, onError: () => void) => (() => void) | undefined;
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
  pauseByRun(runId: string): boolean;
  settled(): Promise<void>;
}
export function createTriggerService(deps: TriggerDeps): TriggerService {
  const { store } = deps;
  let chain = Promise.resolve();
  let cancel: (() => void) | undefined;
  let poked = false;
  let running = false;
  let stopped = false;
  let lastPurge: number | undefined;
  const watchers = new Map<
    string,
    {
      root: string;
      unwatch?: () => void;
      watching: boolean;
      capped?: boolean;
      dirtyFirst?: number;
      dirtyLast?: number;
      lastScan?: number;
    }
  >();
  const close = (id: string, index: number) => {
    const key = `${id}:${index}`;
    const fn = watchers.get(key);
    watchers.delete(key);
    if (fn?.unwatch) {
      try {
        fn.unwatch();
      } catch {
        /* watcher already closed */
      }
    }
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
  const granted = (flow: FlowRow) => {
    if (!deps.home || !deps.dataDir) return undefined;
    const consent = store.getCapabilityConsent(flow.id);
    const folders =
      consent?.hash === flow.hash ? Object.values(consent.pins?.folders ?? {}).map((pin) => pin.path) : [];
    return { home: deps.home, dataDir: deps.dataDir, folders };
  };
  const checked = (flow: FlowRow, manifest: FlowManifest, index: number) =>
    checkEnable({
      manifest,
      files: flow.files,
      index,
      projectDir: deps.projectDir,
      granted: granted(flow),
      flowExists: (id) => !!store.getFlow(id),
      selfId: flow.id,
    });
  function view(flow: FlowRow, manifest: FlowManifest, index: number, trigger: Trigger): TriggerView {
    const row = store.getTrigger(flow.id, index);
    const valid = checked(flow, manifest, index);
    const supported = SUPPORTED_KINDS.some((kind) => kind === trigger.kind);
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
            ? row.pausedWhy === "challenge"
              ? PAUSE_REASON.challenge
              : PAUSE_REASON.blocked_runs
            : undefined;
    if (!valid.ok && state !== "needs_ok") reason = valid.reason;
    const watcher = watchers.get(`${flow.id}:${index}`);
    if (!reason && state === "on" && watcher?.capped) reason = "Only the first 5,000 files are watched.";
    if (!reason && state === "on" && watcher && !watcher.watching)
      reason = "Watching is not available here; this folder is checked every 5 minutes.";
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
      ...(reason ? { reason: sanitizeText(reason, 300) } : {}),
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
    if (hash !== flow.hash)
      throw new EngineError(
        "not_allowed",
        "This flow changed since you looked at it. Reload and check it again.",
      );
    if (old?.enabled && old.hash === hash) return view(flow, manifest, index, trigger);
    const result = checked(flow, manifest, index);
    if (!result.ok) throw new EngineError("not_allowed", result.reason);
    if (trigger.kind === "file_change") {
      const resolved = resolveRoot(deps.projectDir, trigger.path, granted(flow));
      if (!resolved.ok) throw new EngineError("not_allowed", resolved.reason);
      let scanned: ReturnType<typeof scanFolder>;
      try {
        scanned = scanFolder(resolved.root, {
          glob: trigger.glob,
          maxEntries: MAX_SCAN_ENTRIES,
          within: resolved.within ?? realpathSync(deps.projectDir),
        });
      } catch {
        throw new EngineError("not_allowed", "That folder does not exist.");
      }
      if (scanned.outside)
        throw new EngineError(
          "not_allowed",
          "Only folders inside the project folder or a folder you granted to this flow can be watched.",
        );
      store.putSetting(`snap:${id}:${index}`, scanned.files);
      close(id, index);
    }
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
    detail = detail === undefined ? undefined : Array.from(detail).slice(0, 200).join("");
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
    onClaim?: () => void,
  ): TriggerRow {
    if (store.getSetting("agentPermission") !== "on") {
      if (trigger.kind === "flow_done" || trigger.kind === "file_change") {
        if (!store.claimKey(flow.id, row.index, key, deps.now().toISOString())) return row;
      }
      return record(row, "refused", "permission_off");
    }
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
    if (!result.ok && !result.consume) {
      if (trigger.kind === "flow_done") {
        const rollback = {};
        let claimed = false;
        try {
          store.transaction(() => {
            claimed = store.claimKey(flow.id, row.index, key, now.toISOString());
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
        if (!claimed) return row;
      }
      return record(row, result.outcome, result.detail);
    }
    if (!store.claimKey(flow.id, row.index, key, now.toISOString()))
      return trigger.kind === "flow_done" ? row : record(row, "duplicate");
    onClaim?.();
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
        trigger: { kind: trigger.kind, payload, index: row.index },
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
      return record(row, outcome, message);
    }
  }
  function pauseRow(row: TriggerRow, flowName: string, why: PausedWhy): void {
    const pausedAt = deps.now().toISOString();
    store.putTrigger({ ...row, enabled: false, pausedAt, pausedWhy: why, recentRuns: [] });
    close(row.flowId, row.index);
    audit("trigger_paused", { flowId: row.flowId, index: row.index });
    try {
      deps.onPaused?.({
        flowId: row.flowId,
        index: row.index,
        flowName,
        pausedAt,
        ...(why === "challenge" ? { why } : {}),
      });
    } catch {
      /* notification is optional */
    }
  }
  function pauseByRun(runId: string): boolean {
    let paused = false;
    try {
      const run = store.getRun(runId);
      const index = run?.trigger?.index;
      const rows =
        run && typeof index === "number" && Number.isSafeInteger(index) && index >= 0
          ? [store.getTrigger(run.flowId, index)]
          : store
              .listTriggers()
              .map((candidate) => store.getTrigger(candidate.flowId, candidate.index))
              .filter((row) => row?.recentRuns?.includes(runId));
      for (const row of rows) {
        if (!row?.enabled) continue;
        const found = flowOf(row.flowId);
        if (!found) continue;
        try {
          pauseRow(row, found.manifest.name, "challenge");
          paused = true;
        } catch {
          /* one row failing must not keep the others from pausing */
        }
      }
    } catch {
      /* pausing is best effort and never throws */
    }
    return paused;
  }
  function section(candidate: TriggerRow) {
    if (store.getFlowHead(candidate.flowId)?.deletedAt) return;
    let row = store.getTrigger(candidate.flowId, candidate.index);
    if (!row?.enabled) return;
    try {
      const found = flowOf(row.flowId);
      if (!found) return;
      const { flow, manifest } = found;
      if (
        row.recentRuns?.length === 3 &&
        row.recentRuns.every((id) => store.getRun(id)?.state === "blocked")
      ) {
        pauseRow(row, manifest.name, "blocked_runs");
        return;
      }
      const trigger = manifest.triggers.at(row.index);
      if (!trigger || row.hash !== flow.hash || row.spec !== JSON.stringify(trigger)) {
        close(row.flowId, row.index);
        const updated = record(row, "needs_ok");
        if (updated !== row) store.putTrigger(updated);
        return;
      }
      if (trigger.kind === "file_change") {
        const key = `${row.flowId}:${row.index}`;
        const resolved = resolveRoot(deps.projectDir, trigger.path, granted(flow));
        if (!resolved.ok) {
          close(row.flowId, row.index);
          const updated = record(row, "refused", resolved.reason);
          if (updated !== row) store.putTrigger(updated);
          return;
        }
        let state = watchers.get(key);
        if (state && state.root !== resolved.root) {
          close(row.flowId, row.index);
          state = undefined;
        }
        if (!state) {
          state = { root: resolved.root, watching: false };
          const current = state;
          watchers.set(key, state);
          let failed = false;
          try {
            const unwatch = deps.watch(
              resolved.root,
              () => {
                const now = deps.now().getTime();
                current.dirtyFirst ??= now;
                current.dirtyLast = now;
              },
              () => {
                if (watchers.get(key) !== current) return;
                failed = true;
                current.watching = false;
                const stop = current.unwatch;
                delete current.unwatch;
                try {
                  stop?.();
                } catch {
                  /* periodic fallback */
                }
              },
            );
            if (unwatch && failed) unwatch();
            else if (unwatch) {
              state.unwatch = unwatch;
              state.watching = true;
            }
          } catch {
            /* periodic fallback */
          }
        }
        const now = deps.now().getTime();
        const debounce = durationMs(trigger.debounce);
        if (
          state.lastScan !== undefined &&
          now - state.lastScan < RESCAN_MS &&
          (state.dirtyLast === undefined ||
            state.dirtyFirst === undefined ||
            (now - state.dirtyLast < debounce &&
              now - state.dirtyFirst < Math.max(6 * debounce, MAX_DEBOUNCE_WAIT_MS)))
        )
          return;
        delete state.dirtyFirst;
        delete state.dirtyLast;
        state.lastScan = now;
        const scanned = scanFolder(state.root, {
          glob: trigger.glob,
          maxEntries: MAX_SCAN_ENTRIES,
          within: resolved.within ?? realpathSync(deps.projectDir),
        });
        state.capped = scanned.capped;
        if (scanned.outside) {
          const updated = record(
            row,
            "refused",
            "Only folders inside the project folder or a folder you granted to this flow can be watched.",
          );
          if (updated !== row) store.putTrigger(updated);
          return;
        }
        const setting = `snap:${row.flowId}:${row.index}`;
        const stored = parseSnapshot(store.getSetting(setting));
        if (!stored) {
          store.putSetting(setting, scanned.files);
          return;
        }
        const { changed, removed } = diffSnapshot(stored, scanned.files);
        if (!changed.length) {
          if (removed.length) store.putSetting(setting, scanned.files);
          return;
        }
        const max = manifest.limits?.max_items ?? DEFAULT_MAX_ITEMS;
        const batch = changed.slice(0, max);
        const entries = batch.map((path) => {
          const item = scanned.files[path];
          if (!item) throw new Error("Missing scanned file");
          return [path, item[0], item[1]];
        });
        const fireKey = `files:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`;
        const updated = fire(
          row,
          flow,
          manifest,
          trigger,
          fireKey,
          { count: batch.length, total: changed.length, files: payloadFiles(batch, max) },
          "queue",
        );
        if (updated !== row) store.putTrigger(updated);
        if (
          ["started", "dropped_cap", "refused", "duplicate"].some(
            (outcome) => outcome === updated.lastFire?.outcome,
          )
        )
          store.putSetting(setting, mergeHandled(stored, scanned.files, batch));
        if (
          changed.length > batch.length ||
          updated.lastFire?.outcome === "dropped_queue_full" ||
          updated.lastFire?.outcome === "needs_ok"
        ) {
          state.dirtyFirst = now;
          state.dirtyLast = now;
        }
        return;
      }
      if (trigger.kind === "flow_done") {
        if (!store.getFlow(trigger.flow)) return;
        const now = deps.now().getTime();
        const since = Math.max(Date.parse(row.enabledAt), now - FLOW_DONE_WINDOW_MS);
        if (!Number.isFinite(since)) return;
        const runs = store
          .listRuns({ flowId: trigger.flow })
          .filter(
            (run) =>
              run.endedAt !== undefined &&
              Number.isFinite(Date.parse(run.endedAt)) &&
              Date.parse(run.endedAt) >= since &&
              Date.parse(run.endedAt) <= now &&
              (run.state === "done" || (trigger.status === "any" && run.state === "failed")),
          )
          .sort((a, b) => Date.parse(a.endedAt ?? "") - Date.parse(b.endedAt ?? ""));
        let handled = 0;
        for (const run of runs) {
          if (handled >= FLOW_DONE_PER_TICK) break;
          let depth = 1;
          if (run.trigger?.kind === "flow_done") {
            const payload = run.trigger.payload;
            if (
              !payload ||
              typeof payload !== "object" ||
              Array.isArray(payload) ||
              typeof payload.depth !== "number" ||
              !Number.isSafeInteger(payload.depth) ||
              payload.depth < 1
            )
              continue;
            depth += payload.depth;
          }
          if (depth > MAX_CHAIN_DEPTH) {
            if (!store.claimKey(flow.id, row.index, run.id, deps.now().toISOString())) continue;
            handled++;
            row = record(row, "depth");
            store.putTrigger(row);
            audit("trigger_depth", { flowId: flow.id, upstream: run.id, depth });
            continue;
          }
          let claimed = false;
          const updated = fire(
            row,
            flow,
            manifest,
            trigger,
            run.id,
            { flow: trigger.flow, run: run.id, status: run.state, depth },
            "queue",
            () => {
              claimed = true;
            },
          );
          if (claimed) handled++;
          if (updated !== row) store.putTrigger(updated);
          row = updated;
        }
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
      if (!onTime && trigger.catch_up !== "once")
        row = record(row, "missed", `${due.capped ? "more than " : ""}${due.slots} missed`);
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
      if (due.capped && row.lastFire?.outcome === "started")
        row = {
          ...row,
          lastFire: { ...row.lastFire, detail: `more than ${onTime ? due.slots - 1 : due.slots} missed` },
        };
      store.putTrigger({ ...row, cursorMs: due.latest });
    } catch (e) {
      const fresh = store.getTrigger(candidate.flowId, candidate.index);
      if (fresh?.enabled) {
        try {
          store.putTrigger(record(fresh, "error", e instanceof Error ? e.message : "Unknown error"));
        } catch {
          /* keep other triggers running */
        }
      }
    }
  }
  function tick(): Promise<void> {
    if (stopped) return chain;
    chain = chain
      .then(() => {
        if (stopped) return;
        const now = deps.now().getTime();
        if (Number.isFinite(now) && (lastPurge === undefined || now - lastPurge >= 3_600_000)) {
          store.purgeKeys(new Date(now - KEY_KEEP_MS).toISOString());
          lastPurge = now;
        }
        for (const row of store.listTriggers()) if (row.enabled) section(row);
      })
      .catch(() => {});
    return chain;
  }
  function poke() {
    if (!running || poked) return;
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
    pauseByRun,
    settled: async () => {
      await Promise.resolve();
      await chain;
    },
    start() {
      running = true;
      stopped = false;
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
      running = false;
      stopped = true;
      try {
        cancel?.();
      } catch {
        /* no throw */
      }
      cancel = undefined;
      for (const watcher of watchers.values())
        try {
          watcher.unwatch?.();
        } catch {
          /* no throw */
        }
      watchers.clear();
    },
  };
}
