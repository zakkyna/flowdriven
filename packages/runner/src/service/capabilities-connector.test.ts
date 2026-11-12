import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { ALLOW_NOT_ROUTED, ALLOW_NOT_ROUTED_CONNECTOR, createCapabilities } from "./capabilities.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const hash = `sha256:${"1".repeat(64)}`;
const entry = CONNECTORS[0];
if (!entry) throw new Error("Missing connector");
const connector = {
  id: "gmail",
  type: "mcp_server",
  ref: "connector:gmail",
  tools: ["search_threads", "delete_draft"],
};
const web = { id: "web", type: "web", mode: "read", session: "own", url_patterns: ["https://example.com/"] };
const fact = {
  name: entry.name,
  url: entry.url,
  status: "connected",
  tools: [
    { name: "search_threads", readOnly: true },
    { name: "delete_draft", readOnly: false },
  ],
};
async function setup(requirements: unknown[], uses: string[], connected: boolean) {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements,
    steps: [{ id: "worker", do: "worker", instructions: "Read", uses }],
  });
  store.putFlow({ id: manifest.id, version: "1", hash, manifest, files: {}, registeredAt: "2026-11-12" });
  return createCapabilities({
    store,
    now: () => new Date("2026-11-12T00:00:00Z"),
    facts: () => ({ hooks: true, chrome: false, connectors: connected ? [fact] : [] }),
  });
}
test("a routed connector row says provider Gmail connector in Claude Code, enforcedBy, official, away true, the cost line about 2,900 tokens, and no details", async () => {
  const capabilities = await setup([connector], ["gmail"], true);
  expect(capabilities.get("local.test").rows.at(0)).toMatchObject({
    routed: true,
    provider: "Gmail connector in Claude Code",
    enforcedBy: "FlowDriven hook in Claude Code",
    label: "official",
    away: true,
    cost: "Adds about 2,900 tokens for each of its tools to each call of a step that uses it.",
    details: [],
  });
});
test("an unrouted catalog connector that a step uses gives allowBlocked with the connector sentence, and allow is refused with it", async () => {
  const capabilities = await setup([connector], ["gmail"], false);
  expect(ALLOW_NOT_ROUTED_CONNECTOR).toBe(
    "FlowDriven cannot provide the connector this flow uses yet, so there is nothing to allow.",
  );
  expect(capabilities.get("local.test").allowBlocked).toBe(ALLOW_NOT_ROUTED_CONNECTOR);
  expect(() => capabilities.allow("local.test", hash)).toThrow(
    expect.objectContaining({ code: "not_allowed", message: ALLOW_NOT_ROUTED_CONNECTOR }),
  );
});
test("a flow with a web requirement and a connector keeps both rows and the web allowBlocked sentence wins when both are unrouted", async () => {
  const capabilities = await setup([connector, web], ["gmail", "web"], false);
  const preview = capabilities.get("local.test");
  expect(preview.rows.map((row) => [row.requirementId, row.routed])).toEqual([
    ["gmail", false],
    ["web", false],
  ]);
  expect(preview.allowBlocked).toBe(ALLOW_NOT_ROUTED);
});
