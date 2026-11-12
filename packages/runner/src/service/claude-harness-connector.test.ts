import { rmSync } from "node:fs";
import { FlowManifest, Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { pickGrant } from "../connectors/grants.ts";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { ALLOW_FIRST, CLAUDE_ID, createHarnessService, gate, type HarnessService } from "./claude-harness.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail = entry;
const id = `mcpsrv_${"a".repeat(24)}`;
const tools = [
  ...gmail.read.map((name) => ({ name, readOnly: true })),
  ...Object.keys(gmail.risky).map((name) => ({ name, readOnly: false })),
  { name: "create_draft", readOnly: false },
];
const fact = { name: gmail.name, url: gmail.url, id, status: "connected" as const, tools };
const facts = { hooks: true, chrome: false, connectors: [fact] };
const requirement = (extra: object = {}) => ({
  id: "gmail",
  type: "mcp_server",
  ref: "connector:gmail",
  tools: ["search_threads", "delete_draft"],
  ...extra,
});
const manifest = (req: object = requirement()) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [req],
    steps: [{ id: "s", do: "worker", instructions: "Read", uses: ["gmail"] }],
  });
const base = {
  platform: "darwin",
  dataDir: "/tmp/data",
  scan: {
    detected: true,
    path: "/bin/claude",
    missingFlags: [],
    configFolder: true,
    login: "logged_in" as const,
    scannedAt: "2026-11-12T00:00:00Z",
  },
  finished: true,
  fileExists: () => true,
  consent: "given" as const,
};
const homes: string[] = [];
const stores: Store[] = [];
const services: HarnessService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
test("a used connector:gmail requirement with a connected fact is ready only with the allow, and says Allow what this flow may touch on its screen first. without it", () => {
  expect(gate({ ...base, facts, manifest: manifest() })).toEqual({ ready: false, reason: ALLOW_FIRST });
  expect(gate({ ...base, facts, manifest: manifest(), allowed: true })).toEqual({ ready: true });
});
test("a missing fact, a fact with the right name and another url, and a declared plain write give the router's drop reasons This connector is not connected in Claude Code. and FlowDriven cannot provide one of this connector's tools yet.", () => {
  for (const connectors of [[], [{ ...fact, url: "https://other.example/" }]])
    expect(
      gate({ ...base, facts: { ...facts, connectors }, manifest: manifest(), allowed: true }).reason,
    ).toBe("This connector is not connected in Claude Code.");
  expect(
    gate({ ...base, facts, manifest: manifest(requirement({ tools: ["create_draft"] })), allowed: true })
      .reason,
  ).toBe("FlowDriven cannot provide one of this connector's tools yet.");
});
test("a sensitive connector requirement is blocked when it is not routed or not allowed and passes when routed and allowed", () => {
  const m = manifest(requirement({ sensitive: true }));
  expect(gate({ ...base, facts: { ...facts, connectors: [] }, manifest: m, allowed: true }).ready).toBe(
    false,
  );
  expect(gate({ ...base, facts, manifest: m }).ready).toBe(false);
  expect(gate({ ...base, facts, manifest: m, allowed: true }).ready).toBe(true);
});
test("an mcp_server with no ref or another ref keeps This flow needs something FlowDriven cannot enforce yet", () => {
  for (const ref of [undefined, "connector:other"])
    expect(gate({ ...base, facts, manifest: manifest(requirement({ ref })), allowed: true }).reason).toBe(
      "This flow needs something FlowDriven cannot enforce yet: gmail.",
    );
});
async function setup() {
  const home = makeFakeHome({
    connectors: { [gmail.name]: { url: gmail.url, id, tools } },
    plays: [
      {
        when: "Read",
        actions: [
          { do: "tool", id: "read", name: `${gmail.prefix}search_threads`, input: { query: "test" } },
          { do: "tool", id: "delete", name: `${gmail.prefix}delete_draft`, input: { id: "d1" } },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  homes.push(home);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const now = () => new Date("2026-11-12T00:00:00Z");
  let n = 0;
  const hs = createHarnessService({
    store,
    dataDir: home,
    projectDir: home,
    env: { HOME: home, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: (p) => `${p}-${++n}`,
    mcpTimeoutMs: 500,
    connectorSettleMs: 0,
    adapter: { rounds: 20 },
  });
  services.push(hs);
  await hs.start().settled;
  await hs.rescan();
  hs.setConsent(CLAUDE_ID, "given");
  const m = manifest();
  const hash = `sha256:${"a".repeat(64)}`;
  store.createRun({
    id: "r1",
    flowId: m.id,
    flowHash: hash,
    flowVersion: m.version,
    state: "running",
    project: home,
    inputs: {},
    params: {},
    requirements: m.requirements,
    startedAt: now().toISOString(),
  });
  const req = Requirement.parse(requirement());
  const route = routeRequirement(req, facts);
  if (!route?.routed) throw new Error("Missing route");
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "j1",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "Read",
    instructions: "Read",
    uses: ["gmail"],
    project: home,
    requirements: [req],
    routes: [route],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return { home, store, hs, m, hash, request, now };
}
test("admit asks for the allow of the run's flow hash for a connector step, refuses a stale hash with Allow what this flow may touch on its screen first., and leaves a step with only a path requirement alone", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({ block: ALLOW_FIRST });
  t.store.putCapabilityConsent({
    flowId: t.m.id,
    hash: `sha256:${"b".repeat(64)}`,
    at: t.now().toISOString(),
  });
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({ block: ALLOW_FIRST });
  const path = Requirement.parse({ id: "path", type: "path", ref: "." });
  expect(
    await t.hs.adapter.runStep({ ...t.request, requirements: [path], uses: ["path"], routes: [] }),
  ).not.toHaveProperty("block", ALLOW_FIRST);
  t.store.putCapabilityConsent({ flowId: t.m.id, hash: t.hash, at: t.now().toISOString() });
  expect(await t.hs.adapter.runStep(t.request)).not.toHaveProperty("block", ALLOW_FIRST);
});
test("after a rescan on the fake the harness service gives the adapter the scan's connectors and a grant book over its store: a connector step reads, and a pick grant added to the store releases the risky tool for that item", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  t.store.putCapabilityConsent({ flowId: t.m.id, hash: t.hash, at: t.now().toISOString() });
  t.store.addGrant("r1", pickGrant("gmail", "delete_draft"), "j1");
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({ exit: "ok", outside: true });
  expect(readFakeCalls(t.home)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "tool", id: "read", ran: true }),
      expect.objectContaining({ kind: "tool", id: "delete", ran: true }),
    ]),
  );
});
