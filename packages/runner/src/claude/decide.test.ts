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
import { buildPolicy } from "./policy.ts";

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
      outcome: "run",
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
    outcome: "run",
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

test("TC-j24-15 exact standing rule runs", () => {
  const connector = {
    requirementId: "timesheet",
    label: "Timesheet",
    name: "timesheet",
    url: "https://example.test",
    id: "test",
    prefix: "mcp__timesheet__",
    tools: ["log_entry"],
    read: [],
    write: ["log_entry"],
    risky: {},
    blocked: [],
  };
  const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
  const p = {
    ...policy,
    connector,
    effectCatalog: [
      {
        tool: "mcp__timesheet__log_entry",
        effect: "change" as const,
        place: { kind: "account" as const, value: "timesheet-account" },
      },
    ],
    flowId: "example.fill-timesheet",
    touches: [
      {
        touchId: "log-hours",
        effect: "change" as const,
        matcher: "exact" as const,
        place,
        fixedPlace: true,
        list: "on_its_own" as const,
        covers: ["timesheet.log_entry"],
      },
    ],
  };
  const rule = {
    id: "rule",
    flowId: p.flowId,
    touchId: "log-hours",
    effect: "change" as const,
    place,
    state: "active" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
    createdBy: "confirm" as const,
    sentence: "Log hours",
    uses: 0,
  };
  const invoke = decide as (...args: unknown[]) => unknown;
  expect(
    invoke(
      p,
      call("mcp__timesheet__log_entry", { hours: 8 }),
      undefined,
      { calls: 0, granted: () => false },
      { rules: [rule] },
    ),
  ).toMatchObject({ outcome: "run", effect: "change", by: "rule", ruleId: "rule" });
});
test("TC-SR1-01 classifies a declared read", () => {
  expect(decide({ ...policy, touches: [] }, call("Read", { file_path: join(notes, "a") }))).toMatchObject({
    outcome: "run",
    effect: "read",
    by: "read",
  });
});
test("TC-SR1-02 refuses an undeclared tool", () => {
  expect(decide({ ...policy, touches: [] }, call("WebFetch"))).toMatchObject({
    outcome: "refuse",
    reason: "This step does not declare the tool WebFetch.",
  });
});
test("TC-SR1-03 holds an unknown declared tool as change", () => {
  const p = {
    ...policy,
    tools: [...policy.tools, "mcp__other_server__get_cleanup_status"],
    touches: [
      {
        touchId: "unknown",
        effect: "change" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: ["other_server.get_cleanup_status"],
      },
    ],
  };
  expect(decide(p, call("mcp__other_server__get_cleanup_status", { id: "x1" }))).toMatchObject({
    outcome: "hold",
    effect: "change",
    held: { fixedPlace: false },
  });
});

test("TC-SR1-01 covers all effect classes and held digests", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  for (const effect of ["change", "send", "post", "pay", "delete", "merge"] as const) {
    const name = `test.${effect}`;
    const input = { id: "x1" };
    const p = {
      ...policy,
      tools: [name],
      flowId: "flow",
      effectCatalog: [{ tool: name, effect, place: undefined }],
      touches: [
        {
          touchId: effect,
          effect,
          matcher: "exact" as const,
          fixedPlace: false,
          list: "asks_first" as const,
          covers: [name],
        },
      ],
    };
    const result = decide(p, call(name, input));
    expect(result).toMatchObject({
      outcome: "hold",
      effect,
      held: {
        tool: name,
        input,
        digest: digestCall(name, input),
        fixedPlace: false,
        ...(effect === "change" ? {} : { action: effect }),
      },
    });
    if (!result.allow && result.held && effect === "change") expect(result.held.action).toBeUndefined();
  }
  const write = {
    ...policy,
    touches: [
      {
        touchId: "write",
        effect: "local_write" as const,
        matcher: "folder" as const,
        place: { kind: "folder" as const, value: notes, label: "Notes" },
        fixedPlace: true,
        list: "on_its_own" as const,
        covers: [],
      },
    ],
  };
  expect(decide(write, call("Write", { file_path: join(notes, "app.apk"), content: "x" }))).toMatchObject({
    outcome: "run",
    effect: "local_write",
    by: "declared_write",
  });
  const command = {
    ...policy,
    tools: ["Bash"],
    commands: { patterns: ["flutter build apk"] },
    touches: [
      {
        touchId: "build",
        effect: "run_command" as const,
        matcher: "command" as const,
        fixedPlace: false,
        list: "on_its_own" as const,
        covers: ["flutter build apk"],
      },
    ],
  };
  expect(decide(command, call("Bash", { command: "flutter build apk" }))).toMatchObject({
    outcome: "run",
    effect: "run_command",
    by: "declared_command",
  });
});

