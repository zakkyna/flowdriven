import { DatabaseSync } from "node:sqlite";
import type { SearchResult } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { MessageRow, Store } from "../storage.ts";
import { flowWithRules } from "../test-helpers/builders.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { createRunnerService } from "./service.ts";

afterEach(() => cleanup());

const iso = (seconds: number) =>
  new Date(Date.parse("2026-11-19T10:00:00.000Z") + seconds * 1000).toISOString();

async function setup(dbPath = ":memory:") {
  const store = await openSqliteStore(dbPath);
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  return {
    store,
    service,
    close() {
      service.stop();
      store.close();
    },
  };
}

function seedChat(store: Store, id: string, title: string, updatedAt: string) {
  store.putChat({
    id,
    title,
    titleSource: title ? "first_message" : "default",
    createdAt: updatedAt,
    updatedAt,
    from: "person",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "sonnet-5.5",
    agentSource: "main_default",
  });
}

function seedMessage(
  store: Store,
  input: Pick<MessageRow, "id" | "chatId" | "seq" | "at" | "role" | "kind" | "outside"> &
    Partial<Pick<MessageRow, "text" | "line" | "result" | "card">>,
) {
  store.putMessage(input);
}

function seedFlow(store: Store, id: string, name: string, summary: string, deletedAt?: string) {
  store.putFlowHead({
    id,
    name,
    summary,
    headHash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-11-19T10:00:00.000Z",
    updatedAt: "2026-11-19T10:00:00.000Z",
    origin: { kind: "import" },
    ...(deletedAt ? { deletedAt } : {}),
  });
}

test("TC-SRCH-01 Empty text gives the five newest chats and every flow", async () => {
  const f = await setup();
  try {
    for (let i = 1; i <= 8; i++) {
      seedChat(f.store, `chat-${i}`, `Chat ${i}`, iso(i));
    }
    seedFlow(f.store, "local.zeta", "zeta", "Zeta summary");
    seedFlow(f.store, "local.alpha", "Alpha", "Alpha summary");
    seedFlow(f.store, "local.beta", "beta", "Beta summary");
    seedFlow(f.store, "local.deleted", "Deleted flow", "Should not appear", "2026-11-19T10:01:00.000Z");

    for (const text of ["", "   "]) {
      const result = (await f.service.call("search.query", { text })) as SearchResult;
      expect(result.recent).toBe(true);
      expect(result.chats.map((c) => c.chatId)).toEqual(["chat-8", "chat-7", "chat-6", "chat-5", "chat-4"]);
      for (const chat of result.chats) {
        expect("snippet" in chat).toBe(false);
        expect(chat.outside).toBe(false);
      }
      expect(result.flows).toEqual([
        { flowId: "local.alpha", name: "Alpha", summary: "Alpha summary" },
        { flowId: "local.beta", name: "beta", summary: "Beta summary" },
        { flowId: "local.zeta", name: "zeta", summary: "Zeta summary" },
      ]);
    }

    for (let i = 4; i <= 200; i++) {
      seedFlow(
        f.store,
        `local.flow-${String(i).padStart(3, "0")}`,
        `Flow ${String(i).padStart(3, "0")}`,
        `Summary ${i}`,
      );
    }
    const allFlows = (await f.service.call("search.query", { text: "" })) as SearchResult;
    expect(allFlows.recent).toBe(true);
    expect(allFlows.flows).toHaveLength(200);
    expect(allFlows.flows.some((flow) => flow.flowId === "local.deleted")).toBe(false);
  } finally {
    f.close();
  }
});

