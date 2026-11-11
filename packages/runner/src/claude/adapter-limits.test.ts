import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement, type Value } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { StepRequest } from "../harness.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { type ClaudeAdapterOptions, createClaudeAdapter } from "./adapter.ts";
import * as childModule from "./child.ts";
import { MAX_DENIED_ENTRIES } from "./run.ts";
import { LIMITS_NOT_APPLIED } from "./stream.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(play: FakePlay, extra: Partial<ClaudeAdapterOptions> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({ plays: [play] });
  roots.push(home);
  const project = join(root, "proj dir"),
    notes = join(project, "notes"),
    controlRoot = join(root, "app data", "control");
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "note.txt"), "KIWI");
  const audits: { kind: string; runId: string; detail: Value }[] = [];
  let n = 0,
    session = 0;
  const options: ClaudeAdapterOptions = {
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({
      HOME: home,
      PATH: process.env.PATH,
      USER: "u",
      TMPDIR: "/tmp",
      LANG: "C",
      LOGNAME: "x",
      SHELL: "/bin/zsh",
      ANTHROPIC_API_KEY: "k",
      CLAUDE_CONFIG_DIR: "/c",
    }),
    controlRoot,
    audit: (kind, runId, detail) => audits.push({ kind, runId, detail }),
    newId: () => `cc-${++n}`,
    newSessionId: () => `session-${++session}`,
    rounds: 20,
    ...extra,
  };
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Read note.txt",
    uses: ["notes"],
    project,
    requirements: [Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read" })],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return { root, home, notes, project, controlRoot, audits, request, adapter: createClaudeAdapter(options) };
}
const play = (actions: FakeAction[]): FakePlay => ({ when: "", actions });
const tool = (id: string, path: string): FakeAction => ({
  do: "tool",
  id,
  name: "Read",
  input: { file_path: path },
});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await sleep(10);
  }
  throw Error("Timed out waiting for fake");
}
async function gone(pid: number) {
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
}
function pids(home: string) {
  return readFakeCalls(home)
    .filter((c) => c.kind === "call")
    .map((c) => c.pid);
}
function pid(home: string) {
  const p = pids(home).at(-1);
  if (p === undefined) throw Error("Missing pid");
  return p;
}
const write = (path: string): FakeAction => ({
  do: "tool",
  id: "t1",
  name: "Write",
  input: { file_path: path, content: "SECRET-TEXT" },
  write: { path, text: "SECRET-TEXT" },
});