test("TC-SR1-02 every undeclared tool is refused without a held call", () => {
  const p = { ...policy, tools: [], touches: [] };
  for (const name of [
    "mcp__claude_ai_Gmail__get_thread",
    "mcp__claude_ai_Gmail__forward",
    "WebFetch",
    "Bash",
    "Read",
    "mcp__other_server__anything",
  ]) {
    const result = decide(p, call(name, { file_path: "/etc/hosts", command: "ls" }));
    expect(result).toMatchObject({
      outcome: "refuse",
      reason: `This step does not declare the tool ${name}.`,
    });
    if (!result.allow) expect(result.held).toBeUndefined();
  }
});

test("TC-j24-15 rule near misses, revoked rules, and risky rules hold", () => {
  const name = "timesheet.log_entry";
  const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
  const touch = {
    touchId: "log-hours",
    effect: "change" as const,
    matcher: "exact" as const,
    place,
    fixedPlace: true,
    list: "on_its_own" as const,
    covers: [name],
  };
  const rule = {
    id: "rule",
    flowId: "example.fill-timesheet",
    touchId: touch.touchId,
    effect: "change" as const,
    place,
    state: "active" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
    createdBy: "confirm" as const,
    sentence: "Log hours",
    uses: 0,
  };
  const p = {
    ...policy,
    tools: [name],
    flowId: rule.flowId,
    effectCatalog: [
      { tool: name, effect: "change" as const, place: { kind: "account" as const, value: place.value } },
    ],
    touches: [touch],
    rules: [rule],
  };
  expect(decide(p, call(name, { hours: 8 }))).toMatchObject({ outcome: "run", by: "rule", ruleId: rule.id });
  for (const mismatch of [
    { ...p, flowId: "example.weekly-supplier-report" },
    { ...p, rules: [{ ...rule, state: "revoked" as const }] },
    {
      ...p,
      effectCatalog: [
        {
          tool: name,
          effect: "change" as const,
          place: { kind: "account" as const, value: "timesheet-other" },
        },
      ],
    },
    { ...p, earlierNo: true },
    { ...p, source: "tool" },
  ])
    expect(decide(mismatch, call(name, { hours: 8 }))).toMatchObject({ outcome: "hold", effect: "change" });
  expect(decide({ ...p, touches: [] }, call(name, {}))).toMatchObject({ outcome: "refuse" });
  const send = {
    ...p,
    effectCatalog: [{ tool: name, effect: "send" as const, place: undefined }],
    touches: [{ ...touch, effect: "send" as const }],
    rules: [{ ...rule, effect: "send" }],
  };
  expect(decide(send, call(name, {}))).toMatchObject({
    outcome: "hold",
    effect: "send",
    held: { action: "send" },
  });
});

test("TC-SR1-03 a supplied catalog can classify a declared unknown server tool as read", () => {
  const name = "mcp__other_server__send_note";
  const cover = "other_server.send_note";
  const touch = {
    touchId: "unknown",
    effect: "change" as const,
    matcher: "exact" as const,
    fixedPlace: false,
    list: "asks_first" as const,
    covers: [cover],
  };
  const p = { ...policy, tools: [name], touches: [touch] };
  expect(decide(p, call(name, { id: "x1", readOnlyHint: true }))).toMatchObject({
    outcome: "hold",
    effect: "change",
    held: { fixedPlace: false },
  });
  expect(
    decide(
      { ...p, effectCatalog: [{ tool: name, effect: "read" as const, place: undefined }] },
      call(name, { id: "x1", readOnlyHint: true }),
    ),
  ).toMatchObject({ outcome: "run", effect: "read" });
});

