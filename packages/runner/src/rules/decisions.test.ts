import { afterEach, expect, test } from "vitest";
import { digestCall } from "../connectors/grants.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { makeGrant } from "../test-helpers/policy-fixture.ts";
import { matchGrant } from "./decisions.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
test("TC-SR1-08 matches every identity field and only an unused grant", async () => {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const tool = "mcp__claude_ai_Gmail__reply";
  const input = { threadId: "thread-sam", body: "Thanks." };
  const grant = makeGrant({ tool, input }, { runId: "run-1", stepId: "reply" });
  store.putCallGrant(grant);
  expect(matchGrant(store, grant)).toEqual(grant);
  for (const change of [
    { runId: "run-2" },
    { stepId: "other" },
    { itemKey: "item" },
    { tool: "mcp__claude_ai_Gmail__forward" },
    { digest: digestCall(tool, { ...input, body: "Thanks!" }) },
  ])
    expect(matchGrant(store, { ...grant, ...change })).toBeUndefined();
  store.useGrant(grant, "2026-11-22T00:00:00.000Z");
  expect(matchGrant(store, grant)).toBeUndefined();
});
