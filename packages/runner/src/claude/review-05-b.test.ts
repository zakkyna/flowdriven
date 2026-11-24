import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, type FakeAction, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { CHROME_PREFIX } from "./browser.ts";
import { POST_TEXT, postLine } from "./browser-post.ts";
import { type Channel, MAX_REQUEST_BYTES, startChannel } from "./channel.ts";
import { type ControlDir, createControlDir } from "./control.ts";
import { createPageCounter } from "./pages.ts";
import { tripSentence } from "./stream.ts";

const roots: string[] = [];
const stores: Store[] = [];
const channels: Channel[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const channel of channels.splice(0)) channel.stop();
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
const notes = Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read" });
const tool = (id: string, name: string, input: Record<string, unknown> = {}): FakeAction => ({
  do: "tool",
  id,
  name: `${CHROME_PREFIX}${name}`,
  input,
});
const readPlay: FakeAction[] = [
  tool("context", "tabs_context_mcp", { createIfEmpty: true }),
  tool("nav", "navigate", { tabId: 1001, url: address }),
  tool("read", "get_page_text", { tabId: 1001 }),
  { do: "result", result: "done" },
];
type Audit = { kind: string; detail: unknown };
async function setup(options: {
  text?: string;
  maxLineBytes?: number;
  plan?: FakeAction[];
  browser?: boolean;
}) {
  const browser = options.browser ?? true;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({
    chrome: browser,
    pages: { [address]: { title: "Job", text: options.text ?? "Text", final: address } },
    plays: [{ when: "", actions: options.plan ?? readPlay }],
  });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(join(project, "notes"), { recursive: true });
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const requirement = browser ? web : notes;
  store.createRun({
    id: "r1",
    flowId: "flow",
    flowHash: "hash",
    flowVersion: "1",
    state: "running",
    project,
    inputs: {},
    params: {},
    requirements: [requirement],
    startedAt: "2026-11-12T00:00:00Z",
  });
  const pages = createPageCounter({
    store,
    dayOf: () => "2026-11-12",
    now: () => new Date("2026-11-12T00:00:00Z"),
  });
  const route = routeRequirement(web, { hooks: true, chrome: true });
  if (!route) throw Error("missing route");
  let n = 0;
  const audits: Audit[] = [];
  const controlRoot = join(root, "control");
  const adapter = createClaudeAdapter({
    pages,
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot,
    audit: (kind: string, _run: string, detail: unknown) => audits.push({ kind, detail }),
    newId: () => `cc-${++n}`,
    newSessionId: () => "session-1",
    rounds: 20,
    ...(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes }),
  });
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Read",
    uses: [requirement.id],
    project,
    requirements: [requirement],
    ...(browser ? { routes: [route] } : {}),
    outputs: [],
    maxDurationMs: 20000,
    signal: new AbortController().signal,
  };
  return { adapter, request, audits, controlRoot };
}
const of = (audits: Audit[], kind: string) => audits.filter((a) => a.kind === kind);

test("B-1: in a browser step a result line over the line limit blocks the step with the unchecked-tool sentence, audits tool_unchecked and is not tried again", {
  timeout: 30_000,
}, async () => {
  const t = await setup({ text: "y".repeat(40_000), maxLineBytes: 20_000 });
  const outcome = await t.adapter.runStep({
    ...t.request,
    onStart: () => {
      // The post hook fails only for get_page_text, so the original, large result reaches the stream.
      const path = join(t.controlRoot, "cc-1", "hook.sh");
      const original = readFileSync(path, "utf8");
      const wrapper = [
        'if [ "$1" = "post" ]; then',
        '  t="$0.req.$$"',
        '  /bin/cat > "$t"',
        `  if /usr/bin/grep -q '"tool_name":"mcp__claude-in-chrome__get_page_text"' "$t"; then /bin/rm -f "$t"; exit 7; fi`,
        '  /bin/sh "$0" post2 < "$t"; c=$?; /bin/rm -f "$t"; exit $c',
        "fi",
        "",
      ].join("\n");
      writeFileSync(
        path,
        wrapper + original.replace('if [ "$1" = "post" ]; then', 'if [ "$1" = "post2" ]; then'),
      );
    },
  });
  expect(outcome).toMatchObject({ block: tripSentence("unknown") });
  // A block result stops the run in the engine; the plain failed outcome of the old branch has no block.
  expect(outcome.text).not.toBe("Claude Code sent a line that was too long.");
  expect(of(t.audits, "tool_unchecked")).toEqual([
    { kind: "tool_unchecked", detail: expect.objectContaining({ tool: "unknown" }) },
  ]);
});

