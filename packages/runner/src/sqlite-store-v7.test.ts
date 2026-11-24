import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { contentHash } from "@flowdriven/sdk/node";
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
import type { Confirmation, WaitingQuestion } from "./storage.ts";
import { oneStepFlow } from "./test-helpers/flows.ts";
import { storeFaults } from "./test-helpers/store-faults.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

test("TC-STO-20 only one open question per flow", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys = ON; INSERT INTO chats VALUES ('chat', '', 'now', '{}')");
    const question: WaitingQuestion = {
      id: "q1",
      flowId: "flow",
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
      pendingStart: { startId: "s", source: "schedule", request: {} },
    };
    store.putQuestion(question);
    expect(() => store.putQuestion({ ...question, id: "q2" })).toThrow();
    store.putQuestion({ ...question, state: "answered" });
    store.putQuestion({ ...question, id: "q2" });
    store.putQuestion({ ...question, id: "q3", flowId: "other" });
    expect(
      db.prepare("SELECT count(*) AS count FROM waiting_questions WHERE state = 'open'").get()?.count,
    ).toBe(2);
  } finally {
    db.close();
    store.close();
  }
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

test("TC-STO-21 a start key is claimed once", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const base = {
      id: "s1",
      flowId: "f",
      at: "2026",
      source: "schedule",
      outcome: "started",
      key: "slot:2026-11-19T10:00:00.000Z",
      request: {},
    } as const;
    expect(store.claimStart(base)).toEqual({ created: true, row: base });
    expect(store.claimStart({ ...base, id: "s2" })).toEqual({ created: false, row: base });
    expect(store.claimStart({ ...base, id: "s3", flowId: "other" }).created).toBe(true);
    const { key: _key, ...unkeyed } = base;
    expect(store.claimStart({ ...unkeyed, id: "s4" }).created).toBe(true);
    expect(store.claimStart({ ...unkeyed, id: "s5" }).created).toBe(true);
    expect(store.listStarts()).toHaveLength(4);
  } finally {
    store.close();
  }
});

test("TC-STO-22 only allowed rules at matching places are stored", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const input = {
      flowId: "f",
      touchId: "log-hours",
      effect: "change",
      place: { kind: "account", value: "timesheet-account", label: "Timesheet account" },
    } as const;
    const first = store.makeRule(input);
    expect(store.makeRule({ ...input, place: { ...input.place, label: "Other label" } }).id).toBe(first.id);
    expect(store.listRules().filter((r) => r.state === "active")).toHaveLength(1);
    store.revokeRule(first.id, "ask_me_again");
    expect(store.makeRule(input).id).not.toBe(first.id);
    expect(store.makeRule({ ...input, place: { ...input.place, value: "other-account" } }).id).not.toBe(
      first.id,
    );
    expect(store.makeRule({ ...input, place: { kind: "folder", value: "timesheet-account" } }).id).not.toBe(
      first.id,
    );
    const before = store.listRules();
    for (const effect of ["send", "post", "pay", "delete", "merge"])
      expect(() =>
        store.makeRule({ ...input, effect, place: { kind: "address", value: "me@example.test" } }),
      ).toThrow("rule_effect_not_allowed");
    expect(() => store.makeRule({ ...input, place: { kind: "address", value: "me@example.test" } })).toThrow(
      "rule_place_not_allowed",
    );
    expect(() =>
      store.makeRule({ ...input, effect: "local_write", place: { kind: "account", value: "x" } }),
    ).toThrow("rule_place_not_allowed");
    expect(() =>
      store.makeRule({ ...input, effect: "run_command", place: { kind: "folder", value: "x" } }),
    ).toThrow("rule_place_not_allowed");
    expect(store.listRules()).toEqual(before);
  } finally {
    store.close();
  }
});

test("TC-STO-23 a one-time grant is used once", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    const grant = {
      runId: "run-000000000001",
      stepId: "send",
      itemKey: "",
      tool: "mcp__x__send",
      digest: "D1",
      kind: "approve",
      createdAt: "2026",
    } as const;
    store.putCallGrant(grant);
    store.putCallGrant(grant);
    expect(db.prepare("SELECT count(*) AS n FROM call_grants").get()?.n).toBe(1);
    expect(store.findGrant(grant)).toEqual(grant);
    expect(store.findGrant({ ...grant, digest: "D2" })).toBeUndefined();
    store.useGrant(grant, "2026-11-22");
    expect(JSON.parse(String(db.prepare("SELECT data FROM call_grants").get()?.data))).toMatchObject({
      usedAt: "2026-11-22",
    });
    expect(store.findGrant(grant)).toBeUndefined();
    const pick = { ...grant, stepId: "*", digest: "*", kind: "pick" } as const;
    store.putCallGrant(pick);
    expect(store.findPickGrant(grant)).toEqual(pick);
    expect(store.findPickGrant(grant)).toEqual(pick);
  } finally {
    db.close();
    store.close();
  }
});