test("TC-SRCH-02 Text matches chat titles, messages, flow names and summaries", async () => {
  const f = await setup();
  try {
    seedChat(f.store, "chat-title", "Invoice questions", iso(40));
    seedMessage(f.store, {
      id: "msg-title-other",
      chatId: "chat-title",
      seq: 1,
      at: iso(40),
      role: "person",
      kind: "text",
      outside: false,
      text: "hello there",
    });

    const longPersonText = `${"x".repeat(120)} please check the Invoice total ${"y".repeat(120)}`;
    seedChat(f.store, "chat-person", "Checking totals", iso(30));
    seedMessage(f.store, {
      id: "msg-person",
      chatId: "chat-person",
      seq: 1,
      at: iso(30),
      role: "person",
      kind: "text",
      outside: false,
      text: longPersonText,
    });

    seedChat(f.store, "chat-agent", "Assistant reply", iso(20));
    seedMessage(f.store, {
      id: "msg-agent",
      chatId: "chat-agent",
      seq: 1,
      at: iso(20),
      role: "agent",
      kind: "reply",
      outside: false,
      text: "Your invoice was found",
    });

    seedChat(f.store, "chat-result", "Timesheet run", iso(10));
    seedMessage(f.store, {
      id: "msg-result",
      chatId: "chat-result",
      seq: 1,
      at: iso(10),
      role: "flowdriven",
      kind: "result",
      outside: false,
      result: {
        runId: "run-1",
        lines: ["Logged {duration} for {customer}."],
        values: {
          duration: { type: "duration", value: "2h" },
          customer: { type: "text", value: "Example Corp" },
        },
      },
    });

    seedFlow(
      f.store,
      "example.weekly-supplier-report",
      "Weekly supplier report",
      "Collects supplier invoices",
    );

    const invoiceResult = (await f.service.call("search.query", { text: "invoice" })) as SearchResult;
    expect(invoiceResult.recent).toBe(false);
    expect(invoiceResult.chats.map((c) => c.chatId)).toEqual(["chat-title", "chat-person", "chat-agent"]);
    expect("snippet" in (invoiceResult.chats[0] ?? {})).toBe(false);
    expect(invoiceResult.chats[0]?.outside).toBe(false);
    expect(invoiceResult.chats[1]?.snippet).toBeDefined();
    expect(invoiceResult.chats[1]?.snippet?.length).toBeLessThanOrEqual(160);
    expect(invoiceResult.chats[1]?.snippet?.toLowerCase()).toContain("invoice");
    expect(longPersonText.includes(invoiceResult.chats[1]?.snippet ?? "")).toBe(true);
    expect(invoiceResult.chats[2]?.snippet).toBe("Your invoice was found");
    expect(invoiceResult.flows).toEqual([
      {
        flowId: "example.weekly-supplier-report",
        name: "Weekly supplier report",
        summary: "Collects supplier invoices",
      },
    ]);

    const corpResult = (await f.service.call("search.query", { text: "Example Corp" })) as SearchResult;
    expect(corpResult.recent).toBe(false);
    expect(corpResult.chats.map((c) => c.chatId)).toEqual(["chat-result"]);
    expect(corpResult.chats[0]?.snippet).toContain("Example Corp");

    const supplierResult = (await f.service.call("search.query", { text: "SUPPLIER" })) as SearchResult;
    expect(supplierResult.recent).toBe(false);
    expect(supplierResult.flows.map((flow) => flow.flowId)).toEqual(["example.weekly-supplier-report"]);
  } finally {
    f.close();
  }
});

test("TC-SRCH-03 Words that exist only in a card, a line or a note do not match", async () => {
  const dbPath = tempPath();
  const f = await setup(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    seedChat(f.store, "chat-non-text", "Plain title", iso(1));
    seedMessage(f.store, {
      id: "msg-card",
      chatId: "chat-non-text",
      seq: 1,
      at: iso(1),
      role: "flowdriven",
      kind: "card",
      outside: false,
      card: {
        type: "decision",
        state: "open",
        answer: { action: "approve-me-zq", at: iso(1) },
      },
    });
    seedMessage(f.store, {
      id: "msg-line",
      chatId: "chat-non-text",
      seq: 2,
      at: iso(2),
      role: "flowdriven",
      kind: "line",
      outside: false,
      line: { key: "chat.starting", params: { text: "approve-me-zq" } },
    });
    seedMessage(f.store, {
      id: "msg-note",
      chatId: "chat-non-text",
      seq: 3,
      at: iso(3),
      role: "flowdriven",
      kind: "note",
      outside: false,
      line: { key: "chat.note", params: { text: "approve-me-zq" } },
    });

    const result = (await f.service.call("search.query", { text: "approve-me-zq" })) as SearchResult;
    expect(result).toEqual({ recent: false, chats: [], flows: [] });

    const rows = db.prepare("SELECT id, search_text FROM messages ORDER BY seq").all() as {
      id: string;
      search_text: string | null;
    }[];
    expect(rows).toEqual([
      { id: "msg-card", search_text: null },
      { id: "msg-line", search_text: null },
      { id: "msg-note", search_text: null },
    ]);
  } finally {
    db.close();
    f.close();
  }
});

