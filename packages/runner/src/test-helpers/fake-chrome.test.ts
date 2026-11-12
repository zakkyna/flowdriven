import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { chromeTools, FakeChrome } from "./fake-chrome.ts";
import {
  FAKE_CLAUDE_PATH,
  FAKE_HELP,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
} from "./fake-claude-script.ts";

const prefix = "mcp__claude-in-chrome__";
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function play(
  actions: FakeAction[],
  post: string,
  matcher = "mcp__claude-in-chrome__.*",
  pre = "true",
  chrome = true,
) {
  const h = makeFakeHome({ chrome, plays: [{ when: "", actions: [...actions, { do: "result" }] }] });
  homes.push(h);
  const settings = join(h, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ command: "true" }] }],
        PreToolUse: [{ hooks: [{ command: pre }] }],
        PostToolUse: [{ matcher, hooks: [{ command: post }] }],
      },
    }),
  );
  const run = spawnSync(FAKE_CLAUDE_PATH, ["-p", "--settings", settings, ...(chrome ? ["--chrome"] : [])], {
    cwd: h,
    env: { HOME: h, PATH: process.env.PATH },
    input: "x",
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const events = run.stdout
    .trim()
    .split("\n")
    .map(
      (s) =>
        JSON.parse(s) as {
          subtype?: string;
          tools?: string[];
          mcp_servers?: unknown[];
          message?: { content: { content?: unknown; is_error?: boolean }[] };
          permission_denials?: unknown[];
        },
    );
  return { events, calls: readFakeCalls(h) };
}
const tool = (name: string, input: Record<string, unknown> = {}, id = name): FakeAction => ({
  do: "tool",
  name,
  input,
  id,
});
const allow = `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'`;
const replacement = [{ type: "text", text: "replacement" }];
const post = `printf '%s' '{"hookSpecificOutput":{"updatedMCPToolOutput":[{"type":"text","text":"replacement"}]}}'`;
function results(events: ReturnType<typeof play>["events"]) {
  return events
    .filter((e) => e.message?.content.at(0)?.content !== undefined)
    .map((e) => e.message?.content.at(0));
}

test("FakeChrome gives the three blocks of F6 for each of the five calls, and the first block of each has the F6 shape", () => {
  const c = new FakeChrome();
  const calls = [
    ["tabs_context_mcp", {}, '"tabId":1001'],
    ["tabs_create_mcp", {}, "Created new tab. Tab ID: 1002"],
    ["navigate", { tabId: 1002, url: "https://example.com/" }, "Navigated to https://example.com/"],
    [
      "get_page_text",
      { tabId: 1002 },
      "Title: Example\nURL: https://example.com/\nSource element: <body>\n---\nText",
    ],
    ["tabs_close_mcp", { tabId: 1002 }, "Closed tab 1002. Group is now empty (auto-removed)."],
  ] as const;
  for (const [name, input, first] of calls) {
    const r = c.result(prefix + name, input, { "https://example.com/": { title: "Example", text: "Text" } });
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks.at(0)?.text).toContain(first);
    expect(r.blocks.at(1)?.text).toContain("Tab Context:");
    expect(r.blocks.at(2)?.text).toContain("<system-reminder>");
  }
});
test("get_page_text says the final address of the page table, which can differ from the one navigate was asked for (F8)", () => {
  const c = new FakeChrome();
  c.result(prefix + "tabs_context_mcp", {}, {});
  c.result(prefix + "navigate", { tabId: 1001, url: "https://example.com/" }, {});
  expect(
    c
      .result(
        prefix + "get_page_text",
        { tabId: 1001 },
        { "https://example.com/": { final: "https://example.com/moved", title: "T", text: "X" } },
      )
      .blocks.at(0)?.text,
  ).toContain("URL: https://example.com/moved");
});
test("an unknown address is a Not found page, a never-navigated tab is an error, and tabs_create_mcp before tabs_context_mcp is the F7 error", () => {
  const c = new FakeChrome();
  expect(c.result(prefix + "tabs_create_mcp", {}, {}).error).toContain("no tab group");
  c.result(prefix + "tabs_context_mcp", {}, {});
  expect(c.result(prefix + "get_page_text", { tabId: 1001 }, {}).error).toContain("Couldn't determine");
  c.result(prefix + "navigate", { tabId: 1001, url: "https://example.com/" }, {});
  expect(c.result(prefix + "get_page_text", { tabId: 1001 }, {}).blocks.at(0)?.text).toContain(
    "Title: Not found\nURL: https://example.com/\nSource element: <body>\n---\nNothing here.",
  );
});
test("a tab id of another session gives the F15 errors for get_page_text and tabs_close_mcp", () => {
  const c = new FakeChrome();
  c.result(prefix + "tabs_context_mcp", {}, {});
  expect(c.result(prefix + "get_page_text", { tabId: 9 }, {}).error).toContain("Couldn't determine");
  expect(c.result(prefix + "get_page_text", {}, {}).error).toContain("Couldn't determine");
  expect(c.result(prefix + "tabs_close_mcp", { tabId: 9 }, {}).error).toContain("not in Claude's tab group");
});
test("with --chrome the init event lists the Chrome server and the 21 tools; without it, as before", () => {
  expect(chromeTools).toHaveLength(21);
  const a = play([], "true");
  expect(a.events.find((e) => e.subtype === "init")).toMatchObject({
    tools: chromeTools,
    mcp_servers: [{ name: "claude-in-chrome", status: "connected" }],
  });
  expect(play([], "true", "x", "true", false).events.find((e) => e.subtype === "init")).toMatchObject({
    tools: [],
    mcp_servers: [],
  });
});
test("a Chrome tool action runs the PreToolUse command, then the PostToolUse command from the settings, and the tool_result content is the replacement the hook printed", () => {
  const p = play([tool(prefix + "tabs_context_mcp")], post, undefined, allow);
  expect(results(p.events).at(0)?.content).toEqual(replacement);
  expect(p.calls.slice(-2)).toMatchObject([
    { kind: "tool", ran: true },
    { kind: "post", hookExit: 0, replaced: true },
  ]);
});
test("a hook that prints nothing or fails leaves the original three blocks in the tool_result", () => {
  for (const cmd of ["true", "exit 1"]) {
    const p = play([tool(prefix + "tabs_context_mcp")], cmd, undefined, allow);
    expect(results(p.events).at(0)?.content).toHaveLength(3);
    expect(p.calls.at(-1)).toMatchObject({ kind: "post", replaced: false });
  }
});
test("the matcher is applied: a StructuredOutput and a Read action do not run the post hook, a Chrome action does, and a matcher that matches nothing runs it for none", () => {
  const actions = [tool("StructuredOutput"), tool("Read"), tool(prefix + "tabs_context_mcp")];
  expect(play(actions, post, undefined, allow).calls.filter((c) => c.kind === "post")).toHaveLength(1);
  expect(play(actions, post, "nothing", allow).calls.filter((c) => c.kind === "post")).toHaveLength(0);
});
test("a denied Chrome call is an error result with the hook text and is listed in permission_denials, and the post hook does not run", () => {
  const p = play([tool(prefix + "tabs_context_mcp")], post, undefined, "echo denied >&2; exit 2");
  expect(results(p.events).at(0)).toMatchObject({
    is_error: true,
    content: expect.stringContaining("denied"),
  });
  expect(p.events.at(-1)?.permission_denials).toHaveLength(1);
  expect(p.calls.filter((c) => c.kind === "post")).toHaveLength(0);
});
test("with chrome: true the help text has the --chrome line, and the present help is unchanged otherwise", () => {
  for (const chrome of [false, true]) {
    const h = makeFakeHome({ chrome });
    homes.push(h);
    const r = spawnSync(FAKE_CLAUDE_PATH, ["--help"], {
      env: { HOME: h, PATH: process.env.PATH },
      encoding: "utf8",
    });
    expect(r.stdout).toBe(FAKE_HELP + (chrome ? "--chrome  Enable Claude in Chrome integration\n" : ""));
  }
});
