import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { retentionSweep } from "./retention.ts";
import { SCHEMA } from "./schema.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { AuditEntry, RunRow, StepRow, Store } from "./storage.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

const stores: Store[] = [];
const migrationDirs: string[] = [];
function migrationPath(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  migrationDirs.push(dir);
  return join(dir, "store.sqlite");
}
function makeVersionOne(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = 1; COMMIT;`);
  db.prepare("INSERT INTO audit_log (at, kind, run_id, detail) VALUES (?, ?, ?, ?)").run(
    "2026",
    "test",
    "r1",
    JSON.stringify({ value: 1 }),
  );
  db.close();
}
function version(path: string): unknown {
  const db = new DatabaseSync(path);
  try {
    return db.prepare("PRAGMA user_version").get()?.user_version;
  } finally {
    db.close();
  }
}
async function open(path = ":memory:") {
  const store = await openSqliteStore(path);
  stores.push(store);
  return store;
}
const run: RunRow = {
  id: "r1",
  flowId: "f",
  flowHash: "h1",
  flowVersion: "1",
  state: "running",
  project: "p",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: "2026-11-11",
};
const runDefaults = {
  agent: { agent: "claude-code", choice: "main" },
  language: "en",
  flowName: "f",
  start: { source: "flows" },
  decisionLines: [],
};
const step: StepRow = {
  runId: "r1",
  stepId: "a",
  itemKey: "",
  state: "pending",
  attempts: [],
  outputs: {},
  checks: [],
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  cleanup();
  for (const dir of migrationDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("round-trips a flow, a run and its steps", async () => {
  const store = await open();
  const flow = { id: "f", version: "1", hash: "h1", manifest: {}, files: {}, registeredAt: "2026" };
  store.putFlow(flow);
  store.putFlow({ ...flow, hash: "h2" });
  expect(store.getFlow("f")?.hash).toBe("h2");
  expect(store.getFlow("f", "h1")).toEqual(flow);
  store.createRun(run);
  store.updateRun("r1", { state: "blocked", blockedReason: "x" });
  expect(store.listRuns({ state: "blocked" })).toEqual([
    { ...run, ...runDefaults, state: "blocked", blockedReason: "x", cause: { code: "step_failed" } },
  ]);
  store.upsertStep(step);
  store.upsertStep({ ...step, state: "passed" });
  store.upsertStep({ ...step, itemKey: "k1" });
  expect(store.listSteps("r1")).toHaveLength(2);
  expect(store.getStep("r1", "a")?.state).toBe("passed");
  expect(store.getStep("r1", "a", "k1")?.state).toBe("pending");
});
test("returns plain objects", async () => {
  const store = await open();
  store.createRun(run);
  expect(Object.getPrototypeOf(store.getRun("r1"))).toBe(Object.prototype);
});
test("keeps data across reopening a file database", async () => {
  const path = tempPath();
  const store = await open(path);
  store.createRun(run);
  store.markSeen("f", "l", "k", "2026");
  store.close();
  stores.pop();
  const again = await open(path);
  expect(again.getRun("r1")).toEqual({ ...run, ...runDefaults });
  expect(again.isSeen("f", "l", "k")).toBe(true);
});
test("the seen store is per flow and per loop and purges by age", async () => {
  const store = await open();
  store.markSeen("f", "review", "k1", "2026-10-01T00:00:00.000Z");
  expect(store.isSeen("f", "review", "k1")).toBe(true);
  expect(store.isSeen("g", "review", "k1")).toBe(false);
  expect(store.isSeen("f", "build", "k1")).toBe(false);
  expect(store.purgeSeen("2026-10-31T00:00:00.000Z")).toBe(1);
  expect(store.isSeen("f", "review", "k1")).toBe(false);
});
test("a transaction that throws leaves no trace", async () => {
  const store = await open();
  expect(() =>
    store.transaction(() => {
      store.markSeen("f", "l", "k", "2026-11-01T00:00:00.000Z");
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(store.isSeen("f", "l", "k")).toBe(false);
});
test("counters add up per name and day", async () => {
  const store = await open();
  expect(store.increment("runs:f", "2026-11-11")).toBe(1);
  expect(store.increment("runs:f", "2026-11-11")).toBe(2);
  expect(store.counter("runs:f", "2026-11-12")).toBe(0);
});
test("grants are per run, tool and item", async () => {
  const store = await open();
  store.addGrant("r1", "host.publish", "j1");
  expect(store.hasGrant("r1", "host.publish", "j1")).toBe(true);
  expect(store.hasGrant("r1", "host.publish", "j2")).toBe(false);
  expect(store.hasGrant("r2", "host.publish", "j1")).toBe(false);
});
test("TC-SR7-02 the audit log is append-only", async () => {
  const path = tempPath();
  const store = await open(path);
  const entries = [
    { at: "a", kind: "one", detail: {} },
    { at: "b", kind: "two", runId: "r1", detail: "x" },
    { at: "c", kind: "three", detail: {} },
  ];
  for (const entry of entries) store.appendAudit(entry);
  expect(store.listAudit()).toEqual(entries);
  for (let i = 0; i < 51; i++)
    store.createRun({ ...run, id: `old-${i}`, state: "done", endedAt: "2026-01-01" });
  store.upsertStep({ ...step, runId: "old-0" });
  store.createApproval({
    id: "old-decision",
    kind: "ask",
    runId: "old-0",
    stepId: "a",
    itemKey: "",
    summary: "old",
    payload: {},
    approves: [],
    onExpiry: "end",
    createdAt: "2026-01-01",
    expiresAt: "2026-01-02",
    state: "approved",
  });
  retentionSweep(store, () => new Date("2026-11-21T03:00:00Z"));
  expect(store.listRuns()).toHaveLength(50);
  expect(store.listSteps("old-0")).toHaveLength(0);
  expect(store.listApprovals({ runId: "old-0" })).toHaveLength(0);
  expect(store.listAudit()).toEqual(entries);
  const db = new DatabaseSync(path);
  try {
    expect(() => db.exec("UPDATE audit_log SET kind = 'x'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM audit_log")).toThrow(/append-only/);
  } finally {
    db.close();
  }
});
test("a database made by the present code at version 1 opens, keeps every row and becomes version 7", async () => {
  const path = migrationPath();
  makeVersionOne(path);
  const store = await open(path);
  expect(store.listAudit()).toEqual([
    { at: "2026", kind: "test", runId: "r1", detail: { value: 1 } },
    {
      at: expect.any(String),
      kind: "store_migrated",
      detail: {
        from: 1,
        to: 7,
        backup: expect.stringMatching(/^flowdriven-v1-\d{8}T\d{6}Z\.sqlite$/),
        flows: 0,
        confirmations: 0,
        grants: 0,
        skipped: 0,
        renames: [],
      },
    },
  ]);
  expect(version(path)).toBe(7);
  expect(store.getHarnessState("claude-code")).toBeUndefined();
});
test("an exclusive open migrates a version 1 file too", async () => {
  const path = migrationPath();
  makeVersionOne(path);
  const store = await openSqliteStore(path, { exclusive: true });
  expect(store.listAudit()).toEqual([
    { at: "2026", kind: "test", runId: "r1", detail: { value: 1 } },
    {
      at: expect.any(String),
      kind: "store_migrated",
      detail: {
        from: 1,
        to: 7,
        backup: expect.stringMatching(/^flowdriven-v1-\d{8}T\d{6}Z\.sqlite$/),
        flows: 0,
        confirmations: 0,
        grants: 0,
        skipped: 0,
        renames: [],
      },
    },
  ]);
  expect(store.getHarnessState("claude-code")).toBeUndefined();
  store.close();
  expect(version(path)).toBe(7);
});
test("a new database is created at version 7 with the tables", async () => {
  const path = migrationPath();
  const store = await open(path);
  expect(version(path)).toBe(7);
  expect(store.getHarnessState("claude-code")).toBeUndefined();
});
test("a database from version 8 is refused", async () => {
  const path = migrationPath();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 8");
  db.close();
  await expect(openSqliteStore(path)).rejects.toMatchObject({
    code: "unavailable",
    message: "Unsupported database version.",
  });
});
test("put replaces the row of the same id and get returns it with its nested scan", async () => {
  const store = await open();
  const row = {
    id: "claude-code",
    consent: "given" as const,
    consentAt: "2026-11-11T00:00:00.000Z",
    scan: { a: [1, { b: null }] },
    scanAt: "x",
  };
  store.putHarnessState(row);
  expect(store.getHarnessState("claude-code")).toEqual(row);
  const replacement = { id: "claude-code", consent: "revoked" as const };
  store.putHarnessState(replacement);
  expect(store.getHarnessState("claude-code")).toEqual(replacement);
  expect(store.getHarnessState("other")).toBeUndefined();
});
test("refuses a database from a newer version", async () => {
  const path = tempPath();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version = 99");
  db.close();
  await expect(openSqliteStore(path)).rejects.toMatchObject({ code: "unavailable" });
});
test("nested transactions roll back only their own writes", async () => {
  const store = await open();
  store.transaction(() => {
    store.markSeen("f", "l", "outer", "a");
    expect(() =>
      store.transaction(() => {
        store.markSeen("f", "l", "inner", "a");
        throw new Error("inner");
      }),
    ).toThrow("inner");
  });
  expect(store.isSeen("f", "l", "outer")).toBe(true);
  expect(store.isSeen("f", "l", "inner")).toBe(false);
});
test("stores items and approvals and filters them", async () => {
  const store = await open();
  const item = {
    runId: "r1",
    loopId: "l",
    key: "k",
    position: 0,
    item: { id: "k" },
    status: "pending" as const,
  };
  store.upsertItem(item);
  store.upsertItem({ ...item, status: "passed" });
  expect(store.listItems("r1", "l")).toEqual([{ ...item, status: "passed" }]);
  const approval = {
    id: "a",
    kind: "ask" as const,
    runId: "r1",
    stepId: "s",
    itemKey: "",
    summary: "choose",
    payload: [],
    approves: [],
    onExpiry: "end" as const,
    createdAt: "a",
    expiresAt: "b",
    state: "pending" as const,
  };
  store.createApproval(approval);
  store.updateApproval("a", { state: "approved", picks: ["k"] });
  expect(store.getApproval("a")).toEqual({ ...approval, state: "approved", picks: ["k"] });
  expect(store.listApprovals({ runId: "r1", state: "approved" })).toHaveLength(1);
});

test("keeps two items with the same key at different positions", async () => {
  const store = await open();
  const item = {
    runId: "r1",
    loopId: "l",
    key: "k",
    position: 0,
    item: { id: "k" },
    status: "passed" as const,
  };
  const duplicate = { ...item, position: 1, status: "skipped" as const, note: "skipped: duplicate key" };
  store.upsertItem(duplicate);
  store.upsertItem(item);
  expect(store.listItems("r1", "l")).toEqual([item, duplicate]);
});

test("listFlows returns the newest registration of each flow ordered by id", async () => {
  const store = await open();
  const flow = { id: "b", version: "1", hash: "h1", manifest: {}, files: {}, registeredAt: "2026" };
  store.putFlow(flow);
  store.putFlow({ ...flow, id: "a" });
  store.putFlow({ ...flow, id: "a", hash: "h2" });
  expect(store.listFlows().map((row) => row.id)).toEqual(["a", "b"]);
  expect(store.listFlows().at(0)?.hash).toBe("h2");
});
async function holder(path: string): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./test-helpers/hold-lock-child.ts", import.meta.url)), path],
    { env: { ...process.env, NODE_OPTIONS: "" }, stdio: "pipe" },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("locked\n")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`holder exited early: ${code}`)));
  });
  return child;
}
test("an exclusive store refuses a second process and says so", { timeout: 20_000 }, async () => {
  const path = tempPath();
  const child = await holder(path);
  try {
    await expect(openSqliteStore(path, { exclusive: true })).rejects.toMatchObject({
      code: "unavailable",
      message: "Another FlowDriven runner is using this data folder.",
    });
  } finally {
    child.stdin.end();
  }
  expect((await once(child, "exit")).at(0)).toBe(0);
});
test("the lock goes away when the holder is killed", { timeout: 20_000 }, async () => {
  const path = tempPath();
  const child = await holder(path);
  child.kill("SIGKILL");
  await once(child, "exit");
  const store = await openSqliteStore(path, { exclusive: true });
  stores.push(store);
  expect(store.listFlows()).toEqual([]);
});

test.each(["Bash", "mcp__example__send"])(
  "TC-SR1-48 a new outside approval re-arms a used grant for %s",
  async (tool) => {
    const { pendingDecision } = await import("./test-helpers/builders.ts");
    const { digestCall, callGrant } = await import("./connectors/grants.ts");
    const store = await open();
    const first = pendingDecision(store, {
      id: "rearm",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "outside_flow",
    });
    const input = { text: "hello" };
    const digest = digestCall(tool, input);
    const approve = tool.startsWith("mcp__") ? callGrant("req", tool, digest) : `${tool}#${digest}`;
    store.updateApproval(first.id, { state: "approved", call: { tool, input }, approves: [approve] });
    const second = {
      ...first,
      id: "rearm-second",
      kind: "outside_flow" as const,
      state: "approved" as const,
      effect: "change" as const,
      call: { tool, input },
      approves: [approve],
    };
    store.createApproval(second);
    const key = {
      runId: first.runId,
      stepId: first.stepId,
      itemKey: first.itemKey,
      tool,
      digest,
      kind: "approve" as const,
      createdAt: first.createdAt,
      approvalId: first.id,
    };
    store.putCallGrant(key);
    store.useGrant(key, "2026-11-21T00:00:01Z");
    store.putCallGrant(key);
    expect(store.findGrant(key)).toBeUndefined();
    store.putCallGrant({ ...key, approvalId: second.id });
    expect(store.findGrant(key)).toMatchObject({ approvalId: second.id });
    store.useGrant(key, "2026-11-21T00:00:02Z");
    expect(store.findGrant(key)).toBeUndefined();
  },
);

