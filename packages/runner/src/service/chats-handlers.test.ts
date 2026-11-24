import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChatSummary, ChatView } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { AGENT_CATALOG } from "../agents/catalog.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { AGENT_PROFILES } from "../test-helpers/agent-profiles.ts";
import { seedSampleFlow, standingRule } from "../test-helpers/builders.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { FAKE_CODEX_PATH, writeFakeCodexScript } from "../test-helpers/fake-codex-script.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { createRunnerService } from "./service.ts";

afterEach(() => cleanup());

async function fixture(dbPath = ":memory:") {
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  symlinkSync(FAKE_CODEX_PATH, join(bin, "codex"));
  writeFakeCodexScript(home, { profile: AGENT_PROFILES.codex, signedIn: true });
  const store = await openSqliteStore(dbPath);
  let n = 0;
  let ms = Date.parse("2026-11-23T00:00:00.000Z");
  const catalog = structuredClone(AGENT_CATALOG);
  const service = createRunnerService({
    store,
    dataDir: home,
    mode: "demo",
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}` },
    now: () => new Date(++ms),
    agents: {
      catalog,
      extraDirs: [],
      claudePath: join(bin, "claude"),
      codexPath: join(bin, "codex"),
    },
    newId: (prefix) => `${prefix}-${String(++n).padStart(12, "0")}`,
  });
  await service.start().settled;
  await service.call("settings.update", {
    patch: { mainAgent: { agent: "claude-code", model: "sonnet-5.5" } },
  });
  return {
    home,
    dbPath,
    store,
    catalog,
    service,
    create: () => service.call("chats.create", {}) as Promise<{ chatId: string; reused: boolean }>,
    get: (chatId: string) => service.call("chats.get", { chatId }) as Promise<ChatView>,
    addMessage(chatId: string, role: "person" | "agent", text: string) {
      const seq = (store.listMessages(chatId).at(-1)?.seq ?? 0) + 1;
      store.putMessage({
        id: `msg-${String(++n).padStart(12, "0")}`,
        chatId,
        seq,
        at: new Date(++ms).toISOString(),
        role,
        kind: role === "person" ? "text" : "reply",
        outside: false,
        text,
      });
    },
    close() {
      service.stop();
      store.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("TC-AST-25 chats.setAgent changes one chat, posts note, audits and validates agent/model", async () => {
  const f = await fixture();
  try {
    const c1 = await f.create();
    f.addMessage(c1.chatId, "person", "first chat");
    const c2 = await f.create();
    const { manifest, hash } = seedSampleFlow(f.store, "example.fill-timesheet");
    const runId = "run-000000000001";
    f.store.createRun({
      id: runId,
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "running",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-23T00:00:05.000Z",
      agent: { agent: "claude-code", model: "sonnet-5.5", choice: "chat" },
      start: { source: "chat", chatId: c1.chatId },
    });

    const summary = (await f.service.call("chats.setAgent", {
      chatId: c1.chatId,
      agent: "codex",
      model: "gpt-6.1-sol",
    })) as ChatSummary;
    expect(summary).toMatchObject({ id: c1.chatId, agent: "codex", model: "gpt-6.1-sol" });
    expect((await f.get(c1.chatId)).chat).toMatchObject({ agent: "codex", model: "gpt-6.1-sol" });
    expect(f.store.getChat(c1.chatId)).toMatchObject({ agentSource: "person" });
    expect((await f.get(c2.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
    expect(await f.service.call("settings.get", {})).toMatchObject({
      mainAgent: { agent: "claude-code", model: "sonnet-5.5" },
    });
    expect((await f.get(c1.chatId)).messages).toMatchObject([
      { kind: "text", text: "first chat" },
      {
        role: "flowdriven",
        kind: "note",
        line: { key: "chat.agentChanged", params: { agent: "codex", model: "gpt-6.1-sol" } },
      },
    ]);
    expect(
      (
        (await f.service.call("audit.list", {})) as { kind: string; detail: Record<string, unknown> }[]
      ).filter((row) => row.kind === "chat_agent_changed"),
    ).toMatchObject([{ detail: { chatId: c1.chatId, agent: "codex", model: "gpt-6.1-sol" } }]);
    expect(await f.service.call("runs.status", { runId })).toMatchObject({
      agent: "claude-code",
      model: "sonnet-5.5",
    });

    await expect(
      f.service.call("chats.setAgent", { chatId: c1.chatId, agent: "codex", model: "gpt-6.1-nova" }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "model_unknown" });
    await expect(
      f.service.call("chats.setAgent", { chatId: c1.chatId, agent: "gemini", model: "gpt-6.1-sol" }),
    ).rejects.toMatchObject({ code: "not_found", reason: "agent_unknown" });

    writeFakeCodexScript(f.home, { profile: AGENT_PROFILES.codex, signedIn: false });
    await f.service.call("agents.rescan", {});
    await expect(
      f.service.call("chats.setAgent", { chatId: c1.chatId, agent: "codex", model: "gpt-6.1-sol" }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "agent_not_ready" });
  } finally {
    f.close();
  }
});

test("TC-AST-26 a model that is no longer offered falls back to default once while running run keeps old model", async () => {
  const f = await fixture();
  try {
    const c1 = await f.create();
    await f.service.call("chats.setAgent", {
      chatId: c1.chatId,
      agent: "claude-code",
      model: "opus-5.5",
    });
    const { manifest, hash } = seedSampleFlow(f.store, "example.fill-timesheet");
    const runId = "run-000000000001";
    f.store.createRun({
      id: runId,
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "running",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-23T00:00:05.000Z",
      agent: { agent: "claude-code", model: "opus-5.5", choice: "chat" },
      start: { source: "chat", chatId: c1.chatId },
    });

    const claude = f.catalog.find((entry) => entry.id === "claude-code");
    if (!claude) throw new Error("missing catalog");
    claude.models["2.1.318"] = (claude.models["2.1.318"] ?? []).filter((m) => m.id !== "opus-5.5");
    await f.service.call("agents.rescan", {});

    const view1 = await f.get(c1.chatId);
    const view2 = await f.get(c1.chatId);
    expect(view1.chat.model).toBe("sonnet-5.5");
    expect(view2.chat.model).toBe("sonnet-5.5");
    expect(f.store.getChat(c1.chatId)).toMatchObject({ model: "sonnet-5.5", agentSource: "model_gone" });
    expect(view2.messages.filter((m) => m.line?.key === "chat.modelGone")).toMatchObject([
      {
        role: "flowdriven",
        kind: "note",
        line: {
          key: "chat.modelGone",
          params: { old: "Opus 5.5", agent: "claude-code", model: "sonnet-5.5" },
        },
      },
    ]);
    expect(await f.service.call("runs.status", { runId })).toMatchObject({
      agent: "claude-code",
      model: "opus-5.5",
    });
  } finally {
    f.close();
  }
});

test("TC-SR4-06 unlisted model is refused and gone model falls back", async () => {
  const f = await fixture();
  try {
    const c1 = await f.create();
    await expect(
      f.service.call("chats.setAgent", {
        chatId: c1.chatId,
        agent: "claude-code",
        model: "gpt-6.1-sol",
      }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "model_unknown" });
    expect((await f.get(c1.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });

    await f.service.call("chats.setAgent", {
      chatId: c1.chatId,
      agent: "claude-code",
      model: "haiku-5.5",
    });
    const claude = f.catalog.find((entry) => entry.id === "claude-code");
    if (!claude) throw new Error("missing catalog");
    claude.models["2.1.318"] = (claude.models["2.1.318"] ?? []).filter((m) => m.id !== "haiku-5.5");
    await f.service.call("agents.rescan", {});

    const view = await f.get(c1.chatId);
    expect(view.chat.model).toBe("sonnet-5.5");
    expect(f.store.getChat(c1.chatId)).toMatchObject({ model: "sonnet-5.5", agentSource: "model_gone" });
    expect(view.messages.filter((m) => m.line?.key === "chat.modelGone")).toMatchObject([
      {
        line: {
          key: "chat.modelGone",
          params: { old: "Haiku 5.5", agent: "claude-code", model: "sonnet-5.5" },
        },
      },
    ]);
  } finally {
    f.close();
  }
});

test("TC-STO-35 deleting a chat leaves no text behind and keeps runs, usage and audit", async () => {
  const dbPath = tempPath();
  const f = await fixture(dbPath);
  const marker = "zq-marker-8841-invoice";
  try {
    const { chatId } = await f.create();
    f.addMessage(chatId, "person", `Please process ${marker}`);
    f.addMessage(chatId, "agent", `Reply for ${marker}`);
    f.store.putDraft({
      id: "draft-000000000001",
      chatId,
      messageId: "msg-000000000001",
      kind: "new_flow",
      state: "drafted",
      createdAt: "2026-11-23T00:00:01.000Z",
      updatedAt: "2026-11-23T00:00:01.000Z",
      files: { "flow.yaml": marker },
      hash: `sha256:${"a".repeat(64)}`,
      name: "Draft",
      nameAdjusted: false,
      lists: { onItsOwn: [], asksFirst: [], never: [] },
      outside: false,
      assumptions: [],
    });
    f.store.putQuestion({
      id: "wq-000000000001",
      flowId: "example.fill-timesheet",
      chatId,
      messageId: "msg-000000000001",
      kind: "inputs",
      state: "open",
      createdAt: "2026-11-23T00:00:02.000Z",
      updatedAt: "2026-11-23T00:00:02.000Z",
      source: "schedule",
      proactive: true,
      flowHash: `sha256:${"a".repeat(64)}`,
      given: {},
      missing: ["duration"],
      pendingStart: { startId: "start-000000000001", source: "schedule", request: {} },
    });
    const { manifest, hash } = seedSampleFlow(f.store, "example.fill-timesheet");
    const runId = "run-000000000001";
    f.store.createRun({
      id: runId,
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "running",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-23T00:00:03.000Z",
      agent: { agent: "claude-code", model: "sonnet-5.5", choice: "chat" },
      start: { source: "chat", chatId },
    });
    f.store.addUsage({
      at: "2026-11-23T00:00:04.000Z",
      runId: chatId,
      stepId: "msg-000000000001",
      itemKey: "",
      attempt: 1,
      kind: "brain",
      harness: "claude-code",
      models: [{ model: "sonnet-5.5", input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }],
      turns: 1,
      wallMs: 50,
      queuedMs: 0,
      exit: "ok",
      billing: "plan",
    });

    expect(await f.service.call("chats.delete", { chatId })).toEqual({ deleted: true });
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
    } finally {
      db.close();
    }

    await expect(f.service.call("chats.delete", { chatId })).rejects.toMatchObject({ code: "not_found" });
    await expect(f.service.call("chats.get", { chatId })).rejects.toMatchObject({ code: "not_found" });
    expect(f.store.getChat(chatId)).toBeUndefined();
    expect(f.store.listMessages(chatId)).toEqual([]);
    expect(f.store.listDrafts(chatId)).toEqual([]);
    expect(f.store.listQuestions().filter((q) => q.chatId === chatId)).toEqual([]);
    expect(f.store.getRun(runId)?.state).toBe("running");
    expect(f.store.listUsage({ runId: chatId })).toHaveLength(1);

    const audit = await f.service.call("audit.list", {});
    expect(audit).toContainEqual(
      expect.objectContaining({
        kind: "question_closed",
        detail: {
          questionId: "wq-000000000001",
          flowId: "example.fill-timesheet",
          chatId,
          kind: "inputs",
          state: "closed",
          why: "chat_deleted",
        },
      }),
    );
    expect(audit).toContainEqual(
      expect.objectContaining({
        kind: "chat_deleted",
        detail: { chatId, messages: 2 },
      }),
    );
    expect(JSON.stringify(audit)).not.toContain(marker);
    expect(readFileSync(dbPath).includes(Buffer.from(marker))).toBe(false);
    if (existsSync(`${dbPath}-wal`)) {
      expect(readFileSync(`${dbPath}-wal`).includes(Buffer.from(marker))).toBe(false);
    }
  } finally {
    f.close();
  }
});

test("TC-SR7-11 deleting a flow and a chat leaves prior audit and removes chat bytes", async () => {
  const dbPath = tempPath();
  const f = await fixture(dbPath);
  const marker = "sr7-delete-marker-991";
  try {
    const { manifest, hash } = seedSampleFlow(f.store, "example.fill-timesheet");
    const rule = standingRule(f.store);
    f.store.createRun({
      id: "run-000000000001",
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "done",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-23T00:00:01.000Z",
      endedAt: "2026-11-23T00:00:02.000Z",
    });
    const { chatId } = await f.create();
    f.addMessage(chatId, "person", marker);
    f.addMessage(chatId, "agent", `${marker} response`);
    f.store.appendAudit({
      at: "2026-11-23T00:00:03.000Z",
      kind: "rule_used",
      runId: "run-000000000001",
      detail: { ruleId: rule.id, flowId: manifest.id },
    });
    const beforeAudit = f.store.listAudit();

    await f.service.call("flows.delete", { flowId: manifest.id });
    await f.service.call("chats.delete", { chatId });
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
    } finally {
      db.close();
    }

    const afterAudit = f.store.listAudit();
    expect(afterAudit.slice(0, beforeAudit.length)).toEqual(beforeAudit);
    expect(afterAudit).toContainEqual(
      expect.objectContaining({
        kind: "flow_deleted",
        detail: expect.objectContaining({ flowId: manifest.id }),
      }),
    );
    expect(afterAudit).toContainEqual(
      expect.objectContaining({ kind: "chat_deleted", detail: { chatId, messages: 2 } }),
    );
    expect(f.store.listMessages(chatId)).toEqual([]);
    expect(readFileSync(dbPath).includes(Buffer.from(marker))).toBe(false);
    if (existsSync(`${dbPath}-wal`)) {
      expect(readFileSync(`${dbPath}-wal`).includes(Buffer.from(marker))).toBe(false);
    }
  } finally {
    f.close();
  }
});
