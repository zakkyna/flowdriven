import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS, type ConnectorEntry } from "../connectors/catalog.ts";
import { routeRequirement } from "../router/route.ts";
import type { Routed } from "../router/types.ts";
import { CONNECTOR_STOP } from "./connector.ts";
import { buildPolicy } from "./policy.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing connector");
const fact = {
  name: entry.name,
  url: entry.url,
  id: `mcpsrv_${"a".repeat(24)}`,
  status: "connected" as const,
  tools: [
    ...entry.read.map((name) => ({ name, readOnly: true })),
    ...Object.keys(entry.risky).map((name) => ({ name, readOnly: false })),
    { name: "create_label", readOnly: false },
  ],
};
const req = (extra: object = {}) =>
  Requirement.parse({
    id: "gmail",
    type: "mcp_server",
    ref: "connector:gmail",
    connect: "native",
    tools: ["search_threads", "delete_draft"],
    ...extra,
  });
const maybeRoute = routeRequirement(req(), { hooks: true, chrome: false, connectors: [fact] });
if (!maybeRoute?.routed) throw new Error("Missing route");
const route = maybeRoute;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const project = join(root, "project");
  const controlRoot = join(root, "control");
  mkdirSync(project);
  mkdirSync(controlRoot);
  return {
    kind: "worker" as const,
    project,
    controlRoot,
    controlCwd: join(controlRoot, "cwd"),
    sessionId: "s1",
    schema: false,
    requirements: [req()],
    routes: [route],
    connectors: [fact],
  };
}
const failure = (id: string) => `This step uses something FlowDriven cannot enforce yet (${id}).`;
test("a routed connector requirement with a connected fact gives policy.connector with requirementId, label, name, url, id, prefix, tools, read, risky and blocked, and no extra built-in tool", () => {
  const p = buildPolicy(setup());
  expect(p.tools).toEqual([]);
  expect(p.connector).toEqual({
    requirementId: "gmail",
    label: entry.label,
    name: entry.name,
    url: entry.url,
    id: fact.id,
    prefix: entry.prefix,
    tools: ["search_threads", "delete_draft"],
    read: ["search_threads"],
    risky: { delete_draft: "delete" },
    blocked: fact.tools.map((t) => t.name).filter((n) => n !== "search_threads" && n !== "delete_draft"),
  });
});
test("blocked holds every scan tool that is not declared and none that is", () => {
  const p = buildPolicy(setup()).connector;
  expect(p?.blocked).toEqual(
    fact.tools.map((t) => t.name).filter((n) => !["search_threads", "delete_draft"].includes(n)),
  );
});
test("tools are deduplicated in declared order and read and risky are split by the entry", () => {
  const o = setup();
  const p = buildPolicy({
    ...o,
    requirements: [req({ tools: ["delete_draft", "search_threads", "delete_draft"] })],
  }).connector;
  expect(p?.tools).toEqual(["delete_draft", "search_threads"]);
  expect(p?.read).toEqual(["search_threads"]);
  expect(p?.risky).toEqual({ delete_draft: "delete" });
});
test("no stored route, a dropped route and a route of another provider each throw the present sentence", () => {
  const o = setup();
  const dropped: Routed = {
    routed: false,
    requirementId: "gmail",
    type: "mcp_server",
    noun: "A connector",
    reason: "no",
  };
  for (const routes of [undefined, [dropped], [{ ...route, provider: "claude-code-files" as const }]])
    expect(() => buildPolicy({ ...o, routes })).toThrow(failure("gmail"));
});
test("a missing fact, and a fact that is needs_login, failed or pending, each throw CONNECTOR_STOP.down('Gmail')", () => {
  const o = setup();
  for (const connectors of [
    [],
    ...(["needs_login", "failed", "pending"] as const).map((status) => [{ ...fact, status }]),
  ])
    expect(() => buildPolicy({ ...o, connectors })).toThrow(CONNECTOR_STOP.down("Gmail"));
});
test("a fact with the right name and another url throws CONNECTOR_STOP.down", () => {
  const o = setup();
  expect(() => buildPolicy({ ...o, connectors: [{ ...fact, url: "https://other.example/" }] })).toThrow(
    CONNECTOR_STOP.down("Gmail"),
  );
});
test("a second mcp_server, a web requirement in the same step, connect gateway and a ref that is not in the catalog each throw the present sentence", () => {
  const o = setup();
  const web = Requirement.parse({
    id: "web",
    type: "web",
    mode: "read",
    session: "own",
    url_patterns: ["https://example.com/"],
  });
  for (const requirements of [
    [req(), req({ id: "other" })],
    [req(), web],
    [web, req()],
    [req({ connect: "gateway" })],
    [req({ ref: "connector:other" })],
  ])
    expect(() => buildPolicy({ ...o, requirements })).toThrow(
      /This step uses something FlowDriven cannot enforce yet/,
    );
});
test("with a path requirement too the folders and tools are as before and the connector is added", () => {
  const o = setup();
  const path = Requirement.parse({ id: "path", type: "path", access: "read" });
  expect(buildPolicy({ ...o, requirements: [path, req()] })).toMatchObject({
    tools: ["Read", "Glob", "Grep"],
    folders: [{ path: o.project, write: false }],
    connector: { requirementId: "gmail" },
  });
});
test("a catalog passed as a parameter is used", () => {
  const o = setup();
  const host: ConnectorEntry = {
    ref: "connector:host",
    name: "host",
    url: "https://example.test/",
    label: "Host",
    prefix: "mcp__host__",
    read: [],
    risky: { publish: "post" },
  };
  const f = { ...fact, name: host.name, url: host.url, tools: [{ name: "publish", readOnly: false }] };
  const r = req({ ref: host.ref, tools: ["publish"] });
  const routed = routeRequirement(r, { hooks: true, chrome: false, connectors: [f] }, [host]);
  if (!routed) throw new Error("Missing host route");
  expect(
    buildPolicy({ ...o, requirements: [r], routes: [routed], connectors: [f], catalog: [host] }).connector,
  ).toMatchObject({ label: "Host", risky: { publish: "post" } });
});
