import { rmSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, writeFakeScript } from "../test-helpers/fake-claude-script.ts";
import {
  CLAUDE_ID,
  createHarnessService,
  harnessFacts,
  storedScan,
  toHarnessCard,
} from "./claude-harness.ts";

const id = `mcpsrv_${"a".repeat(24)}`,
  url = "https://mail.example.test/mcp",
  name = "claude.ai Gmail";
const fact = {
  name,
  url,
  id,
  status: "connected" as const,
  tools: [{ name: "search_threads", readOnly: true }],
};
const scan = {
  detected: true,
  missingFlags: [],
  configFolder: true,
  login: "logged_in" as const,
  scannedAt: "2026-11-12T00:00:00.000Z",
};
const inventory = { skills: [], plugins: [], mcpServers: [] };
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
test("a rescan stores the connectors with the scan, a later scan without MCP keeps them, and a hung call keeps the cached list", {
  timeout: 20_000,
}, async () => {
  const h = makeFakeHome({
    connectors: { [name]: { url, id, tools: [{ name: "search_threads", readOnly: true }] } },
  });
  homes.push(h);
  const store = await openSqliteStore(":memory:");
  const options = {
    store,
    dataDir: h,
    projectDir: h,
    env: { HOME: h, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-12T00:00:00Z"),
    newId: (s: string) => s,
    mcpTimeoutMs: 500,
    connectorSettleMs: 0,
  };
  const service = createHarnessService(options);
  await service.start().settled;
  await service.rescan();
  expect(storedScan(store.getHarnessState(CLAUDE_ID)?.scan)?.inventory.connectors).toEqual([fact]);
  service.stop();
  const next = createHarnessService(options);
  await next.start().settled;
  expect(next.facts().connectors).toEqual([{ name, url, status: "connected", tools: fact.tools }]);
  writeFakeScript(h, { hang: ["status"] });
  await next.rescan();
  expect(storedScan(store.getHarnessState(CLAUDE_ID)?.scan)?.inventory.connectors).toEqual([fact]);
  next.stop();
  store.close();
});
test("the harness card and harnessFacts carry no id: the card JSON has no mcpsrv_, and harnessFacts(scan, connectors) has name, url, status and tools only, and no connectors key without the second argument", () => {
  expect(
    JSON.stringify(toHarnessCard({ scan, inventory: { ...inventory, connectors: [fact] } }, undefined)),
  ).not.toContain("mcpsrv_");
  expect(harnessFacts(scan, [fact])).toEqual({
    hooks: true,
    chrome: false,
    connectors: [{ name, url, status: "connected", tools: fact.tools }],
  });
  expect(harnessFacts(scan)).not.toHaveProperty("connectors");
});
test("storedScan keeps an old scan that has no connectors and drops a malformed connectors list", () => {
  expect(storedScan({ scan, inventory })).toEqual({ scan, inventory });
  for (const connectors of [
    {},
    [null],
    [{ ...fact, tools: [{ name: "x", readOnly: "yes" }] }],
    [{ ...fact, status: "unknown" }],
  ])
    expect(storedScan({ scan, inventory: { ...inventory, connectors } })).toEqual({ scan, inventory });
});
