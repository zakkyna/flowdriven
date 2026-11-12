import { expect, test } from "vitest";
import { POST_TEXT } from "./browser-post.ts";
import type { ConnectorPolicy } from "./connector.ts";
import { decideConnectorPost } from "./connector-post.ts";
import { visible } from "./text.ts";

const connector: ConnectorPolicy = {
  requirementId: "gmail",
  label: "Gmail",
  name: "Gmail",
  url: "https://example.test",
  id: "id",
  prefix: "mcp__claude_ai_Gmail__",
  tools: ["search_threads"],
  read: ["search_threads"],
  risky: {},
  blocked: [],
};
const call = (response: unknown) => ({
  hook_event_name: "PostToolUse",
  session_id: "session",
  tool_use_id: "id",
  tool_name: `${connector.prefix}search_threads`,
  tool_response: response,
});
const check = (response: unknown) => decideConnectorPost(connector, "session", call(response));
const unchecked = { kind: "unchecked", text: POST_TEXT.unchecked, tool: "search_threads" };

test("G6: a tool_response that is a string passes as that text, an empty string passes as an empty text, and text blocks are joined with a line break and pass", () => {
  for (const [response, text] of [
    ["hello", "hello"],
    ["", ""],
    [
      [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
      "one\ntwo",
    ],
  ] as const)
    expect(check(response)).toEqual({ kind: "pass", text, tool: "search_threads" });
});
test("a text over 40,000 characters, and a CJK text over 40,000 bytes, are cut with the cut marker and report cut, for a string and for blocks", () => {
  for (const text of ["x".repeat(40_001), String.fromCodePoint(0x6f22).repeat(13_334)])
    for (const response of [text, [{ type: "text", text }]]) {
      const result = check(response);
      expect(result?.kind).toBe("cut");
      expect(result?.text.endsWith(`\n${POST_TEXT.cut}`)).toBe(true);
      expect(Buffer.byteLength(result?.text.split("\n").at(0) ?? "")).toBeLessThanOrEqual(40_000);
    }
});
test("a block that is not text (an image block, a block with no text, a text that is not a string) makes the whole result unchecked with the fixed sentence", () => {
  for (const bad of [{ type: "image", text: "x" }, { type: "text" }, { type: "text", text: 2 }])
    expect(check([{ type: "text", text: "safe" }, bad])).toEqual(unchecked);
});
test("a tool_response that is a number, null, an object, an empty array or an array holding a string is unchecked", () => {
  for (const value of [2, null, {}, [], ["text"]]) expect(check(value)).toEqual(unchecked);
});
test("a tool the connector policy does not declare is unchecked", () => {
  expect(
    decideConnectorPost(connector, "session", { ...call("secret"), tool_name: `${connector.prefix}other` }),
  ).toEqual({ ...unchecked, tool: "other" });
});
test("a request of another session, another event, no tool_use_id or another prefix gives undefined", () => {
  for (const value of [
    null,
    [],
    { ...call("x"), session_id: "other" },
    { ...call("x"), hook_event_name: "PreToolUse" },
    { ...call("x"), tool_use_id: undefined },
    { ...call("x"), tool_name: "other" },
  ])
    expect(decideConnectorPost(connector, "session", value)).toBeUndefined();
});
test("the tool name passes visible", () => {
  const name = `bad\n${"x".repeat(80)}`;
  expect(
    decideConnectorPost(connector, "session", { ...call("x"), tool_name: connector.prefix + name })?.tool,
  ).toBe(visible(name, 60));
});
