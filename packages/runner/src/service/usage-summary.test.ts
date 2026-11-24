import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store, UsageEventRow } from "../storage.ts";
import { createDispatcher, createHandlers } from "./handlers.ts";
import { createRunnerService, type RunnerService } from "./service.ts";
import { summarizeUsage } from "./usage-summary.ts";

const roots: string[] = [];
const stores: Store[] = [];
const services: RunnerService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
const now = () => new Date("2026-11-11T12:00:00.000Z");
const row = (at: string, models: UsageEventRow["models"]): UsageEventRow => ({
  at,
  runId: "r",
  stepId: "s",
  itemKey: "",
  attempt: 1,
  kind: "worker",
  harness: "claude-code",
  models,
  turns: 0,
  wallMs: 0,
  queuedMs: 0,
  exit: "ok",
});
const model = { model: "m", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 };
async function rig() {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  return store;
}
test("summarizes today and the rolling week and reports quota status", async () => {
  const store = await rig();
  for (const at of [
    "2026-11-11T01:00:00.000Z",
    "2026-11-11T02:00:00.000Z",
    "2026-11-08T12:00:00.000Z",
    "2026-11-01T12:00:00.000Z",
  ])
    store.addUsage(row(at, [model]));
  const summary = (quotaOf: Parameters<typeof summarizeUsage>[0]["quotaOf"]) =>
    summarizeUsage({ store, now: now(), quotaOf, lines: { fiveHour: 0.9, sevenDay: 0.9 } }).harnesses.at(0);
  expect(
    summary(() => ({
      sevenDay: { utilization: 0.92, resetsAt: Date.parse("2026-11-14T17:59:00.000Z") / 1000 },
    })),
  ).toMatchObject({
    harnessId: "claude-code",
    name: "Claude Code",
    today: { calls: 2, input: 8, output: 768, cacheRead: 16908, cacheWrite: 312 },
    week: { calls: 3, input: 12, output: 1152, cacheRead: 25362, cacheWrite: 468 },
    limit: { status: "warning", sevenDay: { utilization: 0.92, resetsAt: "2026-11-14T17:59:00.000Z" } },
  });
  expect(summary(() => ({ rejectedUntil: now().getTime() + 1000 }))?.limit.status).toBe("limited");
  expect(summary(() => ({}))?.limit.status).toBe("unknown");
});
test("TC-AGT-11 retired harness card and usage summary retain usage and stored windows", async () => {
  const store = await rig();
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dataDir);
  const service = createRunnerService({ store, dataDir, mode: "demo", now });
  services.push(service);
  await service.start().settled;
  const call = createDispatcher({
    v2: {},
    legacy: createHandlers({
      engine: service.engine,
      store,
      mode: "demo",
      projectDir: dataDir,
      now,
      harnessIdOf: (id) => id,
    }),
    audit: () => {},
  });
  await expect(call("harnesses.list", {})).rejects.toMatchObject({ code: "unavailable", reason: "retired" });
  store.addUsage(row("2026-11-11T01:00:00.000Z", [model]));
  store.addUsage(
    row("2026-11-11T02:00:00.000Z", [{ ...model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]),
  );
  store.putSetting("quota:claude-code", {
    sevenDay: { utilization: 0.78, resetsAt: Date.parse("2026-11-14T17:59:00.000Z") / 1000 },
  });
  expect(
    summarizeUsage({
      store,
      now: now(),
      quotaOf: () => ({
        sevenDay: { utilization: 0.78, resetsAt: Date.parse("2026-11-14T17:59:00.000Z") / 1000 },
      }),
      lines: { fiveHour: 0.9, sevenDay: 0.9 },
    }).harnesses[0],
  ).toMatchObject({
    today: { calls: 2, input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 },
    week: { calls: 2, input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 },
    limit: { status: "ok", sevenDay: { utilization: 0.78, resetsAt: "2026-11-14T17:59:00.000Z" } },
  });
  store.addUsage(row("2026-11-11T03:00:00.000Z", [{ ...model, input: 1e300, output: 1e300 }]));
  const capped = summarizeUsage({
    store,
    now: now(),
    quotaOf: () => ({}),
    lines: { fiveHour: 0.9, sevenDay: 0.9 },
  }).harnesses[0];
  expect(capped?.today).toMatchObject({ input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER });
  expect(capped?.week).toMatchObject({ input: Number.MAX_SAFE_INTEGER, output: Number.MAX_SAFE_INTEGER });
  const auditBefore = store.listAudit();
  await expect(call("usage.summary", {})).rejects.toMatchObject({ code: "unavailable", reason: "retired" });
  await expect(call("usage.summary", { unexpected: 1 })).rejects.toMatchObject({
    code: "unavailable",
    reason: "retired",
  });
  await expect(service.call("usage.summary", {})).rejects.toMatchObject({
    code: "unavailable",
    reason: "retired",
  });
  expect(store.listAudit()).toEqual(auditBefore);
});

test("today and the week start at the owner's local midnight", async () => {
  const store = await rig();
  // The boundary is the owner's local day, even when UTC calendar fields differ.
  class LocalNow extends Date {
    override getUTCDate() {
      return super.getUTCDate() - 1;
    }
  }
  const at = new LocalNow(2026, 10, 11, 12);
  for (const date of [
    new Date(2026, 10, 10, 23, 59),
    new Date(2026, 10, 11, 0, 0),
    new Date(2026, 10, 4, 0, 0),
    new Date(2026, 10, 3, 23, 59),
  ])
    store.addUsage(row(date.toISOString(), [model]));
  const result = summarizeUsage({
    store,
    now: at,
    quotaOf: () => ({}),
    lines: { fiveHour: 0.9, sevenDay: 0.9 },
  }).harnesses.at(0);
  expect(result?.today.calls).toBe(1);
  expect(result?.week.calls).toBe(3);
});
