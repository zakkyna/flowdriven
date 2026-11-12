import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { BROWSER_DENY, CHROME_PREFIX } from "./browser.ts";
import { POST_TEXT, STOP } from "./browser-post.ts";
import * as childModule from "./child.ts";
import { createPageCounter } from "./pages.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const address = "https://www.upwork.com/jobs/~01abcdefghijklmnopqrs";
const web = Requirement.parse({
  id: "jobs_web",
  type: "web",
  mode: "read",
  session: "own",
  url_patterns: ["https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}"],
  rate: { per_run: 3, per_day: 10 },
});
const tool = (id: string, name: string, input: Record<string, unknown> = {}): FakeAction => ({
  do: "tool",
  id,
  name: `${CHROME_PREFIX}${name}`,
  input,
});
const context = () => tool("context", "tabs_context_mcp", { createIfEmpty: true });
const navigate = (id: string, tabId = 1001) => tool(id, "navigate", { tabId, url: address });
async function setup(
  actions: FakeAction[] = [{ do: "result" }],
  page = { title: "Job", text: "Text", final: address },
  closeWaitMs = 300,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({
    chrome: true,
    pages: { [address]: page },
    plays: [{ when: "", actions }],
  });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const addRun = (id: string) =>
    store.createRun({
      id,
      flowId: "flow",
      flowHash: "hash",
      flowVersion: "1",
      state: "running",
      project,
      inputs: {},
      params: {},
      requirements: [web],
      startedAt: "2026-11-12T00:00:00Z",
    });
  addRun("r1");
  addRun("r2");
  let day = "2026-11-12";
  const pages = createPageCounter({
    store,
    dayOf: () => day,
    now: () => new Date("2026-11-12T00:00:00Z"),
  });
  const route = routeRequirement(web, { hooks: true, chrome: true });
  if (!route) throw Error("missing route");
  let n = 0;
  const audits: { kind: string; detail: unknown }[] = [];
  const options = {
    pages,
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind: string, _run: string, detail: unknown) => audits.push({ kind, detail }),
    newId: () => `cc-${++n}`,
    newSessionId: () => "session-1",
    rounds: 20,
    closeWaitMs,
    exitWaitMs: 5000,
  };
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Read",
    uses: ["jobs_web"],
    project,
    requirements: [web],
    routes: [route],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return {
    home,
    request,
    options,
    audits,
    pages,
    setDay: (value: string) => {
      day = value;
    },
    adapter: createClaudeAdapter(options),
  };
}
const result: FakeAction = { do: "result", result: "done" };
const read = (id = "read"): FakeAction => tool(id, "get_page_text", { tabId: 1001 });
function capture() {
  const original = childModule.startChild;
  const chunks: string[] = [];
  vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
    const child = original(...args);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    return child;
  });
  return () => chunks.join("");
}
function received(stream: string, id: string): unknown {
  for (const line of stream.split("\n")) {
    try {
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || !("message" in event)) continue;
      const message = event.message;
      if (
        !message ||
        typeof message !== "object" ||
        !("content" in message) ||
        !Array.isArray(message.content)
      )
        continue;
      for (const block of message.content as unknown[]) {
        if (
          block &&
          typeof block === "object" &&
          "tool_use_id" in block &&
          block.tool_use_id === id &&
          "content" in block
        )
          return block.content;
      }
    } catch {}
  }
  return undefined;
}
const textBlock = (text: string) => [{ type: "text", text }];
const calls = (home: string) => readFakeCalls(home).filter((c) => c.kind === "tool");
const denied = (audits: { kind: string; detail: unknown }[]) =>
  audits.filter((a) => a.kind === "tool_denied");

const moved = { title: "Job", text: "private page", final: "https://evil.example/" };
const challenge = { title: "Just a moment...", text: "private challenge", final: address };
const close = (tabId = 1001) => tool(`close-${tabId}`, "tabs_close_mcp", { tabId });
const after = () => navigate("after");
const closingActions = (...extra: FakeAction[]): FakeAction[] => [
  context(),
  navigate("nav"),
  read(),
  ...extra,
];
const wait: FakeAction = { do: "hold", file: "/nonexistent-flowdriven-closing-test" };

test("after a moved page the worker receives the withheld sentence plus Close tab 1001 now, then stop., and the audit sentence is the plain one", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(closingActions(close(), after(), result), moved);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved });
  expect(received(output(), "read")).toEqual(textBlock(`${POST_TEXT.moved} Close tab 1001 now, then stop.`));
  expect(t.audits.filter((a) => a.kind === "page_withheld")).toEqual([
    expect.objectContaining({ detail: expect.objectContaining({ sentence: POST_TEXT.moved }) }),
  ]);
});