test("TC-SR1-03 compiled unknown server identities ignore scan hints", () => {
  const toolNames = ["get_cleanup_status", "send_note"];
  const requirements = [
    {
      id: "other_server",
      type: "mcp_server" as const,
      required: true,
      sensitive: false,
      why: "",
      tools: toolNames,
    },
  ];
  const touches = toolNames.map((tool) => ({
    id: tool.replaceAll("_", "-"),
    sentence: "Check",
    effect: "change" as const,
    rule: "asks_first" as const,
    covers: [`other_server.${tool}`],
  }));
  const input = {
    kind: "worker" as const,
    project,
    controlRoot: join(root, "control"),
    controlCwd: join(root, "control", "cwd"),
    sessionId: "s1",
    schema: false,
    flowId: "flow",
    requirements,
    touches,
  };
  const p = buildPolicy(input);
  for (const name of toolNames) {
    const tool = `mcp__other_server__${name}`;
    expect(decide(p, call(tool, { id: "x1", readOnlyHint: true }))).toMatchObject({
      outcome: "hold",
      effect: "change",
      held: { fixedPlace: false },
    });
  }
  const read = buildPolicy({
    ...input,
    effectCatalog: [{ tool: "other_server.send_note", effect: "read", place: undefined }],
  });
  expect(decide(read, call("mcp__other_server__send_note", { id: "x1" }))).toMatchObject({
    outcome: "run",
    effect: "read",
  });
});

test("TC-SR1-01 declared Gmail read runs by read", () => {
  const name = "mcp__claude_ai_Gmail__search_threads";
  const p = {
    ...policy,
    flowId: "mail",
    connector: {
      requirementId: "gmail",
      label: "Gmail",
      name: "gmail",
      url: "https://example.test",
      id: "fake",
      prefix: "mcp__claude_ai_Gmail__",
      tools: ["search_threads"],
      read: ["search_threads"],
      risky: {},
      blocked: [],
    },
    touches: [
      {
        touchId: "read-mail",
        effect: "read" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "on_its_own" as const,
        covers: ["gmail.search_threads"],
      },
    ],
  };
  expect(
    decide(p, call(name, { query: "is:unread" }), undefined, { calls: 0, granted: () => false }),
  ).toMatchObject({ outcome: "run", effect: "read", by: "read" });
});

test("TC-SR1-39 an outside-text step cannot compile commands", () => {
  const input = {
    kind: "worker" as const,
    project,
    controlRoot: join(root, "control"),
    controlCwd: join(root, "control", "cwd"),
    sessionId: "s1",
    schema: false,
    takesOutside: true,
    requirements: [
      {
        id: "cli",
        type: "cli_tool" as const,
        required: true,
        sensitive: false,
        why: "",
        commands: ["flutter build apk"],
      },
    ],
  };
  expect(() => buildPolicy(input)).toThrow(
    "A step that reads outside text cannot run commands. Run them in a step of their own.",
  );
});

test("TC-SR1-03 a catalog entry keyed by the full server identity is enforced by compilation", () => {
  const requirement = {
    id: "other_server",
    type: "mcp_server" as const,
    required: true,
    sensitive: false,
    why: "",
    tools: ["send_note"],
  };
  const touch = {
    id: "send-note",
    sentence: "Send note",
    effect: "change" as const,
    rule: "asks_first" as const,
    covers: ["other_server.send_note"],
  };
  expect(() =>
    buildPolicy({
      kind: "worker",
      project,
      controlRoot: join(root, "control"),
      controlCwd: join(root, "control", "cwd"),
      sessionId: "s1",
      schema: false,
      requirements: [requirement],
      touches: [touch],
      effectCatalog: [{ tool: "mcp__other_server__send_note", effect: "send", place: undefined }],
    }),
  ).toThrow("Invalid touch coverage: other_server.send_note");
});

test("TC-j24-15 reads a standing rule book per call and checks its returned row", () => {
  const name = "timesheet.log_entry";
  const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
  const touch = {
    touchId: "log-hours",
    effect: "change" as const,
    matcher: "exact" as const,
    place,
    fixedPlace: true,
    list: "on_its_own" as const,
    covers: [name],
  };
  const rule = {
    id: "rule",
    flowId: "flow",
    touchId: touch.touchId,
    effect: "change" as const,
    place,
    state: "active" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
    createdBy: "confirm" as const,
    sentence: "Log hours",
    uses: 0,
  };
  const p = {
    ...policy,
    runId: "run",
    tools: [name],
    flowId: "flow",
    effectCatalog: [
      { tool: name, effect: "change" as const, place: { kind: "account" as const, value: place.value } },
    ],
    touches: [touch],
  };
  let current = { ...rule, state: "active" as "active" | "revoked" };
  const calls: unknown[][] = [];
  const rules = {
    match: (...args: unknown[]) => {
      calls.push(args);
      return current;
    },
  };
  const invoke = decide as (...args: unknown[]) => unknown;
  expect(invoke(p, call(name, { hours: 8 }), undefined, undefined, { rules })).toMatchObject({
    outcome: "run",
    by: "rule",
    ruleId: "rule",
  });
  expect(calls).toEqual([["run", "flow", "log-hours", "change", place]]);
  current = { ...rule, state: "revoked" as const };
  expect(invoke(p, call(name, { hours: 8 }), undefined, undefined, { rules })).toMatchObject({
    outcome: "hold",
  });
});

