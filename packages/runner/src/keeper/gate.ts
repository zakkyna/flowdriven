import { DEFAULT_WEIGHT_MB, PRESSURE_HIGHEST, WEIGHT_MARGIN } from "./constants.ts";
import type { HarnessQuota, KeeperConfig, QuotaWindow, Ticket, Waiting } from "./types.ts";
export type GateInput = {
  ticket: Ticket;
  running: { ticket: Ticket }[];
  claimedMb: number;
  availableMb?: number;
  pressure?: number;
  quota?: HarnessQuota;
  weeklyAnswer?: "keep" | "hold";
  config: KeeperConfig;
  nowMs: number;
};
export function weightFromPeaks(peaks: number[], fallbackMb: number): number {
  return peaks.length ? Math.max(...peaks) * WEIGHT_MARGIN : fallbackMb;
}
export function defaultWeightMb(input: { harnessId: string; connectors: number }): number {
  return input.harnessId === "claude-code"
    ? DEFAULT_WEIGHT_MB.restricted + DEFAULT_WEIGHT_MB.perConnector * input.connectors
    : DEFAULT_WEIGHT_MB.unmeasured;
}
export function admit(i: GateInput): { ok: true } | { ok: false; waiting: Waiting } {
  const { ticket, config, nowMs } = i;
  const wait = (reason: Waiting["reason"], more: Partial<Waiting> = {}) =>
    ({ ok: false, waiting: { reason, harnessId: ticket.harnessId, ...more } }) as const;
  const iso = (ms?: number): Partial<Waiting> => {
    const d = ms === undefined ? undefined : new Date(ms);
    return d !== undefined && Number.isFinite(d.getTime()) ? { until: d.toISOString() } : {};
  };
  const until = (sec?: number): Partial<Waiting> => iso(sec === undefined ? undefined : sec * 1000);
  const live = (w?: QuotaWindow) =>
    w?.utilization !== undefined && (w.resetsAt === undefined || w.resetsAt * 1000 > nowMs) ? w : undefined;
  const q = i.quota;
  if (q?.rejectedUntil !== undefined && q.rejectedUntil > nowMs) return wait("quota", iso(q.rejectedUntil));
  const week = live(q?.sevenDay);
  if (ticket.cls === 2 && week && (week.utilization ?? 0) >= config.sevenDayLine && i.weeklyAnswer !== "keep")
    return wait("quota", until(week.resetsAt));
  const five = live(q?.fiveHour);
  const here = i.running.filter((r) => r.ticket.harnessId === ticket.harnessId).length;
  if (five && (five.utilization ?? 0) >= config.fiveHourLine && here >= 1)
    return wait("quota", until(five.resetsAt));
  if (i.running.length >= config.ceiling)
    return wait("ceiling", { running: i.running.length, ceiling: config.ceiling });
  if (i.pressure !== undefined && i.pressure >= PRESSURE_HIGHEST) return wait("memory");
  if (i.running.length === 0) return { ok: true };
  if (i.availableMb !== undefined && i.availableMb - i.claimedMb - ticket.weightMb < config.reserveMb)
    return wait("memory");
  return { ok: true };
}
