import type { Store } from "./storage.ts";

export function retentionSweep(store: Store, clock: () => Date = () => new Date()): void {
  const now = clock();
  const before90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const before30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  for (;;) {
    const rows = store.retentionCandidates(before90, before30);
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      store.transaction(() => store.deleteRetentionRows(batch));
    }
  }
  store.putSetting("retention", { lastSweepAt: now.toISOString() });
}
export function retentionDue(store: Store, clock: () => Date = () => new Date()): boolean {
  const value = store.getSetting("retention");
  const last = value && typeof value === "object" && !Array.isArray(value) ? value.lastSweepAt : undefined;
  return (
    typeof last !== "string" ||
    !Number.isFinite(Date.parse(last)) ||
    clock().getTime() - Date.parse(last) > 86_400_000
  );
}
