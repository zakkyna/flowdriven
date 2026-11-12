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
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  makeFakeHome,
  readFakeCalls,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing Gmail");
const gmail: ConnectorEntry = entry;
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
const invoke = (id: string, name: string, input: Record<string, unknown>): FakeAction => ({
  do: "tool",
  id,
  name: gmail.prefix + name,
  input,
  result: "ok",
});
const worker = (id: string, instructions: string) => ({
  id,
  do: "worker",
  instructions,
  uses: ["gmail"],
  checks: [{ type: "contains", pattern: "ok" }],
});
async function real(steps: unknown[], plays: FakePlay[], tools: string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  dirs.push(root);
  const fact = {
    name: gmail.name,
    url: gmail.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: [
      ...gmail.read.map((name) => ({ name, readOnly: true })),
      ...Object.keys(gmail.risky).map((name) => ({ name, readOnly: false })),
    ],
  };
  const connectors = { [gmail.name]: { url: gmail.url, id: fact.id, tools: fact.tools } };
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
    catalog: [gmail],
    grants: createGrantBook(store),
  });
  const facts = { hooks: true, chrome: false, connectors: [fact] };
  const engine = createEngine({
    store,
    harness: adapter,
    now,
    newId: (p) => `${p}-${++n}`,
    routeOf: (reqs) => routeAll(reqs, facts, [gmail]),
  });
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.proof",
    name: "Proof",
    kind: "build",
    requirements: [{ id: "gmail", type: "mcp_server", ref: gmail.ref, tools }],
    steps,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  engine.registerFlow(parsed.manifest, hash);
  return { root, home, store, engine, start: () => engine.startRun("local.proof", { project: root }) };
}
function pending(store: Store) {
  const a = store.listApprovals({ state: "pending" }).at(0);
  if (!a) throw new Error("Missing approval");
  return a;
}

test(
  "R-1: a held send with a long body and a bcc after it cannot be approved: there is no card, and the send never runs",
  timeout,
  async () => {
    const input = { to: "client@example.com", body: "Thanks. ".repeat(500), bcc: "attacker@example.net" };
    const c = await real(
      [worker("send", "Send")],
      [{ when: "Send", actions: [invoke("send", "send_message", input), result] }],
      ["search_threads", "send_message"],
    );
    const run = await c.start();
    expect(run).toMatchObject({
      state: "blocked",
      blockedReason: "This call is too large to show for your approval.",
    });
    expect(c.store.listApprovals()).toEqual([]);
    expect(readFakeCalls(c.home)).not.toContainEqual(
      expect.objectContaining({ kind: "tool", id: "send", ran: true }),
    );
  },
);

// R-2: an ask option key taken from outside data can equal the #<position> key of a keyless loop,
// so a pick of one item releases the risky tool for another, unpicked item.
test(
  "R-2: picking an item whose id is #0 does not release delete_draft for item #0 of a loop with no key: that call is held",
  timeout,
  async () => {
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
    const ask = {
      id: "pick",
      do: "ask",
      ask: {
        question: "Pick",
        choose_from: "${steps.find.outputs.jobs}",
        max_pick: 1,
        approves: ["gmail.delete_draft"],
      },
    };
    const loop = {
      id: "loop",
      for_each: "${steps.find.outputs.jobs}",
      as: "job",
      steps: [worker("clean", "Clean job ${job.id}")],
    };
    const c = await real(
      [find, ask, loop],
      [
        {
          when: "Find jobs",
          actions: [
            {
              do: "result",
              structured: {
                report: "ok",
                outputs: {
                  jobs: [
                    { id: "j-good", title: "A good job" },
                    { id: "#0", title: "Pick me" },
                  ],
                  message: "ok",
                },
              },
            },
          ],
        },
        { when: "Clean job j-good", actions: [invoke("clean-good", "delete_draft", { id: "good" }), result] },
        { when: "Clean job #0", actions: [invoke("clean-evil", "delete_draft", { id: "evil" }), result] },
      ],
      ["search_threads", "delete_draft"],
    );
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    const after = await c.engine.answerAsk(pending(c.store).id, { picks: ["#0"] });
    expect(after.state).toBe("waiting_approval");
    expect(c.store.hasGrant(run.id, pickGrant("gmail", "delete_draft"), "#0")).toBe(false);
    expect(pending(c.store)).toMatchObject({ kind: "risky_action", stepId: "clean", itemKey: "#0" });
    expect(readFakeCalls(c.home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "clean-good", ran: false }),
    );
    expect(c.store.listAudit(run.id)).not.toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ itemKey: "#0", grant: "pick" }),
      }),
    );
  },
);
