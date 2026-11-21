import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { runProcess } from "./service/run-process.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import { makeStoreV6, readStoreV6 } from "./test-helpers/store-v6.ts";

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
    expect(after.rows[table]).toHaveLength(before.rows[table]?.length ?? 0);
    for (const [index, row] of (before.rows[table] ?? []).entries()) {
      expect(after.rows[table]?.[index]).toMatchObject(row);
    }
  }
  for (let i = 0; i < 2; i++)
    (await openSqliteStore(path, { now: () => new Date("2026-11-21T04:00:00Z") })).close();
  expect(readStoreV6(path)).toEqual(after);
  expect(after.version).toBe(7);
  expect(readdirSync(join(dir, "backups"))).toHaveLength(1);
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
