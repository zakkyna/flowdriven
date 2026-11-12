import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { routeAll, routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  FAKE_HELP,
  type FakeScript,
  makeFakeHome,
  readFakeCalls,
} from "../test-helpers/fake-claude-script.ts";
import { ALLOW_FIRST, CLAUDE_ID, createHarnessService, type HarnessService } from "./claude-harness.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const roots: string[] = [];
const stores: Store[] = [];
const services: (HarnessService | RunnerService)[] = [];
const now = () => new Date("2026-11-12T00:00:00Z");
const dayOf = () => "injected-day";
const otherHash = `sha256:${"1".repeat(64)}`;
const web = {
  id: "web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: ["https://example.com/"],
  rate: { per_run: 3, per_day: 10 },
};
const flow = () =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps: [
      {
        id: "s",
        do: "worker",
        instructions: "Read",
        uses: ["web"],
        checks: [{ type: "contains", pattern: "done" }],
      },
    ],
    requirements: [web, { id: "extra", type: "mcp_server", tools: ["read"] }],
  });
const context = {
  do: "tool",
  id: "context",
  name: "mcp__claude-in-chrome__tabs_context_mcp",
  input: { createIfEmpty: true },
} as const;
const navigate = {
  do: "tool",
  id: "navigate",
  name: "mcp__claude-in-chrome__navigate",
  input: { tabId: 1001, url: "https://example.com/" },
} as const;
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function setup(script: FakeScript = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  const home = makeFakeHome({
    chrome: true,
    plays: [{ when: "", actions: [context, { do: "result", result: "done" }] }],
    ...script,
  });
  roots.push(home);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let n = 0;
  const common = {
    store,
    dataDir: dir,
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: (prefix: string) => `${prefix}-${++n}`,
  };
  const hs = createHarnessService({ ...common, projectDir: dir, dayOf });
  services.push(hs);
  await hs.start().settled;
  hs.setConsent(CLAUDE_ID, "given");
  const m = flow();
  const addRun = (id: string, hash = DEMO_HASH) =>
    store.createRun({
      id,
      flowId: m.id,
      flowHash: hash,
      flowVersion: m.version,
      state: "running",
      project: dir,
      inputs: {},
      params: {},
      requirements: m.requirements,
      startedAt: now().toISOString(),
    });
  const req = m.requirements.find((r) => r.id === "web");
  if (!req) throw Error("Missing requirement");
  const route = routeRequirement(req, { hooks: true, chrome: true });
  if (!route) throw Error("Missing route");
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "Read",
    instructions: "Read",
    uses: ["web"],
    project: dir,
    requirements: [req],
    routes: [route],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return { dir, home, store, hs, m, addRun, request, common };
}
const allow = (store: Store, hash = DEMO_HASH) =>
  store.putCapabilityConsent({ flowId: "local.test", hash, at: now().toISOString() });

test("a flow with a web requirement is blocked before the allow row exists, runs after the allow, and is blocked again at the next attempt after withdrawal", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  const service = createRunnerService({ ...t.common, mode: "live", triggers: { dayOf } });
  services.push(service);
  await service.start().settled;
  service.engine.registerFlow(t.m, DEMO_HASH, {});
  const blocked = await service.engine.startRun(t.m.id, { project: t.dir });
  expect(blocked).toMatchObject({ state: "blocked", blockedReason: ALLOW_FIRST });
  allow(t.store);
  expect(await service.engine.resumeRun(blocked.id)).toMatchObject({ state: "done" });
  t.store.deleteCapabilityConsent(t.m.id);
  t.addRun("r1");
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({
    exit: "failed",
    block: ALLOW_FIRST,
    text: ALLOW_FIRST,
    outputs: {},
  });
  allow(t.store);
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
  expect(readFakeCalls(t.home)).toContainEqual(
    expect.objectContaining({ kind: "tool", name: context.name, ran: true }),
  );
  t.store.deleteCapabilityConsent(t.m.id);
  expect(await t.hs.adapter.runStep({ ...t.request, attempt: 2 })).toMatchObject({
    exit: "failed",
    block: ALLOW_FIRST,
  });
});
test("a changed hash makes the stored allow stale and leaves the old run row unaffected", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  t.addRun("r1");
  t.addRun("r2", otherHash);
  allow(t.store);
  const old = t.store.getRun("r1");
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: otherHash })).toEqual({
    ready: false,
    reason: ALLOW_FIRST,
  });
  expect(await t.hs.adapter.runStep({ ...t.request, runId: "r2" })).toMatchObject({ block: ALLOW_FIRST });
  expect(t.store.getRun("r1")).toEqual(old);
  expect(await t.hs.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
});
test("a run stores routes from facts at its start including a dropped requirement", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  const service = createRunnerService({ ...t.common, mode: "live", triggers: { dayOf } });
  services.push(service);
  await service.start().settled;
  service.engine.registerFlow(t.m, DEMO_HASH, {});
  const run = await service.engine.startRun(t.m.id, { project: t.dir });
  expect(service.engine.getRun(run.id).run.routes).toEqual(
    routeAll(t.m.requirements, { hooks: true, chrome: true }),
  );
  expect(service.engine.getRun(run.id).run.routes).toContainEqual(
    expect.objectContaining({ requirementId: "extra", routed: false }),
  );
});
test("facts drop web without Chrome or without hooks", { timeout: 20_000 }, async () => {
  for (const [script, facts, sentence] of [
    [{ chrome: false }, { hooks: true, chrome: false }, "This Claude Code cannot use Chrome."],
    [
      { help: FAKE_HELP.replace("--settings\n", "") },
      { hooks: false, chrome: false },
      "This needs a harness that can check each call.",
    ],
  ] as const) {
    const t = await setup(script);
    expect(t.hs.facts()).toEqual(facts);
    expect(routeAll(t.m.requirements, t.hs.facts())).toContainEqual(
      expect.objectContaining({ requirementId: "web", routed: false, reason: sentence }),
    );
  }
});
test("readiness without a context never counts as allowed", { timeout: 20_000 }, async () => {
  const t = await setup();
  allow(t.store);
  expect(t.hs.readiness(t.m)).toEqual({ ready: false, reason: ALLOW_FIRST });
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: DEMO_HASH })).toEqual({ ready: true });
});
test("page counters live in the store for the run and injected day", { timeout: 20_000 }, async () => {
  const t = await setup({
    pages: { "https://example.com/": { title: "Example", text: "Page" } },
    plays: [
      {
        when: "",
        actions: [
          context,
          navigate,
          { do: "tool", id: "read", name: "mcp__claude-in-chrome__get_page_text", input: { tabId: 1001 } },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const service = createRunnerService({ ...t.common, mode: "live", triggers: { dayOf } });
  services.push(service);
  await service.start().settled;
  service.engine.registerFlow(t.m, DEMO_HASH, {});
  allow(t.store);
  const run = await service.engine.startRun(t.m.id, { project: t.dir });
  expect(run.state).toBe("done");
  expect(t.store.counter(`pages-run:${run.id}:web`, "run")).toBe(1);
  expect(t.store.counter("pages:local.test:web", "injected-day")).toBe(1);
});