test("TC-STO-24 confirm rolls back confirmation and rules if audit fails", async () => {
  const fault = storeFaults();
  const store = await openSqliteStore(":memory:", { afterWrite: fault.afterWrite });
  try {
    const confirmation: Confirmation = {
      flowId: "f",
      hash: "H1",
      at: "2026",
      by: "confirm_dialog",
      onItsOwn: ["one", "two"],
      pins: { skills: {}, folders: {} },
    };
    const rules = ["one", "two"].map((touchId) => ({
      flowId: "f",
      touchId,
      effect: "change",
      place: { kind: "account", value: touchId },
    }));
    const input = { confirmation, rules };
    fault.failAfter("audit_log");
    expect(() => store.confirmFlow(input)).toThrow("store fault: audit_log");
    expect(store.getConfirmation("f")).toBeUndefined();
    expect(store.listRules()).toEqual([]);
    expect(store.listAudit()).toEqual([]);
    fault.clear();
    store.confirmFlow(input);
    expect(store.getConfirmation("f")).toEqual(confirmation);
    expect(store.listRules()).toHaveLength(2);
    expect(store.listAudit().map((a) => a.kind)).toContain("flow_confirmed");
  } finally {
    store.close();
  }
});

test("TC-STO-25 save flow is one transaction and is idempotent", async () => {
  const fault = storeFaults();
  const store = await openSqliteStore(":memory:", { afterWrite: fault.afterWrite });
  try {
    store.putChat({
      id: "chat",
      title: "",
      titleSource: "default",
      createdAt: "2026",
      updatedAt: "2026",
      from: "person",
      language: "en",
      languageSource: "app",
      agent: "claude-code",
      model: "model",
      agentSource: "person",
    });
    store.putMessage({
      id: "message",
      chatId: "chat",
      seq: 1,
      at: "2026",
      role: "flowdriven",
      kind: "card",
      outside: false,
      card: { type: "draft", state: "open" },
    });
    const manifest = {
      ...oneStepFlow("local.test"),
      format: "flowdriven-flow/1.2",
      touches: [
        {
          id: "change",
          effect: "change",
          sentence: "Change the account",
          place: { kind: "account", value: "account", label: "Account" },
          rule: "runs_alone",
          covers: [],
        },
      ],
    };
    const files = { "flow.yaml": JSON.stringify(manifest), "README.md": "A test flow" };
    const hash = contentHash(new Map(Object.entries(files).map(([name, text]) => [name, Buffer.from(text)])));
    store.putDraft({
      id: "draft",
      chatId: "chat",
      messageId: "message",
      kind: "new_flow",
      state: "drafted",
      createdAt: "2026",
      updatedAt: "2026",
      files,
      hash,
      name: "Test",
      nameAdjusted: false,
      lists: { onItsOwn: ["change"], asksFirst: [], never: [] },
      schedule: { type: "weekdays", time: "17:00", whenItsTime: "ask" },
      outside: false,
      assumptions: [],
    });
    fault.failAfter("audit_log");
    expect(() => store.saveFlow("draft")).toThrow("store fault: audit_log");
    expect(store.getFlowHead("local.test")).toBeUndefined();
    expect(store.getFlow("local.test")).toBeUndefined();
    expect(store.getConfirmation("local.test")).toBeUndefined();
    expect(store.listRules()).toEqual([]);
    expect(store.getSchedule("local.test")).toBeUndefined();
    expect(store.getDraft("draft")?.state).toBe("drafted");
    expect(store.getMessage("message")?.card?.state).toBe("open");
    fault.clear();
    const saved = store.saveFlow("draft");
    expect(store.saveFlow("draft")).toEqual(saved);
    expect(store.getDraft("draft")?.state).toBe("saved");
    expect(store.getFlowHead(saved.flowId)).toBeDefined();
    expect(store.getSchedule(saved.flowId)).toBeDefined();
    expect(store.getConfirmation(saved.flowId)?.hash).toBe(hash);
    expect(store.listRules().filter((rule) => rule.state === "active")).toHaveLength(1);
    expect(store.getMessage("message")?.card?.state).toBe("answered");
  } finally {
    store.close();
  }
});