test("TC-SR1-01 sample actions hold with their catalog effects and exact digests", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const rows = [
    ["timesheet.log_entry", "change", { day: "2026-11-20", hours: 8 }],
    ["social.post", "post", { text: "Build ready" }],
    ["payments.pay", "pay", { amount: 10 }],
    ["git.merge", "merge", { branch: "main" }],
  ] as const;
  for (const [tool, effect, input] of rows) {
    const p = {
      ...policy,
      tools: [tool],
      effectCatalog: [{ tool, effect, place: undefined }],
      touches: [
        {
          touchId: "action",
          effect,
          matcher: "exact" as const,
          fixedPlace: false,
          list: "asks_first" as const,
          covers: [tool],
        },
      ],
    };
    expect(decide(p, call(tool, input))).toMatchObject({
      outcome: "hold",
      effect,
      held: {
        tool,
        input,
        digest: digestCall(tool, input),
        ...(effect === "change" ? {} : { action: effect }),
      },
    });
  }
  const prefix = "mcp__claude_ai_Gmail__";
  const connector = {
    requirementId: "gmail",
    label: "Gmail",
    name: "gmail",
    url: "https://example.test",
    id: "fake",
    prefix,
    tools: ["reply", "trash_thread"],
    read: [],
    risky: { reply: "send" as const, trash_thread: "delete" as const },
    blocked: [],
  };
  for (const [name, effect, input] of [
    ["reply", "send", { threadId: "thread-sam", body: "Thanks." }],
    ["trash_thread", "delete", { id: "thread-sam" }],
  ] as const) {
    const tool = prefix + name;
    const p = {
      ...policy,
      connector,
      touches: [
        {
          touchId: effect,
          effect,
          matcher: "exact" as const,
          fixedPlace: false,
          list: "asks_first" as const,
          covers: [`gmail.${name}`],
        },
      ],
    };
    expect(decide(p, call(tool, input), undefined, { calls: 0, granted: () => false })).toMatchObject({
      outcome: "hold",
      effect,
      held: { tool, input, digest: digestCall(tool, input), action: effect },
    });
  }
});

test("TC-j24-15 Gmail send stays held even with a matching risky rule", () => {
  const prefix = "mcp__claude_ai_Gmail__";
  const name = `${prefix}send_message`;
  const place = { kind: "account" as const, value: "gmail", label: "Gmail" };
  const connector = {
    requirementId: "gmail",
    label: "Gmail",
    name: "gmail",
    url: "https://example.test",
    id: "fake",
    prefix,
    tools: ["send_message"],
    read: [],
    risky: { send_message: "send" as const },
    blocked: [],
  };
  const touch = {
    touchId: "send",
    effect: "send" as const,
    matcher: "exact" as const,
    fixedPlace: true,
    list: "on_its_own" as const,
    covers: ["gmail.send_message"],
    place,
  };
  const rule = {
    id: "unsafe",
    flowId: "flow",
    touchId: "send",
    effect: "send",
    place,
    state: "active" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
    createdBy: "confirm" as const,
    sentence: "Send",
    uses: 0,
  };
  const p = {
    ...policy,
    connector,
    flowId: "flow",
    effectCatalog: [
      { tool: name, effect: "send" as const, place: { kind: "account" as const, value: "gmail" } },
    ],
    touches: [touch],
    rules: [rule],
  };
  expect(
    decide(p, call(name, { to: "me@example.test", body: "Hello" }), undefined, {
      calls: 0,
      granted: () => false,
    }),
  ).toMatchObject({ outcome: "hold", effect: "send", held: { action: "send" } });
});

