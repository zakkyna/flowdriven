import { totalmem } from "node:os";
import type { RunnerTopic } from "@flowdriven/contracts";
import { DEFAULT_KEEPER, KeeperSettings } from "@flowdriven/contracts/v1";
import type { HarnessAdapter } from "../harness.ts";
import { HISTORY_RUNS } from "../keeper/constants.ts";
import { defaultWeightMb, weightFromPeaks } from "../keeper/gate.ts";
import { createKeeper } from "../keeper/keeper.ts";
import { createKeptHarness } from "../keeper/kept-harness.ts";
import { createProbes, realCapture, reserveMb } from "../keeper/probes.ts";
import type { Keeper, Probes, QuotaWindow } from "../keeper/types.ts";
import type { Store } from "../storage.ts";

export type Every = (ms: number, fn: () => void) => () => void;
export function readKeeperSettings(store: Pick<Store, "getSetting">): KeeperSettings {
  const value = store.getSetting("keeper");
  if (value === undefined) return DEFAULT_KEEPER;
  const result = KeeperSettings.safeParse(value);
  return result.success
    ? result.data
    : { ...DEFAULT_KEEPER, ceiling: 1, quotaLines: { fiveHour: 0.9, sevenDay: 0.9 } };
}
export function wireKeeper(o: {
  store: Store;
  now: () => Date;
  harness: HarnessAdapter;
  probes?: Probes;
  every?: Every;
  weekly?: {
    answerOf(harnessId: string): "keep" | "hold" | undefined;
    onLimit(harnessId: string, window: QuotaWindow): void;
  };
  markChanged?: (topic: RunnerTopic) => void;
}): { harness: HarnessAdapter; keeper: Keeper; probes: Probes } {
  const { store } = o;
  const stored = store.getSetting("keeper");
  if (stored !== undefined && !KeeperSettings.safeParse(stored).success)
    store.appendAudit({
      at: o.now().toISOString(),
      kind: "keeper_settings_invalid",
      detail: "The stored keeper settings could not be read; the ceiling is 1 until they are saved again.",
    });
  const probes =
    o.probes ??
    createProbes({
      capture: realCapture,
      platform: process.platform,
      availableMemory: process.availableMemory,
      totalMemory: totalmem,
    });
  const every: Every =
    o.every ??
    ((ms, fn) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return () => clearInterval(timer);
    });
  const keeper = createKeeper({
    probes,
    every,
    nowMs: () => o.now().getTime(),
    config: () => {
      const s = readKeeperSettings(store);
      return {
        ceiling: s.ceiling,
        reserveMb: reserveMb(s.reserveMb, probes.totalMb()),
        fiveHourLine: s.quotaLines.fiveHour,
        sevenDayLine: s.quotaLines.sevenDay,
      };
    },
    weeklyAnswer: (id) => o.weekly?.answerOf(id),
    onWeekly: (id, window) => o.weekly?.onLimit(id, window),
    onChange: () => o.markChanged?.("runs"),
    loadQuota: () => {
      const result: Record<string, { fiveHour?: QuotaWindow; sevenDay?: QuotaWindow }> = {};
      for (const id of new Set([o.harness.id, "claude-code"])) {
        try {
          const value = store.getSetting(`quota:${id}`);
          if (value === undefined) continue;
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new Error("Invalid stored quota.");
          const windows: { fiveHour?: QuotaWindow; sevenDay?: QuotaWindow } = {};
          for (const key of ["fiveHour", "sevenDay"] as const) {
            const w = value[key];
            if (w === undefined) continue;
            if (typeof w !== "object" || w === null || Array.isArray(w))
              throw new Error("Invalid stored quota.");
            const utilization = w.utilization;
            const resetsAt = w.resetsAt;
            if (
              (utilization !== undefined &&
                (typeof utilization !== "number" ||
                  !Number.isFinite(utilization) ||
                  utilization < 0 ||
                  utilization > 1)) ||
              (resetsAt !== undefined &&
                (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt < 0))
            )
              throw new Error("Invalid stored quota.");
            windows[key] = {
              ...(utilization === undefined ? {} : { utilization }),
              ...(resetsAt === undefined ? {} : { resetsAt }),
            };
          }
          result[id] = windows;
        } catch {
          store.deleteSetting(`quota:${id}`);
        }
      }
      return result;
    },
    saveQuota: (id, windows) => store.putSetting(`quota:${id}`, windows),
  });
  const harness = createKeptHarness({
    inner: o.harness,
    keeper,
    nowMs: () => o.now().getTime(),
    at: () => o.now().toISOString(),
    info: (id) => {
      const run = store.getRun(id);
      return run
        ? {
            cls: run.trigger && run.trigger.kind !== "manual" ? 2 : 1,
            underWay: store.listSteps(id).some((step) => step.state === "passed" || step.state === "skipped"),
            startedAt: run.startedAt,
            flowId: run.flowId,
          }
        : undefined;
    },
    weight: (q) =>
      weightFromPeaks(
        store.recentPeaks({
          flowId: q.flowId,
          stepId: q.stepId,
          kind: q.kind,
          harness: q.harnessId,
          runs: HISTORY_RUNS,
        }),
        defaultWeightMb({ harnessId: q.harnessId, connectors: q.connectors }),
      ),
    record: (row) => store.addUsage(row),
  });
  return { harness, keeper, probes };
}
