import { expect, test } from "vitest";
import { CHROME_PREFIX } from "./browser.ts";
import { checkFirstEvent, type StreamEvent } from "./stream.ts";

const settings = { tools: ["Read", "Glob"], schema: false, sessionId: "s1", started: true, browser: true };
const chromeTool = `${CHROME_PREFIX}navigate`;
const init: StreamEvent = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  tools: ["Glob", "Read", chromeTool, `${CHROME_PREFIX}get_page_text`],
  mcp_servers: [{ name: "claude-in-chrome", status: "connected" }],
  skills: [],
  slash_commands: [],
  permissionMode: "default",
};

test("the start proof with a browser: one connected claude-in-chrome server, the expected built-in tools and the Chrome tools pass", () => {
  expect(checkFirstEvent(init, settings)).toEqual({ ok: true });
});

test("it fails with Chrome is not connected to Claude Code. for no server, a server that is not connected, a second server and a server of another name", () => {
  for (const mcp_servers of [
    [],
    [{ name: "claude-in-chrome", status: "disconnected" }],
    [
      { name: "claude-in-chrome", status: "connected" },
      { name: "other", status: "connected" },
    ],
    [{ name: "other", status: "connected" }],
    undefined,
  ]) {
    expect(checkFirstEvent({ ...init, mcp_servers }, settings)).toEqual({
      ok: false,
      why: "Chrome is not connected to Claude Code.",
    });
  }
});

test("it fails for an unexpected built-in tool (Bash), a missing built-in tool, a duplicate, no Chrome tool at all, and a non-string tool", () => {
  for (const tools of [
    ["Read", "Glob", chromeTool, "Bash"],
    ["Read", chromeTool],
    ["Read", "Glob", chromeTool, chromeTool],
    ["Read", "Read", "Glob", chromeTool],
    ["Read", "Glob"],
    ["Read", "Glob", chromeTool, 42],
  ])
    expect(checkFirstEvent({ ...init, tools }, settings).ok).toBe(false);
});

test("with a schema the built-in set includes StructuredOutput, and without a schema StructuredOutput is refused", () => {
  const event = { ...init, tools: ["Read", "Glob", chromeTool, "StructuredOutput"] };
  expect(checkFirstEvent(event, { ...settings, schema: true })).toEqual({ ok: true });
  expect(checkFirstEvent(init, { ...settings, schema: true }).ok).toBe(false);
  expect(checkFirstEvent(event, settings).ok).toBe(false);
});

test("skills, slash commands and a permission mode other than default still fail", () => {
  for (const change of [{ skills: ["x"] }, { slash_commands: ["x"] }, { permissionMode: "acceptEdits" }])
    expect(checkFirstEvent({ ...init, ...change }, settings).ok).toBe(false);
});

test("without a browser the proof is as strict as before: any MCP server fails, and the present tests of stream.test.ts pass unchanged", () => {
  const noBrowser = { tools: settings.tools, schema: false, sessionId: "s1", started: true };
  const event = { ...init, tools: ["Read", "Glob"] };
  expect(checkFirstEvent({ ...event, mcp_servers: [] }, noBrowser)).toEqual({ ok: true });
  expect(checkFirstEvent(event, noBrowser).ok).toBe(false);
  expect(
    checkFirstEvent({ ...event, mcp_servers: [], tools: ["Read", "Glob", chromeTool] }, noBrowser).ok,
  ).toBe(false);
});