test("TC-SR1-07 an exact unused grant runs once", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const name = "test.send";
  const input = { body: "Thanks" };
  const grant = {
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22T00:00:00.000Z",
  };
  const p = {
    ...policy,
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tools: [name],
    effectCatalog: [{ tool: name, effect: "send" as const, place: undefined }],
    touches: [
      {
        touchId: "reply",
        effect: "send" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: [name],
      },
    ],
  };
  const grants = {
    findGrant: (key: typeof grant) =>
      ["runId", "stepId", "itemKey", "tool", "digest"].every(
        (k) => key[k as keyof typeof key] === grant[k as keyof typeof grant],
      )
        ? grant
        : undefined,
  };
  const invoke = decide as (...args: unknown[]) => unknown;
  expect(invoke(p, call(name, input), undefined, undefined, { grants })).toMatchObject({
    outcome: "run",
    by: "grant",
  });
});

function grantCase() {
  const name = "test.send";
  const input = { threadId: "thread-sam", body: "Thanks, I will send the invoice on Monday." };
  const p = {
    ...policy,
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tools: [name],
    effectCatalog: [{ tool: name, effect: "send" as const, place: undefined }],
    touches: [
      {
        touchId: "reply",
        effect: "send" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: [name],
      },
    ],
  };
  return { name, input, p };
}
test("TC-j24-05 grant identity and a used grant hold", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const { name, input, p } = grantCase();
  const grant = {
    runId: p.runId,
    stepId: p.stepId,
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  let used = false;
  const grants = {
    findGrant: (key: typeof grant) =>
      !used &&
      ["runId", "stepId", "itemKey", "tool", "digest"].every(
        (k) => key[k as keyof typeof key] === grant[k as keyof typeof grant],
      )
        ? grant
        : undefined,
  };
  const invoke = (p1: typeof p, value: typeof input) =>
    decide(p1, call(name, value), undefined, undefined, { grants });
  expect(invoke(p, input)).toMatchObject({ outcome: "run", by: "grant" });
  used = true;
  expect(invoke(p, input)).toMatchObject({
    outcome: "hold",
    held: { tool: name, input, digest: grant.digest, action: "send" },
  });
});
test("TC-j24-48 a granted call runs in the decision table", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const { name, input, p } = grantCase();
  const grant = {
    runId: p.runId,
    stepId: p.stepId,
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  expect(
    decide(p, call(name, input), undefined, undefined, { grants: { findGrant: () => grant } }),
  ).toMatchObject({ outcome: "run", by: "grant" });
});
test("TC-SR1-06 declaration is checked before a grant", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const { name, input, p } = grantCase();
  const grant = {
    runId: p.runId,
    stepId: p.stepId,
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  let lookups = 0;
  const grants = {
    findGrant: () => {
      lookups++;
      return grant;
    },
  };
  expect(
    decide({ ...p, tools: [], touches: [] }, call(name, input), undefined, undefined, { grants }),
  ).toMatchObject({ outcome: "refuse" });
  expect(lookups).toBe(0);
  expect(decide(p, call(name, input), undefined, undefined, { grants })).toMatchObject({
    outcome: "run",
    by: "grant",
  });
});
test("TC-SR1-08 a canonical exact input matches after near misses", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const { name, input, p } = grantCase();
  const grant = {
    runId: p.runId,
    stepId: p.stepId,
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  const grants = {
    findGrant: (key: typeof grant) =>
      ["runId", "stepId", "itemKey", "tool", "digest"].every(
        (k) => key[k as keyof typeof key] === grant[k as keyof typeof grant],
      )
        ? grant
        : undefined,
  };
  for (const changed of [
    { ...input, body: `${input.body}!` },
    { ...input, body: `${input.body} ` },
    { ...input, cc: "x@example.test" },
    { ...input, body: input.body + String.fromCodePoint(0x202e) },
  ])
    expect(decide(p, call(name, changed), undefined, undefined, { grants })).toMatchObject({
      outcome: "hold",
    });
  expect(
    decide(p, call(name, { body: input.body, threadId: input.threadId }), undefined, undefined, { grants }),
  ).toMatchObject({ outcome: "run", by: "grant" });
});
test("TC-SR1-21 a grant also runs from tool and phone sources", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const { name, input, p } = grantCase();
  const grant = {
    runId: p.runId,
    stepId: p.stepId,
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  for (const source of [
    "chat",
    "flows",
    "again",
    "schedule",
    "after",
    "try_next",
    "proactive",
    "tool",
    "phone",
  ])
    expect(
      decide({ ...p, source }, call(name, input), undefined, undefined, {
        grants: { findGrant: () => grant },
      }),
    ).toMatchObject({ outcome: "run", by: "grant" });
});