test("a denied call is audited with its tool, reason and target and never with its content", {
  timeout: 20_000,
}, async () => {
  const originalStart = childModule.startChild;
  let stream = "";
  vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
    const child = originalStart(...args);
    child.stdout.on("data", (chunk: Buffer) => {
      stream += chunk.toString();
    });
    return child;
  });
  const t = setup(play([]));
  const path = join(t.notes, "x.txt");
  writeFakeScript(t.home, { plays: [play([write(path), { do: "result" }])] });
  expect((await t.adapter.runStep(t.request)).exit).toBe("ok");
  expect(existsSync(path)).toBe(false);
  const events: unknown[] = stream
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "user",
      message: {
        content: [expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true })],
      },
    }),
  );
  expect(readFakeCalls(t.home)).toContainEqual({
    kind: "tool",
    id: "t1",
    name: "Write",
    hookExit: 2,
    ran: false,
  });
  expect(t.audits).toEqual([
    {
      kind: "tool_denied",
      runId: "r1",
      detail: {
        stepId: "s",
        itemKey: "",
        attempt: 1,
        tool: "Write",
        reason: "This step may only read this folder.",
        target: path,
      },
    },
    {
      kind: "tool_calls",
      runId: "r1",
      detail: { stepId: "s", itemKey: "", attempt: 1, allowed: 0, denied: 1 },
    },
  ]);
  expect(JSON.stringify(t.audits)).not.toContain("SECRET-TEXT");
});
test("a read outside the folders is blocked, the counts add up, and the audit keeps at most maxDeniedEntries denials", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([]), { maxDeniedEntries: 2 });
  writeFakeScript(t.home, {
    plays: [
      play([
        tool("a", join(t.notes, "note.txt")),
        tool("b", "/etc/hosts"),
        tool("c", "/etc/hosts"),
        tool("d", "/etc/hosts"),
        { do: "result" },
      ]),
    ],
  });
  await t.adapter.runStep(t.request);
  expect(MAX_DENIED_ENTRIES).toBe(50);
  const denied = t.audits.filter((a) => a.kind === "tool_denied");
  expect(denied).toHaveLength(2);
  expect(denied.at(0)?.detail).toMatchObject({
    reason: "This path is outside the folders this step declares.",
  });
  expect(t.audits.at(-1)?.detail).toMatchObject({ allowed: 1, denied: 3 });
});
test("the channel stops answering in the middle of a step: the next call is blocked and nothing is written (R12, channel)", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([]), { pollMs: 3_600_000, rounds: 3 });
  const path = join(t.notes, "out.txt");
  t.request.requirements = [
    Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read_write" }),
  ];
  writeFakeScript(t.home, { plays: [play([write(path), { do: "result" }])] });
  await t.adapter.runStep(t.request);
  expect(readFakeCalls(t.home)).toContainEqual({
    kind: "tool",
    id: "t1",
    name: "Write",
    hookExit: 2,
    ran: false,
  });
  expect(existsSync(path)).toBe(false);
  expect(t.audits.filter((a) => a.kind === "tool_denied")).toHaveLength(0);
});
test("a removed control folder blocks the next call (R12, folder)", { timeout: 20_000 }, async () => {
  const t = setup(play([]), { rounds: 3 });
  const path = join(t.notes, "out.txt");
  writeFakeScript(t.home, { plays: [play([{ do: "pause", ms: 2500 }, write(path), { do: "result" }])] });
  const pending = t.adapter.runStep(t.request);
  await until(() => readFakeCalls(t.home).some((c) => c.kind === "init"));
  await sleep(500);
  rmSync(join(t.controlRoot, "cc-1"), { recursive: true, force: true });
  await pending;
  expect(readFakeCalls(t.home)).toContainEqual({
    kind: "tool",
    id: "t1",
    name: "Write",
    hookExit: 2,
    ran: false,
  });
  expect(existsSync(path)).toBe(false);
});
test("the start proof fails when the SessionStart hook did not run", { timeout: 20_000 }, async () => {
  const t = setup({ when: "", startHook: false, actions: [] });
  const path = join(t.notes, "out.txt");
  writeFakeScript(t.home, {
    plays: [
      {
        when: "",
        startHook: false,
        actions: [
          { do: "pause", ms: 1500 },
          { do: "ungated", id: "u", name: "Write", write: { path, text: "x" } },
        ],
      },
    ],
  });
  const result = await t.adapter.runStep(t.request);
  expect(result).toMatchObject({ exit: "failed", block: LIMITS_NOT_APPLIED });
  expect(t.audits).toContainEqual({
    kind: "limits_not_applied",
    runId: "r1",
    detail: { stepId: "s", itemKey: "", attempt: 1, why: "the start hook did not run" },
  });
  await gone(pid(t.home));
  expect(existsSync(path)).toBe(false);
});
test("the start proof fails for an init that lists a tool, a server, another mode, or no init at all", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([]));
  for (const init of [
    { tools: ["Read", "Glob", "Grep", "Bash"] },
    { mcp_servers: [{ name: "x" }] },
    { permissionMode: "acceptEdits" },
    false,
  ] as const) {
    writeFakeScript(t.home, {
      plays: [
        {
          when: "",
          init,
          actions: [
            { do: "text", text: "x" },
            { do: "pause", ms: 1500 },
          ],
        },
      ],
    });
    expect(await t.adapter.runStep(t.request)).toMatchObject({ block: LIMITS_NOT_APPLIED });
    await gone(pid(t.home));
  }
});
test("the tripwire stops a tool that ran without the check", { timeout: 20_000 }, async () => {
  const t = setup(play([]));
  const a = join(t.notes, "a"),
    b = join(t.notes, "b");
  writeFakeScript(t.home, {
    plays: [
      play([
        { do: "ungated", id: "a", name: "Write", write: { path: a, text: "a" } },
        { do: "pause", ms: 1500 },
        { do: "ungated", id: "b", name: "Write", write: { path: b, text: "b" } },
      ]),
    ],
  });
  expect(await t.adapter.runStep(t.request)).toMatchObject({
    block: "A tool ran without FlowDriven's check (Write). The step was stopped.",
  });
  expect(t.audits).toContainEqual({
    kind: "tool_unchecked",
    runId: "r1",
    detail: { stepId: "s", itemKey: "", attempt: 1, tool: "Write" },
  });
  expect(existsSync(b)).toBe(false);
  await gone(pid(t.home));
});
test("a reused tool_use_id is denied the second time", { timeout: 20_000 }, async () => {
  const t = setup(play([]));
  const path = join(t.notes, "note.txt");
  writeFakeScript(t.home, { plays: [play([tool("t1", path), tool("t1", path), { do: "result" }])] });
  await t.adapter.runStep(t.request);
  expect(
    readFakeCalls(t.home)
      .filter((c) => c.kind === "tool")
      .at(1),
  ).toMatchObject({ ran: false });
  expect(t.audits.filter((a) => a.kind === "tool_denied")).toHaveLength(1);
  expect(t.audits.find((a) => a.kind === "tool_denied")?.detail).toMatchObject({
    reason: "This tool call was already seen.",
  });
});
test("a stream that ends in a cut line has no result", { timeout: 20_000 }, async () => {
  const t = setup(play([{ do: "raw", line: '{"type":"result","subtype":"succ', newline: false }]));
  expect(await t.adapter.runStep(t.request)).toMatchObject({
    exit: "failed",
    text: "Claude Code ended without a result.",
  });
});
test("an over-long line kills the child, and a child that does not exit after its result is killed", {
  timeout: 20_000,
}, async () => {
  const t = setup(
    play([
      { do: "raw", line: "x".repeat(5000) },
      { do: "pause", ms: 30000 },
    ]),
    { maxLineBytes: 1000, exitWaitMs: 300 },
  );
  expect(await t.adapter.runStep(t.request)).toMatchObject({
    text: "Claude Code sent a line that was too long.",
  });
  await gone(pid(t.home));
  writeFakeScript(t.home, {
    plays: [
      play([
        {
          do: "raw",
          line: JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok" }),
        },
        { do: "pause", ms: 30000 },
      ]),
    ],
  });
  expect(await t.adapter.runStep(t.request)).toMatchObject({
    text: "Claude Code did not exit after its result.",
  });
  await gone(pid(t.home));
});
test("a child that ignores SIGTERM is killed after the grace when the step is aborted, and stop() ends every running step", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([{ do: "ignore_sigterm" }, { do: "pause", ms: 30000 }]), { graceMs: 200 });
  const controller = new AbortController();
  const pending = t.adapter.runStep({ ...t.request, signal: controller.signal });
  await sleep(300);
  controller.abort();
  expect(await Promise.race([pending, sleep(3000).then(() => "timeout")])).toMatchObject({
    text: "The step was aborted.",
  });
  await gone(pid(t.home));
  expect(readdirSync(t.controlRoot)).toEqual([]);
  const p1 = t.adapter.runStep(t.request),
    p2 = t.adapter.runStep({ ...t.request, runId: "r2" });
  await until(() => pids(t.home).length === 3);
  const before = pids(t.home);
  await t.adapter.stop?.();
  expect(await Promise.all([p1, p2])).toMatchObject([{ exit: "interrupted" }, { exit: "interrupted" }]);
  for (const p of before) await gone(p);
  expect(readdirSync(t.controlRoot)).toEqual([]);
  expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "interrupted" });
  expect(pids(t.home)).toEqual(before);
});
test("two steps at the same time use their own folders, sessions and decisions", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([]));
  const second = join(t.root, "second project"),
    notes2 = join(second, "notes");
  mkdirSync(notes2, { recursive: true });
  writeFileSync(join(notes2, "note.txt"), "x");
  writeFakeScript(t.home, {
    plays: [
      { when: "first", actions: [tool("a", join(t.notes, "note.txt")), { do: "result" }] },
      {
        when: "second",
        actions: [
          tool("b", join(notes2, "note.txt")),
          tool("c", join(t.notes, "note.txt")),
          { do: "result" },
        ],
      },
    ],
  });
  const result = await Promise.all([
    t.adapter.runStep({ ...t.request, instructions: "first" }),
    t.adapter.runStep({ ...t.request, runId: "r2", project: second, instructions: "second" }),
  ]);
  expect(result.map((r) => r.exit)).toEqual(["ok", "ok"]);
  const calls = readFakeCalls(t.home).filter((c) => c.kind === "call");
  expect(new Set(calls.map((c) => c.args.at(c.args.indexOf("--settings") + 1))).size).toBe(2);
  expect(new Set(calls.map((c) => c.args.at(c.args.indexOf("--session-id") + 1))).size).toBe(2);
  expect(readFakeCalls(t.home).filter((c) => c.kind === "tool")).toEqual(
    expect.arrayContaining([
      { kind: "tool", id: "a", name: "Read", hookExit: 0, ran: true },
      { kind: "tool", id: "b", name: "Read", hookExit: 0, ran: true },
      { kind: "tool", id: "c", name: "Read", hookExit: 2, ran: false },
    ]),
  );
  expect(t.audits.find((a) => a.runId === "r2" && a.kind === "tool_denied")?.detail).toMatchObject({
    reason: "This path is outside the folders this step declares.",
  });
});