test("B-1: without a browser policy a line over the limit is the present failed outcome", {
  timeout: 20_000,
}, async () => {
  const t = await setup({
    browser: false,
    maxLineBytes: 1000,
    plan: [
      { do: "raw", line: "x".repeat(5000) },
      { do: "pause", ms: 30000 },
    ],
  });
  const outcome = await t.adapter.runStep(t.request);
  expect(outcome).toMatchObject({ exit: "failed", text: "Claude Code sent a line that was too long." });
  expect(outcome).not.toHaveProperty("block");
  expect(of(t.audits, "tool_unchecked")).toEqual([]);
});

test("B-4: a page text over 2 MiB is withheld and gives exactly one page_withheld line with why unchecked, no tool_denied line, and denied 0", {
  timeout: 30_000,
}, async () => {
  const t = await setup({ text: "x".repeat(2_100_000) });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok", text: "done" });
  expect(of(t.audits, "page_withheld")).toEqual([
    {
      kind: "page_withheld",
      detail: expect.objectContaining({
        tool: "get_page_text",
        address: "",
        why: "unchecked",
        sentence: POST_TEXT.unchecked,
      }),
    },
  ]);
  expect(of(t.audits, "page_read")).toEqual([]);
  expect(of(t.audits, "tool_denied")).toEqual([]);
  expect(of(t.audits, "tool_calls")).toEqual([
    { kind: "tool_calls", detail: expect.objectContaining({ allowed: 3, held: 0, refused: 0 }) },
  ]);
});

test("B-4: a post request over 8 MiB gets no answer, counts nothing, and gives one page_withheld line with the tool unknown and no tool_denied line", {
  timeout: 60_000,
}, async () => {
  const t = await setup({ text: "x".repeat(9_000_000) });
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "ok", text: "done" });
  expect(of(t.audits, "page_withheld")).toEqual([
    {
      kind: "page_withheld",
      detail: expect.objectContaining({
        tool: "unknown",
        address: "",
        why: "unchecked",
        sentence: POST_TEXT.unchecked,
      }),
    },
  ]);
  expect(of(t.audits, "tool_denied")).toEqual([]);
  expect(of(t.audits, "tool_unchecked")).toEqual([]);
  expect(of(t.audits, "tool_calls")).toEqual([
    { kind: "tool_calls", detail: expect.objectContaining({ allowed: 3, held: 0, refused: 0 }) },
  ]);
});

const a = "aaaaaaaaaaaaaaaa",
  b = "bbbbbbbbbbbbbbbb",
  c = "cccccccccccccccc",
  d = "dddddddddddddddd";
function channelSetup(options: Partial<Parameters<typeof startChannel>[0]> = {}) {
  vi.useFakeTimers();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const dir = createControlDir({ root: join(root, "control"), id: "cc-1", rounds: 3 });
  const onCall = vi.fn();
  const channel = startChannel({
    dir,
    decide: () => ({ allow: true, tool: "x", reason: "ok" }),
    onCall,
    pollMs: 5,
    ...options,
  });
  channels.push(channel);
  return { dir, channel, onCall };
}
function put(dir: ControlDir, name: string, text: string) {
  const tmp = join(dir.req, `.${name}`);
  writeFileSync(tmp, text);
  renameSync(tmp, join(dir.req, `${name}.json`));
  vi.advanceTimersByTime(5);
}
const pre = (id: string, name = `${CHROME_PREFIX}get_page_text`) =>
  JSON.stringify({ hook_event_name: "PreToolUse", tool_use_id: id, tool_name: name });
