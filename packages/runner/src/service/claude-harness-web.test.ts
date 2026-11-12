import { FlowManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import type { Routed } from "../router/types.ts";
import { gate, gateRoutes, harnessFacts } from "./claude-harness.ts";

const scan = {
  detected: true,
  path: "/bin/claude",
  version: "2.1.318",
  missingFlags: [],
  configFolder: true,
  login: "logged_in" as const,
  scannedAt: "2026-11-11T00:00:00.000Z",
  chrome: true,
};
const facts = { hooks: true, chrome: true };
const worker = (uses: string[]) => ({ id: "worker", do: "worker", instructions: "Read", uses });
const web = (extra: object = {}) => ({
  id: "web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: ["https://example.com/"],
  ...extra,
});
const manifest = (
  steps: unknown[] = [worker(["web"])],
  requirements: unknown[] = [web()],
  triggers: unknown[] = [],
) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    steps,
    requirements,
    triggers,
  });
const base = {
  platform: "darwin",
  dataDir: "/tmp/data",
  scan,
  finished: true,
  fileExists: () => true,
  consent: "given" as const,
};
const ask = { id: "ask", do: "ask", ask: { question: "Choose", choose_from: "items" } };

test("a routed web requirement without the allow blocks, and with the allow the gate is ready", () => {
  expect(gate({ ...base, manifest: manifest(), facts })).toEqual({
    ready: false,
    reason: "Allow what this flow may touch on its screen first.",
  });
  expect(gate({ ...base, manifest: manifest(), facts, allowed: true })).toEqual({ ready: true });
});
test("R11: without hooks or Chrome the drop comes before the allow sentence", () => {
  for (const [f, reason] of [
    [{ hooks: false, chrome: false }, "This needs a harness that can check each call."],
    [{ hooks: true, chrome: false }, "This Claude Code cannot use Chrome."],
  ] as const)
    expect(gate({ ...base, manifest: manifest(), facts: f })).toEqual({ ready: false, reason });
});
test("a sensitive web passes when routed and allowed; a sensitive path remains blocked", () => {
  expect(
    gate({
      ...base,
      facts,
      allowed: true,
      manifest: manifest([worker(["web"])], [web({ sensitive: true })]),
    }),
  ).toEqual({ ready: true });
  expect(
    gate({
      ...base,
      facts,
      allowed: true,
      manifest: manifest(
        [worker(["web", "path"])],
        [web({ sensitive: true }), { id: "path", type: "path", ref: "notes", sensitive: true }],
      ),
    }),
  ).toEqual({
    ready: false,
    reason:
      "This flow marks path as sensitive, and Claude Code runs without an OS sandbox. Allowing that arrives with a later version.",
  });
});
test("a web requirement used by an agent or declared but unused does not ask for an allow", () => {
  for (const steps of [[{ id: "agent", do: "agent", instructions: "Read", uses: ["web"] }], [worker([])]])
    expect(gate({ ...base, manifest: manifest(steps), facts })).toEqual({ ready: true });
});
test("mcp_server, skill and cli_tool requirements keep cannot enforce and come before a web drop", () => {
  const requirements = [
    web(),
    { id: "mcp", type: "mcp_server", tools: ["read"] },
    { id: "skill", type: "skill" },
    { id: "cli", type: "cli_tool" },
  ];
  expect(
    gate({ ...base, manifest: manifest([worker(["web", "mcp", "skill", "cli"])], requirements) }),
  ).toEqual({
    ready: false,
    reason: "This flow needs something FlowDriven cannot enforce yet: cli, mcp, skill.",
  });
});
test("gateRoutes reports an unenforced provider before the first ask for a scheduled flow", () => {
  const route: Routed = {
    routed: true,
    requirementId: "web",
    type: "web",
    provider: "claude-in-chrome",
    providerName: "Test",
    enforcedBy: "not enforced",
    label: "unofficial",
    away: false,
  };
  const fake = () => [route];
  const scheduled = [{ kind: "schedule", every: "1h" }];
  expect(gateRoutes(manifest([worker(["web"]), ask], [web()], scheduled), facts, fake)).toBe(
    "This step would run unattended on a provider FlowDriven cannot enforce.",
  );
  expect(gateRoutes(manifest([ask, worker(["web"])], [web()], scheduled), facts, fake)).toBeUndefined();
  expect(gateRoutes(manifest([worker(["web"])], [web()], [{ kind: "manual" }]), facts, fake)).toBeUndefined();
  expect(gateRoutes(manifest([worker(["web"])], [web()], scheduled), facts)).toBeUndefined();
});
test("harnessFacts requires detection and all flags and treats absent chrome as false", () => {
  expect(harnessFacts(scan)).toEqual(facts);
  const { chrome: _chrome, ...oldScan } = scan;
  expect(harnessFacts(oldScan)).toEqual({ hooks: true, chrome: false });
  expect(harnessFacts(undefined)).toEqual({ hooks: false, chrome: false });
  expect(harnessFacts({ ...scan, detected: false })).toEqual({ hooks: false, chrome: false });
  expect(harnessFacts({ ...scan, missingFlags: ["--restricted"] })).toEqual({ hooks: false, chrome: false });
});
test("the present gate base input remains ready without facts and allow", () => {
  expect(
    gate({
      ...base,
      manifest: manifest(
        [worker(["notes"])],
        [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
      ),
    }),
  ).toEqual({ ready: true });
});
