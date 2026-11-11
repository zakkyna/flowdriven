import { expect, test } from "vitest";
import {
  checkFirstEvent,
  createTripwire,
  isAuthFailure,
  isRateLimited,
  LIMITS_NOT_APPLIED,
  LineReader,
  parseEvent,
  parseResult,
  type StreamEvent,
  startHookEvent,
  tripSentence,
} from "./stream.ts";

const settings = { tools: ["Read", "Glob"], schema: false, sessionId: "s1", started: true };
const init: StreamEvent = {
  type: "system",
  subtype: "init",
  session_id: "s1",
  tools: ["Glob", "Read"],
  mcp_servers: [],
  skills: [],
  slash_commands: [],
  permissionMode: "default",
};
const assistant = (id: string, name: string): StreamEvent => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name }] },
});
const result = (id: unknown, is_error = false): StreamEvent => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error }] },
});

test("the line reader splits chunks, keeps a multi-byte character cut across chunks whole and returns the cut tail from rest()", () => {
  const reader = new LineReader();
  expect(reader.push("a\nb").lines).toEqual(["a"]);
  expect(reader.push("\nc").lines).toEqual(["b"]);
  const snow = String.fromCodePoint(0x2603);
  for (const byte of Buffer.from(snow)) expect(reader.push(Uint8Array.of(byte)).lines).toEqual([]);
  expect(reader.push("\n").lines).toEqual([`c${snow}`]);
  expect(reader.rest()).toBe("");
  expect(reader.push("x").lines).toEqual([]);
  expect(reader.rest()).toBe("x");
});

test("a line over the limit reports overflow before it ends", () => {
  expect(new LineReader(1000).push(Buffer.alloc(1001, 97))).toEqual({ lines: [], overflow: true });
  expect(new LineReader(1000).push(`${"a".repeat(1000)}\n`)).toEqual({
    lines: ["a".repeat(1000)],
    overflow: false,
  });
});

test("many lines in one chunk, blank lines and CRLF", () => {
  const reader = new LineReader();
  expect(reader.push("one\n\ntwo\r\n").lines).toEqual(["one", "", "two\r"]);
  expect(parseEvent("")).toBeUndefined();
});

test("parseEvent refuses what is not an event", () => {
  for (const line of ["not json", "[]", '"x"', "{}", '{"type":5}']) expect(parseEvent(line)).toBeUndefined();
  expect(parseEvent('{"type":"result"}')).toEqual({ type: "result" });
});

test("the first event proof accepts exactly the limits that were asked for", () => {
  expect(checkFirstEvent(init, settings)).toEqual({ ok: true });
  expect(
    checkFirstEvent({ ...init, tools: ["StructuredOutput", "Read", "Glob"] }, { ...settings, schema: true }),
  ).toEqual({ ok: true });
});

test("the proof fails for each deviation", () => {
  const cases: [StreamEvent | undefined, typeof settings][] = [
    [init, { ...settings, started: false }],
    ...[
      ["Read", "Glob", "Bash"],
      ["Glob"],
      ["Read", "Read", "Glob"],
      "Read",
      ["Read", "Glob", "StructuredOutput"],
    ].map((tools): [StreamEvent, typeof settings] => [{ ...init, tools }, settings]),
    ...[
      { mcp_servers: [{}] },
      { skills: ["x"] },
      { slash_commands: ["x"] },
      { permissionMode: "acceptEdits" },
      { permissionMode: "bypassPermissions" },
      { permissionMode: undefined },
      { session_id: "other" },
      { type: "assistant" },
    ].map((change): [StreamEvent, typeof settings] => [{ ...init, ...change }, settings]),
    [undefined, settings],
    [init, { ...settings, schema: true }],
    [{ ...init, mcp_servers: undefined }, settings],
  ];
  for (const [event, expected] of cases) {
    const proof = checkFirstEvent(event, expected);
    expect(proof.ok).toBe(false);
    if (!proof.ok) expect(proof.why.length).toBeGreaterThan(0);
  }
});