test("the start proof passes over the start hook's own events", { timeout: 20_000 }, async () => {
  const originalStart = childModule.startChild;
  let output = "";
  vi.spyOn(childModule, "startChild").mockImplementation((...args) => {
    const child = originalStart(...args);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    return child;
  });
  const t = setup(play([]));
  writeFakeScript(t.home, { plays: [play([tool("read", join(t.notes, "note.txt")), { do: "result" }])] });
  expect((await t.adapter.runStep(t.request)).exit).toBe("ok");
  expect(
    output
      .trim()
      .split("\n")
      .slice(0, 2)
      .map((line) => (JSON.parse(line) as { subtype: string }).subtype),
  ).toEqual(["hook_started", "hook_response"]);
  expect(t.audits.some((audit) => audit.kind === "limits_not_applied")).toBe(false);
  expect(t.audits.find((audit) => audit.kind === "tool_calls")?.detail).toMatchObject({ allowed: 1 });
});

test("a failed start hook, and more than eight start hook events, fail the proof", {
  timeout: 20_000,
}, async () => {
  const t = setup(play([]));
  for (const [change, why] of [
    [{ startExitCode: 2 }, "The start hook failed."],
    [{ startEvents: 5 }, "Too many events before init."],
  ] as const) {
    writeFakeScript(t.home, { plays: [{ when: "", ...change, actions: [{ do: "pause", ms: 1500 }] }] });
    expect(await t.adapter.runStep(t.request)).toMatchObject({ exit: "failed", block: LIMITS_NOT_APPLIED });
    expect(t.audits).toContainEqual({
      kind: "limits_not_applied",
      runId: "r1",
      detail: { stepId: "s", itemKey: "", attempt: 1, why },
    });
    await gone(pid(t.home));
  }
  writeFakeScript(t.home, { plays: [{ when: "", startEvents: 4, actions: [{ do: "result" }] }] });
  expect((await t.adapter.runStep(t.request)).exit).toBe("ok");
});
