import { parseTemplate } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { BROWSER_DENY, CHROME_PREFIX } from "./browser.ts";
import { DENY, decide } from "./decide.ts";
import type { Policy } from "./policy.ts";

const parsed = parseTemplate("https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}");
if (!parsed.ok) throw new Error("Bad test template");
const policy: Policy = {
  tools: [],
  folders: [],
  cwd: "/",
  addDirs: [],
  schema: false,
  sessionId: "s1",
  browser: { requirementId: "web", templates: [parsed.template], perRun: 3, perDay: 10 },
};
const state = { counts: { run: 0, day: 0 }, tabs: new Set([7]), opened: 0 };
const url = `https://www.upwork.com/jobs/~${"a".repeat(18)}`;
const call = (name: string, tool_input: unknown = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  tool_name: CHROME_PREFIX + name,
  tool_use_id: "t1",
  tool_input,
});
const decision = (name: string, input: unknown = {}, s = state) => decide(policy, call(name, input), s);

test("the five read calls are allowed with their exact inputs, a page flagged on navigate and a tab flagged on tabs_create_mcp", () => {
  for (const [name, input, effect] of [
    ["tabs_context_mcp", {}, undefined],
    ["tabs_context_mcp", { createIfEmpty: true }, undefined],
    ["tabs_create_mcp", {}, "tab"],
    ["navigate", { url, tabId: 7 }, "page"],
    ["get_page_text", { tabId: 7 }, undefined],
    ["get_page_text", { tabId: 7, max_chars: 40000 }, undefined],
    ["tabs_close_mcp", { tabId: 7 }, undefined],
  ] as const)
    expect(decision(name, input)).toEqual({
      allow: true,
      tool: CHROME_PREFIX + name,
      ...(effect ? { effect } : {}),
    });
});
test("R3: every other Chrome tool is refused with This step may only read pages., one assertion per tool", () => {
  for (const name of [
    "browser_batch",
    "computer",
    "file_upload",
    "find",
    "form_input",
    "gif_creator",
    "list_connected_browsers",
    "read_console_messages",
    "read_network_requests",
    "read_page",
    "resize_window",
    "select_browser",
    "shortcuts_execute",
    "shortcuts_list",
    "switch_browser",
    "upload_image",
    "new_tool",
  ])
    expect(decision(name)).toEqual({
      allow: false,
      reason: BROWSER_DENY.readOnly,
      tool: CHROME_PREFIX + name,
    });
});
test("a call with a part FlowDriven does not recognise is refused: an extra key, createIfEmpty: false, a string tab id, a float, Infinity, a negative max_chars, max_chars of 40,001, a non-object input", () => {
  for (const [name, input] of [
    ["tabs_context_mcp", { extra: 1 }],
    ["tabs_context_mcp", { createIfEmpty: false }],
    ["navigate", { url, tabId: "7" }],
    ["navigate", { url, tabId: 7.5 }],
    ["navigate", { url, tabId: Infinity }],
    ["get_page_text", { tabId: 7, max_chars: -1 }],
    ["get_page_text", { tabId: 7, max_chars: 40001 }],
    ["navigate", { tabId: 7, url, x: 1 }],
    ["get_page_text", { tabId: 7, x: 1 }],
    ["tabs_close_mcp", { tabId: 7, x: 1 }],
    ["tabs_create_mcp", { x: 1 }],
    ["get_page_text", { tabId: 7, max_chars: 1.5 }],
  ] as const)
    expect(decision(name, input)).toMatchObject({ allow: false, reason: BROWSER_DENY.part });
  expect(decision("navigate", null)).toMatchObject({ allow: false, reason: BROWSER_DENY.part });
});
test("R2: an address must match a template whole: ~abc/../x, an upper-case host, a port, a query, an empty query, a fragment, an empty fragment, a percent sign, @evil.example, another host and a trailing character are all This address is not one this step declares.", () => {
  for (const address of [
    "https://www.upwork.com/jobs/~abc/../x",
    url.replace("www", "WWW"),
    url.replace(".com/", ".com:443/"),
    url + "?x=1",
    url + "?",
    url + "#x",
    url + "#",
    url + "%",
    url.replace("www.upwork.com", "www.upwork.com@evil.example"),
    url.replace("www.upwork.com", "evil.example"),
    url + "/",
  ])
    expect(decision("navigate", { url: address, tabId: 7 })).toMatchObject({
      allow: false,
      reason: BROWSER_DENY.address,
    });
});
test("R1: a tab the session never saw is refused for navigate, get_page_text and tabs_close_mcp with This tab is not one this step opened., and with no state at all every such call is refused", () => {
  for (const [name, input] of [
    ["navigate", { url, tabId: 8 }],
    ["get_page_text", { tabId: 8 }],
    ["tabs_close_mcp", { tabId: 8 }],
  ] as const) {
    expect(decision(name, input)).toMatchObject({ allow: false, reason: BROWSER_DENY.tab });
    expect(decide(policy, call(name, input))).toMatchObject({ allow: false, reason: BROWSER_DENY.tab });
  }
});
test("R6: the run limit, then the day limit, are checked after the tab and the address and name their own sentence; one page below each limit is allowed", () => {
  const full = { ...state, counts: { run: 3, day: 10 } };
  expect(decision("navigate", { url, tabId: 8 }, full)).toMatchObject({ reason: BROWSER_DENY.tab });
  expect(decision("navigate", { url: "bad", tabId: 7 }, full)).toMatchObject({
    reason: BROWSER_DENY.address,
  });
  expect(decision("navigate", { url, tabId: 7 }, full)).toMatchObject({ reason: BROWSER_DENY.runLimit });
  expect(decision("navigate", { url, tabId: 7 }, { ...state, counts: { run: 2, day: 10 } })).toMatchObject({
    reason: BROWSER_DENY.dayLimit,
  });
  expect(decision("navigate", { url, tabId: 7 }, { ...state, counts: { run: 2, day: 9 } }).allow).toBe(true);
});
test("unreadable counters fail closed", () => {
  expect(decision("navigate", { url, tabId: 7 }, { ...state, counts: { run: NaN, day: 0 } })).toMatchObject({
    allow: false,
    reason: BROWSER_DENY.runLimit,
  });
  expect(decision("navigate", { url, tabId: 7 }, { ...state, counts: { run: 0, day: NaN } })).toMatchObject({
    allow: false,
    reason: BROWSER_DENY.dayLimit,
  });
  expect(decision("tabs_create_mcp", {}, { ...state, opened: NaN })).toMatchObject({
    allow: false,
    reason: BROWSER_DENY.tabs,
  });
});
test("tabs_create_mcp is allowed twice and the third is refused with This step opened too many tabs.", () => {
  for (const opened of [0, 1])
    expect(decision("tabs_create_mcp", {}, { ...state, opened })).toMatchObject({
      allow: true,
      effect: "tab",
    });
  expect(decision("tabs_create_mcp", {}, { ...state, opened: 2 })).toMatchObject({
    allow: false,
    reason: BROWSER_DENY.tabs,
  });
});
test("a Chrome tool without a browser policy is refused as undeclared, and the file tools are decided as before", () => {
  const { browser: _browser, ...noBrowser } = policy;
  expect(decide(noBrowser, call("navigate"))).toMatchObject({
    reason: `This step does not declare the tool ${CHROME_PREFIX}navigate.`,
  });
  expect(
    decide({ ...noBrowser, tools: ["Read"] }, { ...call("x"), tool_name: "Read", tool_input: {} }),
  ).toMatchObject({ reason: DENY.noPath });
});
test("a PostToolUse request is still refused as a bad request", () => {
  expect(decide(policy, { ...call("navigate"), hook_event_name: "PostToolUse" }, state)).toMatchObject({
    reason: DENY.badRequest,
  });
});
test("the denied target is cut to 300 characters and the tool name passes visible", () => {
  expect(decision("navigate", { url: "x".repeat(400), tabId: 7 })).toMatchObject({ target: "x".repeat(300) });
  expect(decision(`bad${String.fromCodePoint(0x202e)}`)).toMatchObject({
    tool: `${CHROME_PREFIX}bad<U+202E>`,
  });
});
