import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakeScript,
  makeFakeHome,
  readFakeCalls,
} from "./fake-claude-script.ts";

const name = "claude.ai Gmail";
const url = "https://mail.example.test/mcp";
const id = `mcpsrv_${"a".repeat(24)}`;
const prefix = "mcp__claude_ai_Gmail__";
const connector = { url, id, tools: [{ name: "search_threads", readOnly: true }, { name: "delete_draft" }] };
const homes: string[] = [];
function home(extra: Record<string, unknown> = {}) {
  const h = makeFakeHome({ connectors: { [name]: connector }, ...extra } as FakeScript);
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const request = (subtype: string, request_id = subtype) =>
  JSON.stringify({ type: "control_request", request_id, request: { subtype } }) + "\n";
function control(h: string, args: string[], input: string) {
  const r = spawnSync(FAKE_CLAUDE_PATH, ["-p", "--input-format", "stream-json", ...args], {
    cwd: h,
    env: { HOME: h, PATH: process.env.PATH },
    input,
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}
const config = (entry: object = { type: "claudeai-proxy", url, id }) =>
  JSON.stringify({ mcpServers: { [name]: entry } });
const allow = `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'`;
const replace = `printf '%s' '{"hookSpecificOutput":{"updatedMCPToolOutput":[{"type":"text","text":"replaced"}]}}'`;
function play(
  h: string,
  cfg: string,
  actions: FakeAction[] = [],
  posts: { matcher: string; command: string }[] = [],
  pre = allow,
  chrome = false,
  status: "connected" | "needs-auth" = "connected",
) {
  writeFileSync(
    join(h, "fake-claude.json"),
    JSON.stringify({ connectors: { [name]: { ...connector, status } }, plays: [{ when: "", actions }] }),
  );
  const settings = join(h, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ command: "true" }] }],
        PreToolUse: [{ hooks: [{ command: pre }] }],
        PostToolUse: posts.map((p) => ({ matcher: p.matcher, hooks: [{ command: p.command }] })),
      },
    }),
  );
  const r = spawnSync(
    FAKE_CLAUDE_PATH,
    ["-p", "--settings", settings, "--mcp-config", cfg, ...(chrome ? ["--chrome"] : [])],
    { cwd: h, env: { HOME: h, PATH: process.env.PATH }, input: "x", encoding: "utf8" },
  );
  expect(r.status, r.stderr).toBe(0);
  return r.stdout
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
}
const tool = (name: string, blocks?: unknown[]): FakeAction =>
  ({
    do: "tool",
    id: name,
    name,
    input: {},
    result: "original",
    ...(blocks ? { blocks } : {}),
  }) as FakeAction;

