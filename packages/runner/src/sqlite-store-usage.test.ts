import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { HARNESS_STATE_SCHEMA, SCHEMA } from "./schema.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { RunRow, UsageEventRow } from "./storage.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const run = (id: string, flowId = "f"): RunRow => ({
  id,
  flowId,
  flowHash: "h",
  flowVersion: "1.0.0",
  state: "done",
  project: "/p",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: "2026-11-11T09:00:00.000Z",
});
const event = (runId: string, over: Partial<UsageEventRow> = {}): UsageEventRow => ({
  at: "2026-11-11T09:00:00.000Z",
  runId,
  stepId: "a",
  itemKey: "",
  attempt: 1,
  kind: "worker",
  harness: "claude-code",
  models: [{ model: "m", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 }],
  turns: 2,
  wallMs: 4800,
  queuedMs: 0,
  exit: "ok",
  ...over,
});
test("a usage event round-trips with tokens per model", async () => {
  const store = await openSqliteStore(":memory:");
  store.createRun(run("r1"));
  store.addUsage(event("r1", { memoryPeakMb: 150.5, costUsd: 0.0003 }));
  expect(store.listUsage({ runId: "r1" })).toEqual([event("r1", { memoryPeakMb: 150.5, costUsd: 0.0003 })]);
  expect(store.listUsage({ since: "2026-11-12T00:00:00.000Z" })).toEqual([]);
});
test("recentPeaks gives the largest peak of each of the last runs, newest first, and ignores rows with no peak", async () => {
  const store = await openSqliteStore(":memory:");
  for (const id of ["r1", "r2", "r3"]) store.createRun(run(id));
  store.createRun(run("x1", "other"));
  store.addUsage(event("r1", { memoryPeakMb: 100 }));
  store.addUsage(event("r1", { memoryPeakMb: 180, attempt: 2 }));
  store.addUsage(event("r2", { memoryPeakMb: 120 }));
  store.addUsage(event("r3"));
  store.addUsage(event("x1", { memoryPeakMb: 999 }));
  store.addUsage(event("r3", { memoryPeakMb: 140, kind: "judge" }));
  const q = { flowId: "f", stepId: "a", kind: "worker" as const, harness: "claude-code", runs: 5 };
  expect(store.recentPeaks(q)).toEqual([120, 180]);
  expect(store.recentPeaks({ ...q, runs: 1 })).toEqual([120]);
});
test("settings are stored as JSON", async () => {
  const store = await openSqliteStore(":memory:");
  expect(store.getSetting("keeper")).toBeUndefined();
  store.putSetting("keeper", { ceiling: 1 });
  expect(store.getSetting("keeper")).toEqual({ ceiling: 1 });
});
test("a version 2 database migrates to 3 and keeps its rows; version 99 is still refused", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  const path = join(dir, "db.sqlite");
  const old = new DatabaseSync(path);
  old.exec(`${SCHEMA} ${HARNESS_STATE_SCHEMA} PRAGMA user_version = 2;`);
  old
    .prepare("INSERT INTO harness_state (id, data) VALUES (?, ?)")
    .run("claude-code", '{"id":"claude-code","consent":"given"}');
  old.close();
  const store = await openSqliteStore(path);
  expect(store.getHarnessState("claude-code")?.consent).toBe("given");
  store.addUsage(event("r1"));
  store.close();
  const newer = new DatabaseSync(path);
  newer.exec("PRAGMA user_version = 99");
  newer.close();
  await expect(openSqliteStore(path)).rejects.toThrow("Unsupported database version.");
});

test("recentPeaks refuses an invalid run count", async () => {
  const store = await openSqliteStore(":memory:");
  expect(() =>
    store.recentPeaks({ flowId: "f", stepId: "a", kind: "worker", harness: "claude-code", runs: -1 }),
  ).toThrow();
  store.close();
});
