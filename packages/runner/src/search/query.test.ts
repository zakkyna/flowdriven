import { SearchResult } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { SearchParam } from "../storage.ts";
import { searchQuery } from "./query.ts";

test("TC-SRCH-04 The percent sign, the underscore and the backslash are literal", async () => {
  const recorded: { sql: string; params: readonly SearchParam[] }[] = [];
  const store = await openSqliteStore(":memory:", {
    onStatement: (sql, params) => {
      recorded.push({ sql, params });
    },
  });
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const messages = [
      { id: "chat-1", text: "we are 50% done" },
      { id: "chat-2", text: "we are 500 done" },
      { id: "chat-3", text: "file a_b" },
      { id: "chat-4", text: "file axb" },
      { id: "chat-5", text: "path x\\y" },
    ];
    for (let i = 0; i < messages.length; i++) {
      const entry = messages[i];
      if (!entry) continue;
      const at = `2026-11-19T10:00:0${i + 1}.000Z`;
      store.putChat({
        id: entry.id,
        title: `Chat ${i + 1}`,
        titleSource: "first_message",
        createdAt: at,
        updatedAt: at,
        from: "person",
        language: "en",
        languageSource: "app",
        agent: "claude-code",
        model: "sonnet-5.5",
        agentSource: "main_default",
      });
      store.putMessage({
        id: `msg-${i + 1}`,
        chatId: entry.id,
        seq: 1,
        at,
        role: "person",
        kind: "text",
        outside: false,
        text: entry.text,
      });
    }

    const cases: { text: string; expectedIds: string[]; expectedParam: string }[] = [
      { text: "50%", expectedIds: ["chat-1"], expectedParam: "%50\\%%" },
      { text: "%", expectedIds: ["chat-1"], expectedParam: "%\\%%" },
      { text: "a_b", expectedIds: ["chat-3"], expectedParam: "%a\\_b%" },
      { text: "_", expectedIds: ["chat-3"], expectedParam: "%\\_%" },
      { text: "x\\y", expectedIds: ["chat-5"], expectedParam: "%x\\\\y%" },
    ];

    for (const item of cases) {
      recorded.length = 0;
      const result = (await service.call("search.query", { text: item.text })) as SearchResult;
      expect(result.chats.map((c) => c.chatId)).toEqual(item.expectedIds);
      expect(result.chats.length).toBeLessThan(messages.length);
      expect(recorded.length).toBeGreaterThan(0);
      expect(recorded.length).toBeLessThanOrEqual(2);
      for (const stmt of recorded) {
        expect(stmt.sql).toContain("ESCAPE '\\'");
        expect(stmt.params.length).toBeGreaterThan(0);
        for (const param of stmt.params) {
          expect(param).toBe(item.expectedParam);
        }
      }
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SRCH-08 No match gives empty lists", async () => {
  const store = await openSqliteStore(":memory:");
  try {
    store.putChat({
      id: "chat-1",
      title: "Monthly close",
      titleSource: "first_message",
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:00:00.000Z",
      from: "person",
      language: "en",
      languageSource: "app",
      agent: "claude-code",
      model: "sonnet-5.5",
      agentSource: "main_default",
    });
    store.putFlowHead({
      id: "local.close",
      name: "Monthly close",
      summary: "Closes books",
      headHash: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-11-19T10:00:00.000Z",
      updatedAt: "2026-11-19T10:00:00.000Z",
      origin: { kind: "import" },
    });

    const result = searchQuery(store, "zzzzqq");
    expect(result).toEqual({ recent: false, chats: [], flows: [] });
    expect(SearchResult.parse(result)).toEqual({ recent: false, chats: [], flows: [] });
    expect(() => store.searchRows("DELETE FROM chats")).toThrow();
    expect(() => store.searchRows("SELECT 1; DROP TABLE chats")).toThrow();
  } finally {
    store.close();
  }
});
