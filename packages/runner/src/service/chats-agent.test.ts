import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { ChatView } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { AGENT_CATALOG } from "../agents/catalog.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { AGENT_PROFILES } from "../test-helpers/agent-profiles.ts";
import { seedSampleFlow } from "../test-helpers/builders.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { FAKE_CODEX_PATH, writeFakeCodexScript } from "../test-helpers/fake-codex-script.ts";
import { createRunnerService } from "./service.ts";

async function fixture() {
  const home = makeFakeHome();
  const bin = join(home, "bin");
  mkdirSync(bin);
  symlinkSync(FAKE_CLAUDE_PATH, join(bin, "claude"));
  symlinkSync(FAKE_CODEX_PATH, join(bin, "codex"));
  writeFakeCodexScript(home, { profile: AGENT_PROFILES.codex, signedIn: true });
  const store = await openSqliteStore(":memory:");
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
    store,
    catalog,
    service,
    create: () => service.call("chats.create", {}) as Promise<{ chatId: string; reused: boolean }>,
    get: (chatId: string) => service.call("chats.get", { chatId }) as Promise<ChatView>,
    addPersonMessage(chatId: string, text = "hello") {
      const seq = (store.listMessages(chatId).at(-1)?.seq ?? 0) + 1;
      store.putMessage({
        id: `msg-${String(++n).padStart(12, "0")}`,
        chatId,
        seq,
        at: new Date(++ms).toISOString(),
        role: "person",
        kind: "text",
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

test("TC-j31-01 a new chat starts with the main agent's default model and empty chats reuse with current main", async () => {
  const f = await fixture();
  try {
    const a = await f.create();
    expect(a.reused).toBe(false);
    f.addPersonMessage(a.chatId);
    await f.service.call("settings.update", {
      patch: { mainAgent: { agent: "codex", model: "gpt-6.1-sol" } },
    });
    const b = await f.create();
    expect(b.reused).toBe(false);
    expect((await f.get(a.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
    expect((await f.get(b.chatId)).chat).toMatchObject({ agent: "codex", model: "gpt-6.1-sol" });
    expect(f.store.getChat(a.chatId)).toMatchObject({ agentSource: "main_default" });
    expect(f.store.getChat(b.chatId)).toMatchObject({ agentSource: "main_default" });
    const claudeModels = (await f.service.call("agents.models", { agentId: "claude-code" })) as {
      id: string;
      isDefault: boolean;
    }[];
    expect(claudeModels.filter((m) => m.isDefault).map((m) => m.id)).toEqual(["sonnet-5.5"]);

    await f.service.call("settings.update", {
      patch: { mainAgent: { agent: "claude-code", model: "sonnet-5.5" } },
    });
    const reused = await f.create();
    expect(reused).toEqual({ chatId: b.chatId, reused: true });
    expect((await f.get(b.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
  } finally {
    f.close();
  }
});

test("TC-j31-06 a choice changes only that chat with note and audit", async () => {
  const f = await fixture();
  try {
    const a = await f.create();
    f.addPersonMessage(a.chatId, "Example chat");
    const b = await f.create();
    f.addPersonMessage(b.chatId, "Second chat");
    await f.service.call("chats.setAgent", {
      chatId: a.chatId,
      agent: "claude-code",
      model: "opus-5.5",
    });
    const c = await f.create();
    expect((await f.get(a.chatId)).chat).toMatchObject({ agent: "claude-code", model: "opus-5.5" });
    expect(f.store.getChat(a.chatId)).toMatchObject({ agentSource: "person" });
    expect((await f.get(b.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
    expect((await f.get(c.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
    expect(await f.service.call("settings.get", {})).toMatchObject({
      mainAgent: { agent: "claude-code", model: "sonnet-5.5" },
    });
    expect((await f.get(a.chatId)).messages).toMatchObject([
      { kind: "text", text: "Example chat" },
      {
        role: "flowdriven",
        kind: "note",
        line: { key: "chat.agentChanged", params: { agent: "claude-code", model: "opus-5.5" } },
      },
    ]);
    expect((await f.get(b.chatId)).messages).toHaveLength(1);
    expect((await f.get(c.chatId)).messages).toHaveLength(0);
    expect(
      (
        (await f.service.call("audit.list", {})) as { kind: string; detail: Record<string, unknown> }[]
      ).filter((row) => row.kind === "chat_agent_changed"),
    ).toMatchObject([{ detail: { chatId: a.chatId, agent: "claude-code", model: "opus-5.5" } }]);
  } finally {
    f.close();
  }
});

test("TC-j31-23 an unlisted or malformed model id is refused and the choice stays", async () => {
  const f = await fixture();
  try {
    const a = await f.create();
    await expect(
      f.service.call("chats.setAgent", { chatId: a.chatId, agent: "claude-code", model: "opus-9" }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "model_unknown" });
    for (const model of ["--dangerously-skip-permissions", "opus-5.5 --yolo", "Opus", "a".repeat(65)]) {
      await expect(
        f.service.call("chats.setAgent", { chatId: a.chatId, agent: "claude-code", model }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      f.service.call("chats.setAgent", { chatId: a.chatId, agent: "nope", model: "opus-5.5" }),
    ).rejects.toMatchObject({ code: "not_found", reason: "agent_unknown" });
    await expect(
      f.service.call("settings.update", {
        patch: { mainAgent: { agent: "claude-code", model: "opus-9" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "model_unknown" });
    expect((await f.get(a.chatId)).chat).toMatchObject({ agent: "claude-code", model: "sonnet-5.5" });
    expect(f.store.getChat(a.chatId)).toMatchObject({ agentSource: "main_default" });
    expect((await f.get(a.chatId)).messages).toHaveLength(0);
    expect(f.store.listAudit().filter((row) => row.kind === "chat_agent_changed")).toHaveLength(0);
  } finally {
    f.close();
  }
});

test("TC-j31-28 a model that went away falls back to the default once", async () => {
  const f = await fixture();
  try {
    const a = await f.create();
    const claude = f.catalog.find((entry) => entry.id === "claude-code");
    if (!claude) throw new Error("missing catalog");
    claude.models["2.1.318"] = (claude.models["2.1.318"] ?? [])
      .filter((m) => m.id !== "sonnet-5.5")
      .map((m) => ({ ...m, isDefault: m.id === "opus-5.5" }));
    await f.service.call("agents.rescan", {});
    const first = await f.get(a.chatId);
    const second = await f.get(a.chatId);
    expect(first.chat.model).toBe("opus-5.5");
    expect(second.chat.model).toBe("opus-5.5");
    expect(f.store.getChat(a.chatId)).toMatchObject({ model: "opus-5.5", agentSource: "model_gone" });
    expect(second.messages).toMatchObject([
      {
        role: "flowdriven",
        kind: "note",
        line: {
          key: "chat.modelGone",
          params: { old: "Sonnet 5.5", agent: "claude-code", model: "opus-5.5" },
        },
      },
    ]);
  } finally {
    f.close();
  }
});

test("TC-j31-35 run agent, model and chat_agent_changed audit are recorded", async () => {
  const f = await fixture();
  try {
    const chat = await f.create();
    await f.service.call("chats.setAgent", {
      chatId: chat.chatId,
      agent: "claude-code",
      model: "opus-5.5",
    });
    const { manifest, hash } = seedSampleFlow(f.store, "example.fill-timesheet");
    const at = "2026-11-23T00:00:10.000Z";
    const chatRunId = "run-000000000001";
    const schedRunId = "run-000000000002";
    f.store.createRun({
      id: chatRunId,
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "done",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: at,
      endedAt: at,
      agent: { agent: "claude-code", model: "opus-5.5", choice: "chat" },
      start: { source: "chat", chatId: chat.chatId },
    });
    f.store.claimStart({
      id: "start-000000000001",
      flowId: manifest.id,
      at,
      source: "chat",
      outcome: "started",
      runId: chatRunId,
      chatId: chat.chatId,
      request: { chatId: chat.chatId },
      agent: { agent: "claude-code", model: "opus-5.5", choice: "chat" },
      flowHash: hash,
    });
    f.store.appendAudit({
      at,
      kind: "start_requested",
      runId: chatRunId,
      detail: {
        flowId: manifest.id,
        source: "chat",
        outcome: "started",
        startId: "start-000000000001",
        runId: chatRunId,
      },
    });
    f.store.createRun({
      id: schedRunId,
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "done",
      project: f.home,
      inputs: {},
      params: {},
      requirements: [],
      startedAt: at,
      endedAt: at,
      agent: { agent: "claude-code", model: "sonnet-5.5", choice: "main" },
      start: { source: "schedule" },
    });
    f.store.claimStart({
      id: "start-000000000002",
      flowId: manifest.id,
      at,
      source: "schedule",
      outcome: "started",
      runId: schedRunId,
      request: {},
      agent: { agent: "claude-code", model: "sonnet-5.5", choice: "main" },
      flowHash: hash,
    });
    f.store.appendAudit({
      at,
      kind: "start_requested",
      runId: schedRunId,
      detail: {
        flowId: manifest.id,
        source: "schedule",
        outcome: "started",
        startId: "start-000000000002",
        runId: schedRunId,
      },
    });

    expect(await f.service.call("runs.status", { runId: chatRunId })).toMatchObject({
      agent: "claude-code",
      model: "opus-5.5",
    });
    expect(await f.service.call("runs.status", { runId: schedRunId })).toMatchObject({
      agent: "claude-code",
      model: "sonnet-5.5",
    });
    expect(f.store.listStarts()).toMatchObject([
      { runId: chatRunId, agent: { agent: "claude-code", model: "opus-5.5", choice: "chat" } },
      { runId: schedRunId, agent: { agent: "claude-code", model: "sonnet-5.5", choice: "main" } },
    ]);
    expect(await f.service.call("audit.list", { runId: chatRunId })).toMatchObject([
      { kind: "start_requested", runId: chatRunId, detail: { runId: chatRunId } },
    ]);
    expect(await f.service.call("audit.list", { runId: schedRunId })).toMatchObject([
      { kind: "start_requested", runId: schedRunId, detail: { runId: schedRunId } },
    ]);
    expect(await f.service.call("audit.list", {})).toContainEqual(
      expect.objectContaining({
        kind: "chat_agent_changed",
        detail: { chatId: chat.chatId, agent: "claude-code", model: "opus-5.5" },
      }),
    );
  } finally {
    f.close();
  }
});
