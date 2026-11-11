import type { HarnessUsage, LimitWindow, Totals, UsageSummary } from "@flowdriven/contracts";
import type { HarnessQuota, QuotaWindow } from "../keeper/types.ts";
import type { Store, UsageEventRow } from "../storage.ts";

export function liveWindow(w: QuotaWindow | undefined, nowMs: number): LimitWindow | undefined {
  if (
    w?.utilization === undefined ||
    !Number.isFinite(w.utilization) ||
    w.utilization < 0 ||
    w.utilization > 1
  )
    return undefined;
  if (w.resetsAt === undefined) return { utilization: w.utilization };
  const date = new Date(w.resetsAt * 1000);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= nowMs) return undefined;
  return { utilization: w.utilization, resetsAt: date.toISOString() };
}
function totals(rows: UsageEventRow[]): Totals {
  const out: Totals = { calls: rows.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const row of rows)
    for (const m of row.models) {
      out.input += m.input;
      out.output += m.output;
      out.cacheRead += m.cacheRead;
      out.cacheWrite += m.cacheWrite;
    }
  return out;
}
export function summarizeUsage(o: {
  store: Store;
  now: Date;
  quotaOf: (harnessId: string) => HarnessQuota;
  lines: { fiveHour: number; sevenDay: number };
}): UsageSummary {
  const rows = o.store.listUsage();
  const nowMs = o.now.getTime();
  const day = Date.UTC(o.now.getUTCFullYear(), o.now.getUTCMonth(), o.now.getUTCDate());
  const week = nowMs - 7 * 86400_000;
  const harnesses: HarnessUsage[] = [...new Set(rows.map((r) => r.harness))].map((id) => {
    const own = rows.filter((r) => r.harness === id);
    const quota = o.quotaOf(id);
    const fiveHour = liveWindow(quota.fiveHour, nowMs);
    const sevenDay = liveWindow(quota.sevenDay, nowMs);
    const rejected =
      quota.rejectedUntil !== undefined &&
      Number.isFinite(quota.rejectedUntil) &&
      quota.rejectedUntil > nowMs &&
      Number.isFinite(new Date(quota.rejectedUntil).getTime());
    const status = rejected
      ? "limited"
      : (fiveHour && fiveHour.utilization >= o.lines.fiveHour) ||
          (sevenDay && sevenDay.utilization >= o.lines.sevenDay)
        ? "warning"
        : fiveHour || sevenDay
          ? "ok"
          : "unknown";
    return {
      harnessId: id,
      name: id === "claude-code" ? "Claude Code" : id,
      today: totals(own.filter((r) => Date.parse(r.at) >= day && Date.parse(r.at) <= nowMs)),
      week: totals(own.filter((r) => Date.parse(r.at) >= week && Date.parse(r.at) <= nowMs)),
      limit: {
        status,
        ...(fiveHour ? { fiveHour } : {}),
        ...(sevenDay ? { sevenDay } : {}),
        ...(rejected ? { until: new Date(quota.rejectedUntil as number).toISOString() } : {}),
      },
    };
  });
  return { harnesses };
}
