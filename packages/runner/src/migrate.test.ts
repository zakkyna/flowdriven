import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import { runProcess } from "./service/run-process.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import { makeOlderStore, makeStoreV6, readStoreV6 } from "./test-helpers/store-v6.ts";

const dirs: string[] = [];
const clock = () => new Date("2026-11-21T03:00:00Z");
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "flow-migrate-"));
  dirs.push(dir);
  return dir;
}
const backup = (dir: string) => join(dir, "backups", "flowdriven-v6-20261121T030000Z.sqlite");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
async function processExit(dir: string) {
  return runProcess({
    dataDir: dir,
    demo: false,
    input: new PassThrough(),
    output: new PassThrough(),
    errors: () => {},
    now: clock,
  });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("TC-STO-01 new store has version 7 without backup", async () => {
  const dir = folder();
  const path = join(dir, "flowdriven.sqlite");
  const store = await openSqliteStore(path);
  store.close();
  const db = new DatabaseSync(path, { readOnly: true });
  expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name),
  ).toEqual([
    "approvals",
    "audit_log",
    "call_grants",
    "capability_consents",
    "chats",
    "confirmations",
    "consent_pins",
    "counters",
    "drafts",
    "fire_keys",
    "flow_heads",
    "flows",
    "grants",
    "harness_state",
    "items",
    "messages",
    "remembered",
    "runs",
    "schedules",
    "seen",
    "settings",
    "standing_rules",
    "starts",
    "steps",
    "triggers",
    "usage_events",
    "waiting_questions",
  ]);
  expect(
    db
      .prepare("PRAGMA table_info(usage_events)")
      .all()
      .map((r) => r.name),
  ).toContain("billing");
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((r) => r.name);
  for (const name of [
    "runs_flow",
    "runs_state",
    "approvals_run",
    "approvals_state",
    "audit_log_run",
    "usage_events_at",
    "flow_heads_name",
    "standing_rules_flow",
    "schedules_after",
    "starts_key",
    "starts_flow_at",
    "starts_outcome_at",
    "chats_updated",
    "messages_chat_seq",
    "messages_card",
    "drafts_chat",
    "waiting_questions_open",
    "waiting_questions_chat",
  ])
    expect(indexes).toContain(name);
  db.close();
  expect(existsSync(join(dir, "backups"))).toBe(false);
});
test("TC-STO-03 backup is verified before migration", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  const store = await openSqliteStore(path, { now: clock });
  store.close();
  expect(existsSync(backup(dir))).toBe(true);
  expect(statSync(join(dir, "backups")).mode & 0o777).toBe(0o700);
  expect(statSync(backup(dir)).mode & 0o077).toBe(0);
  const db = new DatabaseSync(backup(dir), { readOnly: true });
  expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  db.close();
  expect(readStoreV6(backup(dir))).toEqual(before);
  const second = folder();
  const other = makeStoreV6(second);
  await expect(openSqliteStore(other, { now: clock, failAt: "create_tables" })).rejects.toMatchObject({
    reason: "migration_failed",
  });
  expect(existsSync(backup(second))).toBe(true);
});
test("TC-STO-04 newer store is untouched and exits 5", async () => {
  const dir = folder();
  const path = join(dir, "flowdriven.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=8");
  db.close();
  const before = digest(path);
  await expect(openSqliteStore(path, { exclusive: true })).rejects.toMatchObject({
    reason: "store_newer",
    message: "Unsupported database version.",
  });
  expect(digest(path)).toBe(before);
  expect(existsSync(join(dir, "backups"))).toBe(false);
  expect(await processExit(dir)).toBe(5);
  expect(digest(path)).toBe(before);
});
const steps = [
  "create_tables",
  "add_billing_column",
  "create_indexes",
  "fill_flow_heads",
  "fill_confirmations",
  "fill_call_grants",
  "write_audit",
  "set_version",
] as const;
test.each(steps)("TC-STO-05 rollback at %s", async (step) => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  await expect(openSqliteStore(path, { now: clock, failAt: step })).rejects.toMatchObject({
    reason: "migration_failed",
  });
  expect(readStoreV6(path)).toEqual(before);
  expect(existsSync(backup(dir))).toBe(true);
});
test("TC-STO-05 SQL migration failure exits 6", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE flow_heads (id TEXT)");
  db.close();
  expect(await processExit(dir)).toBe(6);
  expect(readStoreV6(path).version).toBe(6);
  expect(existsSync(backup(dir))).toBe(true);
});
test.each(["backup_vacuum", "backup_mkdir", "backup_integrity"] as const)(
  "TC-STO-06 backup failure %s leaves store unchanged",
  async (step) => {
    const dir = folder();
    const path = makeStoreV6(dir);
    const before = readStoreV6(path);
    await expect(openSqliteStore(path, { now: clock, failAt: step })).rejects.toMatchObject({
      reason: "backup_failed",
    });
    expect(readStoreV6(path)).toEqual(before);
  },
);
test("TC-STO-06 corrupt backup is rejected", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  await expect(
    openSqliteStore(path, {
      now: clock,
      failAt: (step) => {
        if (step === "backup_integrity") writeFileSync(backup(dir), "corrupt");
      },
    }),
  ).rejects.toMatchObject({ reason: "backup_failed" });
  expect(readStoreV6(path)).toEqual(before);
});
test("TC-STO-06 existing backup is refused", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "backups"));
  writeFileSync(backup(dir), "existing");
  await expect(openSqliteStore(path, { now: clock })).rejects.toMatchObject({ reason: "backup_failed" });
  expect(readFileSync(backup(dir), "utf8")).toBe("existing");
  expect(await processExit(dir)).toBe(6);
});
test("TC-STO-07 subsequent opens do not back up again", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  (await openSqliteStore(path, { now: clock })).close();
  const after = readStoreV6(path);
  for (const table of before.tables) {
    expect(after.rows[table]).toHaveLength(
      (before.rows[table]?.length ?? 0) + (table === "audit_log" ? 1 : 0),
    );
    for (const [index, row] of (before.rows[table] ?? []).entries()) {
      expect(after.rows[table]?.[index]).toMatchObject(row);
    }
  }
  for (let i = 0; i < 2; i++)
    (await openSqliteStore(path, { now: () => new Date("2026-11-21T04:00:00Z") })).close();
  expect(readStoreV6(path)).toEqual(after);
  expect(after.version).toBe(7);
  expect(readdirSync(join(dir, "backups"))).toHaveLength(1);
  expect(after.rows.audit_log?.filter((row) => row.kind === "store_migrated")).toHaveLength(1);
});
test("TC-STO-14 killed migration rolls back and retries", { timeout: 20000 }, async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./test-helpers/migrate-kill-child.ts", import.meta.url)), path],
    { stdio: "ignore" },
  );
  const [code, signal] = await once(child, "exit");
  expect(code).toBeNull();
  expect(signal).toBe("SIGKILL");
  expect(readStoreV6(path)).toEqual(before);
  (await openSqliteStore(path, { now: () => new Date("2026-11-21T03:01:00Z") })).close();
  expect(readStoreV6(path).version).toBe(7);
  expect(readdirSync(join(dir, "backups"))).toHaveLength(2);
});
test("TC-STO-16 lock precedes migration", { timeout: 20000 }, async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = digest(path);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./test-helpers/hold-lock-child.ts", import.meta.url)), path, "lock-only"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    await once(child.stdout, "data");
    expect(await processExit(dir)).toBe(3);
    expect(digest(path)).toBe(before);
    expect(existsSync(join(dir, "backups"))).toBe(false);
  } finally {
    child.stdin.end();
    await once(child, "exit");
  }
});

