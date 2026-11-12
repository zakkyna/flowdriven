import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { HarnessCallError, type StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { BROWSER_DENY, CHROME_PREFIX } from "./browser.ts";
import { STOP } from "./browser-post.ts";
import { createPageCounter } from "./pages.ts";
import * as runModule from "./run.ts";
import { LIMITS_NOT_APPLIED } from "./stream.ts";

const roots: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const address = "https://www.upwork.com/jobs/~abcdefghijklmnopqr";
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
async function setup(actions: FakeAction[] = [{ do: "result" }]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({
    chrome: true,
    pages: { [address]: { title: "Job", text: "Text" } },
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
  const pages = createPageCounter({
    store,
    dayOf: () => "2026-11-12",
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
  const script = (next: FakeAction[], init?: Record<string, unknown>) =>
    writeFakeScript(home, {
      chrome: true,
      pages: { [address]: { title: "Job", text: "Text" } },
      plays: [{ when: "", actions: next, ...(init ? { init } : {}) }],
    });
  return { home, store, pages, request, options, audits, script, adapter: createClaudeAdapter(options) };
}
const result: FakeAction = { do: "result", result: "done" };
const toolCalls = (home: string) => readFakeCalls(home).filter((c) => c.kind === "tool");

test("the call has --chrome and the control settings have the PostToolUse entry, and a step without a web requirement has --no-chrome and no PostToolUse entry", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  let settings = "";
  await t.adapter.runStep({
    ...t.request,
    onStart: () => {
      settings = readFileSync(join(t.options.controlRoot, "cc-1", "settings.json"), "utf8");
    },
  });
  expect(settings).toContain("PostToolUse");
  expect(readFakeCalls(t.home).find((c) => c.kind === "call")).toMatchObject({
    args: expect.arrayContaining(["--chrome"]),
  });
  await t.adapter.runStep({
    ...t.request,
    requirements: [],
    onStart: () => {
      settings = readFileSync(join(t.options.controlRoot, "cc-2", "settings.json"), "utf8");
    },
  });
  expect(settings).not.toContain("PostToolUse");
  const calls = readFakeCalls(t.home).filter((c) => c.kind === "call");
  expect(calls.at(1)).toMatchObject({ args: expect.arrayContaining(["--no-chrome"]) });
});
test("an empty run budget stops the attempt before any harness call: no child is started and the result has noRetry with `This step reached its page limit for this run.`", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  for (let i = 0; i < 3; i++) t.pages.take("r1", "jobs_web");
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: BROWSER_DENY.runLimit });
  expect(readFakeCalls(t.home)).toEqual([]);
});
test("an empty day budget stops the same way with `This flow reached its page limit for today.`", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  t.store.increment("pages:flow:jobs_web", "2026-11-12", 10);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: BROWSER_DENY.dayLimit });
  expect(readFakeCalls(t.home)).toEqual([]);
});
test("R1: navigate for a tab id the session never saw is refused; after tabs_context_mcp taught the id it is allowed; a close of a tab id from another session is refused by FlowDriven before the extension sees it", {
  timeout: 20_000,
}, async () => {
  const t = await setup([
    navigate("before"),
    context(),
    navigate("after"),
    tool("close", "tabs_close_mcp", { tabId: 999 }),
    result,
  ]);
  await t.adapter.runStep(t.request);
  expect(toolCalls(t.home)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "before", ran: false }),
      expect.objectContaining({ id: "after", ran: true }),
      expect.objectContaining({ id: "close", ran: false }),
    ]),
  );
  expect(t.audits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "tool_denied",
        detail: expect.objectContaining({ reason: BROWSER_DENY.tab }),
      }),
    ]),
  );
});
test("two navigate calls in one turn cannot both take the last page: with one page left the first is allowed, the second is denied with the run-limit sentence, and the counter reads the limit", {
  timeout: 20_000,
}, async () => {
  const t = await setup([context(), navigate("first"), navigate("second"), result]);
  t.pages.take("r1", "jobs_web");
  t.pages.take("r1", "jobs_web");
  await t.adapter.runStep(t.request);
  expect(toolCalls(t.home)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "first", ran: true }),
      expect.objectContaining({ id: "second", ran: false }),
    ]),
  );
  expect(t.pages.count("r1", "jobs_web").run).toBe(3);
  const call = readFakeCalls(t.home).find((entry) => entry.kind === "call");
  expect(call).toMatchObject({
    prompt: expect.stringContaining("You can read at most 1 more page in this step."),
  });
  expect(call).toMatchObject({ prompt: expect.stringContaining("https://www.upwork.com/jobs/~{id}") });
  expect(t.audits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ detail: expect.objectContaining({ reason: BROWSER_DENY.runLimit }) }),
    ]),
  );
});
test("pages count across attempts and runs: a second attempt of the same run starts with the pages the first one took, and a second run on the same local day starts with the day count", {
  timeout: 20_000,
}, async () => {
  const t = await setup([context(), navigate("first"), result]);
  await t.adapter.runStep(t.request);
  expect(t.pages.count("r1", "jobs_web")).toEqual({ run: 1, day: 1 });
  t.script([context(), navigate("second"), result]);
  await t.adapter.runStep({ ...t.request, attempt: 2 });
  expect(t.pages.count("r1", "jobs_web")).toEqual({ run: 2, day: 2 });
  expect(t.pages.count("r2", "jobs_web")).toEqual({ run: 0, day: 2 });
  await t.adapter.runStep({ ...t.request, runId: "r2" });
  expect(t.pages.count("r2", "jobs_web")).toEqual({ run: 1, day: 3 });
});
test("a third tabs_create_mcp in an attempt is refused with `This step opened too many tabs.`, and a new attempt may open two again", {
  timeout: 20_000,
}, async () => {
  const actions = [
    context(),
    tool("a", "tabs_create_mcp"),
    tool("b", "tabs_create_mcp"),
    tool("c", "tabs_create_mcp"),
    result,
  ];
  const t = await setup(actions);
  await t.adapter.runStep(t.request);
  expect(toolCalls(t.home)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "a", ran: true }),
      expect.objectContaining({ id: "b", ran: true }),
      expect.objectContaining({ id: "c", ran: false }),
    ]),
  );
  expect(t.audits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ detail: expect.objectContaining({ reason: BROWSER_DENY.tabs }) }),
    ]),
  );
  t.script(actions);
  await t.adapter.runStep({ ...t.request, attempt: 2 });
  expect(toolCalls(t.home).filter((c) => c.id === "a" && c.ran)).toHaveLength(2);
  expect(toolCalls(t.home).filter((c) => c.id === "b" && c.ran)).toHaveLength(2);
});
test("a Chrome server that is not connected blocks with `Chrome is not connected to Claude Code.`", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  t.script([result], { mcp_servers: [{ name: "claude-in-chrome", status: "disconnected" }] });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ block: STOP.chromeDown });
});
test("an allowed navigate calls onOutside and marks the result outside true; a step that only had its calls refused does not", {
  timeout: 20_000,
}, async () => {
  const t = await setup([context(), navigate("yes"), result]);
  const onOutside = vi.fn();
  expect(await t.adapter.runStep({ ...t.request, onOutside })).toMatchObject({ outside: true });
  expect(onOutside).toHaveBeenCalled();
  t.script([navigate("no"), result]);
  const denied = await t.adapter.runStep({ ...t.request, onOutside });
  expect(denied.outside).toBeUndefined();
  expect(onOutside).toHaveBeenCalledTimes(1);
});
test("without `pages` a step with a browser is blocked with the limits sentence", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  const { pages: _pages, ...options } = t.options;
  expect(await createClaudeAdapter(options).runStep(t.request)).toMatchObject({ block: LIMITS_NOT_APPLIED });
  expect(readFakeCalls(t.home)).toEqual([]);
});
test("a judge call whose outcome is a stop throws a HarnessCallError of class failed with the sentence", {
  timeout: 20_000,
}, async () => {
  const t = await setup();
  vi.spyOn(runModule, "runClaude").mockResolvedValue({ kind: "stop", sentence: BROWSER_DENY.runLimit });
  const error: unknown = await t.adapter
    .judge({ runId: "r1", stepId: "s", rubric: "r", output: "o", signal: t.request.signal })
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HarnessCallError);
  expect(error).toMatchObject({ message: BROWSER_DENY.runLimit, exit: "failed" });
});

test("a missing or malformed stored run refuses page counting", async () => {
  const t = await setup();
  const row = t.store.getRun("r1");
  if (!row) throw new Error("Missing run");
  const getRun = vi.spyOn(t.store, "getRun");
  getRun.mockReturnValueOnce(undefined);
  expect(() => t.pages.count("r1", "jobs_web")).toThrow();
  getRun.mockReturnValueOnce({ ...row, flowId: undefined } as unknown as typeof row);
  expect(() => t.pages.take("r1", "jobs_web")).toThrow();
});

test("unreadable or invalid page counts block before a child starts", async () => {
  const t = await setup();
  const count = vi.spyOn(t.pages, "count");
  count.mockImplementationOnce(() => {
    throw new Error("unreadable");
  });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ block: LIMITS_NOT_APPLIED });
  count.mockReturnValueOnce({ run: Number.NaN, day: 0 });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ block: LIMITS_NOT_APPLIED });
  expect(readFakeCalls(t.home)).toEqual([]);
});
