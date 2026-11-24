import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { retentionDue } from "./retention.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store } from "./storage.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

const stores: Store[] = [];
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const store of stores.splice(0)) store.close();
  cleanup();
});
const now = () => new Date("2026-11-21T03:00:00.000Z");
async function setup() {
  const path = tempPath();
  const store = await openSqliteStore(path);
  stores.push(store);
  const db = new DatabaseSync(path);
  dbs.push(db);
  return { store, db, path };
}
function run(
  db: DatabaseSync,
  id: string,
  flowId: string,
  endedAt = "2026-08-01T00:00:00.000Z",
  state = "done",
) {
  const data = {
    id,
    flowId,
    flowHash: "H1",
    flowVersion: "1",
    state,
    project: "p",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: endedAt,
    endedAt,
  };
  db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?)").run(id, flowId, state, JSON.stringify(data));
}
async function sweep(store: Store) {
  const { retentionSweep } = await import("./retention.ts");
  return retentionSweep(store, now);
}
test("TC-STO-29 retains runs by age or newest fifty", async () => {
  const { store, db } = await setup();
  for (let i = 0; i < 60; i++) {
    run(db, `a${i}`, "a");
    run(db, `c${i}`, "c", i < 10 ? "2026-08-01" : "2026-11-16");
  }
  for (let i = 0; i < 3; i++) run(db, `b${i}`, "b");
  const start = db.prepare(
    "INSERT INTO starts (id,flow_id,at,source,outcome,data) VALUES (?, ?, ?, 'schedule', 'missed', ?)",
  );
  for (let i = 0; i < 60; i++) start.run(`start${i}`, "a", "2026-08-01", JSON.stringify({ runId: `a${i}` }));
  for (let i = 0; i < 3; i++) start.run(`few${i}`, "b", "2026-08-01", "{}");
  db.exec(`INSERT INTO steps VALUES ('a0','s','','{}');
    INSERT INTO items VALUES ('a0','l','k',0,'{}');
    INSERT INTO approvals VALUES ('a','a0','approved','{}');
    INSERT INTO grants VALUES ('a0','tool','');
    INSERT INTO call_grants VALUES ('a0','s','','tool','d','{}');
    INSERT INTO usage_events (at,run_id,step_id,item_key,attempt,kind,harness,models,turns,wall_ms,queued_ms,exit) VALUES ('2026','a0','s','',1,'worker','a','[]',0,0,0,'ok');`);
  await sweep(store);
  for (const table of ["steps", "items", "approvals", "grants", "call_grants", "usage_events"]) {
    expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id = 'a0'`).get()?.n).toBe(0);
  }
  expect(db.prepare("SELECT count(*) AS n FROM starts WHERE flow_id = 'a'").get()?.n).toBe(50);
  expect(db.prepare("SELECT count(*) AS n FROM starts WHERE flow_id = 'b'").get()?.n).toBe(3);
  expect(store.listRuns({ flowId: "a" })).toHaveLength(50);
  expect(store.listRuns({ flowId: "b" })).toHaveLength(3);
  expect(store.listRuns({ flowId: "c" })).toHaveLength(50);
});
test("TC-STO-30 protects open runs, decisions and questions", async () => {
  const { store, db } = await setup();
  for (let i = 0; i < 56; i++) run(db, `new${i}`, "f", "2026-11-01");
  for (const state of ["waiting_approval", "needs_login", "running"])
    run(db, state, "f", "2026-07-01", state);
  run(db, "decision", "f", "2026-07-01");
  run(db, "question", "f", "2026-07-01");
  run(db, "from", "f", "2026-07-01");
  run(db, "after", "f", "2026-07-01");
  run(db, "unprotected", "f", "2026-07-01");
  db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?)").run("ap", "decision", "pending", "{}");
  db.exec("INSERT INTO chats VALUES ('chat','','now','{}')");
  const q = {
    id: "q",
    flowId: "f",
    chatId: "chat",
    messageId: "m",
    kind: "inputs",
    state: "open",
    createdAt: "2026",
    updatedAt: "2026",
    source: "schedule",
    proactive: true,
    flowHash: "H1",
    given: {},
    missing: [],
    runId: "question",
    pendingStart: { startId: "s", source: "schedule", request: {} },
  };
  store.putQuestion(q as Parameters<Store["putQuestion"]>[0]);
  for (const [field, id] of [
    ["fromRunId", "from"],
    ["afterRunId", "after"],
  ] as const) {
    db.prepare("INSERT INTO waiting_questions VALUES (?, ?, 'chat', 'inputs', 'open', ?)").run(
      id,
      id,
      JSON.stringify({ pendingStart: { request: { [field]: id } } }),
    );
  }
  await sweep(store);
  expect(store.getRun("unprotected")).toBeUndefined();
  for (const id of ["waiting_approval", "needs_login", "running", "decision", "question", "from", "after"])
    expect(store.getRun(id)).toBeDefined();
});
test("TC-STO-31 retains rules questions keys chats and audit by policy", async () => {
  const { store, db, path } = await setup();
  db.exec(
    "INSERT INTO chats VALUES ('chat','','now','{}'); INSERT INTO messages (id,chat_id,seq,at,kind,data) VALUES ('m','chat',1,'2025','text','{}'); INSERT INTO flow_heads VALUES ('deleted','name','','2025','{}')",
  );
  const backup = join(dirname(path), "backups", "backup.sqlite");
  mkdirSync(dirname(backup));
  writeFileSync(backup, "backup");
  const insert = db.prepare("INSERT INTO standing_rules VALUES (?, 'f', ?, ?)");
  insert.run("old", "revoked", JSON.stringify({ revokedAt: "2026-08-21" }));
  insert.run("recent", "revoked", JSON.stringify({ revokedAt: "2026-08-24" }));
  insert.run("active", "active", "{}");
  db.exec(
    "INSERT INTO seen VALUES ('f','l','old','2026-10-01'),('f','l','new','2026-11-01'); INSERT INTO fire_keys VALUES ('f',0,'old','2026-10-01'),('f',0,'new','2026-11-01')",
  );
  const question = db.prepare("INSERT INTO waiting_questions VALUES (?, ?, 'chat', 'inputs', ?, ?)");
  for (const [id, state, date] of [
    ["answered", "answered", "2026-10-01"],
    ["cancelled", "cancelled", "2026-11-01"],
    ["closed", "closed", "2026-10-01"],
    ["open", "open", "2026-01-01"],
  ] as const)
    question.run(id, id, state, JSON.stringify({ updatedAt: date }));
  store.appendAudit({ at: "2026", kind: "test", detail: {} });
  await sweep(store);
  expect(
    db
      .prepare("SELECT id FROM standing_rules ORDER BY id")
      .all()
      .map((r) => r.id),
  ).toEqual(["active", "recent"]);
  expect(
    db
      .prepare("SELECT key FROM seen")
      .all()
      .map((r) => r.key),
  ).toEqual(["new"]);
  expect(
    db
      .prepare("SELECT key FROM fire_keys")
      .all()
      .map((r) => r.key),
  ).toEqual(["new"]);
  expect(
    db
      .prepare("SELECT id FROM waiting_questions ORDER BY id")
      .all()
      .map((r) => r.id),
  ).toEqual(["cancelled", "open"]);
  expect(store.listChats()).toHaveLength(1);
  expect(db.prepare("SELECT count(*) AS n FROM messages").get()?.n).toBe(1);
  expect(db.prepare("SELECT count(*) AS n FROM flow_heads").get()?.n).toBe(1);
  expect(existsSync(backup)).toBe(true);
  expect(store.listAudit()).toHaveLength(1);
});
test("TC-STO-32 sweeps in batches and records the time", async () => {
  const { store, db } = await setup();
  for (let i = 0; i < 1250; i++) run(db, `r${i}`, "f");
  const tx = vi.spyOn(store, "transaction");
  await sweep(store);
  expect(store.listRuns()).toHaveLength(50);
  expect(tx).toHaveBeenCalledTimes(3);
  expect(store.getSetting("retention")).toEqual({ lastSweepAt: now().toISOString() });
  expect(retentionDue(store, () => new Date(now().getTime() + 23 * 3600000))).toBe(false);
  expect(retentionDue(store, () => new Date(now().getTime() + 25 * 3600000))).toBe(true);
});
test("TC-STO-33 removes unused versions only for deleted flows", async () => {
  const { store, db } = await setup();
  db.prepare("INSERT INTO flow_heads VALUES (?, ?, ?, ?, ?)").run("f", "f", "", "2026", "{}");
  for (const hash of ["H1", "H2"]) db.prepare("INSERT INTO flows VALUES (?, ?, ?)").run("f", hash, "{}");
  db.prepare("INSERT INTO flow_heads VALUES (?, ?, ?, ?, ?)").run("live", "live", "", null, "{}");
  for (const hash of ["L1", "L2", "L3"])
    db.prepare("INSERT INTO flows VALUES (?, ?, ?)").run("live", hash, "{}");
  run(db, "kept", "f", "2026-11-01");
  await sweep(store);
  expect(
    db
      .prepare("SELECT hash FROM flows WHERE id = 'f'")
      .all()
      .map((r) => r.hash),
  ).toEqual(["H1"]);
  expect(db.prepare("SELECT count(*) AS n FROM flow_heads").get()?.n).toBe(2);
  expect(db.prepare("SELECT count(*) AS n FROM flows WHERE id = 'live'").get()?.n).toBe(3);
  db.exec("DELETE FROM runs WHERE id = 'kept'");
  await sweep(store);
  expect(db.prepare("SELECT hash FROM flows WHERE id = 'f'").all()).toHaveLength(0);
});

test("TC-STO-32 runner sweeps at startup and after twenty-five hours", async () => {
  const { PassThrough } = await import("node:stream");
  const retention = await import("./retention.ts");
  const { runProcess } = await import("./service/run-process.ts");
  const spy = vi.spyOn(retention, "retentionSweep");
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  let time = now().getTime();
  const done = runProcess({
    dataDir: dirname(tempPath()),
    demo: false,
    input,
    output,
    errors: () => {},
    now: () => new Date(time),
    sweepEveryMs: 20,
  });
  const wait = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(condition()).toBe(true);
  };
  try {
    await wait(() => spy.mock.calls.length === 1);
    time += 23 * 3600000;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(spy).toHaveBeenCalledTimes(1);
    time += 2 * 3600000;
    await wait(() => spy.mock.calls.length === 2);
  } finally {
    input.end();
    await done;
    spy.mockRestore();
  }
});