test("after a challenge the worker receives the same close sentence and the page text never reaches it", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(closingActions(close(), after(), result), challenge);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ block: STOP.challenge });
  expect(received(output(), "read")).toEqual(
    textBlock(`${POST_TEXT.challenge} Close tab 1001 now, then stop.`),
  );
  expect(output()).not.toContain(challenge.text);
});

test("a close of the withheld tab is allowed by the present rules, and the child is stopped as soon as its result was answered: the action after it (id after) never runs", {
  timeout: 20_000,
}, async () => {
  const t = await setup(closingActions(close(), after(), result), moved);
  await t.adapter.runStep(t.request);
  expect(calls(t.home)).toContainEqual(expect.objectContaining({ id: "close-1001", ran: true }));
  expect(calls(t.home)).not.toContainEqual(expect.objectContaining({ id: "after" }));
});

test("while closing, a navigate, a second get_page_text, a tabs_create_mcp and a file tool are each refused with This step is stopping. It may only close its tab.", {
  timeout: 20_000,
}, async () => {
  const t = await setup(
    closingActions(
      after(),
      read("read-again"),
      tool("create", "tabs_create_mcp"),
      { do: "tool", id: "file", name: "Read", input: { file_path: "/tmp/file" } },
      close(),
      result,
    ),
    moved,
    5000,
  );
  await t.adapter.runStep(t.request);
  const rows = denied(t.audits);
  expect(rows).toHaveLength(4);
  for (const name of [
    `${CHROME_PREFIX}navigate`,
    `${CHROME_PREFIX}get_page_text`,
    `${CHROME_PREFIX}tabs_create_mcp`,
    "Read",
  ])
    expect(rows).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          tool: name,
          reason: "This step is stopping. It may only close its tab.",
        }),
      }),
    );
});

test("a close of a tab this attempt never saw is refused with This tab is not one this step opened. and does not end the closing time", {
  timeout: 20_000,
}, async () => {
  const t = await setup(closingActions(close(9999), close(), after(), result), moved, 5000);
  await t.adapter.runStep(t.request);
  expect(denied(t.audits)).toContainEqual(
    expect.objectContaining({ detail: expect.objectContaining({ reason: BROWSER_DENY.tab }) }),
  );
  expect(calls(t.home)).toContainEqual(expect.objectContaining({ id: "close-9999", ran: false }));
  expect(calls(t.home)).toContainEqual(expect.objectContaining({ id: "close-1001", ran: true }));
});

test("a worker that never closes: the child is killed closeWaitMs after the stop began and the outcome is the stop outcome", {
  timeout: 20_000,
}, async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const t = await setup(closingActions(wait), moved);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved });
  expect(timers.mock.calls.some((args) => args[1] === 300)).toBe(true);
});

test("a child that exits before the close gives the stop outcome with no timer left running", {
  timeout: 20_000,
}, async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const cleared = vi.spyOn(globalThis, "clearTimeout");
  const t = await setup(closingActions({ do: "exit", code: 0 }), moved);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved });
  const index = timers.mock.calls.findIndex((args) => args[1] === 300);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(cleared).toHaveBeenCalledWith(timers.mock.results.at(index)?.value);
});

test("the outcome, its sentence and the audit rows are as before: noRetry The page moved to an address this step does not declare. with one page_withheld row, and block with the challenge sentence", {
  timeout: 20_000,
}, async () => {
  const t = await setup(closingActions(close(), result), moved);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved, text: STOP.moved });
  expect(t.audits.filter((a) => a.kind === "page_withheld")).toEqual([
    expect.objectContaining({ detail: expect.objectContaining({ why: "moved", sentence: POST_TEXT.moved }) }),
  ]);
  const c = await setup(closingActions(close(), result), challenge);
  expect(await c.adapter.runStep(c.request)).toMatchObject({ block: STOP.challenge, text: STOP.challenge });
  expect(c.audits.filter((a) => a.kind === "page_withheld")).toEqual([
    expect.objectContaining({
      detail: expect.objectContaining({ why: "challenge", sentence: POST_TEXT.challenge }),
    }),
  ]);
});

test("the tripwire accepts the extended withheld text as the runner's answer", {
  timeout: 20_000,
}, async () => {
  const t = await setup(closingActions(close(), result), moved);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved });
  expect(t.audits.filter((a) => a.kind === "tool_unchecked")).toHaveLength(0);
});

test("a tripwire stop does not wait for the closing time", { timeout: 20_000 }, async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const t = await setup([
    context(),
    navigate("nav"),
    { do: "ungated", id: "unsafe", name: `${CHROME_PREFIX}get_page_text`, input: { tabId: 1001 } },
    wait,
  ]);
  const outcome = await t.adapter.runStep(t.request);
  expect(outcome.block).toBeDefined();
  expect(t.audits).toContainEqual(expect.objectContaining({ kind: "tool_unchecked" }));
  expect(timers.mock.calls.some((args) => args[1] === 300)).toBe(false);
});
