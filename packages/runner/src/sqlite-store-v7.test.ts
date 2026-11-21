import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import {
  CAPABILITY_SCHEMA,
  HARNESS_STATE_SCHEMA,
  PINS_SCHEMA,
  SCHEMA,
  TRIGGER_SCHEMA,
  USAGE_SCHEMA,
} from "./schema.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

test("TC-STO-01 a new store has version 7 and every table and index", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  store.close();
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(7);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
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
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((r) => r.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(
      db
        .prepare("PRAGMA table_info(usage_events)")
        .all()
        .map((r) => r.name),
    ).toContain("billing");
    expect(existsSync(join(dirname(path), "backups"))).toBe(false);
  } finally {
    db.close();
  }
});

test("TC-STO-15 pragmas are set on new and migrated opens", async () => {
  const path = tempPath();
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  for (let i = 0; i < 2; i++) {
    const currentPath = i === 0 ? path : tempPath();
    if (i === 1) {
      const old = new DatabaseSync(currentPath);
      old.exec(
        `${SCHEMA} ${HARNESS_STATE_SCHEMA} ${USAGE_SCHEMA} ${TRIGGER_SCHEMA} ${CAPABILITY_SCHEMA} ${PINS_SCHEMA} PRAGMA user_version = 6;`,
      );
      old.close();
    }
    const store = await openSqliteStore(currentPath, { exclusive: true });
    const db = prepare.mock.instances.at(-1) as DatabaseSync | undefined;
    expect(db).toBeDefined();
    if (!db) throw new Error("Store database was not observed");
    expect(db.prepare("PRAGMA secure_delete").get()?.secure_delete).toBe(1);
    expect(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys).toBe(1);
    expect(db.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.prepare("PRAGMA locking_mode").get()?.locking_mode).toBe("exclusive");
    store.close();
  }
});
