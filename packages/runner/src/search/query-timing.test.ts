import { dirname } from "node:path";
import type { SearchResult } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { createRunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";

afterEach(() => cleanup());

test("TC-SRCH-10 Search is fast with 1,000 chats and 200 flows", async () => {
  const dbPath = tempPath();
  let statements = 0;
  const store = await openSqliteStore(dbPath, {
    onStatement: () => {
      statements++;
    },
  });
  const service = createRunnerService({ store, dataDir: dirname(dbPath), mode: "demo" });
  try {
    const baseMs = Date.parse("2026-11-19T10:00:00.000Z");
    store.transaction(() => {
      for (let i = 1; i <= 1000; i++) {
        const chatId = `chat-${String(i).padStart(4, "0")}`;
        const at = new Date(baseMs + i * 1000).toISOString();
        store.putChat({
          id: chatId,
          title: `Conversation ${i}`,
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
        const hasInvoice = i % 10 === 0;
        for (let seq = 1; seq <= 5; seq++) {
          store.putMessage({
            id: `${chatId}-m${seq}`,
            chatId,
            seq,
            at,
            role: seq % 2 === 1 ? "person" : "agent",
            kind: seq % 2 === 1 ? "text" : "reply",
            outside: false,
            text:
              hasInvoice && seq === 3
                ? `Please review invoice #${i} before Friday.`
                : `Routine message ${seq} for chat ${i}.`,
          });
        }
      }
      for (let i = 1; i <= 200; i++) {
        const flowId = `local.flow-${String(i).padStart(3, "0")}`;
        const at = new Date(baseMs + i * 1000).toISOString();
        store.putFlowHead({
          id: flowId,
          name: i <= 60 ? `Invoice flow ${String(i).padStart(3, "0")}` : `Flow ${String(i).padStart(3, "0")}`,
          summary: i <= 60 ? `Handles invoice batch ${i}` : `Handles task ${i}`,
          headHash: `sha256:${"a".repeat(64)}`,
          createdAt: at,
          updatedAt: at,
          origin: { kind: "import" },
        });
      }
    });

    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      statements = 0;
      const t0 = performance.now();
      const result = (await service.call("search.query", { text: "invoice" })) as SearchResult;
      const elapsed = performance.now() - t0;
      timings.push(elapsed);
      expect(statements).toBeGreaterThanOrEqual(1);
      expect(statements).toBeLessThanOrEqual(2);
      expect(result.chats).toHaveLength(20);
      expect(result.flows.length).toBeLessThanOrEqual(50);
    }

    timings.sort((a, b) => a - b);
    const median = ((timings[9] ?? 0) + (timings[10] ?? 0)) / 2;
    expect(median).toBeLessThan(150);
  } finally {
    service.stop();
    store.close();
  }
});
