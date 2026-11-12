import { expect, test } from "vitest";
import { CHROME_PREFIX } from "./browser.ts";
import { CONNECTOR_STOP } from "./connector.ts";
import { checkFirstEvent, type StreamEvent } from "./stream.ts";

const connector = {
  name: "claude.ai Gmail",
  label: "Gmail",
  prefix: "mcp__claude_ai_Gmail__",
  tools: ["search_threads", "delete_draft"],
};
const settings = { tools: ["Read", "Glob"], schema: false, sessionId: "s1", started: true, connector };
const connectorTools = connector.tools.map((tool) => connector.prefix + tool);
const init: StreamEvent = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  tools: ["Read", "Glob", ...connectorTools],
  mcp_servers: [{ name: connector.name, status: "connected", source: "dynamic" }],
  skills: [],
  slash_commands: [],
  permissionMode: "default",
};
const changed = { ok: false, why: CONNECTOR_STOP.changed };
const mismatch = { ok: false, why: "The tools do not match." };

test("exactly the declared connector tools with one connected server pass", () => {
  expect(checkFirstEvent(init, settings)).toEqual({ ok: true });
});

test("no server, two servers, a server with another name and a server that is not connected each fail with the connector-down sentence for Gmail", () => {
  for (const mcp_servers of [
    [],
    [
      { name: connector.name, status: "connected" },
      { name: "other", status: "connected" },
    ],
    [{ name: "other", status: "connected" }],
    [{ name: connector.name, status: "pending" }],
    undefined,
  ])
    expect(checkFirstEvent({ ...init, mcp_servers }, settings)).toEqual({
      ok: false,
      why: CONNECTOR_STOP.down("Gmail"),
    });
});

test("a missing declared tool, an extra connector tool and a connector tool of another connector each fail with The connector's tools changed since the last scan. Scan again on the Harnesses screen.", () => {
  for (const tools of [
    ["Read", "Glob", connectorTools[0]],
    ["Read", "Glob", ...connectorTools, `${connector.prefix}extra`],
    ["Read", "Glob", ...connectorTools, "mcp__another__tool"],
  ])
    expect(checkFirstEvent({ ...init, tools }, settings)).toEqual(changed);
});

test("duplicate tools fail", () => {
  for (const tools of [
    ["Read", "Glob", ...connectorTools, connectorTools[0]],
    ["Read", "Read", "Glob", ...connectorTools],
    ["Read", "Glob", ...connectorTools, 42],
  ])
    expect(checkFirstEvent({ ...init, tools }, settings).ok).toBe(false);
});

test("built-in tools must equal the policy's tools, with StructuredOutput only when a schema was asked for", () => {
  expect(checkFirstEvent({ ...init, tools: ["Read", "Bash", ...connectorTools] }, settings)).toEqual(
    mismatch,
  );
  expect(checkFirstEvent({ ...init, tools: ["Read", ...connectorTools] }, settings)).toEqual(mismatch);
  const event = { ...init, tools: ["Read", "Glob", ...connectorTools, "StructuredOutput"] };
  expect(checkFirstEvent(event, { ...settings, schema: true })).toEqual({ ok: true });
  expect(checkFirstEvent(init, { ...settings, schema: true })).toEqual(mismatch);
  expect(checkFirstEvent(event, settings)).toEqual(mismatch);
});

test("skills and slash_commands must be empty arrays, mcp_servers need not be", () => {
  expect(checkFirstEvent(init, settings)).toEqual({ ok: true });
  for (const change of [
    { skills: ["x"] },
    { slash_commands: ["x"] },
    { skills: undefined },
    { slash_commands: undefined },
  ])
    expect(checkFirstEvent({ ...init, ...change }, settings).ok).toBe(false);
});

test("a Chrome tool in a connector step fails as a built-in mismatch", () => {
  expect(
    checkFirstEvent(
      { ...init, tools: ["Read", "Glob", ...connectorTools, `${CHROME_PREFIX}navigate`] },
      settings,
    ),
  ).toEqual(mismatch);
});

test("connector and browser together fail", () => {
  expect(checkFirstEvent(init, { ...settings, browser: true })).toEqual(mismatch);
});

test("the session id, the start hook and permissionMode rules still apply", () => {
  expect(checkFirstEvent(init, { ...settings, started: false })).toEqual({
    ok: false,
    why: "The start hook did not run.",
  });
  expect(checkFirstEvent({ ...init, session_id: "other" }, settings)).toEqual({
    ok: false,
    why: "The session id does not match.",
  });
  expect(checkFirstEvent({ ...init, permissionMode: "acceptEdits" }, settings)).toEqual({
    ok: false,
    why: "The permission mode is not default.",
  });
});