const post = (id: string) => JSON.stringify({ hook_event_name: "PostToolUse", tool_use_id: id });

test("B-4: a request over 8 MiB that is not a post request is refused as before", () => {
  const onUnanswered = vi.fn();
  const { dir, channel, onCall } = channelSetup({ onUnanswered });
  put(dir, a, `{"pad":"${"x".repeat(MAX_REQUEST_BYTES + 1)}"}`);
  expect(readFileSync(join(dir.res, a), "utf8")).toBe("deny\nThis request is too large.\n");
  expect(onUnanswered).not.toHaveBeenCalled();
  expect(channel.counts()).toEqual({ allowed: 0, denied: 1 });
  expect(onCall).toHaveBeenCalledTimes(1);
  expect(existsSync(join(dir.req, `${a}.json`))).toBe(false);
  // a post request over 8 MiB: no answer, nothing counted, the file is removed, one report without an id.
  put(dir, b, `{"hook_event_name": "PostToolUse","pad":"${"x".repeat(MAX_REQUEST_BYTES + 1)}"}`);
  expect(existsSync(join(dir.res, b))).toBe(false);
  expect(existsSync(join(dir.req, `${b}.json`))).toBe(false);
  expect(onUnanswered).toHaveBeenCalledTimes(1);
  expect(onUnanswered).toHaveBeenCalledWith({});
  expect(channel.counts()).toEqual({ allowed: 0, denied: 1 });
  expect(onCall).toHaveBeenCalledTimes(1);
  expect(readdirSync(dir.res).filter((n) => !n.startsWith("."))).toEqual([a]);
});

test("a post request that the post function answers with nothing reports the id once, and a second post request for that id reports nothing", () => {
  const onUnanswered = vi.fn();
  const post1 = vi.fn(() => undefined);
  const { dir, channel } = channelSetup({ post: post1, onUnanswered });
  put(dir, a, pre("t"));
  put(dir, b, post("t"));
  expect(existsSync(join(dir.res, b))).toBe(false);
  expect(onUnanswered).toHaveBeenCalledTimes(1);
  expect(onUnanswered).toHaveBeenCalledWith({ toolUseId: "t", tool: "get_page_text" });
  put(dir, c, post("t"));
  expect(onUnanswered).toHaveBeenCalledTimes(1);
  expect(existsSync(join(dir.res, c))).toBe(false);
  expect(channel.counts()).toEqual({ allowed: 1, denied: 0 });
  // a throwing post function and a missing post option report once per id too; a callback that throws is contained.
  const throwing = channelSetup({
    post: () => {
      throw Error("no");
    },
    onUnanswered: () => {
      throw Error("no");
    },
  });
  put(throwing.dir, a, pre("u", `${CHROME_PREFIX}navigate`));
  put(throwing.dir, b, post("u"));
  expect(existsSync(join(throwing.dir.res, b))).toBe(false);
  const calls = vi.fn();
  const none = channelSetup({ onUnanswered: calls });
  put(none.dir, a, pre("v", `${CHROME_PREFIX}tabs_context_mcp`));
  put(none.dir, b, post("v"));
  expect(calls).toHaveBeenCalledWith({ toolUseId: "v", tool: "tabs_context_mcp" });
  // an answered id and an id that was never allowed report nothing
  const quiet = vi.fn();
  const ok = channelSetup({ post: () => ({ text: "safe", line: postLine("safe") }), onUnanswered: quiet });
  put(ok.dir, a, pre("w"));
  put(ok.dir, b, post("w"));
  put(ok.dir, c, post("w"));
  put(ok.dir, d, post("missing"));
  expect(quiet).not.toHaveBeenCalled();
});
