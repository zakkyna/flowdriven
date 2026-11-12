import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { CHROME_PREFIX } from "./browser.ts";
import { POST_TEXT, postLine } from "./browser-post.ts";
import { type Channel, startChannel } from "./channel.ts";
import { createControlDir } from "./control.ts";
import { HOOK_TIMEOUT_SECONDS, postCommand, settingsJson } from "./hook-script.ts";
import { createTripwire, type StreamEvent } from "./stream.ts";

const prefix = "mcp__claude_ai_Gmail__";
const roots: string[] = [];
const channels: Channel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) channel.stop();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(value);
  return value;
}
test("settingsJson with connectorPrefix has a PostToolUse entry whose matcher is mcp__claude_ai_Gmail__.* and the post command, and with browser and connectorPrefix has the Chrome entry first and then this one, and with neither there is no PostToolUse", () => {
  const entry = {
    matcher: `${prefix}.*`,
    hooks: [{ type: "command", command: postCommand("/tmp/a"), timeout: HOOK_TIMEOUT_SECONDS }],
  };
  const only = JSON.parse(settingsJson("/tmp/a", { connectorPrefix: prefix }));
  expect(only.hooks.PostToolUse).toEqual([entry]);
  const both = JSON.parse(settingsJson("/tmp/a", { browser: true, connectorPrefix: prefix }));
  expect(both.hooks.PostToolUse).toEqual([{ ...entry, matcher: `${CHROME_PREFIX}.*` }, entry]);
  expect(JSON.parse(settingsJson("/tmp/a")).hooks.PostToolUse).toBeUndefined();
});
test("an invalid connector prefix throws The connector prefix is not valid.", () => {
  for (const value of ["", "mcp__a.b__", "mcp__x__.*", "other"])
    expect(() => settingsJson("/tmp/a", { connectorPrefix: value })).toThrow(
      "The connector prefix is not valid.",
    );
});
test("createControlDir with connectorPrefix writes that entry into settings.json", () => {
  const dir = createControlDir({ root: root(), id: "test", connectorPrefix: prefix });
  expect(readFileSync(dir.settings, "utf8")).toBe(settingsJson(dir.path, { connectorPrefix: prefix }));
});
test("a channel with both prefixes records the id of an allowed connector call, answers its post with the runner's line, and reports an oversized post of a connector id through onUnanswered with its short tool name", () => {
  vi.useFakeTimers();
  const dir = createControlDir({ root: root(), id: "test" });
  const onUnanswered = vi.fn();
  const channel = startChannel({
    dir,
    prefixes: [CHROME_PREFIX, prefix],
    decide: () => ({ allow: true, tool: "x" }),
    post: () => ({ text: "safe", line: postLine("safe") }),
    onUnanswered,
    pollMs: 5,
  });
  channels.push(channel);
  const request = (name: string, value: unknown) => {
    const tmp = join(dir.req, `.${name}`);
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, join(dir.req, `${name}.json`));
    vi.advanceTimersByTime(5);
  };
  request("aaaaaaaaaaaaaaaa", {
    hook_event_name: "PreToolUse",
    tool_use_id: "one",
    tool_name: `${prefix}search_threads`,
  });
  expect(channel.chromeIds.has("one")).toBe(true);
  request("bbbbbbbbbbbbbbbb", { hook_event_name: "PostToolUse", tool_use_id: "one" });
  expect(readFileSync(join(dir.res, "bbbbbbbbbbbbbbbb"), "utf8")).toBe(`${postLine("safe")}\n`);
  expect(channel.posted.get("one")).toBe("safe");
  request("cccccccccccccccc", {
    hook_event_name: "PreToolUse",
    tool_use_id: "two",
    tool_name: `${prefix}search_threads`,
  });
  request("dddddddddddddddd", {
    hook_event_name: "PostToolUse",
    tool_use_id: "two",
    padding: "x".repeat(2 * 1024 * 1024),
  });
  expect(onUnanswered).toHaveBeenCalledWith({ toolUseId: "two", tool: "search_threads" });
});
test("the tripwire passes a connector result that is the runner's answer or the fixed sentence and trips on any other text", () => {
  const result = (text: string): StreamEvent => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "id", content: text }] },
  });
  for (const text of ["safe", POST_TEXT.unchecked])
    expect(
      createTripwire(new Set(["id"]), { ids: new Set(["id"]), posted: new Map([["id", "safe"]]) }).check(
        result(text),
      ),
    ).toEqual({ tripped: false });
  expect(
    createTripwire(new Set(["id"]), { ids: new Set(["id"]), posted: new Map([["id", "safe"]]) }).check(
      result("other"),
    ),
  ).toEqual({ tripped: true, tool: "unknown" });
});
