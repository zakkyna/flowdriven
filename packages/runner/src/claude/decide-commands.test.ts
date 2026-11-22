import { expect, test } from "vitest";
import { COMMAND_DENY, decideCommand } from "./commands.ts";
import { decide } from "./decide.ts";
import type { Policy } from "./policy.ts";

const commands = { patterns: ["git status", "ls *"] };
const policy: Policy = {
  tools: ["Bash"],
  folders: [],
  cwd: "/tmp",
  addDirs: [],
  schema: false,
  sessionId: "s",
  commands,
};
const call = (command: string) => ({
  hook_event_name: "PreToolUse",
  session_id: "s",
  tool_name: "Bash",
  tool_use_id: "1",
  tool_input: { command, description: "test" },
});
test("an exact declared command line is allowed", () => {
  expect(decide(policy, call("git status"))).toMatchObject({ allow: true });
  expect(
    decideCommand(commands, {
      command: "ls file",
      description: "list",
      timeout: 600000,
      run_in_background: false,
      dangerouslyDisableSandbox: false,
    }),
  ).toEqual({ allow: true });
});
test("a line with an extra word, or a command the step does not declare, is refused with This step does not declare this command.", () => {
  for (const command of ["git status extra", "git log", "ls --output=/x", "ls ../x"])
    expect(decide(policy, call(command))).toMatchObject({ allow: false, reason: COMMAND_DENY.notDeclared });
});
test("each shell character, a quote, a tab, a newline and a path as the program is refused", () => {
  for (const char of [
    ";",
    "&",
    "|",
    "$",
    "`",
    ">",
    "<",
    "(",
    ")",
    "'",
    '"',
    "\\",
    "*",
    "?",
    "#",
    "~",
    "!",
    "{",
    "}",
    "[",
    "]",
    String.fromCodePoint(9),
    String.fromCodePoint(10),
  ])
    expect(decide(policy, call(`ls ${char}`)).allow).toBe(false);
  for (const command of ["/usr/bin/git status", "./git status"])
    expect(decide(policy, call(command)).allow).toBe(false);
});
test("run_in_background true and dangerouslyDisableSandbox true are refused, and an unknown key is refused", () => {
  for (const extra of [
    { run_in_background: true },
    { dangerouslyDisableSandbox: true },
    { other: false },
    { timeout: 0 },
    { timeout: 600001 },
    { timeout: 1.5 },
    { description: "x".repeat(501) },
    { description: 1 },
    { command: 1 },
  ])
    expect(decideCommand(commands, { command: "git status", ...extra }).allow).toBe(false);
});

test("TC-SR1-39 declared and undeclared commands have distinct outcomes", () => {
  const build = { ...policy, commands: { patterns: ["flutter build apk"] } };
  expect(decide(build, call("flutter build apk"))).toMatchObject({ outcome: "run" });
  for (const command of [
    "flutter build apk; rm -rf /",
    "flutter build apk && curl https://evil.example.test",
    "flutter build appbundle",
    'sh -c "flutter build apk"',
    "git push origin main",
  ])
    expect(decide(build, call(command))).toMatchObject({ outcome: "refuse" });
  expect(decide({ ...build, commands: { patterns: ["dart *"] } }, call("dart run evil.dart"))).toMatchObject({
    outcome: "refuse",
  });
  expect(
    decide(build, {
      ...call("flutter build apk"),
      tool_input: { command: "flutter build apk", run_in_background: true },
    }),
  ).toMatchObject({ outcome: "refuse" });
  expect(decide({ ...build, tools: [], commands: undefined }, call("flutter build apk"))).toMatchObject({
    outcome: "refuse",
  });
});
