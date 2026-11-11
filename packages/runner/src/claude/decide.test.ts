import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DENY, decide } from "./decide.ts";
import type { Policy } from "./policy.ts";

let root: string;
let project: string;
let notes: string;
let outside: string;
let policy: Policy;
const call = (tool_name: string, tool_input: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  tool_name,
  tool_input,
  tool_use_id: "t1",
});
const reason = (value: unknown, p = policy) => {
  const result = decide(p, value);
  expect(result.allow).toBe(false);
  return result.allow ? "" : result.reason;
};
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  project = join(root, "project dir");
  notes = join(project, "notes");
  outside = join(root, "outside");
  mkdirSync(notes, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "secret"), "secret");
  symlinkSync("../../outside", join(notes, "link"));
  symlinkSync("../../outside/missing", join(notes, "dangling"));
  policy = {
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    folders: [{ path: notes, write: true }],
    cwd: notes,
    addDirs: [],
    schema: false,
    sessionId: "s1",
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("declared calls inside the folder are allowed", () => {
  for (const [tool, input, target] of [
    ["Read", { file_path: join(notes, "a.txt") }, join(notes, "a.txt")],
    ["Write", { file_path: join(notes, "new/deep/b.txt") }, join(notes, "new/deep/b.txt")],
    ["Glob", {}, undefined],
    ["Grep", { path: notes, glob: "*.md" }, notes],
    ["Read", { file_path: notes }, notes],
  ] as const) {
    expect(decide(policy, call(tool, input))).toEqual({
      allow: true,
      tool,
      ...(target === undefined ? {} : { target }),
    });
  }
});
test("a malformed request is denied with the recognised-call sentence", () => {
  expect(DENY).toEqual({
    badRequest: "This request is not a tool call FlowDriven recognises.",
    otherSession: "This request belongs to another session.",
    noSchema: "This step did not ask for structured output.",
    noPath: "This call has no file path.",
    pathNotText: "This call has a path that is not text.",
    notAbsolute: "This path is not absolute.",
    badPath: "This path is not allowed.",
    outside: "This path is outside the folders this step declares.",
    readOnly: "This step may only read this folder.",
    pattern: "This pattern leaves the folder.",
    protectedPath: "This path is protected.",
  });
  expect(reason(call("Unknown"), { ...policy, tools: ["Unknown"] })).toBe(DENY.badRequest);
  for (const value of [
    null,
    [],
    "x",
    { ...call("Read"), hook_event_name: undefined },
    { ...call("Read"), hook_event_name: "PostToolUse" },
    { ...call("Read"), tool_name: 5 },
    { ...call("Read"), tool_use_id: 5 },
    { ...call("Read"), tool_input: undefined },
    { ...call("Read"), tool_input: [] },
  ])
    expect(reason(value)).toBe(DENY.badRequest);
});
test("a request of another session is denied", () => {
  for (const session_id of ["s2", undefined])
    expect(reason({ ...call("Read"), session_id })).toBe(DENY.otherSession);
});
test("StructuredOutput is allowed only when the attempt passed a schema", () => {
  expect(reason(call("StructuredOutput"))).toBe(DENY.noSchema);
  expect(decide({ ...policy, schema: true }, call("StructuredOutput"))).toEqual({
    allow: true,
    tool: "StructuredOutput",
  });
});
test("a tool the step does not declare is denied by name", () => {
  for (const [name, display] of [
    ["Bash", "Bash"],
    ["WebFetch", "WebFetch"],
    ["NotebookEdit", "NotebookEdit"],
    ["mcp__x__y", "mcp__x__y"],
    ["read", "read"],
    ["Read ", "Read "],
    [`Re${String.fromCodePoint(0x202e)}ad`, "Re<U+202E>ad"],
  ] as const)
    expect(reason(call(name))).toBe(`This step does not declare the tool ${display}.`);
  expect(reason(call("Read"), { ...policy, tools: [] })).toBe("This step does not declare the tool Read.");
});
test("file_path variants", () => {
  for (const path of ["a.txt", "~/a.txt"])
    expect(reason(call("Read", { file_path: path }))).toBe(DENY.notAbsolute);
  for (const input of [{ file_path: 5 }, {}, { file_path: "" }])
    expect(reason(call("Read", input))).toBe(DENY.noPath);
  expect(reason(call("Read", { file_path: "/etc/hosts" }))).toBe(DENY.outside);
  for (const path of [
    notes + "/../outside/secret",
    notes + "/link/../x",
    notes + "/a" + String.fromCodePoint(0),
  ])
    expect(reason(call("Read", { file_path: path }))).toBe(DENY.badPath);
});
test("links out and a dangling link are denied", () => {
  expect(reason(call("Read", { file_path: join(notes, "link/secret") }))).toBe(DENY.outside);
  expect(reason(call("Write", { file_path: join(notes, "dangling") }))).toBe(DENY.badPath);
  expect(reason(call("Write", { file_path: join(notes, "link/new.txt") }))).toBe(DENY.outside);
  symlinkSync(notes, join(notes, "inner"));
  expect(decide(policy, call("Read", { file_path: join(notes, "inner/a") })).allow).toBe(true);
});
test("a sibling that shares the prefix is outside", () => {
  for (const path of [notes + "2/x", join(project, "notes-other/x")])
    expect(reason(call("Read", { file_path: path }))).toBe(DENY.outside);
});
test("a path that differs only in case", () => {
  const upper = join(dirname(project), basename(project).toUpperCase(), "notes");
  const result = decide(policy, call("Read", { file_path: join(upper, "a.txt") }));
  expect(result.allow).toBe(existsSync(upper));
  if (!result.allow) expect(result.reason).toBe(DENY.outside);
  if (existsSync(upper))
    expect(reason(call("Read", { file_path: join(upper, "link/secret") }))).toBe(DENY.outside);
});
test("a read-only folder refuses Write and Edit", () => {
  const readonly = { ...policy, folders: [{ path: notes, write: false }] };
  for (const tool of ["Write", "Edit"])
    expect(reason(call(tool, { file_path: join(notes, "a") }), readonly)).toBe(DENY.readOnly);
  expect(decide(readonly, call("Read", { file_path: join(notes, "a") })).allow).toBe(true);
  expect(
    reason(call("Write", { file_path: join(notes, "a") }), {
      ...readonly,
      folders: [...readonly.folders, { path: outside, write: true }],
    }),
  ).toBe(DENY.readOnly);
});
test("Glob and Grep: a path outside, a path that is not text and patterns that leave the folder", () => {
  for (const [tool, key] of [
    ["Glob", "pattern"],
    ["Grep", "glob"],
  ] as const) {
    expect(reason(call(tool, { path: outside }))).toBe(DENY.outside);
    expect(reason(call(tool, { path: 5 }))).toBe(DENY.pathNotText);
    for (const pattern of [
      "/etc/*",
      "~/*",
      "../*",
      "a/../../*",
      "{/etc/hosts,note.txt}",
      "{~/x,y}",
      "a..b",
      "[/]etc/*",
      "@(/etc/hosts)",
      "!(a)",
      "a[b/c]d",
      5,
      "{a,b}/*.txt",
    ])
      expect(reason(call(tool, { [key]: pattern }))).toBe(DENY.pattern);
    for (const pattern of ["*.md", "**/*.txt", "*.[ch]", "[a-z]*.md"])
      expect(decide(policy, call(tool, { [key]: pattern })).allow).toBe(true);
  }
  expect(decide(policy, call("Grep", { pattern: "/etc/*" })).allow).toBe(true);
});
test("protected paths and the audit fields", () => {
  const hidden = String.fromCodePoint(0x200b);
  const invisible = String.fromCodePoint(0x3164);
  for (const tool of ["Write", "Edit"])
    for (const path of [
      ".git/config",
      "sub/.claude/settings.json",
      ".mcp.json",
      ".CLAUDE/settings.json",
      ".Git/hooks/x",
      ".MCP.JSON",
      `.cl${hidden}aude/x`,
      `.git${invisible}/x`,
      ".claude /x",
      `.mcp.j${String.fromCodePoint(0x17f)}on`,
      `.g${String.fromCodePoint(0x131)}t`,
      `.${String.fromCodePoint(0xff43)}laude`,
    ])
      expect(reason(call(tool, { file_path: notes + "/" + path }))).toBe(DENY.protectedPath);
  expect(decide(policy, call("Read", { file_path: join(notes, ".git/config") })).allow).toBe(true);
  for (const path of ["gitnotes.txt", ".github/x"])
    expect(decide(policy, call("Write", { file_path: join(notes, path) })).allow).toBe(true);
  for (const path of [join(notes, "a"), join(outside, "a")])
    expect(
      JSON.stringify(decide(policy, call("Write", { file_path: path, content: "SECRET-TEXT" }))),
    ).not.toContain("SECRET-TEXT");
  expect(decide(policy, call("Write", { file_path: notes + "/" + "x".repeat(400) })).target).toHaveLength(
    300,
  );
});
