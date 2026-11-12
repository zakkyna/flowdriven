import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { HARNESS_STATE_SCHEMA, SCHEMA, USAGE_SCHEMA } from "./schema.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store, TriggerRow } from "./storage.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  cleanup();
});
async function open(path = ":memory:") {
  const store = await openSqliteStore(path);
  stores.push(store);
  return store;
}
const row: TriggerRow = {
  flowId: "f",
  index: 0,
  enabled: true,
  hash: "h",
  spec: "{}",
  enabledAt: "2026-11-12T00:00:00.000Z",
  cursorMs: 123,
  recentRuns: ["r1", "r2", "r3"],
  pausedAt: "2026-11-12T01:00:00.000Z",
  lastFire: { at: "2026-11-12T00:30:00.000Z", outcome: "started", runId: "r1", detail: "detail" },
};

test("a trigger row round-trips, a put replaces it, and the list is by flow and index", async () => {
  const store = await open();
  const second = { ...row, index: 2 };
  const other = { ...row, flowId: "g", index: 1 };
  store.putTrigger(other);
  store.putTrigger(second);
  store.putTrigger(row);
  expect(store.getTrigger("f", 0)).toEqual(row);
  const replacement = { ...row, enabled: false };
  store.putTrigger(replacement);
  expect(store.getTrigger("f", 0)).toEqual(replacement);
  expect(store.getTrigger("f", 1)).toBeUndefined();
  expect(store.listTriggers()).toEqual([replacement, second, other]);
  expect(store.listTriggers("f")).toEqual([replacement, second]);
});

test("a row that is not JSON, or has the wrong field types (also recentRuns and pausedAt), reads as absent and is left out of the list", async () => {
  const path = tempPath();
  const store = await open(path);
  store.putTrigger(row);
  const db = new DatabaseSync(path);
  try {
    const insert = db.prepare("INSERT INTO triggers VALUES (?, ?, ?)");
    const invalid: unknown[] = [
      "not json",
      { ...row, enabled: "true" },
      { ...row, recentRuns: "r" },
      { ...row, recentRuns: ["1", "2", "3", "4"] },
      { ...row, recentRuns: [3] },
      { ...row, pausedAt: "not a date" },
      { ...row, lastFire: { at: "x", outcome: "unknown" } },
      { ...row, cursorMs: "1" },
    ];
    invalid.forEach((value, i) => {
      insert.run("bad", i, typeof value === "string" ? value : JSON.stringify(value));
    });
    for (let i = 0; i < invalid.length; i++) expect(store.getTrigger("bad", i)).toBeUndefined();
    expect(store.listTriggers()).toEqual([row]);
    expect(db.prepare("SELECT count(*) AS n FROM triggers WHERE flow_id = ?").get("bad")?.n).toBe(
      invalid.length,
    );
  } finally {
    db.close();
  }
});

test("claimKey is true once per flow, index and key; the same key on another index or flow is new", async () => {
  const store = await open();
  expect(store.claimKey("f", 0, "k", "2026-11-12")).toBe(true);
  expect(store.claimKey("f", 0, "k", "2026-11-13")).toBe(false);
  expect(store.claimKey("f", 1, "k", "2026-11-12")).toBe(true);
  expect(store.claimKey("g", 0, "k", "2026-11-12")).toBe(true);
});

test("purgeKeys removes keys older than the cut and keeps the rest, and returns the count", async () => {
  const store = await open();
  store.claimKey("f", 0, "old", "2026-11-10");
  store.claimKey("f", 0, "cut", "2026-11-11");
  store.claimKey("f", 0, "new", "2026-11-12");
  expect(store.purgeKeys("2026-11-11")).toBe(1);
  expect(store.claimKey("f", 0, "old", "2026-11-12")).toBe(true);
  expect(store.claimKey("f", 0, "cut", "2026-11-12")).toBe(false);
  expect(store.claimKey("f", 0, "new", "2026-11-12")).toBe(false);
});

test("a version 3 database migrates to 5 and keeps its rows; version 6 is refused", async () => {
  const path = tempPath();
  const db = new DatabaseSync(path);
  db.exec(`${SCHEMA} ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} PRAGMA user_version = 3;`);
  db.prepare("INSERT INTO settings VALUES (?, ?)").run("keep", JSON.stringify({ value: 1 }));
  db.close();
  const store = await open(path);
  expect(store.getSetting("keep")).toEqual({ value: 1 });
  store.putTrigger(row);
  expect(store.getTrigger("f", 0)).toEqual(row);
  const migrated = new DatabaseSync(path);
  expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(5);
  migrated.close();
  store.close();
  stores.pop();
  const newer = new DatabaseSync(path);
  newer.exec("PRAGMA user_version = 6");
  newer.close();
  await expect(openSqliteStore(path)).rejects.toMatchObject({
    code: "unavailable",
    message: "Unsupported database version.",
  });
});