test("the tripwire passes a result for an allowed id, ignores error results and other blocks", () => {
  const wire = createTripwire(new Set(["t1"]));
  expect(wire.check(assistant("t1", "Read"))).toEqual({ tripped: false });
  expect(wire.check(result("t1"))).toEqual({ tripped: false });
  expect(
    wire.check({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true }, { type: "text" }] },
    }),
  ).toEqual({ tripped: false });
});

test("the tripwire trips on a result for an id nobody allowed and names the tool", () => {
  const wire = createTripwire(new Set());
  wire.check(assistant("t1", "Write"));
  expect(wire.check(result("t1"))).toEqual({ tripped: true, tool: "Write" });
  expect(wire.check(result("unseen"))).toEqual({ tripped: true, tool: "unknown" });
  expect(wire.check(result(5))).toEqual({ tripped: true, tool: "unknown" });
});

test("the tripwire reads the live set", () => {
  const ids = new Set<string>();
  const wire = createTripwire(ids);
  wire.check(assistant("t1", "Read"));
  ids.add("t1");
  expect(wire.check(result("t1"))).toEqual({ tripped: false });
});

test("parseResult", () => {
  const base = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    structured_output: { x: 1 },
    api_error_status: 429,
    permission_denials: [{}, {}],
  };
  expect(parseResult(base)).toEqual({
    ok: true,
    text: "ok",
    structured: { x: 1 },
    apiErrorStatus: 429,
    authFailed: false,
    denials: 2,
  });
  expect(parseResult({ ...base, is_error: true }).ok).toBe(false);
  expect(parseResult({ ...base, subtype: "error_during_execution" }).ok).toBe(false);
  expect(
    parseResult({ type: "result", terminal_reason: "api_error", result: "Not logged in - Please run /login" })
      .authFailed,
  ).toBe(true);
  expect(parseResult({ type: "result" })).toEqual({ ok: false, text: "", authFailed: false, denials: 0 });
});

test("the sentences", () => {
  expect(LIMITS_NOT_APPLIED).toBe(
    "Claude Code did not apply the limits FlowDriven asked for. The step was stopped before it could act.",
  );
  expect(tripSentence("Write")).toBe("A tool ran without FlowDriven's check (Write). The step was stopped.");
  expect(tripSentence(`a${String.fromCodePoint(0x202e)}b`)).toBe(
    "A tool ran without FlowDriven's check (a<U+202E>b). The step was stopped.",
  );
  expect(isAuthFailure({ type: "assistant", error: "authentication_failed" })).toBe(true);
  expect(isAuthFailure({ type: "user", error: "authentication_failed" })).toBe(false);
  expect(isAuthFailure({ type: "assistant", error: "other" })).toBe(false);
  expect(isRateLimited({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } })).toBe(true);
  expect(isRateLimited({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } })).toBe(
    false,
  );
  expect(isRateLimited({ type: "assistant", rate_limit_info: { status: "rejected" } })).toBe(false);
});

test("a start hook event is recognised and a failed one is told apart", () => {
  const started = {
    type: "system",
    subtype: "hook_started",
    hook_id: "hook",
    hook_name: "SessionStart:startup",
    hook_event: "SessionStart",
    uuid: "started",
    session_id: "session",
  };
  const response = {
    ...started,
    subtype: "hook_response",
    output: "",
    stdout: "",
    stderr: "",
    exit_code: 0,
    outcome: "success",
    uuid: "response",
  };
  expect(startHookEvent(started)).toEqual({ is: true, failed: false });
  expect(startHookEvent(response)).toEqual({ is: true, failed: false });
  for (const exit_code of [2, "0", undefined])
    expect(startHookEvent({ ...response, exit_code })).toEqual({ is: true, failed: true });
  const { exit_code: _exitCode, ...withoutExitCode } = response;
  expect(startHookEvent(withoutExitCode)).toEqual({ is: true, failed: true });
  for (const event of [
    { ...started, hook_event: "PreToolUse" },
    init,
    { type: "assistant" },
    { type: "system", subtype: "hook_started" },
  ])
    expect(startHookEvent(event)).toEqual({ is: false });
});
