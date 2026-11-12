import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import type { Routed } from "./router/types.ts";
import { HARNESS_STATE_SCHEMA, SCHEMA, TRIGGER_SCHEMA, USAGE_SCHEMA } from "./schema.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { RunRow, StepRow, Store } from "./storage.ts";
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
const consent = { flowId: "f", hash: "hash", at: "2026-11-12" };

test("an allow row round-trips, a put replaces the row of that flow, and a delete removes it", async () => {
  const store = await open();
  expect(store.getCapabilityConsent("f")).toBeUndefined();
  store.putCapabilityConsent(consent);
  expect(store.getCapabilityConsent("f")).toEqual(consent);
  const replacement = { ...consent, hash: "new", at: "later" };
  store.putCapabilityConsent(replacement);
  expect(store.getCapabilityConsent("f")).toEqual(replacement);
  store.putCapabilityConsent({ ...consent, flowId: "other" });
  store.deleteCapabilityConsent("f");
  expect(store.getCapabilityConsent("f")).toBeUndefined();
  expect(store.getCapabilityConsent("other")).toEqual({ ...consent, flowId: "other" });
});

test("a row that is not JSON or has the wrong field types reads as absent", async () => {
  const path = tempPath();
  const store = await open(path);
  const db = new DatabaseSync(path);
  try {
    const insert = db.prepare("INSERT INTO capability_consents VALUES (?, ?, ?)");
    insert.run("bad-json", "not json", JSON.stringify("date"));
    insert.run("bad-hash", JSON.stringify(123), JSON.stringify("date"));
    insert.run("bad-at", JSON.stringify("hash"), JSON.stringify({ date: 1 }));
    insert.run("bad-at-json", JSON.stringify("hash"), "not json");
    for (const id of ["bad-json", "bad-hash", "bad-at", "bad-at-json"]) {
      expect(store.getCapabilityConsent(id)).toBeUndefined();
    }
    expect(db.prepare("SELECT count(*) AS n FROM capability_consents").get()?.n).toBe(4);
  } finally {
    db.close();
  }
});

test("a version 4 database migrates to 5 and keeps its rows", async () => {
  const path = tempPath();
  const db = new DatabaseSync(path);
  db.exec(`${SCHEMA} ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} PRAGMA user_version = 4;`);
  db.prepare("INSERT INTO settings VALUES (?, ?)").run("keep", JSON.stringify({ value: 1 }));
  db.close();
  const store = await open(path);
  expect(store.getSetting("keep")).toEqual({ value: 1 });
  store.putCapabilityConsent(consent);
  expect(store.getCapabilityConsent("f")).toEqual(consent);
  const check = new DatabaseSync(path);
  expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(5);
  check.close();
});

test("a version 1 database reaches 5 with every table, including capability_consents", async () => {
  const path = tempPath();
  const db = new DatabaseSync(path);
  db.exec(`${SCHEMA} PRAGMA user_version = 1;`);
  db.close();
  await open(path);
  const check = new DatabaseSync(path);
  expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(5);
  const tables = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  expect(tables).toEqual(
    expect.arrayContaining([
      "flows",
      "runs",
      "steps",
      "items",
      "seen",
      "approvals",
      "grants",
      "counters",
      "audit_log",
      "harness_state",
      "usage_events",
      "settings",
      "triggers",
      "fire_keys",
      "capability_consents",
    ]),
  );
  check.close();
});

test("routes on a run and outside on a step round-trip, and a run stored without routes reads without them", async () => {
  const store = await open();
  const routes: Routed[] = [
    {
      routed: true,
      requirementId: "web",
      type: "web",
      provider: "claude-in-chrome",
      providerName: "Chrome",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "unofficial",
      away: true,
    },
    { routed: false, requirementId: "other", type: "other", noun: "other", reason: "unavailable" },
  ];
  const run: RunRow = {
    id: "r",
    flowId: "f",
    flowHash: "h",
    flowVersion: "1",
    state: "running",
    project: "p",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: "now",
    routes,
  };
  const step: StepRow = {
    runId: "r",
    stepId: "s",
    itemKey: "",
    state: "pending",
    attempts: [],
    outputs: {},
    checks: [],
    outside: true,
  };
  store.createRun(run);
  store.upsertStep(step);
  expect(store.getRun("r")).toEqual(run);
  expect(store.getStep("r", "s")).toEqual(step);
  const { routes: _routes, ...withoutRoutes } = run;
  store.createRun({ ...withoutRoutes, id: "old" });
  expect(store.getRun("old")).toEqual({ ...withoutRoutes, id: "old" });
  expect(store.getRun("old")).not.toHaveProperty("routes");
});
