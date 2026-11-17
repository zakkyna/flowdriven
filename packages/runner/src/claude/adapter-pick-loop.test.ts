import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS, type ConnectorEntry } from "../connectors/catalog.ts";
import { createGrantBook, pickGrant } from "../connectors/grants.ts";
import { createEngine } from "../engine.ts";
import { routeAll } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { setup as scriptedSetup } from "../test-helpers/engine.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  makeFakeHome,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail = entry;
const host: ConnectorEntry = {
  ref: "connector:prototype-host",
  name: "prototype-host",
  url: "https://prototype.example/mcp",
  prefix: "mcp__prototype-host__",
  label: "Prototype host",
  read: ["list_projects"],
  risky: { prototype_publish: "post" },
};
const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const timeout = { timeout: 20_000 };
const hash = `sha256:${"0".repeat(64)}`;
const now = () => new Date("2026-11-12T00:00:00Z");
const result: FakeAction = { do: "result", result: "ok" };
const invoke = (
  e: ConnectorEntry,
  id: string,
  name: string,
  input: Record<string, unknown> = { id: "d1" },
): FakeAction => ({ do: "tool", id, name: e.prefix + name, input, result: "ok" });
const worker = (id: string, instructions: string, uses: string[] = ["gmail"]) => ({
  id,
  do: "worker",
  instructions,
  uses,
  checks: [{ type: "contains", pattern: "ok" }],
});
function manifest(
  steps: unknown[],
  entry: ConnectorEntry = gmail,
  tools = ["search_threads", "delete_draft"],
) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.proof",
    name: "Proof",
    kind: "build",
    requirements: [{ id: entry === host ? "host" : "gmail", type: "mcp_server", ref: entry.ref, tools }],
    steps,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
async function real(
  steps: unknown[],
  plays: FakePlay[],
  entry: ConnectorEntry = gmail,
  tools = ["search_threads", "delete_draft"],
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  dirs.push(root);
  const fact = {
    name: entry.name,
    url: entry.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: [
      ...entry.read.map((name) => ({ name, readOnly: true })),
      ...Object.keys(entry.risky).map((name) => ({ name, readOnly: false })),
    ],
  };
  const connectors = { [entry.name]: { url: entry.url, id: fact.id, tools: fact.tools } };
  const home = makeFakeHome({ connectors, plays });
  dirs.push(home);
  const store = await openSqliteStore(":memory:", { now });
  stores.push(store);
  let n = 0;
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind, run, detail) => store.appendAudit({ runId: run, kind, detail, at: now().toISOString() }),
    newId: () => `cc-${++n}`,
    newSessionId: () => `session-${++n}`,
    rounds: 20,
    connectors: () => [fact],
    catalog: [entry],
    grants: createGrantBook(store),
  });
  const facts = { hooks: true, chrome: false, connectors: [fact] };
  const engine = createEngine({
    store,
    harness: adapter,
    now,
    newId: (p) => `${p}-${++n}`,
    routeOf: (reqs) => routeAll(reqs, facts, [entry]),
  });
  const m = manifest(steps, entry, tools);
  engine.registerFlow(m, hash);
  return {
    root,
    adapter,
    home,
    store,
    engine,
    m,
    fact,
    facts,
    script: (p: FakePlay[]) => writeFakeScript(home, { connectors, plays: p }),
    start: () => engine.startRun(m.id, { project: root }),
  };
}
function pending(store: Store) {
  const a = store.listApprovals({ state: "pending" }).at(0);
  if (!a) throw new Error("Missing approval");
  return a;
}
const find = {
  id: "find",
  do: "worker",
  instructions: "Find jobs",
  outputs: [
    { id: "jobs", type: "json" },
    { id: "message", type: "text" },
  ],
  checks: [{ type: "contains", pattern: "ok" }],
};
const pick = (grant: string) => ({
  id: "pick",
  do: "ask",
  ask: { question: "Pick", choose_from: "${steps.find.outputs.jobs}", max_pick: 1, approves: [grant] },
});
const loop = (key: boolean, uses: string[]) => ({
  id: "loop",
  for_each: "${steps.pick.outputs.choice}",
  as: "job",
  ...(key ? { key: "${job.id}" } : {}),
  steps: [worker("publish", "Publish picked ${job.id}", uses)],
});
const findPlay: FakePlay = {
  when: "Find jobs",
  actions: [
    {
      do: "result",
      structured: { report: "ok", outputs: { jobs: [{ id: "j1", title: "Job" }], message: "ok" } },
    },
  ],
};

test(
  "R10 on the spec's flow: the pick releases the publish for the picked job in the keyless build loop, and the other job's publish is held",
  timeout,
  async () => {
    const later = {
      ...loop(true, ["host"]),
      id: "other",
      for_each: "${steps.find.outputs.jobs}",
      steps: [worker("other-publish", "Publish other ${job.id}", ["host"])],
    };
    const c = await real(
      [find, pick("host.prototype_publish"), loop(false, ["host"]), later],
      [
        findPlay,
        { when: "Publish picked", actions: [invoke(host, "picked", "prototype_publish"), result] },
        { when: "Publish other", actions: [invoke(host, "other", "prototype_publish"), result] },
      ],
      host,
      ["list_projects", "prototype_publish"],
    );
    const run = await c.start();
    expect((await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] })).state).toBe("waiting_approval");
    expect(pending(c.store)).toMatchObject({ stepId: "other-publish", itemKey: "j1" });
    expect(c.store.listAudit(run.id)).toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ itemKey: "j1", grant: "pick" }),
      }),
    );
  },
);

test("an item with a picked key in another loop is not released", timeout, async () => {
  const other = { ...loop(true, ["gmail"]), for_each: "${steps.find.outputs.jobs}" };
  const c = await real(
    [find, pick("gmail.delete_draft"), other],
    [findPlay, { when: "Publish picked", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
  );
  await c.start();
  expect((await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] })).state).toBe("waiting_approval");
  expect(pending(c.store)).toMatchObject({ itemKey: "j1", kind: "risky_action" });
});

test("a keyless loop over another list keeps positional keys and is never released", timeout, async () => {
  const other = { ...loop(false, ["gmail"]), for_each: "${steps.find.outputs.jobs}" };
  const c = await real(
    [find, pick("gmail.delete_draft"), other],
    [findPlay, { when: "Publish picked", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
  );
  await c.start();
  expect((await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] })).state).toBe("waiting_approval");
  expect(pending(c.store)).toMatchObject({ itemKey: "#0", kind: "risky_action" });
});

test(
  "a step outside any loop over a choice gets no pick tools, and a request without pick tools releases nothing by a pick",
  timeout,
  async () => {
    const c = await real(
      [worker("outside", "Publish picked")],
      [{ when: "Publish picked", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
    );
    const script = await scriptedSetup(c.m, { steps: { outside: { text: "ok" } } });
    stores.push(script.store);
    await script.engine.startRun(c.m.id, { project: c.root });
    const req = script.harness.calls.at(0);
    if (!req) throw new Error("Missing request");
    expect(req).toHaveProperty("pickTools", []);
    c.store.addGrant("direct", pickGrant("gmail", "delete_draft"), "j1");
    const { pickTools: _pickTools, ...withoutPickTools } = req;
    expect(
      await c.adapter.runStep({
        ...withoutPickTools,
        runId: "direct",
        itemKey: "j1",
        routes: routeAll(c.m.requirements, c.facts, [gmail]),
      }),
    ).toHaveProperty("hold");
  },
);
