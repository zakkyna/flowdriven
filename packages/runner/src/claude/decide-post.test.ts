import { parseTemplate } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { CHROME_PREFIX } from "./browser.ts";
import { cutText, decidePost, POST_TEXT, postLine } from "./browser-post.ts";

const parsed = parseTemplate("https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}");
if (!parsed.ok) throw new Error("Bad template");
const browser = { requirementId: "web", templates: [parsed.template], perRun: 3, perDay: 10 };
const url = `https://www.upwork.com/jobs/~${"a".repeat(18)}`;
const page = (address: string, title: string, body: string) => [
  { type: "text", text: `Title: ${title}\nURL: ${address}\nSource element: <body>\n---\n${body}` },
  { type: "text", text: "Tab Context: secret" },
  { type: "text", text: "system-reminder: secret" },
];
const call = (name: string, response: unknown, input: unknown = {}) => ({
  hook_event_name: "PostToolUse",
  session_id: "s1",
  tool_use_id: "t1",
  tool_name: CHROME_PREFIX + name,
  tool_input: input,
  tool_response: response,
});
const text = (value: string) => [{ type: "text", text: value }];
const post = (name: string, response: unknown, input: unknown = {}) =>
  decidePost(browser, "s1", call(name, response, input));

test("a page on a template passes as its first block only, and the tab list and the reminder are dropped", () => {
  const blocks = page(url, "Job", "body");
  expect(post("get_page_text", blocks)).toEqual({
    kind: "pass",
    tool: "get_page_text",
    text: blocks[0]?.text,
  });
});
test("tabs_context_mcp is rewritten to ids only and teaches the ids: a moved tab with a login title and an off-template address shows neither its title nor its address, and a response that does not parse, has a string tab id or more than 50 tabs is unchecked", () => {
  const result = post(
    "tabs_context_mcp",
    text(
      JSON.stringify({
        availableTabs: [{ tabId: 7, title: "Login", url: "https://evil.example/" }],
        tabGroupId: 2,
      }),
    ),
  );
  expect(result).toEqual({
    kind: "pass",
    tool: "tabs_context_mcp",
    text: '{"availableTabs":[{"tabId":7}]}',
    tabs: [7],
  });
  for (const bad of [
    "{",
    JSON.stringify({ availableTabs: [{ tabId: "7" }] }),
    JSON.stringify({ availableTabs: Array.from({ length: 51 }, () => ({ tabId: 1 })) }),
  ])
    expect(post("tabs_context_mcp", text(bad))).toMatchObject({
      kind: "unchecked",
      text: POST_TEXT.unchecked,
    });
});
test("tabs_create_mcp is rewritten from an exact first block and teaches its id; `Created new tab. Tab ID: 12345678901234567` (17 digits), extra words and a second line are unchecked", () => {
  expect(post("tabs_create_mcp", text("Created new tab. Tab ID: 007"))).toEqual({
    kind: "pass",
    tool: "tabs_create_mcp",
    text: "Created new tab. Tab ID: 7",
    tabs: [7],
  });
  for (const bad of [
    "Created new tab. Tab ID: 12345678901234567",
    "Created new tab. Tab ID: 7 extra",
    "Created new tab. Tab ID: 7\nmore",
    "Created new tab. Tab ID: 7\n",
    "Created new tab. Tab ID: 9999999999999999",
  ])
    expect(post("tabs_create_mcp", text(bad))).toMatchObject({ kind: "unchecked" });
});
test("navigate and tabs_close_mcp are rewritten from the request's own input: a first block that names another address or another tab shows the request's, and a block with another start is unchecked", () => {
  expect(post("navigate", text("Navigated to https://evil.example/"), { url })).toMatchObject({
    kind: "pass",
    text: `Navigated to ${url}`,
  });
  expect(post("tabs_close_mcp", text("Closed tab 99."), { tabId: 7 })).toMatchObject({
    kind: "pass",
    text: "Closed tab 7.",
  });
  expect(post("navigate", text("wrong"), { url })).toMatchObject({ kind: "unchecked" });
  expect(post("tabs_close_mcp", text("wrong"), { tabId: 7 })).toMatchObject({ kind: "unchecked" });
});
test("a page whose URL line is off the templates and has no marker is withheld as moved with the address, whatever `navigate` reported (F8)", () => {
  expect(post("get_page_text", page("https://other.example/page", "Page", "body"))).toEqual({
    kind: "moved",
    text: POST_TEXT.moved,
    tool: "get_page_text",
    address: "https://other.example/page",
  });
});
test("R5 off the templates: each pathname marker (`/login`, `/signin`, `/sign-in`, `/checkpoint`, `/challenge`, `/captcha`, `/account-security`) and each of the eight title starts, in any case, is a challenge", () => {
  for (const marker of [
    "/login",
    "/signin",
    "/sign-in",
    "/checkpoint",
    "/challenge",
    "/captcha",
    "/account-security",
  ])
    expect(
      post("get_page_text", page(`https://other.example${marker.toUpperCase()}`, "Page", "body")),
    ).toMatchObject({ kind: "challenge", text: POST_TEXT.challenge });
  for (const title of [
    "just a moment",
    "attention required",
    "access denied",
    "verify you are human",
    "security check",
    "log in",
    "sign in",
    "login",
  ])
    expect(
      post("get_page_text", page("https://other.example/page", title.toUpperCase() + " now", "body")),
    ).toMatchObject({ kind: "challenge", text: POST_TEXT.challenge });
});
test("R5 on a template: a page of 2,000 characters titled `Login page redesign` passes, and one titled `Just a moment` passes; a body of 799 characters with the title `Just a moment` is a challenge and one of 800 is not; a body of 799 characters with `captcha` is a challenge and one of 800 is not; a title `Log in` on a template with a short body is not a challenge", () => {
  for (const title of ["Login page redesign", "Just a moment"])
    expect(post("get_page_text", page(url, title, "x".repeat(2000)))).toMatchObject({ kind: "pass" });
  for (const length of [799, 800]) {
    expect(post("get_page_text", page(url, "Just a moment", "x".repeat(length)))).toMatchObject({
      kind: length === 799 ? "challenge" : "pass",
    });
    for (const marker of ["verify you are human", "are you a robot", "unusual activity", "captcha"])
      expect(
        post("get_page_text", page(url, "Page", marker + "x".repeat(length - marker.length))),
      ).toMatchObject({ kind: length === 799 ? "challenge" : "pass" });
  }
  expect(post("get_page_text", page(url, "Log in", "short"))).toMatchObject({ kind: "pass" });
});
test("a challenge is decided before a moved page: an off-template `/login` address gives the challenge text", () => {
  expect(post("get_page_text", page("https://other.example/login", "Page", "body"))).toMatchObject({
    kind: "challenge",
    text: POST_TEXT.challenge,
  });
});
test("cutText: 40,000 characters pass whole, 40,001 are cut with the mark; a text of 20,000 three-byte characters is cut at 40,000 bytes; a surrogate pair at the cut is not split", () => {
  expect(cutText("a".repeat(40000))).toEqual({ text: "a".repeat(40000), cut: false });
  expect(cutText("a".repeat(40001))).toEqual({ text: `${"a".repeat(40000)}\n${POST_TEXT.cut}`, cut: true });
  expect(cutText("\u4e00".repeat(20000))).toEqual({
    text: `${"\u4e00".repeat(13333)}\n${POST_TEXT.cut}`,
    cut: true,
  });
  expect(cutText(`${"a".repeat(39999)}\u{1f600}`)).toEqual({
    text: `${"a".repeat(39999)}\n${POST_TEXT.cut}`,
    cut: true,
  });
  expect(post("get_page_text", page(url, "Page", "a".repeat(40001)))).toMatchObject({ kind: "cut" });
});
test("the get_page_text header must be exactly the four lines of F14: a missing `Source element:` line, a title that continues on a second line, `\\r`, the lines in another order and a missing `---` are all unchecked with the fixed sentence", () => {
  for (const block of [
    `Title: x\nURL: ${url}\n---\nbody`,
    `Title: x\ncontinued\nURL: ${url}\nSource element: x\n---`,
    `Title: x\r\nURL: ${url}\nSource element: x\n---`,
    `Title: x${String.fromCodePoint(0x2028)}forged\nURL: ${url}\nSource element: x\n---`,
    `URL: ${url}\nTitle: x\nSource element: x\n---`,
    `Title: x\nURL: ${url}\nSource element: x\nbody`,
  ])
    expect(post("get_page_text", text(block))).toMatchObject({
      kind: "unchecked",
      text: POST_TEXT.unchecked,
    });
});
test("no answer for a PreToolUse request, another session, a tool that is not a Chrome tool, a missing `tool_use_id` or a non-object `tool_input`; and a response that is not an array, an empty array or a first block that is not text is unchecked", () => {
  const base = call("get_page_text", page(url, "Page", "body"));
  for (const bad of [
    { ...base, hook_event_name: "PreToolUse" },
    { ...base, session_id: "other" },
    { ...base, tool_name: "Read" },
    { ...base, tool_use_id: undefined },
    { ...base, tool_input: null },
    { ...base, tool_input: [] },
  ])
    expect(decidePost(browser, "s1", bad)).toBeUndefined();
  for (const bad of [null, [], [{ type: "image", text: "x" }], [{ type: "text", text: 1 }]])
    expect(post("get_page_text", bad)).toMatchObject({ kind: "unchecked", text: POST_TEXT.unchecked });
  expect(post("unknown", text("x"))).toMatchObject({ kind: "unchecked" });
});
test("postLine is one line of JSON in the shape of F5 and survives quotes, newlines and unicode in the text", () => {
  const value = '"hello"\n\u4e00';
  const line = postLine(value);
  expect(line).not.toContain("\n");
  expect(JSON.parse(line)).toEqual({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedMCPToolOutput: [{ type: "text", text: value }],
    },
  });
});