test("TC-STO-17 deleting a chat cascades and message keys are enforced", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "PRAGMA foreign_keys = ON; INSERT INTO chats VALUES ('chat-000000000001', '', '2026', '{}'), ('other', '', '2026', '{}'); INSERT INTO messages VALUES ('m1','chat-000000000001',1,'2026','text',NULL,NULL,NULL,'{}'),('m2','chat-000000000001',2,'2026','text',NULL,NULL,NULL,'{}'),('m3','chat-000000000001',3,'2026','text',NULL,NULL,NULL,'{}'),('m4','other',1,'2026','text',NULL,NULL,NULL,'{}'); INSERT INTO drafts VALUES ('d','chat-000000000001','drafted','{}'); INSERT INTO waiting_questions VALUES ('q','flow','chat-000000000001','inputs','open','{}');",
    );
    expect(() =>
      db.exec("INSERT INTO messages VALUES ('duplicate','other',1,'2026','text',NULL,NULL,NULL,'{}')"),
    ).toThrow();
    expect(() =>
      db.exec("INSERT INTO messages VALUES ('missing','missing',1,'2026','text',NULL,NULL,NULL,'{}')"),
    ).toThrow();
    store.deleteChat("chat-000000000001");
    expect(db.prepare("SELECT id FROM messages ORDER BY id").all()).toEqual([{ id: "m4" }]);
    expect(db.prepare("SELECT count(*) AS n FROM drafts").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM waiting_questions").get()?.n).toBe(0);
  } finally {
    db.close();
    store.close();
  }
});

test("TC-STO-18 mismatched question key is skipped and counted", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    db.exec("INSERT INTO chats VALUES ('chat', '', '2026', '{}')");
    const insert = db.prepare("INSERT INTO waiting_questions VALUES (?, ?, 'chat', 'inputs', 'open', ?)");
    insert.run(
      "bad",
      "one",
      JSON.stringify({ id: "bad", flowId: "one", chatId: "chat", kind: "confirm", state: "open" }),
    );
    const good = {
      id: "good",
      flowId: "two",
      chatId: "chat",
      messageId: "message",
      kind: "inputs",
      state: "open",
      createdAt: "2026",
      updatedAt: "2026",
      source: "schedule",
      proactive: true,
      flowHash: "H1",
      given: {},
      missing: [],
      pendingStart: { startId: "s", source: "schedule", request: {} },
    };
    insert.run("good", "two", JSON.stringify(good));
    expect(store.listQuestions()).toEqual([good]);
    expect(store.skippedRows()).toMatchObject({ waiting_questions: 1 });
  } finally {
    db.close();
    store.close();
  }
});

test("TC-STO-19 live names are unique and generated ids are not reused", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const { newFlowId } = await import("./flow-id.ts");
    const head = {
      id: "one",
      name: "Fill timesheet",
      summary: "",
      headHash: "H1",
      createdAt: "2026",
      updatedAt: "2026",
      origin: { kind: "import" },
    } as const;
    store.putFlowHead(head);
    expect(() => store.putFlowHead({ ...head, id: "two", name: "fill timesheet" })).toThrow();
    store.putFlowHead({ ...head, deletedAt: "2026" });
    store.putFlowHead({ ...head, id: "two", name: "fill timesheet" });
    const id = newFlowId(store, "Invoice collector");
    expect(id).toBe("local.invoice-collector");
    store.putFlowHead({ ...head, id, name: "Invoice collector", deletedAt: "2026" });
    expect(newFlowId(store, "Invoice collector")).toBe("local.invoice-collector-2");
    expect(newFlowId(store, "!!!")).toBe("local.flow");
    expect(newFlowId(store, "a".repeat(80)).slice(6).length).toBeLessThanOrEqual(60);
  } finally {
    store.close();
  }
});

test("TC-STO-26 adding a version moves the head and preserves old versions", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    const row = {
      id: "local.f",
      version: "1",
      hash: "H1",
      manifest: {},
      files: { "flow.yaml": "old" },
      registeredAt: "2026",
    };
    store.putFlow(row);
    store.putFlowHead({
      id: "local.f",
      name: "Flow",
      summary: "",
      headHash: "H1",
      createdAt: "2026",
      updatedAt: "2026",
      origin: { kind: "import" },
    });
    const files = { "flow.yaml": JSON.stringify(oneStepFlow("local.f")) };
    const added = store.addVersion("local.f", files, { savedBy: { kind: "save_change" } });
    expect(store.getFlowHead("local.f")?.headHash).toBe(added.hash);
    expect(store.getFlow("local.f")).toMatchObject({ hash: added.hash, parentHash: "H1" });
    expect(store.getFlow("local.f", "H1")).toMatchObject(row);
    expect(store.addVersion("local.f", files, { savedBy: { kind: "save_change" } })).toEqual(added);
  } finally {
    store.close();
  }
});

