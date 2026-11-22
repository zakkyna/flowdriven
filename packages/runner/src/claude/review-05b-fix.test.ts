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
  return {
    root,
    home,
    store,
    engine,
    adapter,
    facts,
    start: () => engine.startRun("local.proof", { project: root }),
  };
}
function pending(store: Store) {
  const a = store.listApprovals({ state: "pending" }).at(0);
  if (!a) throw new Error("Missing approval");
  return a;
}

test(
  "TC-j24-41 R-1: a held send with a long body and a bcc after it cannot be approved: there is no card, and the send never runs",
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
      blockedReason: "FlowDriven could not show the whole text, so it did not ask.",
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

test("TC-j24-04 approving a held reply runs the exact call once on fake Claude", timeout, async () => {
  const input = { threadId: "thread-sam", to: "sam@example.test", subject: "Re: Invoice", body: "Thanks." };
  const c = await real(
    [worker("send", "Send")],
    [{ when: "Send", actions: [invoke("reply", "reply", input), result] }],
    ["reply"],
  );
  const { createRunnerService } = await import("../service/service.ts");
  const service = createRunnerService({
    store: c.store,
    dataDir: c.root,
    mode: "demo",
    harness: c.adapter,
    now,
  });
  try {
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    expect(
      readFakeCalls(c.home).filter((call) => call.kind === "tool" && call.id === "reply" && call.ran),
    ).toHaveLength(0);
    const a = pending(c.store);
    expect(await service.call("approvals.resolve", { approvalId: a.id, decision: "approve" })).toMatchObject({
      decision: { state: "approved" },
      stepWaiting: 0,
    });
    const end = Date.now() + 10000;
    while (Date.now() < end && c.store.getRun(run.id)?.state !== "done")
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(c.store.getRun(run.id)?.state).toBe("done");
    expect(
      readFakeCalls(c.home).filter((call) => call.kind === "tool" && call.id === "reply" && call.ran),
    ).toHaveLength(1);
    expect(c.store.getRun(run.id)?.decisionLines).toContainEqual({
      key: "report.youApproved",
      params: { title: a.summary },
    });
    expect(c.store.listAudit(run.id).map((item) => item.kind)).toEqual(
      expect.arrayContaining(["call_held", "grant_used"]),
    );
  } finally {
    service.stop();
  }
});

test("TC-j24-01 one held reply appears in Activity, chat and a fixed notice", timeout, async () => {
  const input = { to: "Sam Example", subject: "Re: Invoice", body: "Thanks." };
  const c = await real(
    [worker("send", "Send")],
    [{ when: "Send", actions: [invoke("reply", "reply", input), result] }],
    ["reply"],
  );
  const { createRunnerService } = await import("../service/service.ts");
  const { createNotifier, observeStore } = await import("../service/notify-wiring.ts");
  const notices: unknown[] = [];
  const notifier = createNotifier({ store: c.store, now, send: (notice) => notices.push(notice) });
  const store = observeStore(c.store, notifier);
  store.putChat({
    id: "chat-7",
    title: "Chat",
    titleSource: "flowdriven",
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  const runStep = c.adapter.runStep.bind(c.adapter);
  c.adapter.runStep = (request) => {
    store.updateRun(request.runId, { start: { source: "chat", chatId: "chat-7" } });
    return runStep(request);
  };
  let id = 0;
  const engine = createEngine({
    store,
    harness: c.adapter,
    now,
    newId: (prefix) => `test-${prefix}-${++id}`,
    routeOf: (reqs) => routeAll(reqs, c.facts, [gmail]),
  });
  const service = createRunnerService({
    store: c.store,
    dataDir: c.root,
    mode: "demo",
    harness: c.adapter,
    now,
  });
  try {
    const run = await engine.startRun("local.proof", { project: c.root });
    await Promise.resolve();
    expect(run.state).toBe("waiting_approval");
    const a = pending(c.store);
    expect(await service.call("approvals.list", { state: "pending" })).toEqual([
      expect.objectContaining({
        id: a.id,
        kind: "risky_action",
        riskyAction: "send",
        summary: "Send reply to Sam Example?",
        canAlwaysAllow: false,
      }),
    ]);
    expect(await service.call("activity.summary", {})).toMatchObject({
      needsYouCount: 1,
      needsYou: [{ kind: "decision", decision: { id: a.id } }],
    });
    expect(c.store.listMessages("chat-7")).toContainEqual(
      expect.objectContaining({ card: { type: "decision", state: "open", approvalId: a.id } }),
    );
    expect(notices).toEqual([
      expect.objectContaining({
        kind: "approval_waiting",
        title: { key: "notice.decisionTitle" },
        body: { key: "notice.decisionBody" },
      }),
    ]);
    expect(
      readFakeCalls(c.home).filter((call) => call.kind === "tool" && call.id === "reply" && call.ran),
    ).toHaveLength(0);
  } finally {
    service.stop();
    engine.shutdown();
  }
});
