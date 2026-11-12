import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS, type ConnectorEntry } from "../connectors/catalog.ts";
import { callGrant, createGrantBook, digestCall, grantUsedKey, pickGrant } from "../connectors/grants.ts";
import { createEngine } from "../engine.ts";
import { routeAll } from "../router/route.ts";
import { gate } from "../service/claude-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { setup as scriptedSetup } from "../test-helpers/engine.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  makeFakeHome,
  readFakeCalls,
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

test("R10: a publish for an unpicked job is held", timeout, async () => {
  const c = await real(
    [find, pick("host.prototype_publish"), loop(true, ["host"]), worker("later", "Publish later", ["host"])],
    [
      findPlay,
      { when: "Publish picked", actions: [invoke(host, "picked", "prototype_publish"), result] },
      { when: "Publish later", actions: [invoke(host, "later", "prototype_publish"), result] },
    ],
    host,
    ["list_projects", "prototype_publish"],
  );
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  const after = await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] });
  expect(after.state).toBe("waiting_approval");
  expect(pending(c.store)).toMatchObject({ kind: "risky_action", stepId: "later", itemKey: "" });
  expect(c.store.hasGrant(run.id, pickGrant("host", "prototype_publish"), "")).toBe(false);
  expect(c.store.listAudit(run.id)).toContainEqual(
    expect.objectContaining({
      kind: "grant_used",
      detail: expect.objectContaining({ itemKey: "j1", grant: "pick", tool: "prototype_publish" }),
    }),
  );
});
test("the item key of a picked item in a loop over the choice equals the pick key when the loop declares key: the request of the picked item carries the pick key and the grant exists for it", async () => {
  const m = manifest([find, pick("gmail.delete_draft"), loop(true, ["gmail"])]);
  const c = await scriptedSetup(m, {
    steps: {
      find: { text: "ok", outputs: { jobs: [{ id: "j1", title: "Job" }], message: "ok" } },
      publish: { text: "ok" },
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(m.id, { project: "/tmp" });
  await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] });
  expect(c.harness.calls.find((x) => x.stepId === "publish")?.itemKey).toBe("j1");
  expect(c.store.hasGrant(run.id, pickGrant("gmail", "delete_draft"), "j1")).toBe(true);
});
test(
  "without a key on the loop the item key is #<position>, not the pick key, so no grant matches and the call is held (fail closed, Fact 11)",
  timeout,
  async () => {
    const c = await real(
      [find, pick("gmail.delete_draft"), loop(false, ["gmail"])],
      [findPlay, { when: "Publish picked", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
    );
    const run = await c.start();
    const after = await c.engine.answerAsk(pending(c.store).id, { picks: ["j1"] });
    expect(after.state).toBe("waiting_approval");
    expect(pending(c.store)).toMatchObject({ kind: "risky_action", itemKey: "#0" });
    expect(c.store.hasGrant(run.id, pickGrant("gmail", "delete_draft"), "#0")).toBe(false);
  },
);
test(
  "hold, approve, repeat: the run waits with one approval, approving runs the step again, the prompt holds the approved-call sentence with the full tool name and input, the repeated call runs, grant_used says call, and the run ends done",
  timeout,
  async () => {
    const c = await real(
      [worker("hold", "Hold")],
      [{ when: "Hold", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
    );
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    expect(c.store.listApprovals()).toHaveLength(1);
    expect((await c.engine.decide(pending(c.store).id, "approve")).state).toBe("done");
    const calls = readFakeCalls(c.home);
    const prompts = calls.filter((x) => x.kind === "call");
    expect(prompts).toHaveLength(2);
    expect(prompts.at(1)?.prompt).toContain(
      `The owner approved this call. Make it once, exactly as written:\n${gmail.prefix}delete_draft {"id":"d1"}`,
    );
    expect(calls).toContainEqual(expect.objectContaining({ kind: "tool", id: "delete", ran: true }));
    expect(c.store.listAudit(run.id)).toContainEqual(
      expect.objectContaining({ kind: "grant_used", detail: expect.objectContaining({ grant: "call" }) }),
    );
  },
);
test(
  "reject: the run fails with the step note You rejected this call. and the call never runs",
  timeout,
  async () => {
    const c = await real(
      [worker("hold", "Hold")],
      [{ when: "Hold", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
    );
    const run = await c.start();
    expect((await c.engine.decide(pending(c.store).id, "reject")).state).toBe("failed");
    expect(c.store.getStep(run.id, "hold")?.note).toBe("You rejected this call.");
    expect(readFakeCalls(c.home)).not.toContainEqual(
      expect.objectContaining({ kind: "tool", id: "delete", ran: true }),
    );
  },
);
test(
  "a changed input after the approval is held again: a second approval is created, the first grant stays unused",
  timeout,
  async () => {
    const c = await real(
      [worker("hold", "Hold")],
      [{ when: "Hold", actions: [invoke(gmail, "delete", "delete_draft"), result] }],
    );
    const run = await c.start();
    const first = pending(c.store);
    c.script([{ when: "Hold", actions: [invoke(gmail, "changed", "delete_draft", { id: "d2" }), result] }]);
    expect((await c.engine.decide(first.id, "approve")).state).toBe("waiting_approval");
    expect(c.store.listApprovals()).toHaveLength(2);
    expect(pending(c.store).call?.input).toEqual({ id: "d2" });
    const grant = callGrant("gmail", "delete_draft", digestCall("delete_draft", { id: "d1" }));
    expect(c.store.counter(grantUsedKey(run.id, "", grant), "run")).toBe(0);
  },
);
test(
  "an approved call is used once: a later step of the same run that makes the same call is held",
  timeout,
  async () => {
    const c = await real(
      [worker("first", "First"), worker("later", "Later")],
      [
        { when: "First", actions: [invoke(gmail, "first", "delete_draft"), result] },
        { when: "Later", actions: [invoke(gmail, "later", "delete_draft"), result] },
      ],
    );
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    expect((await c.engine.decide(pending(c.store).id, "approve")).state).toBe("waiting_approval");
    expect(pending(c.store)).toMatchObject({ stepId: "later", kind: "risky_action" });
    expect(readFakeCalls(c.home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "later", ran: false }),
    );
  },
);
test(
  "outside: the step row is marked outside after its first allowed connector call, the next step that takes its output is marked, and a held card of a step that had read carries outside true",
  timeout,
  async () => {
    const source = { ...worker("source", "Read first"), outputs: [{ id: "body", type: "text" }] };
    const next = { ...worker("next", "Read next ${steps.source.outputs.body}") };
    const c = await real(
      [source, next],
      [
        {
          when: "Read first",
          actions: [
            invoke(gmail, "read1", "search_threads"),
            { do: "result", structured: { report: "ok", outputs: { body: "ok" } } },
          ],
        },
        {
          when: "Read next",
          actions: [
            invoke(gmail, "read2", "search_threads"),
            invoke(gmail, "delete", "delete_draft"),
            result,
          ],
        },
      ],
    );
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    expect(c.store.getStep(run.id, "source")?.outside).toBe(true);
    expect(c.store.getStep(run.id, "next")?.outside).toBe(true);
    expect(pending(c.store)).toMatchObject({ kind: "risky_action", outside: true });
  },
);
test("a step that asks for a plain write tool is blocked at the gate or the route, and no child is started", async () => {
  const c = await real([worker("write", "Write")], [{ when: "Write", actions: [result] }], gmail, [
    "create_draft",
  ]);
  const fact = { ...c.fact, tools: [...c.fact.tools, { name: "create_draft", readOnly: false }] };
  const readiness = gate({
    platform: "darwin",
    dataDir: c.root,
    scan: {
      detected: true,
      path: "/bin/claude",
      missingFlags: [],
      configFolder: true,
      login: "logged_in",
      scannedAt: now().toISOString(),
    },
    finished: true,
    fileExists: () => true,
    consent: "given",
    allowed: true,
    facts: { ...c.facts, connectors: [fact] },
    manifest: c.m,
  });
  expect(readiness.ready).toBe(false);
  expect(readiness.reason).toBe("FlowDriven cannot provide one of this connector's tools yet.");
  expect(readFakeCalls(c.home)).toEqual([]);
});
