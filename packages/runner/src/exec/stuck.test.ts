import { afterEach, expect, test, vi } from "vitest";
import {
  cleanErrorLine,
  createStuckGuard,
  digestResult,
  MAX_STUCK_EVIDENCE,
  STUCK_DEFAULTS,
  stuckRetryNote,
} from "./stuck.ts";

afterEach(() => {
  vi.useRealTimers();
});

test("TC-ENG-27 centralized defaults and repeated call threshold (3 vs 4) comparing call, input and result", () => {
  expect(STUCK_DEFAULTS).toEqual({ repeatedCall: 4, repeatedError: 3 });
  expect(MAX_STUCK_EVIDENCE).toBe(120);

  const guard = createStuckGuard();
  const sameDigest = digestResult("same-result");
  const base = {
    tool: "Read",
    input: { file_path: "a.txt", opts: { a: 1, b: 2 } },
    resultDigest: sameDigest,
  };

  expect(guard.observe(base)).toBeUndefined();
  expect(guard.observe(base)).toBeUndefined();
  expect(guard.observe(base)).toBeUndefined();
  expect(guard.triggered).toBeUndefined();

  // Varying tool, input, or resultDigest does not count toward the identical triple.
  expect(guard.observe({ ...base, tool: "Glob" })).toBeUndefined();
  expect(guard.observe({ ...base, input: { file_path: "b.txt" } })).toBeUndefined();
  expect(guard.observe({ ...base, resultDigest: digestResult("other-result") })).toBeUndefined();
  expect(guard.triggered).toBeUndefined();

  // Key order differences canonicalize identically on the 4th matching triple.
  const trigger = guard.observe({
    tool: "Read",
    input: { opts: { b: 2, a: 1 }, file_path: "a.txt" },
    resultDigest: sameDigest,
  });
  expect(trigger).toEqual({
    reason: "repeated_call",
    count: 4,
    evidence: "Read",
    outside: false,
    note: stuckRetryNote("repeated_call", 4),
  });
  expect(trigger?.note).toBe("The last attempt repeated the same call 4 times. Try a different way.");
  expect(trigger?.note).not.toContain("Read");
  expect(trigger?.note).not.toContain("a.txt");
  expect(trigger?.note).not.toContain("same-result");
  expect(guard.triggered).toEqual(trigger);

  // Subsequent events in the same attempt do not re-trigger.
  expect(guard.observe(base)).toBeUndefined();
  expect(guard.triggered).toEqual(trigger);
});

test("TC-ENG-27 repeated error threshold (2 vs 3), error sanitization, per-attempt reset and no silence timer", () => {
  const bel = String.fromCodePoint(0x0007);
  const esc = String.fromCodePoint(0x001b);
  const rlo = String.fromCodePoint(0x202e);
  const rawLong = `ERR:${bel}${esc}${rlo}${"z".repeat(140)}\nSECRET_SECOND_LINE`;
  const cleaned = cleanErrorLine(rawLong);
  expect(cleaned).toBe(`ERR:${"z".repeat(116)}`);
  expect([...cleaned]).toHaveLength(120);
  expect(cleaned).not.toContain("SECRET_SECOND_LINE");

  const guard1 = createStuckGuard();
  expect(
    guard1.observe({
      tool: "SECRET_TOOL",
      input: { secret: "SECRET_INPUT" },
      resultDigest: digestResult("SECRET_RESULT_1"),
      error: "SECRET_ERR: boom\nline2",
    }),
  ).toBeUndefined();
  expect(
    guard1.observe({
      tool: "OTHER_TOOL",
      input: { secret: "OTHER_INPUT" },
      resultDigest: digestResult("SECRET_RESULT_2"),
      error: `SECRET_ERR:${bel} boom\nline3`,
    }),
  ).toBeUndefined();
  expect(
    guard1.observe({
      tool: "SECRET_TOOL",
      input: { secret: "SECRET_INPUT" },
      resultDigest: digestResult("SECRET_RESULT_3"),
      error: "OTHER_ERR: fail",
    }),
  ).toBeUndefined();

  const trigger = guard1.observe({
    tool: "SECRET_TOOL",
    input: { secret: "SECRET_INPUT" },
    resultDigest: digestResult("SECRET_RESULT_4"),
    error: "SECRET_ERR: boom\nline4",
  });
  expect(trigger).toEqual({
    reason: "repeated_error",
    count: 3,
    evidence: "SECRET_ERR: boom",
    outside: true,
    note: stuckRetryNote("repeated_error", 3),
  });
  expect(trigger?.note).toBe("The last attempt hit the same error 3 times. Try a different way.");
  expect(trigger?.note).not.toContain("SECRET_TOOL");
  expect(trigger?.note).not.toContain("SECRET_INPUT");
  expect(trigger?.note).not.toContain("SECRET_RESULT");
  expect(trigger?.note).not.toContain("SECRET_ERR");

  // Counts reset per attempt.
  const guard2 = createStuckGuard();
  const callEvent = {
    tool: "Read",
    input: { file_path: "a.txt" },
    resultDigest: digestResult("same"),
  };
  expect(guard2.observe(callEvent)).toBeUndefined();
  expect(guard2.observe(callEvent)).toBeUndefined();
  expect(guard2.observe(callEvent)).toBeUndefined();
  expect(
    guard2.observe({
      tool: "Bash",
      input: { command: "x" },
      resultDigest: digestResult("e"),
      error: "SECRET_ERR: boom",
    }),
  ).toBeUndefined();
  expect(
    guard2.observe({
      tool: "Bash",
      input: { command: "x" },
      resultDigest: digestResult("e"),
      error: "SECRET_ERR: boom",
    }),
  ).toBeUndefined();
  expect(guard2.triggered).toBeUndefined();

  // Silence never fires the guard.
  vi.useFakeTimers();
  const guard3 = createStuckGuard();
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(guard3.triggered).toBeUndefined();
});
