import { expect, test } from "vitest";
import { FAKE_HELP } from "../test-helpers/fake-claude-script.ts";
import { assertSafeArgs, buildClaudeArgs, REFUSED_FLAGS, REQUIRED_FLAGS } from "./args.ts";

const input = {
  model: "haiku" as const,
  sessionId: "11111111-1111-4111-8111-111111111111",
  tools: [],
  settingsPath: "/x y/settings.json",
  addDirs: [],
};
test("the argument list for a step with no tools and no schema", () => {
  expect(buildClaudeArgs(input)).toEqual([
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--session-id",
    input.sessionId,
    "--model",
    "haiku",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--tools",
    "",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
    "--settings",
    input.settingsPath,
  ]);
});
test("tools, further folders and a schema are added in order, and every long flag is one the help check covers", () => {
  const args = buildClaudeArgs({
    ...input,
    tools: ["Read", "Glob", "Grep"],
    addDirs: ["/a", "/b"],
    schema: { type: "object" },
  });
  expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
    "--tools",
    "Read,Glob,Grep",
  ]);
  expect(args.slice(-6)).toEqual([
    "--add-dir",
    "/a",
    "--add-dir",
    "/b",
    "--json-schema",
    '{"type":"object"}',
  ]);
  expect(REQUIRED_FLAGS).toEqual([
    "--output-format",
    "--verbose",
    "--no-session-persistence",
    "--session-id",
    "--model",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    "--tools",
    "--disable-slash-commands",
    "--permission-prompts",
    "--settings",
    "--add-dir",
    "--json-schema",
  ]);
  for (const flag of args.filter((arg) => arg.startsWith("--"))) expect(REQUIRED_FLAGS).toContain(flag);
  expect(FAKE_HELP.trim().split("\n")).toEqual(REQUIRED_FLAGS);
});
test("each of the five refused flags is refused bare, as a value and as --flag=value", () => {
  for (const flag of REFUSED_FLAGS)
    for (const args of [[flag], ["--settings", flag], [`${flag}=x`]])
      expect(() => assertSafeArgs(args)).toThrow(`Refused flag: ${flag}`);
  expect(() => assertSafeArgs(buildClaudeArgs(input))).not.toThrow();
});
test("model names are validated before use", () => {
  expect(() => buildClaudeArgs({ ...input, model: "--yolo" })).toThrow("Refused model name.");
  expect(buildClaudeArgs({ ...input, model: "claude-haiku-5-5" })).toContain("claude-haiku-5-5");
});
