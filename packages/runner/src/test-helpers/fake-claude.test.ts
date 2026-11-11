import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  type FakeScript,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "./fake-claude-script.ts";

const homes: string[] = [];
function home(script: FakeScript = {}) {
  const h = makeFakeHome(script);
  homes.push(h);
  return h;
}
function run(h: string, args: string[], input?: string) {
  return spawnSync(FAKE_CLAUDE_PATH, args, {
    cwd: h,
    env: { HOME: h, PATH: process.env.PATH },
    input,
    encoding: "utf8",
  });
}
function settings(h: string, start = "true", tool = "exit 2", timeout = 1) {
  const p = join(h, "settings.json");
  writeFileSync(
    p,
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ command: start }] }],
        PreToolUse: [{ hooks: [{ command: tool, timeout }] }],
      },
    }),
  );
  return p;
}
function events(output: string): Record<string, unknown>[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

test("the fake is executable, and the failure says how to fix it", () => {
  home();
  expect(
    () => accessSync(FAKE_CLAUDE_PATH, constants.X_OK),
    "run: chmod 755 packages/runner/src/test-helpers/fake-claude.ts",
  ).not.toThrow();
});
test("it answers --version, --help and auth status", () => {
  const h = home();
  expect(run(h, ["--version"]).stdout).toBe("2.1.318 (Claude Code)\n");
  expect(run(h, ["--help"]).stdout).toContain("--restricted");
  expect(run(h, ["--help"]).stdout).toContain("--permission-prompts");
  expect(JSON.parse(run(h, ["auth", "status", "--json"]).stdout).loggedIn).toBe(true);
  writeFakeScript(h, { auth: { loggedIn: false } });
  expect(run(h, ["auth", "status", "--json"]).stdout).toContain('"loggedIn":false');
});
test("it answers plugin list and mcp list, and a hang never ends until it is killed", {
  timeout: 20_000,
}, async () => {
  const h = home({ hang: ["mcp"] });
  expect(JSON.parse(run(h, ["plugin", "list", "--json"]).stdout)).toHaveLength(2);
  writeFakeScript(h, {});
  expect(run(h, ["mcp", "list"]).stdout.trimEnd().split("\n")).toHaveLength(3);
  writeFakeScript(h, { hang: ["mcp"] });
  const child = spawn(FAKE_CLAUDE_PATH, ["mcp", "list"], {
    env: { HOME: h, PATH: process.env.PATH },
    stdio: "pipe",
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(child.exitCode).toBeNull();
  const ended = new Promise((resolve) => child.once("close", resolve));
  child.kill();
  await ended;
});
test("a -p call logs its arguments, folder, environment names and prompt", () => {
  const h = home({ plays: [{ when: "", actions: [] }] });
  const args = ["-p", "--settings", settings(h)];
  run(h, args, "hello");
  expect(readFakeCalls(h).at(0)).toEqual({
    kind: "call",
    pid: expect.any(Number),
    args,
    cwd: realpathSync(h),
    env: ["HOME", "PATH"],
    prompt: "hello",
  });
});
test("the init event is built from its arguments", () => {
  const h = home({ plays: [{ when: "", init: { permissionMode: "other" }, actions: [] }] });
  const args = [
    "-p",
    "--settings",
    settings(h),
    "--tools",
    "Read,Glob",
    "--session-id",
    "abc",
    "--add-dir",
    "/x",
    "--disable-slash-commands",
    "--json-schema",
    "{}",
  ];
  expect(events(run(h, args, "x").stdout).at(0)).toMatchObject({
    type: "system",
    subtype: "init",
    tools: ["Read", "Glob", "StructuredOutput"],
    session_id: "abc",
    additional_directories: ["/x"],
    skills: [],
    slash_commands: [],
    mcp_servers: [],
    permissionMode: "other",
  });
  expect(readFakeCalls(h)).toContainEqual({ kind: "init" });
  const h2 = home({ plays: [{ when: "", init: false, actions: [] }] });
  expect(run(h2, ["-p", "--settings", settings(h2)], "x").stdout).toBe("");
  expect(readFakeCalls(h2)).not.toContainEqual({ kind: "init" });
});
test("it runs the SessionStart hook before the init event, and not when told not to", () => {
  const h = home({ plays: [{ when: "", actions: [] }] });
  run(h, ["-p", "--settings", settings(h, "touch started")], "x");
  expect(existsSync(join(h, "started"))).toBe(true);
  rmSync(join(h, "started"));
  writeFakeScript(h, { plays: [{ when: "", startHook: false, actions: [] }] });
  run(h, ["-p", "--settings", settings(h, "touch started")], "x");
  expect(existsSync(join(h, "started"))).toBe(false);
  writeFakeScript(h, { plays: [{ when: "", actions: [{ do: "tool", id: "1", name: "Read", input: {} }] }] });
  run(h, ["-p", "--settings", settings(h, "rm settings.json", "exit 2")], "x");
  expect(readFakeCalls(h)).toContainEqual({ kind: "tool", id: "1", name: "Read", hookExit: 2, ran: false });
});
test("a tool call follows the hook's outcome", { timeout: 20_000 }, () => {
  const allow = JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
  });
  const deny = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "No.",
    },
  });
  const cases: [string, boolean][] = [
    [`printf '%s' '${allow}'`, true],
    [`printf '%s' '${deny}'`, false],
    ["echo no >&2; exit 2", false],
    ["exit 1", true],
    ["exit 127", true],
    ["echo hello", true],
    ["sleep 5", true],
  ];
  for (const name of ["Read", "Write"])
    for (const [command, readRuns] of cases) {
      const h = home({
        plays: [
          {
            when: "",
            actions: [
              { do: "tool", id: "1", name, input: {}, write: { path: join("effect"), text: "yes" } },
              { do: "result" },
            ],
          },
        ],
      });
      const outcome = run(h, ["-p", "--settings", settings(h, "true", command)], "x");
      const ran = name === "Read" ? readRuns : command.includes(allow);
      expect(existsSync(join(h, "effect"))).toBe(ran);
      expect(readFakeCalls(h)).toContainEqual({
        kind: "tool",
        id: "1",
        name,
        hookExit: command === "sleep 5" ? null : expect.any(Number),
        ran,
      });
      const result = events(outcome.stdout).at(-1);
      expect(result?.permission_denials).toHaveLength(ran ? 0 : 1);
    }
});
test("an ungated tool runs without asking", () => {
  const h = home({
    plays: [
      {
        when: "",
        actions: [{ do: "ungated", id: "u", name: "Write", write: { path: "effect", text: "ok" } }],
      },
    ],
  });
  run(h, ["-p", "--settings", settings(h, "true", "touch marker")], "x");
  expect(existsSync(join(h, "effect"))).toBe(true);
  expect(existsSync(join(h, "marker"))).toBe(false);
});
test("auth_failure ends with exit 1, the event text and a result with is_error true", () => {
  const h = home({ plays: [{ when: "", actions: [{ do: "auth_failure" }] }] });
  const result = run(h, ["-p", "--settings", settings(h)], "x");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("Not logged in - Please run /login");
  expect(events(result.stdout).at(-1)).toMatchObject({ is_error: true, terminal_reason: "api_error" });
});
test("a play is chosen by the prompt; no match exits 3; exit and raw actions do what they say", () => {
  const h = home({
    plays: [
      {
        when: "one",
        init: false,
        actions: [
          { do: "raw", line: "raw", newline: false },
          { do: "exit", code: 7, stderr: "bad" },
        ],
      },
      { when: "two", init: false, actions: [{ do: "text", text: "second" }, { do: "result" }] },
    ],
  });
  const args = ["-p", "--settings", settings(h)];
  const one = run(h, args, "one");
  expect(one.stdout).toBe("raw");
  expect(one.status).toBe(7);
  expect(one.stderr).toBe("bad");
  expect(run(h, args, "two").stdout).toContain("second");
  const none = run(h, args, "unmatched");
  expect(none.status).toBe(3);
  expect(none.stderr).toContain("fake-claude: no play for this prompt");
});
