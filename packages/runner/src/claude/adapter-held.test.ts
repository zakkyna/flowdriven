import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseManifest, Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { CONNECTORS } from "../connectors/catalog.ts";
import { callGrant, createGrantBook, digestCall, pickGrant } from "../connectors/grants.ts";
import { createEngine } from "../engine.ts";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { setup as setupEngine } from "../test-helpers/engine.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { legacyGrant } from "../test-helpers/policy-fixture.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { CONNECTOR_DENY } from "./connector.ts";

const entry = CONNECTORS.at(0);
if (!entry) throw new Error("Missing connector");
const gmail = entry;
const riskyActions = {
  send_message: "send",
  reply: "send",
  forward: "send",
  trash_thread: "delete",
  trash_message: "delete",
  delete_draft: "delete",
  delete_label: "delete",
};
const fact = {
  name: gmail.name,
  url: gmail.url,
  id: `mcpsrv_${"a".repeat(24)}`,
  status: "connected" as const,
  tools: [
    ...["search_threads"].map((name) => ({ name, readOnly: true })),
    ...Object.keys(gmail.risky).map((name) => ({ name, readOnly: false })),
  ],
};
const requirement = Requirement.parse({
  id: "gmail",
  type: "mcp_server",
  ref: "connector:gmail",
  tools: ["search_threads", ...Object.keys(gmail.risky)],
});
const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [fact] });
if (!route?.routed) throw new Error("Missing route");
const routed = route;
const roots: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const tool = (
  id: string,
  name = "delete_draft",
  input: Record<string, unknown> = { id: "d1" },
): FakeAction => ({ do: "tool", id, name: gmail.prefix + name, input });
const done: FakeAction = { do: "result", result: "done" };
async function setup(actions: FakeAction[], withGrants = true, confirmed = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const connectors = { [gmail.name]: { url: fact.url, id: fact.id, tools: fact.tools } };
  const home = makeFakeHome({ connectors, plays: [{ when: "Held test", actions }] });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  const dbPath = join(root, "grants.sqlite");
  const store = await openSqliteStore(dbPath);
  stores.push(store);
  const audits: { kind: string; detail: unknown }[] = [];
  const options = {
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind: string, _run: string, detail: unknown) => audits.push({ kind, detail }),
    newId: () => "cc-1",
    newSessionId: () => "session-1",
    rounds: 20,
    exitWaitMs: 30_000,
    connectors: () => [fact],
    ...(withGrants ? { grants: createGrantBook(store) } : {}),
    ...(confirmed
      ? {
          confirmation: () => ({
            confirmation: {
              flowId: "example.email-triage",
              hash: "hash",
              onItsOwn: [],
              touches: [
                ...["search_threads"].map((name) => ({
                  id: `read-${name.replaceAll("_", "-")}`,
                  sentence: "Read",
                  effect: "read" as const,
                  rule: "runs_alone" as const,
                  covers: [`gmail.${name}`],
                })),
                ...Object.entries(gmail.risky).map(([name, effect]) => ({
                  id: name.replaceAll("_", "-"),
                  sentence: "Action",
                  effect: effect as "send" | "delete",
                  rule: "asks_first" as const,
                  covers: [`gmail.${name}`],
                })),
              ],
            },
            rules: [],
            source: "chat",
            earlierNo: false,
          }),
        }
      : {}),
  };
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "j1",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Held test",
    uses: ["gmail"],
    project,
    requirements: [requirement],
    routes: [routed],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  const script = (next: FakeAction[]) =>
    writeFakeScript(home, { connectors, plays: [{ when: "Held test", actions: next }] });
  return { root, home, dbPath, store, audits, request, script, adapter: createClaudeAdapter(options) };
}
const timeout = { timeout: 20_000 };
const expectedHold = (name = "delete_draft", input = { id: "d1" }, action = "delete") => ({
  requirementId: "gmail",
  tool: name,
  input,
  digest: digestCall(name, input),
  action,
});
test(
  "a risky tool with no grant is refused with the hold sentence, the worker is stopped, and the step result is exit failed with hold carrying requirementId, tool, input, digest and the action",
  timeout,
  async () => {
    const t = await setup([tool("a"), done]);
    const result = await t.adapter.runStep(t.request);
    expect(result).toMatchObject({
      exit: "failed",
      text: CONNECTOR_DENY.held,
      outputs: {},
      hold: expectedHold(),
    });
    expect(result).not.toHaveProperty("block");
    expect(result).not.toHaveProperty("noRetry");
    expect(readFakeCalls(t.home)).toContainEqual(
      expect.objectContaining({ kind: "tool", id: "a", ran: false }),
    );
  },
);
test(
  "the action is send for send_message, reply and forward, and delete for trash_thread, trash_message, delete_draft and delete_label",
  timeout,
  async () => {
    for (const [name, action] of Object.entries(riskyActions)) {
      const t = await setup([tool("a", name), done]);
      expect(await t.adapter.runStep(t.request)).toMatchObject({
        hold: expectedHold(name, { id: "d1" }, action),
      });
    }
  },
);
test(
  "the audit has call_held with the digest and counts the hold, and no later action of the play runs a tool",
  timeout,
  async () => {
    const t = await setup([tool("a"), tool("b", "search_threads"), done]);
    await t.adapter.runStep(t.request);
    expect(t.audits).toContainEqual({
      kind: "call_held",
      detail: {
        stepId: "s",
        itemKey: "j1",
        attempt: 1,
        requirementId: "gmail",
        tool: "delete_draft",
        digest: digestCall("delete_draft", { id: "d1" }),
      },
    });
    expect(t.audits).toContainEqual(
      expect.objectContaining({
        kind: "tool_calls",
        detail: expect.objectContaining({ allowed: 0, held: 1, refused: 0 }),
      }),
    );
    expect(readFakeCalls(t.home)).not.toContainEqual(
      expect.objectContaining({ kind: "tool", id: "b", ran: true }),
    );
  },
);
test(
  "the step ends as soon as the refusal reaches the worker: with exitWaitMs 30,000 and a play that pauses after the held call the result is back well before it",
  timeout,
  async () => {
    const t = await setup([done]);
    t.script([tool("a"), { do: "hold", file: join(t.root, "never-created") }]);
    expect(await t.adapter.runStep(t.request)).toMatchObject({ hold: expectedHold() });
  },
);
test(
  "a pick grant releases only the named tool for the item key of the request: another item key, another tool and another run are held",
  timeout,
  async () => {
    const t = await setup([tool("a"), done]);
    t.store.putCallGrant(legacyGrant("r1", "s", "j1", pickGrant("gmail", "delete_draft")));
    expect(await t.adapter.runStep({ ...t.request, pickTools: ["gmail.delete_draft"] })).toMatchObject({
      exit: "ok",
    });
    expect(
      await t.adapter.runStep({ ...t.request, pickTools: ["gmail.delete_draft"], itemKey: "j2" }),
    ).toMatchObject({ hold: expectedHold() });
    expect(
      await t.adapter.runStep({ ...t.request, pickTools: ["gmail.delete_draft"], runId: "r2" }),
    ).toMatchObject({ hold: expectedHold() });
    t.script([tool("b", "send_message"), done]);
    expect(await t.adapter.runStep({ ...t.request, pickTools: ["gmail.delete_draft"] })).toMatchObject({
      hold: expectedHold("send_message", { id: "d1" }, "send"),
    });
  },
);
test("a pick grant allows any input and the audit has grant_used with grant pick", timeout, async () => {
  const t = await setup([tool("a", "delete_draft", { id: "different" }), done]);
  t.store.putCallGrant(legacyGrant("r1", "s", "j1", pickGrant("gmail", "delete_draft")));
  expect(await t.adapter.runStep({ ...t.request, pickTools: ["gmail.delete_draft"] })).toMatchObject({
    exit: "ok",
  });
  expect(t.audits).toContainEqual({
    kind: "grant_used",
    detail: {
      stepId: "s",
      itemKey: "j1",
      attempt: 1,
      requirementId: "gmail",
      tool: "delete_draft",
      grant: "pick",
    },
  });
});
test(
  "a call grant allows the call with the same tool and input once: grant_used says call, the grant is used once, and a changed input is held again with a different digest",
  timeout,
  async () => {
    const t = await setup([tool("a"), done]);
    const grant = callGrant("gmail", "delete_draft", digestCall("delete_draft", { id: "d1" }));
    t.store.putCallGrant(legacyGrant("r1", "s", "j1", grant));
    expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
    const db = new DatabaseSync(t.dbPath);
    const row = db
      .prepare("SELECT data FROM call_grants WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ?")
      .get("r1", "s", "j1", "gmail.delete_draft");
    const used = row ? (JSON.parse(String(row.data)) as { usedAt?: string }).usedAt : undefined;
    db.close();
    expect(used).toEqual(expect.any(String));
    expect(t.store.findGrant(legacyGrant("r1", "s", "j1", grant))).toBeUndefined();
    expect(() => t.store.useGrant(legacyGrant("r1", "s", "j1", grant), "2026-11-22")).toThrow();
    expect(t.audits).toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ grant: "call", tool: "delete_draft" }),
      }),
    );
    t.script([tool("b", "delete_draft", { id: "d2" }), done]);
    expect(await t.adapter.runStep(t.request)).toMatchObject({
      hold: expectedHold("delete_draft", { id: "d2" }),
    });
  },
);
test(
  "a call grant is used once: the second identical call in the same attempt is held",
  timeout,
  async () => {
    const t = await setup([tool("a"), tool("b"), done]);
    t.store.putCallGrant(
      legacyGrant(
        "r1",
        "s",
        "j1",
        callGrant("gmail", "delete_draft", digestCall("delete_draft", { id: "d1" })),
      ),
    );
    expect(await t.adapter.runStep(t.request)).toMatchObject({ hold: expectedHold() });
    expect(readFakeCalls(t.home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool", id: "a", ran: true }),
        expect.objectContaining({ kind: "tool", id: "b", ran: false }),
      ]),
    );
  },
);
test("a used call grant stays used in a later attempt of the same run, step and item", timeout, async () => {
  const t = await setup([tool("a"), done]);
  t.store.putCallGrant(
    legacyGrant(
      "r1",
      "s",
      "j1",
      callGrant("gmail", "delete_draft", digestCall("delete_draft", { id: "d1" })),
    ),
  );
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
  expect(await t.adapter.runStep({ ...t.request, attempt: 2 })).toMatchObject({ hold: expectedHold() });
});
test("without a grants option every risky tool is held", timeout, async () => {
  for (const [name, action] of Object.entries(riskyActions)) {
    const t = await setup([tool("a", name), done], false);
    expect(await t.adapter.runStep(t.request)).toMatchObject({
      hold: expectedHold(name, { id: "d1" }, action),
    });
  }
});
test(
  "the prompt of a step with approvedCalls holds 'The owner approved this call. Make it once, exactly as written:' with the full tool name and the input JSON, and an approved call for a tool the step does not declare is left out",
  timeout,
  async () => {
    const t = await setup([done]);
    await t.adapter.runStep({
      ...t.request,
      approvedCalls: [
        { tool: "delete_draft", input: { id: "d1" } },
        { tool: "create_draft", input: { secret: "omit" } },
      ],
    });
    const call = readFakeCalls(t.home).find((c) => c.kind === "call");
    expect(call?.kind === "call" && call.prompt).toContain(
      `The owner approved this call. Make it once, exactly as written:\n${gmail.prefix}delete_draft {"id":"d1"}`,
    );
    expect(call?.kind === "call" && call.prompt).not.toContain("create_draft");
  },
);
test(
  "a read tool allowed before a held call keeps its connector_call row, and the result of the attempt is still hold",
  timeout,
  async () => {
    const t = await setup([tool("a", "search_threads"), tool("b"), done]);
    expect(await t.adapter.runStep(t.request)).toMatchObject({ hold: expectedHold(), outside: true });
    expect(t.audits).toContainEqual(
      expect.objectContaining({
        kind: "connector_call",
        detail: expect.objectContaining({ tool: "search_threads", class: "read" }),
      }),
    );
  },
);