test("mcp_status answers the scripted connector with name, scope claudeai, config, status and its tools with annotations (readOnly true or an empty object)", () => {
  const h = home();
  expect(control(h, [], request("mcp_status"))[0]).toEqual({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "mcp_status",
      response: {
        mcpServers: [
          {
            name,
            status: "connected",
            scope: "claudeai",
            config: { type: "claudeai-proxy", url, id },
            tools: [
              { name: "search_threads", annotations: { readOnly: true } },
              { name: "delete_draft", annotations: {} },
            ],
          },
        ],
      },
    },
  });
});
test("mcp_status answers no server when --restricted or --strict-mcp-config is among the arguments", () => {
  for (const flag of ["--restricted", "--strict-mcp-config"])
    expect(control(home(), [flag], request("mcp_status"))[0].response.response.mcpServers).toEqual([]);
});
test("connectorPending makes the first answers pending with no tools, and the next one connected", () => {
  const servers = control(
    home({ connectorPending: 2 }),
    [],
    request("mcp_status", "1") + request("mcp_status", "2") + request("mcp_status", "3"),
  ).map((r) => r.response.response.mcpServers[0]);
  expect(servers.map((s) => s.status)).toEqual(["pending", "pending", "connected"]);
  expect(servers[0]).not.toHaveProperty("tools");
  expect(servers[1]).not.toHaveProperty("tools");
  expect(servers[2].tools).toHaveLength(2);
});
test("initialize gets a success response, and the call log holds control lines and no prompt", () => {
  const h = home();
  expect(control(h, [], request("initialize") + request("mcp_status"))[0]).toEqual({
    type: "control_response",
    response: { subtype: "success", request_id: "initialize", response: {} },
  });
  expect(readFakeCalls(h)).toMatchObject([
    { kind: "call" },
    { kind: "control", subtype: "initialize", restricted: false },
    { kind: "control", subtype: "mcp_status", restricted: false },
  ]);
  expect(readFakeCalls(h)[0]).not.toHaveProperty("prompt");
});
test("a --mcp-config file gives an init event with the server and its tools minus the ones toolPermissions blocks, named mcp__claude_ai_Gmail__<tool>", () => {
  const h = home();
  const path = join(h, "mcp.json");
  writeFileSync(
    path,
    config({ type: "claudeai-proxy", url, id, toolPermissions: { delete_draft: "blocked" } }),
  );
  expect(play(h, path).find((e) => e.subtype === "init")).toMatchObject({
    mcp_servers: [{ name, status: "connected", source: "dynamic" }],
    tools: [prefix + "search_threads"],
  });
});
test("a --mcp-config JSON literal works the same as a file", () => {
  expect(play(home(), config()).find((e) => e.subtype === "init")).toMatchObject({
    mcp_servers: [{ name, status: "connected", source: "dynamic" }],
    tools: [prefix + "search_threads", prefix + "delete_draft"],
  });
});
test("an entry whose url or id does not match the scripted connector gives no server and no tool", () => {
  for (const entry of [
    { type: "claudeai-proxy", url: "wrong", id },
    { type: "claudeai-proxy", url, id: "wrong" },
  ])
    expect(play(home(), config(entry)).find((e) => e.subtype === "init")).toMatchObject({
      mcp_servers: [],
      tools: [],
    });
});
test("a needs-auth connector is listed with its status and no tools", () => {
  const h = home({ connectors: { [name]: { ...connector, status: "needs-auth" } } });
  expect(control(h, [], request("mcp_status"))[0].response.response.mcpServers).toEqual([
    { name, status: "needs-auth", scope: "claudeai", config: { type: "claudeai-proxy", url, id } },
  ]);
  expect(
    play(h, config(), [], [], allow, false, "needs-auth").find((e) => e.subtype === "init"),
  ).toMatchObject({ mcp_servers: [{ name, status: "needs-auth", source: "dynamic" }], tools: [] });
});
test("a scripted tool action on a connector tool runs the pre hook, hands the post hook its result as a string in tool_response (or as the blocks given), runs the PostToolUse entry whose matcher matches, logs a post line, and puts the replaced content in the tool result", () => {
  for (const blocks of [undefined, [{ type: "image", data: "fake" }]]) {
    const h = home();
    const captured = join(h, "post.json");
    const events = play(
      h,
      config(),
      [tool(prefix + "search_threads", blocks)],
      [
        { matcher: "other", command: "exit 1" },
        { matcher: `${prefix}.*`, command: `cat > '${captured}'; ${replace}` },
      ],
    );
    expect(JSON.parse(readFileSync(captured, "utf8"))).toMatchObject({
      tool_response: blocks ?? "original",
      mcp_server: { name, source: "dynamic" },
    });
    expect(readFakeCalls(h)).toContainEqual({
      kind: "tool",
      id: prefix + "search_threads",
      name: prefix + "search_threads",
      hookExit: 0,
      ran: true,
    });
    expect(readFakeCalls(h)).toContainEqual({
      kind: "post",
      id: prefix + "search_threads",
      name: prefix + "search_threads",
      hookExit: 0,
      replaced: true,
    });
    expect(events.find((e) => e.type === "user").message.content[0].content).toEqual([
      { type: "text", text: "replaced" },
    ]);
  }
});
test("a connector tool the pre hook refuses is not run and gets no post line", () => {
  const h = home();
  play(h, config(), [tool(prefix + "search_threads")], [{ matcher: ".*", command: replace }], "exit 2");
  expect(readFakeCalls(h)).toContainEqual(expect.objectContaining({ kind: "tool", ran: false }));
  expect(readFakeCalls(h).filter((c) => c.kind === "post")).toHaveLength(0);
});
test("with a Chrome entry and a connector entry in PostToolUse each tool gets its own entry", () => {
  const h = home();
  const events = play(
    h,
    config(),
    [tool(prefix + "search_threads"), tool("mcp__claude-in-chrome__tabs_context_mcp")],
    [
      { matcher: `${prefix}.*`, command: replace },
      { matcher: "mcp__claude-in-chrome__.*", command: replace },
    ],
    allow,
    true,
  );
  expect(readFakeCalls(h).filter((c) => c.kind === "post")).toHaveLength(2);
  expect(events.filter((e) => e.type === "user").map((e) => e.message.content[0].content)).toEqual([
    [{ type: "text", text: "replaced" }],
    [{ type: "text", text: "replaced" }],
  ]);
});
test("hang with status never answers mcp_status", { timeout: 20_000 }, async () => {
  const h = home({ hang: ["status"] });
  const child = spawn(FAKE_CLAUDE_PATH, ["-p", "--input-format", "stream-json"], {
    cwd: h,
    env: { HOME: h, PATH: process.env.PATH },
    stdio: "pipe",
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  child.stdin.write(request("mcp_status") + request("initialize"));
  const answer = await iterator.next();
  if (answer.done || answer.value === undefined) throw new Error("Missing response");
  expect(JSON.parse(answer.value).response.request_id).toBe("initialize");
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill();
  await closed;
  lines.close();
});
