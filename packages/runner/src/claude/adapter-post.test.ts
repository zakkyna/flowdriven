import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import { CHROME_PREFIX } from "./browser.ts";
import { POST_TEXT, STOP } from "./browser-post.ts";
import * as childModule from "./child.ts";
import { createPageCounter } from "./pages.ts";
import { tripSentence } from "./stream.ts";

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
async function setup(
  actions: FakeAction[] = [{ do: "result" }],
  page = { title: "Job", text: "Text", final: address },
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
  return { home, request, options, audits, adapter: createClaudeAdapter(options) };
}
const result: FakeAction = { do: "result", result: "done" };
const read = (id = "read"): FakeAction => tool(id, "get_page_text", { tabId: 1001 });
const actions = (last: FakeAction = read()): FakeAction[] => [context(), navigate("nav"), last, result];
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
test("a page that passes is audited as page_read with the final address through visible and the step's ids, and the worker's tool_result is exactly the rewritten first block", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(actions());
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
  expect(t.audits).toContainEqual({
    kind: "page_read",
    detail: {
      stepId: "s",
      itemKey: "",
      attempt: 1,
      requirementId: "jobs_web",
      tool: "get_page_text",
      address,
    },
  });
  expect(received(output(), "read")).toEqual(
    textBlock(`Title: Job\nURL: ${address}\nSource element: <body>\n---\nText`),
  );
});
test("a moved page is audited as page_withheld with `why: moved` and the sentence, ends the attempt as noRetry with `The page moved to an address this step does not declare.`, and is not retried", {
  timeout: 20_000,
}, async () => {
  const moved = "https://other.example/page";
  const t = await setup(actions(), { title: "Job", text: "private", final: moved });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ noRetry: STOP.moved });
  expect(t.audits).toContainEqual({
    kind: "page_withheld",
    detail: {
      stepId: "s",
      itemKey: "",
      attempt: 1,
      requirementId: "jobs_web",
      tool: "get_page_text",
      address: moved,
      why: "moved",
      sentence: POST_TEXT.moved,
    },
  });
  expect(readFakeCalls(t.home).filter((c) => c.kind === "call")).toHaveLength(1);
});
test("a challenge is audited as page_withheld with `why: challenge`, ends as a block with the challenge sentence, and the worker never receives the page text", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(actions(), { title: "Just a moment", text: "captcha secret", final: address });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ block: STOP.challenge });
  expect(t.audits).toContainEqual({
    kind: "page_withheld",
    detail: expect.objectContaining({
      why: "challenge",
      sentence: POST_TEXT.challenge,
      tool: "get_page_text",
    }),
  });
  expect(output()).not.toContain("captcha secret");
});
test("an unchecked result (a header the check does not recognise) is audited as page_withheld with `why: unchecked`, the worker gets the fixed sentence and the attempt goes on to its result", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const malformed: FakeAction = {
    do: "tool",
    id: "read",
    name: `${CHROME_PREFIX}get_page_text`,
    input: { tabId: 1001 },
    result: "unknown header",
  };
  const t = await setup(actions(malformed));
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok", text: "done" });
  expect(t.audits).toContainEqual({
    kind: "page_withheld",
    detail: expect.objectContaining({ why: "unchecked", sentence: POST_TEXT.unchecked }),
  });
  expect(received(output(), "read")).toEqual(textBlock(POST_TEXT.unchecked));
});
test("tabs_context, tabs_create, navigate and tabs_close results write no audit row and reach the worker as the rewritten fixed forms", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup([
    context(),
    tool("create", "tabs_create_mcp"),
    navigate("nav"),
    tool("close", "tabs_close_mcp", { tabId: 1002 }),
    result,
  ]);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok" });
  expect(t.audits.filter((a) => a.kind === "page_read" || a.kind === "page_withheld")).toEqual([]);
  expect(received(output(), "context")).toEqual(textBlock('{"availableTabs":[{"tabId":1001}]}'));
  expect(received(output(), "create")).toEqual(textBlock("Created new tab. Tab ID: 1002"));
  expect(received(output(), "nav")).toEqual(textBlock(`Navigated to ${address}`));
  expect(received(output(), "close")).toEqual(textBlock("Closed tab 1002."));
});
test("the audit rows page_read and page_withheld stop at 50 for an attempt and tool_calls still counts every call", {
  timeout: 60_000,
}, async () => {
  const reads = Array.from({ length: 51 }, (_, i) =>
    i % 2 === 0
      ? read(`read${i}`)
      : ({
          do: "tool",
          id: `read${i}`,
          name: `${CHROME_PREFIX}get_page_text`,
          input: { tabId: 1001 },
          result: "bad",
        } as FakeAction),
  );
  const t = await setup([context(), navigate("nav"), ...reads, result]);
  expect(await t.adapter.runStep({ ...t.request, maxDurationMs: 60_000 })).toMatchObject({ exit: "ok" });
  expect(t.audits.filter((a) => a.kind === "page_read" || a.kind === "page_withheld")).toHaveLength(50);
  expect(t.audits).toContainEqual({
    kind: "tool_calls",
    detail: expect.objectContaining({ allowed: 53, held: 0, refused: 0 }),
  });
});
test("an oversized request (a page text of 2.1 million characters) gets no answer, the hook prints the fixed sentence, the worker sees it, the tripwire does not trip and the attempt carries on", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(actions(), { title: "Job", text: "x".repeat(2_100_000), final: address });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok", text: "done" });
  expect(received(output(), "read")).toEqual(textBlock(POST_TEXT.unchecked));
  expect(t.audits.some((a) => a.kind === "tool_unchecked")).toBe(false);
});
test("a post hook that is killed lets the original blocks through and the tripwire blocks the step with the present sentence", {
  timeout: 20_000,
}, async () => {
  const output = capture();
  const t = await setup(actions());
  const outcome = await t.adapter.runStep({
    ...t.request,
    onStart: () => {
      const path = join(t.options.controlRoot, "cc-1", "hook.sh");
      const original = readFileSync(path, "utf8");
      writeFileSync(path, 'if [ "$1" = "post" ]; then exit 7; fi\n' + original);
    },
  });
  expect(outcome).toMatchObject({ block: tripSentence(`${CHROME_PREFIX}tabs_context_mcp`) });
  expect(received(output(), "context")).toHaveLength(3);
});