test("TC-SR1-08 and TC-j24-05 near misses retain the exact held call", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const name = "mcp__claude_ai_Gmail__reply";
  const forward = "mcp__claude_ai_Gmail__forward";
  const input = { threadId: "thread-sam", body: "Thanks, I will send the invoice on Monday." };
  const grant = {
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  const p = {
    ...policy,
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tools: [name, forward],
    declaredTools: [
      { tool: name, cover: "gmail.reply" },
      { tool: forward, cover: "gmail.forward" },
    ],
    touches: [
      {
        touchId: "reply",
        effect: "send" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: ["gmail.reply"],
      },
      {
        touchId: "forward",
        effect: "send" as const,
        matcher: "exact" as const,
        fixedPlace: false,
        list: "asks_first" as const,
        covers: ["gmail.forward"],
      },
    ],
  };
  let usedAt: string | undefined;
  let present = true;
  const grants = {
    findGrant: (key: typeof grant) =>
      present &&
      !usedAt &&
      ["runId", "stepId", "itemKey", "tool", "digest"].every(
        (field) => key[field as keyof typeof key] === grant[field as keyof typeof grant],
      )
        ? grant
        : undefined,
  };
  const invoke = (context: typeof p, tool: string, value: Record<string, unknown>) =>
    decide(context, call(tool, value), undefined, undefined, { grants });
  expect(invoke(p, name, input)).toMatchObject({ outcome: "run", by: "grant" });
  usedAt = "2026-11-22T00:00:00.000Z";
  expect(invoke(p, name, input)).toMatchObject({
    outcome: "hold",
    held: { tool: name, input, digest: grant.digest, action: "send" },
  });
  usedAt = undefined;
  for (const [context, tool, value] of [
    [p, name, { ...input, body: `${input.body}!` }],
    [p, name, { ...input, body: `${input.body} ` }],
    [p, name, { ...input, cc: "x@example.test" }],
    [p, forward, input],
    [{ ...p, stepId: "other" }, name, input],
    [{ ...p, runId: "run-2" }, name, input],
    [p, name, { ...input, body: input.body + String.fromCodePoint(0x202e) }],
  ] as const) {
    expect(invoke(context, tool, value)).toMatchObject({
      outcome: "hold",
      held: { tool, input: value, digest: digestCall(tool, value), action: "send" },
    });
  }
  present = false;
  expect(invoke(p, name, input)).toMatchObject({ outcome: "hold" }); // rejected or expired: no grant row
  present = true;
  expect(invoke(p, name, { body: input.body, threadId: input.threadId })).toMatchObject({
    outcome: "run",
    by: "grant",
  });
});

test("TC-SR1-21 rule sources hold while exact grants take precedence", async () => {
  const { digestCall } = await import("../connectors/grants.ts");
  const name = "timesheet.log_entry";
  const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
  const touch = {
    touchId: "log-hours",
    effect: "change" as const,
    matcher: "exact" as const,
    place,
    fixedPlace: true,
    list: "on_its_own" as const,
    covers: [name],
  };
  const rule = {
    id: "rule-1",
    flowId: "flow",
    touchId: touch.touchId,
    effect: "change" as const,
    place,
    state: "active" as const,
    createdAt: "2026-11-22",
    createdBy: "confirm" as const,
    sentence: "Log hours",
    uses: 0,
  };
  const input = { hours: 3 };
  const grant = {
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    tool: name,
    digest: digestCall(name, input),
    kind: "approve" as const,
    createdAt: "2026-11-22",
  };
  const p = {
    ...policy,
    tools: [name],
    runId: "run-1",
    stepId: "reply",
    itemKey: "",
    flowId: "flow",
    touches: [touch],
    rules: [rule],
    effectCatalog: [
      { tool: name, effect: "change" as const, place: { kind: "account" as const, value: place.value } },
    ],
  };
  const grants = { findGrant: (key: typeof grant) => (key.digest === grant.digest ? grant : undefined) };
  for (const source of [
    "chat",
    "flows",
    "again",
    "schedule",
    "after",
    "try_next",
    "proactive",
    "tool",
    "phone",
  ]) {
    const withSource = { ...p, source };
    expect(decide(withSource, call(name, { hours: 2 }), undefined, undefined, { grants })).toMatchObject(
      source === "tool" || source === "phone"
        ? { outcome: "hold", held: { input: { hours: 2 }, place } }
        : { outcome: "run", by: "rule", ruleId: "rule-1" },
    );
    expect(decide(withSource, call(name, input), undefined, undefined, { grants })).toMatchObject({
      outcome: "run",
      by: "grant",
    });
  }
});