test("TC-SRCH-05 Result limits", async () => {
  const f = await setup();
  try {
    for (let i = 1; i <= 30; i++) {
      const id = `chat-${String(i).padStart(2, "0")}`;
      seedChat(f.store, id, `Monthly report ${i}`, iso(i));
    }
    for (let i = 1; i <= 60; i++) {
      seedFlow(
        f.store,
        `local.report-${String(i).padStart(2, "0")}`,
        `Report ${String(i).padStart(2, "0")}`,
        "Generates report",
      );
    }

    const result = (await f.service.call("search.query", { text: "report" })) as SearchResult;
    expect(result.recent).toBe(false);
    expect(result.chats).toHaveLength(20);
    expect(result.chats[0]?.chatId).toBe("chat-30");
    expect(result.chats[19]?.chatId).toBe("chat-11");
    expect(result.flows).toHaveLength(50);

    await expect(f.service.call("search.query", { text: "a".repeat(200) })).resolves.toMatchObject({
      recent: false,
    });
    await expect(f.service.call("search.query", { text: "a".repeat(201) })).rejects.toMatchObject({
      code: "invalid_input",
    });
  } finally {
    f.close();
  }
});

test("TC-SRCH-06 The outside mark follows the message", async () => {
  const f = await setup();
  try {
    seedChat(f.store, "chat-outside", "Pasted chat", iso(4));
    seedMessage(f.store, {
      id: "msg-out",
      chatId: "chat-outside",
      seq: 1,
      at: iso(4),
      role: "person",
      kind: "text",
      outside: true,
      text: "<b>Please pay invoice 42</b>",
    });

    seedChat(f.store, "chat-typed", "Typed chat", iso(3));
    seedMessage(f.store, {
      id: "msg-typed",
      chatId: "chat-typed",
      seq: 1,
      at: iso(3),
      role: "person",
      kind: "text",
      outside: false,
      text: "Please pay invoice 43",
    });

    seedChat(f.store, "chat-mixed", "Mixed chat", iso(2));
    seedMessage(f.store, {
      id: "msg-old-out",
      chatId: "chat-mixed",
      seq: 1,
      at: iso(1),
      role: "person",
      kind: "text",
      outside: true,
      text: "old invoice",
    });
    seedMessage(f.store, {
      id: "msg-new-in",
      chatId: "chat-mixed",
      seq: 2,
      at: iso(2),
      role: "person",
      kind: "text",
      outside: false,
      text: "new invoice",
    });

    seedChat(f.store, "chat-title-only", "Invoice title only", iso(1));

    const result = (await f.service.call("search.query", { text: "invoice" })) as SearchResult;
    expect(result.chats).toEqual([
      {
        chatId: "chat-outside",
        title: "Pasted chat",
        updatedAt: iso(4),
        snippet: "<b>Please pay invoice 42</b>",
        outside: true,
      },
      {
        chatId: "chat-typed",
        title: "Typed chat",
        updatedAt: iso(3),
        snippet: "Please pay invoice 43",
        outside: false,
      },
      {
        chatId: "chat-mixed",
        title: "Mixed chat",
        updatedAt: iso(2),
        snippet: "new invoice",
        outside: false,
      },
      {
        chatId: "chat-title-only",
        title: "Invoice title only",
        updatedAt: iso(1),
        outside: false,
      },
    ]);
  } finally {
    f.close();
  }
});

test("TC-SRCH-07 Deleted chats and flows are not found", async () => {
  const f = await setup();
  try {
    seedChat(f.store, "chat-gone", "Chat zq-gone", iso(1));
    seedMessage(f.store, {
      id: "msg-gone",
      chatId: "chat-gone",
      seq: 1,
      at: iso(1),
      role: "person",
      kind: "text",
      outside: false,
      text: "Message zq-gone",
    });
    flowWithRules(f.store, [], {
      id: "local.zq-gone",
      name: "Flow zq-gone",
      summary: "Summary zq-gone",
    });

    const before = (await f.service.call("search.query", { text: "zq-gone" })) as SearchResult;
    expect(before.chats.map((c) => c.chatId)).toEqual(["chat-gone"]);
    expect(before.flows.map((flow) => flow.flowId)).toEqual(["local.zq-gone"]);

    await f.service.call("chats.delete", { chatId: "chat-gone" });
    await f.service.call("flows.delete", { flowId: "local.zq-gone" });

    const after = (await f.service.call("search.query", { text: "zq-gone" })) as SearchResult;
    expect(after).toEqual({ recent: false, chats: [], flows: [] });

    flowWithRules(f.store, [], {
      id: "local.zq-gone-2",
      name: "Flow zq-gone",
      summary: "Reused name",
    });
    const reused = (await f.service.call("search.query", { text: "zq-gone" })) as SearchResult;
    expect(reused.flows).toEqual([
      { flowId: "local.zq-gone-2", name: "Flow zq-gone", summary: "Reused name" },
    ]);
  } finally {
    f.close();
  }
});