test("TC-SR1-26 a held reply carries effect and fixed place through the fake hook", timeout, async () => {
  const t = await setup(
    [
      tool("tu-1", "reply", { threadId: "thread-sam", body: "Thanks, I will send the invoice on Monday." }),
      done,
    ],
    true,
    true,
  );
  const result = await t.adapter.runStep(t.request);
  expect(result).toMatchObject({ hold: { effect: "send", fixedPlace: false } });
  expect(readFakeCalls(t.home)).toContainEqual(
    expect.objectContaining({ kind: "tool", id: "tu-1", hookExit: 2, ran: false }),
  );
  expect(t.audits).toContainEqual(
    expect.objectContaining({
      kind: "call_held",
      detail: expect.objectContaining({ digest: expect.any(String) }),
    }),
  );
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.mail",
    name: "Mail",
    kind: "build",
    requirements: [requirement],
    steps: [
      {
        id: "s",
        do: "worker",
        instructions: "Held test",
        uses: ["gmail"],
        checks: [{ type: "contains", pattern: "ok" }],
      },
    ],
  });
  if (!parsed.ok) throw Error(JSON.stringify(parsed.issues));
  const c = await setupEngine(parsed.manifest, {});
  try {
    const engine = createEngine({
      store: c.store,
      harness: t.adapter,
      now: c.clock.now,
      routeOf: () => [routed],
    });
    const run = await engine.startRun(parsed.manifest.id, { project: t.request.project });
    expect(run.state).toBe("waiting_approval");
    expect(c.store.listApprovals({ runId: run.id })).toEqual([
      expect.objectContaining({ kind: "risky_action", state: "pending", effect: "send", fixedPlace: false }),
    ]);
  } finally {
    c.store.close();
  }
});