test("TC-SRCH-09 search_text is kept in step with messages", async () => {
  const path = tempPath();
  const store = await openSqliteStore(path);
  const db = new DatabaseSync(path);
  try {
    const chat = {
      id: "chat-000000000001",
      title: "",
      titleSource: "default" as const,
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:00:00.000Z",
      from: "person" as const,
      language: "en",
      languageSource: "app" as const,
      agent: "claude-code",
      model: "sonnet-5.5",
      agentSource: "main_default" as const,
    };
    store.putChat(chat);
    const longText = "a".repeat(16_500);
    store.putMessage({
      id: "msg-1",
      chatId: chat.id,
      seq: 1,
      at: "2026-11-19T10:00:01.000Z",
      role: "person",
      kind: "text",
      outside: false,
      text: longText,
    });
    store.putMessage({
      id: "msg-2",
      chatId: chat.id,
      seq: 2,
      at: "2026-11-19T10:00:02.000Z",
      role: "agent",
      kind: "reply",
      outside: false,
      text: "Your invoice was found",
    });
    store.putMessage({
      id: "msg-3",
      chatId: chat.id,
      seq: 3,
      at: "2026-11-19T10:00:03.000Z",
      role: "flowdriven",
      kind: "result",
      outside: false,
      result: {
        runId: "run-000000000001",
        lines: ["Logged {duration} for {customer}."],
        values: {
          duration: { type: "duration", value: "2h" },
          customer: { type: "text", value: "Example Corp" },
        },
      },
    });
    store.putMessage({
      id: "msg-4",
      chatId: chat.id,
      seq: 4,
      at: "2026-11-19T10:00:04.000Z",
      role: "flowdriven",
      kind: "line",
      outside: false,
      line: { key: "chat.starting", params: { flow: "Fill timesheet" } },
    });
    store.putMessage({
      id: "msg-5",
      chatId: chat.id,
      seq: 5,
      at: "2026-11-19T10:00:05.000Z",
      role: "flowdriven",
      kind: "note",
      outside: false,
      line: { key: "chat.agentChanged", params: { agent: "codex", model: "gpt-6.1-sol" } },
    });
    store.putMessage({
      id: "msg-6",
      chatId: chat.id,
      seq: 6,
      at: "2026-11-19T10:00:06.000Z",
      role: "flowdriven",
      kind: "card",
      outside: false,
      card: { type: "decision", state: "open" },
    });

    const beforeMsg2 = db.prepare("SELECT search_text, data FROM messages WHERE id = 'msg-2'").get();
    store.putChat({
      ...chat,
      title: "First person message",
      titleSource: "first_message",
      updatedAt: "2026-11-19T10:00:07.000Z",
    });

    const rows = db.prepare("SELECT id, search_text, data FROM messages ORDER BY seq").all() as {
      id: string;
      search_text: string | null;
      data: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual(["msg-1", "msg-2", "msg-3", "msg-4", "msg-5", "msg-6"]);
    expect(rows[0]?.search_text).toBe("a".repeat(16_000));
    expect(rows[0]?.search_text?.length).toBe(16_000);
    expect(rows[1]?.search_text).toBe("Your invoice was found");
    expect(rows[2]?.search_text).toBe("Logged 2h for Example Corp.");
    expect(rows[3]?.search_text).toBeNull();
    expect(rows[4]?.search_text).toBeNull();
    expect(rows[5]?.search_text).toBeNull();

    const chatRow = db.prepare("SELECT title, data FROM chats WHERE id = ?").get(chat.id) as {
      title: string;
      data: string;
    };
    expect(chatRow.title).toBe("First person message");
    expect(chatRow.title).toBe((JSON.parse(chatRow.data) as { title: string }).title);

    const afterMsg2 = db.prepare("SELECT search_text, data FROM messages WHERE id = 'msg-2'").get();
    expect(afterMsg2).toEqual(beforeMsg2);
  } finally {
    db.close();
    store.close();
  }
});