async function migrated() {
  const dir = folder();
  const path = makeStoreV6(dir);
  const before = readStoreV6(path);
  const store = await openSqliteStore(path, { now: clock });
  return { dir, path, before, store, db: new DatabaseSync(path) };
}
function dataRows(db: DatabaseSync, table: string) {
  return db
    .prepare(`SELECT data FROM ${table} ORDER BY rowid`)
    .all()
    .map((r) => JSON.parse(String(r.data)));
}
test("TC-STO-02 version 6 rows remain readable and unreadable approvals are counted", async () => {
  const { path, before, store, db } = await migrated();
  const after = readStoreV6(path);
  for (const table of before.tables) {
    expect(after.rows[table]).toHaveLength(
      (before.rows[table]?.length ?? 0) + (table === "audit_log" ? 1 : 0),
    );
    for (const [i, row] of (before.rows[table] ?? []).entries())
      expect(after.rows[table]?.[i]).toMatchObject(row);
  }
  // Version 2 defaults are checked separately by TC-ENG-19; every version 6 key must survive.
  const expectV6Keys = (actual: object | undefined, data: unknown) => {
    const original = JSON.parse(String(data)) as Record<string, unknown>;
    expect(actual).toBeDefined();
    expect(
      Object.fromEntries(Object.keys(original).map((key) => [key, Reflect.get(actual ?? {}, key)])),
    ).toEqual(original);
  };
  expectV6Keys(store.getRun("running"), before.rows.runs?.find((r) => r.id === "running")?.data);
  expectV6Keys(store.getFlow("example.fill-timesheet"), before.rows.flows?.[1]?.data);
  const oldApprovals = (before.rows.approvals ?? []).filter((row) => row.id !== "bad");
  const approvals = store.listApprovals();
  expect(approvals).toHaveLength(oldApprovals.length);
  oldApprovals.forEach((row, index) => {
    expectV6Keys(approvals[index], row.data);
  });
  expect(store.skippedRows()).toEqual({ approvals: 1 });
  db.close();
  store.close();
});
test("TC-STO-08 flow heads select newest versions and resolve duplicate names", async () => {
  const { store, db } = await migrated();
  const heads = dataRows(db, "flow_heads");
  expect(heads).toHaveLength(3);
  expect(heads[0]).toMatchObject({
    id: "example.fill-timesheet",
    headHash: "H2",
    createdAt: "2026-11-21T02:59:00.000Z",
    origin: { kind: "import" },
  });
  expect(heads[1]).toMatchObject({ origin: { kind: "demo" } });
  expect(heads[2]).toMatchObject({ name: "Fill timesheet 2", origin: { kind: "import" } });
  expect(store.getFlow("example.job-review")?.manifest).toMatchObject({ name: "Fill timesheet" });
  expect(store.listAudit().at(-1)?.detail).toMatchObject({
    renames: [{ flowId: "example.job-review", from: "Fill timesheet", to: "Fill timesheet 2" }],
  });
  db.close();
  store.close();
});
test("TC-SR3-12 and TC-STO-09 confirmations retain hashes and pins", async () => {
  const { store, db, dir } = await migrated();
  const confirmations = dataRows(db, "confirmations");
  expect(confirmations).toHaveLength(2);
  expect(confirmations[0]).toEqual({
    flowId: "example.fill-timesheet",
    hash: "H2",
    at: "2026",
    by: "migration",
    onItsOwn: [],
    legacy: true,
    pins: {
      skills: { skill: "sha256:skill" },
      folders: { project: { path: join(dir, "project"), access: "read_write" } },
    },
  });
  expect(confirmations[1]).toMatchObject({
    flowId: "example.build-apk",
    hash: "H0",
    by: "migration",
    onItsOwn: [],
    legacy: true,
    pins: { skills: {}, folders: {} },
  });
  const { flowState } = await import("./flow-state.ts");
  expect(
    ["example.fill-timesheet", "example.build-apk", "example.job-review"].map((id) => flowState(store, id)),
  ).toEqual(["confirmed", "changed", "new"]);
  expect(db.prepare("SELECT * FROM standing_rules").all()).toHaveLength(0);
  db.close();
  store.close();
});
test("TC-STO-10 open run grants retain tool and decision step", async () => {
  const { store, db, before } = await migrated();
  expect(dataRows(db, "call_grants")).toEqual([
    expect.objectContaining({
      runId: "waiting_approval",
      stepId: "step",
      tool: "mcp__x__send",
      digest: "digest",
      kind: "migrated",
    }),
    expect.objectContaining({
      runId: "waiting_approval",
      stepId: "*",
      tool: "pick",
      digest: "*",
      kind: "migrated",
    }),
  ]);
  expect(db.prepare("SELECT * FROM grants").all()).toEqual(before.rows.grants);
  db.close();
  store.close();
});
test("TC-SR2-12 and TC-STO-11 consent does not grant agent permission or create schedules", async () => {
  const { store, db, before, dir } = await migrated();
  const { createRunnerService } = await import("./service/service.ts");
  const { scriptedHarness } = await import("./scripted-harness.ts");
  const service = createRunnerService({
    store,
    dataDir: dir,
    mode: "live",
    now: clock,
    harness: scriptedHarness({ steps: {} }),
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  expect(await service.call("settings.get", {})).toMatchObject({
    agentPermission: "unset",
    mainAgent: null,
    language: "en",
  });
  expect(db.prepare("SELECT * FROM settings").all()).toEqual(before.rows.settings);
  expect(db.prepare("SELECT * FROM schedules").all()).toHaveLength(0);
  expect(db.prepare("SELECT * FROM standing_rules").all()).toHaveLength(0);
  expect(dataRows(db, "confirmations")).toHaveLength(2);
  const { createTriggerService } = await import("./triggers/service.ts");
  const begin = vi.fn(() => {
    throw new Error("Unexpected start");
  });
  const triggers = createTriggerService({
    store,
    now: () => new Date("2026-11-21T04:00:00Z"),
    dayOf: () => "2026-11-21",
    projectDir: dir,
    begin,
    every: () => () => {},
    watch: () => undefined,
    summaryOf: () => "schedule",
  });
  triggers.start();
  await triggers.tick();
  expect(begin).not.toHaveBeenCalled();
  expect(store.getTrigger("example.fill-timesheet", 0)?.lastFire).toMatchObject({
    outcome: "refused",
    detail: "permission_off",
  });
  expect(db.prepare("SELECT * FROM starts WHERE outcome = 'started'").all()).toHaveLength(0);
  triggers.stop();
  service.stop();
  db.close();
  store.close();
});
test("TC-STO-12 migration audit is append-only and records counts", async () => {
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const { store, db } = await migrated();
  const storeDb = prepare.mock.instances.at(-1) as DatabaseSync | undefined;
  if (!storeDb) throw new Error("Store database was not observed");
  expect(() => db.exec("UPDATE audit_log SET kind = 'x'")).toThrow("audit_log is append-only");
  expect(() => db.exec("DELETE FROM audit_log")).toThrow("audit_log is append-only");
  expect(store.listAudit().at(-1)).toMatchObject({
    kind: "store_migrated",
    detail: {
      from: 6,
      to: 7,
      backup: "flowdriven-v6-20261121T030000Z.sqlite",
      flows: 3,
      confirmations: 2,
      grants: 2,
      skipped: 1,
      renames: [{ flowId: "example.job-review", from: "Fill timesheet", to: "Fill timesheet 2" }],
    },
  });
  expect(storeDb.prepare("PRAGMA secure_delete").get()?.secure_delete).toBe(1);
  prepare.mockRestore();
  db.close();
  store.close();
});
test.each([1, 2, 3, 4, 5])("TC-STO-13 version %s migrates in one open", async (version) => {
  const dir = folder();
  const path = makeOlderStore(dir, version);
  const store = await openSqliteStore(path, { now: clock });
  expect(store.schemaVersion()).toBe(7);
  expect(existsSync(join(dir, "backups", `flowdriven-v${version}-20261121T030000Z.sqlite`))).toBe(true);
  expect(store.listAudit().at(-1)?.detail).toMatchObject({ from: version, to: 7 });
  store.close();
});

test("B-03.T7 TC-STO-10 used migrated call grants cannot be found", async () => {
  const dir = folder();
  const path = makeStoreV6(dir);
  const old = new DatabaseSync(path);
  old.exec("INSERT INTO grants VALUES ('waiting_approval', 'mcp__x__send#unused', '')");
  old.close();
  const store = await openSqliteStore(path, { now: clock });
  const db = new DatabaseSync(path);
  const key = {
    runId: "waiting_approval",
    stepId: "step",
    itemKey: "",
    tool: "mcp__x__send",
    digest: "digest",
    kind: "migrated" as const,
    createdAt: clock().toISOString(),
  };
  expect(store.findGrant(key)).toBeUndefined();
  expect(dataRows(db, "call_grants").find((row) => row.digest === "digest")).toMatchObject({
    usedAt: clock().toISOString(),
  });
  expect(store.findGrant({ ...key, stepId: "*", digest: "unused" })).toBeDefined();
  db.close();
  store.close();
});

test("B-03.T7 TC-SR3-12 withdrawal removes only legacy confirmation", async () => {
  const { store, db } = await migrated();
  const { flowState } = await import("./flow-state.ts");
  const other = store.getConfirmation("example.build-apk");
  if (!other) throw new Error("missing confirmation");
  const { legacy: _legacy, ...modern } = other;
  store.putConfirmation(modern);
  store.deleteCapabilityConsent("example.fill-timesheet");
  store.deleteCapabilityConsent("example.build-apk");
  expect(flowState(store, "example.fill-timesheet")).toBe("new");
  expect(store.getConfirmation("example.build-apk")).toEqual(modern);
  db.close();
  store.close();
});

test("B-03.T7 TC-SR3-12 re-import moves a migrated head", async () => {
  const { store, db } = await migrated();
  const { createEngine } = await import("./engine.ts");
  const { scriptedHarness } = await import("./scripted-harness.ts");
  const { triggerFlow } = await import("./test-helpers/trigger-rig.ts");
  const { flowState } = await import("./flow-state.ts");
  const engine = createEngine({ store, harness: scriptedHarness({ steps: {} }), now: clock });
  const id = "example.fill-timesheet";
  const head = store.getFlowHead(id);
  if (!head) throw new Error("missing head");
  store.putFlowHead({ ...head, origin: { kind: "chat", chatId: "chat", draftId: "draft" } });
  engine.registerFlow(triggerFlow(id, [{ kind: "schedule", every: "1h" }]), "H3");
  expect(store.getFlowHead(id)?.origin).toEqual({ kind: "import" });
  expect(store.getFlow(id)?.hash).toBe("H3");
  expect(flowState(store, id)).toBe("changed");
  db.close();
  store.close();
});
