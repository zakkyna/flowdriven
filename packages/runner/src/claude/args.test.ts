import { expect, test, vi } from "vitest";
import { FAKE_HELP } from "../test-helpers/fake-claude-script.ts";
import { assertSafeArgs, buildClaudeArgs, REFUSED_FLAGS, REQUIRED_FLAGS } from "./args.ts";

const childSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: childSpawn,
}));

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
    "--no-chrome",
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
    "--no-chrome",
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

test("TC-j31-19 and TC-AGT-17 step models change only the model value", () => {
  const lists = ["opus-5.5", "sonnet-5.5", "haiku-5.5"].map((model) => buildClaudeArgs({ ...input, model }));
  const first = lists[0];
  if (!first) throw new Error("Missing model arguments.");
  const index = first.indexOf("--model") + 1;
  for (const args of lists) {
    expect(args.filter((arg) => arg === "--model")).toHaveLength(1);
    expect(args.filter((_, i) => i !== index)).toEqual(first.filter((_, i) => i !== index));
    expect(() => assertSafeArgs(args)).not.toThrow();
  }
});

test("TC-j31-24 and TC-AGT-18 reject invalid step models", () => {
  for (const model of [
    "x --yolo",
    "--model",
    "",
    "Opus",
    "-opus",
    "opus 5.5",
    "Opus-5.5",
    "opus;rm",
    "a".repeat(65),
  ])
    expect(() => buildClaudeArgs({ ...input, model })).toThrow("Refused model name.");
});

test("TC-SR4-01 literal bypass flags are refused in every form", () => {
  for (const flag of [
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--permission-mode",
    "--yolo",
    "--trust-all-tools",
  ])
    for (const suffix of [[flag], [`${flag}=bypassPermissions`], [flag, "bypassPermissions"]])
      expect(() => assertSafeArgs([...buildClaudeArgs(input), ...suffix])).toThrow(`Refused flag: ${flag}`);
});

test("TC-SR4-01 a bypass flag is rejected before spawning", async () => {
  childSpawn.mockClear();
  const { startChild } = await import("./child.ts");
  expect(() => startChild("unused", [...buildClaudeArgs(input), "--yolo"], { cwd: "/", env: {} })).toThrow(
    "Refused flag: --yolo",
  );
  expect(childSpawn).not.toHaveBeenCalled();
});

test("TC-SR4-02 step arguments retain their limits for every model", () => {
  for (const model of ["opus-5.5", "sonnet-5.5", "haiku-5.5"])
    for (const extra of [{}, { schema: { type: "object" } }, { chrome: true }, { addDirs: ["/a", "/b"] }]) {
      const args = buildClaudeArgs({ ...input, ...extra, model });
      for (const flag of [
        "--restricted",
        "--strict-mcp-config",
        "--mcp-config",
        "--tools",
        "--disable-slash-commands",
        "--permission-prompts",
        "--settings",
        "--no-session-persistence",
        "--model",
      ])
        expect(args).toContain(flag);
      expect(args[args.indexOf("--permission-prompts") + 1]).toBe("none");
      expect(args[args.indexOf("--model") + 1]).toBe(model);
      expect(args).not.toContain("--allowedTools");
      expect(args).not.toContain("--input-format");
    }
});

test("TC-AGT-17 and TC-AGT-18 chat model changes only the model value and rejects bad models", async () => {
  const { buildClaudeChatArgs } = await import("./args.ts");
  const schema = { type: "object" };
  const a = buildClaudeChatArgs({ model: "sonnet-5.5", schema });
  const b = buildClaudeChatArgs({ model: "opus-5.5", schema });
  const i = a.indexOf("--model") + 1;
  expect(a.filter((_, n) => n !== i)).toEqual(b.filter((_, n) => n !== i));
  expect(a[i]).toBe("sonnet-5.5");
  expect(b[i]).toBe("opus-5.5");
  expect(a[a.indexOf("--tools") + 1]).toBe("");
  expect(a[a.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
  expect(a).toContain("--strict-mcp-config");
  expect(a).not.toContain("--add-dir");
  expect(a).not.toContain("--chrome");
  for (const model of ["-opus", "opus 5.5", "Opus-5.5", "opus;rm", "a".repeat(65), ""])
    expect(() => buildClaudeChatArgs({ model, schema })).toThrow("Refused model name.");
});

test("TC-AGT-41 worker settings keep hooks and scoped config while chat keeps memory", async () => {
  const { workerSettings, buildClaudeChatArgs } = await import("./args.ts");
  const settings = { hooks: { PreToolUse: [{ matcher: "*" }] }, permissions: { deny: ["Bash"] } };
  expect(workerSettings(settings, { settings: { autoMemoryEnabled: false } })).toEqual({
    ...settings,
    autoMemoryEnabled: false,
  });
  const chat = buildClaudeChatArgs({ model: "sonnet-5.5", schema: {} });
  expect(chat.join(" ")).not.toContain("autoMemoryEnabled");
});

test("TC-AGT-42 memory gap is recorded without removing hooks", async () => {
  const { workerSettings, claudeMemoryGap } = await import("./args.ts");
  const settings = { hooks: { PreToolUse: [{ matcher: "*" }] }, permissions: { deny: ["Bash"] } };
  expect(workerSettings(settings, undefined)).toEqual(settings);
  expect(claudeMemoryGap(undefined)).toBe("memory_on");
  expect(claudeMemoryGap({ settings: { autoMemoryEnabled: false }, gap: "own_instruction_files" })).toBe(
    "own_instruction_files",
  );
});

test("TC-AGT-42 agent capability reports the profile's remaining memory", async () => {
  const { createAgentRegistry } = await import("../agents/registry.ts");
  const { AGENT_CATALOG } = await import("../agents/catalog.ts");
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const entry = AGENT_CATALOG.find((item) => item.id === "claude-code");
  if (!entry) throw new Error("Missing Claude catalog entry.");
  const store = await openSqliteStore(":memory:");
  try {
    for (const [memoryOff, gap] of [
      [entry.memoryOff, "own_instruction_files"],
      [undefined, "memory_on"],
    ] as const) {
      const registry = createAgentRegistry({
        store,
        env: {},
        cwd: "/",
        now: () => new Date(0),
        catalog: [{ ...entry, memoryOff }],
        claudePath: "/missing",
      });
      expect((await registry.list())[0]?.capability).toEqual({
        tier: "enforced",
        accountTools: true,
        memoryGap: gap,
      });
      registry.stop();
    }
  } finally {
    store.close();
  }
});