test("TC-SR6-04 audit detail holds ids, codes, hashes and short titles, never text, and secure_delete removes deleted chat bytes", async () => {
  const { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } = await import("node:fs");
  const { vi } = await import("vitest");
  const { AGENT_PROFILES } = await import("./test-helpers/agent-profiles.ts");
  const { pendingDecision } = await import("./test-helpers/builders.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome } = await import("./test-helpers/fake-claude-script.ts");
  const { FAKE_CODEX_PATH, writeFakeCodexScript } = await import("./test-helpers/fake-codex-script.ts");
  const { createRunnerService } = await import("./service/service.ts");

  const path = tempPath();
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  symlinkSync(FAKE_CODEX_PATH, join(bin, "codex"));
  writeFakeCodexScript(home, { profile: AGENT_PROFILES.codex, signedIn: true });
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const store = await open(path);
  const storeDb = prepare.mock.instances.at(-1) as DatabaseSync | undefined;
  prepare.mockRestore();
  expect(storeDb?.prepare("PRAGMA secure_delete").get()?.secure_delete).toBe(1);
  const db = new DatabaseSync(path);
  let n = 0;
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "demo",
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
    now: () => new Date("2026-11-23T00:00:00.000Z"),
    agents: { extraDirs: [], claudePath: join(bin, "claude"), codexPath: join(bin, "codex") },
    newId: (prefix) => `${prefix}-${String(++n).padStart(12, "0")}`,
  });
  const chatMarker = "UNIQUE-MARKER-TEXT 12345";
  const payloadMarker = "HELD-PAYLOAD-MARKER 12345";
  try {
    await service.start().settled;
    const { chatId } = (await service.call("chats.create", {})) as { chatId: string };
    store.putMessage({
      id: "msg-000000000001",
      chatId,
      seq: 1,
      at: "2026-11-23T00:00:00.000Z",
      role: "person",
      kind: "text",
      outside: false,
      text: chatMarker,
    });
    await service.call("chats.setAgent", { chatId, agent: "codex", model: "gpt-6.1-sol" });

    const approval = pendingDecision(store, {
      id: "ap-000000000001",
      createdAt: "2026-11-23T00:00:00.000Z",
      kind: "risky_action",
      effect: "send",
    });
    store.updateApproval(approval.id, { payload: { kind: "text", text: payloadMarker } });
    await service.call("approvals.resolve", { approvalId: approval.id, decision: "reject" });

    const at = "2026-11-23T00:00:00.000Z";
    const hash = `sha256:${"a".repeat(64)}`;
    const auditEntries: AuditEntry[] = [
      {
        at,
        kind: "store_migrated",
        detail: {
          from: 6,
          to: 7,
          backup: "backup.sqlite",
          flows: 1,
          confirmations: 1,
          grants: 0,
          skipped: 0,
        },
      },
      { at, kind: "permission_changed", detail: { from: "unset", to: "on", source: "window" } },
      { at, kind: "setting_changed", detail: { key: "language", from: "en", to: "id" } },
      { at, kind: "limit_raised", detail: { from: 10, to: 25, decisions: ["pause-1"] } },
      { at, kind: "agent_setup", detail: { agentId: "codex", phase: "ready" } },
      { at, kind: "agent_sign_in", detail: { agentId: "codex", result: "ready" } },
      {
        at,
        kind: "chat_turn_failed",
        detail: { chatId, messageId: "msg-1", agent: "codex", model: "gpt-6.1-sol", failure: "timeout" },
      },
      {
        at,
        kind: "flow_saved",
        detail: {
          flowId: "local.test",
          hash,
          onItsOwn: ["read"],
          asksFirst: [],
          never: [],
          draftId: "draft-1",
          skillId: "skill-1",
          skillHash: hash,
        },
      },
      {
        at,
        kind: "flow_changed",
        detail: { flowId: "local.test", oldHash: hash, newHash: hash, kept: [], ended: [] },
      },
      {
        at,
        kind: "flow_confirmed",
        detail: { flowId: "local.test", hash, onItsOwn: [], by: "confirm_dialog" },
      },
      { at, kind: "flow_imported", detail: { flowId: "local.test", hash } },
      { at, kind: "flow_deleted", detail: { flowId: "local.test", hash, schedulesTurnedOff: [] } },
      {
        at,
        kind: "schedule_changed",
        detail: { flowId: "local.test", from: "manual", to: "daily 09:00", by: "window" },
      },
      {
        at,
        kind: "start_requested",
        runId: approval.runId,
        detail: {
          flowId: "local.test",
          source: "chat",
          outcome: "started",
          startId: "start-1",
          runId: approval.runId,
        },
      },
      {
        at,
        kind: "run_stopped",
        runId: approval.runId,
        detail: { runId: approval.runId, by: "person", outcome: "stopped" },
      },
      {
        at,
        kind: "run_resumed",
        runId: approval.runId,
        detail: { runId: approval.runId, by: "window", outcome: "resumed" },
      },
      {
        at,
        kind: "decision_expired",
        runId: approval.runId,
        detail: { approvalId: approval.id, runId: approval.runId, why: "permission_off" },
      },
      {
        at,
        kind: "decisions_batch",
        runId: approval.runId,
        detail: { runId: approval.runId, group: "send", approvalIds: [approval.id] },
      },
      {
        at,
        kind: "rule_created",
        detail: {
          ruleId: "rule-1",
          flowId: "local.test",
          touchId: "t1",
          effect: "change",
          placeKind: "account",
          by: "confirm",
        },
      },
      {
        at,
        kind: "rule_revoked",
        detail: {
          ruleId: "rule-1",
          flowId: "local.test",
          touchId: "t1",
          effect: "change",
          placeKind: "account",
          by: "ask_me_again",
        },
      },
      {
        at,
        kind: "rule_used",
        runId: approval.runId,
        detail: {
          ruleId: "rule-1",
          flowId: "local.test",
          touchId: "t1",
          effect: "change",
          placeKind: "account",
          runId: approval.runId,
          stepId: "s1",
        },
      },
      {
        at,
        kind: "question_asked",
        detail: {
          questionId: "wq-1",
          flowId: "local.test",
          chatId,
          kind: "inputs",
          missing: ["days"],
          state: "open",
        },
      },
      {
        at,
        kind: "question_closed",
        detail: {
          questionId: "wq-1",
          flowId: "local.test",
          chatId,
          kind: "inputs",
          state: "closed",
          why: "chat_deleted",
        },
      },
      {
        at,
        kind: "run_note_added",
        runId: approval.runId,
        detail: { runId: approval.runId, noteId: "note-1", outside: false },
      },
      {
        at,
        kind: "run_note_used",
        runId: approval.runId,
        detail: { runId: approval.runId, noteId: "note-1", step: 1 },
      },
      {
        at,
        kind: "attempt_stuck",
        runId: approval.runId,
        detail: { runId: approval.runId, step: 1, attempt: 1, reason: "repeated_call", count: 3 },
      },
      {
        at,
        kind: "run_blocked",
        runId: approval.runId,
        detail: { runId: approval.runId, state: "blocked", cause: "step_failed" },
      },
      { at, kind: "caller_refused", detail: { operation: "settings.update", caller: "tool" } },
    ];
    for (const entry of auditEntries) {
      store.appendAudit(entry);
    }

    await service.call("chats.delete", { chatId });
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();

    const records = (await service.call("audit.list", {})) as {
      kind: string;
      detail: Record<string, string | number | boolean | null | string[]>;
    }[];
    for (const record of records) {
      for (const value of Object.values(record.detail)) {
        if (typeof value === "string") {
          expect(value.length).toBeLessThanOrEqual(200);
          expect(value).not.toContain(chatMarker);
          expect(value).not.toContain(payloadMarker);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            expect(typeof item).toBe("string");
            expect(item.length).toBeLessThanOrEqual(200);
            expect(item).not.toContain(chatMarker);
            expect(item).not.toContain(payloadMarker);
          }
        } else {
          expect(value === null || typeof value === "boolean" || typeof value === "number").toBe(true);
        }
      }
    }
    expect(records).toContainEqual(
      expect.objectContaining({ kind: "chat_deleted", detail: { chatId, messages: 2 } }),
    );
    expect(readFileSync(path).includes(Buffer.from(chatMarker))).toBe(false);
    if (existsSync(`${path}-wal`)) {
      expect(readFileSync(`${path}-wal`).includes(Buffer.from(chatMarker))).toBe(false);
    }
  } finally {
    db.close();
    service.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
