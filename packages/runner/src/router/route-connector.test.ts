import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { CONNECTORS, type ConnectorEntry } from "../connectors/catalog.ts";
import { capabilitySentence, DROP, routeAll, routeRequirement } from "./route.ts";

const entry = CONNECTORS[0];
if (!entry) throw new Error("Missing connector");
const fact = {
  name: entry.name,
  url: entry.url,
  status: "connected",
  tools: [
    ...entry.read.map((name) => ({ name, readOnly: true })),
    ...Object.keys(entry.risky).map((name) => ({ name, readOnly: false })),
    { name: "create_label", readOnly: false },
  ],
};
const facts = { hooks: true, chrome: false, connectors: [fact] };
const req = (extra: object = {}) =>
  Requirement.parse({
    id: "gmail",
    type: "mcp_server",
    ref: "connector:gmail",
    tools: ["search_threads", "delete_draft"],
    ...extra,
  });

test("a requirement with ref connector:gmail, connect native or absent, a connected fact with the exact name and url, and hooks, is routed with provider claude-ai-connector, enforcedBy FlowDriven hook in Claude Code, label official, away true", () => {
  for (const extra of [{}, { connect: "native" }])
    expect(routeRequirement(req(extra), facts)).toEqual({
      routed: true,
      requirementId: "gmail",
      type: "mcp_server",
      provider: "claude-ai-connector",
      providerName: "Gmail connector in Claude Code",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "official",
      away: true,
    });
});
test("without hooks the route drops with DROP.noHooks", () => {
  expect(routeRequirement(req(), { ...facts, hooks: false })).toMatchObject({
    routed: false,
    noun: "A connector",
    reason: DROP.noHooks,
  });
});
test("no fact, a fact that is needs_login, failed or pending, and a fact with the right name and another url each drop with DROP.noConnector", () => {
  for (const connectors of [
    [],
    ...["needs_login", "failed", "pending"].map((status) => [{ ...fact, status }]),
    [{ ...fact, url: "https://other.example/" }],
  ])
    expect(routeRequirement(req(), { ...facts, connectors })).toMatchObject({
      routed: false,
      noun: "A connector",
      reason: DROP.noConnector,
    });
});
test("a tool with no class, an unknown tool, a tool the scan does not list, and a read tool whose annotation is not read-only each drop with DROP.connectorTool", () => {
  for (const [tool, tools] of [
    ["create_label", fact.tools],
    ["unknown", fact.tools],
    ["get_thread", fact.tools.filter((t) => t.name !== "get_thread")],
    ["search_threads", fact.tools.map((t) => ({ ...t, readOnly: false }))],
  ] as const)
    expect(
      routeRequirement(req({ tools: [tool] }), { ...facts, connectors: [{ ...fact, tools }] }),
    ).toMatchObject({ routed: false, noun: "A connector", reason: DROP.connectorTool });
});
test("connect gateway, another ref and no ref keep DROP.notYet", () => {
  for (const extra of [{ connect: "gateway" }, { ref: "connector:other" }, { ref: undefined }])
    expect(routeRequirement(req(extra), facts)).toMatchObject({ routed: false, reason: DROP.notYet });
});
test("a catalog passed as a parameter routes its own entry (connector:prototype-host with a risky prototype_publish) and the default catalog does not", () => {
  const host: ConnectorEntry = {
    ref: "connector:prototype-host",
    name: "prototype-host",
    url: "https://example.test/",
    prefix: "mcp__prototype-host__",
    label: "Host",
    read: [],
    risky: { prototype_publish: "post" },
  };
  const requirement = req({ ref: host.ref, tools: ["prototype_publish"] });
  const hostFacts = {
    ...facts,
    connectors: [
      {
        name: host.name,
        url: host.url,
        status: "connected",
        tools: [{ name: "prototype_publish", readOnly: false }],
      },
    ],
  };
  expect(routeRequirement(requirement, hostFacts)).toMatchObject({ routed: false, reason: DROP.notYet });
  expect(routeAll([requirement], hostFacts, [host])).toMatchObject([
    { routed: true, provider: "claude-ai-connector" },
  ]);
});
test("capabilitySentence for Gmail with search_threads and delete_draft is the sentence of this task, lists each tool once through visible, and leaves out the second part when no risky tool is declared", () => {
  expect(
    capabilitySentence(req({ tools: ["search_threads", "delete_draft", "search_threads", "delete_draft"] })),
  ).toBe(
    "Uses your Gmail through the Gmail connector in Claude Code. Reads with: search_threads. Waits for your approval before each: delete_draft.",
  );
  expect(capabilitySentence(req({ tools: ["search_threads"] }))).toBe(
    "Uses your Gmail through the Gmail connector in Claude Code. Reads with: search_threads.",
  );
  const unusual = `read${String.fromCodePoint(10)}x`;
  expect(
    capabilitySentence(req({ ref: "connector:test", tools: [unusual] }), [
      { ...entry, ref: "connector:test", read: [unusual], risky: {} },
    ]),
  ).toContain("Reads with: read<U+000A>x.");
});
