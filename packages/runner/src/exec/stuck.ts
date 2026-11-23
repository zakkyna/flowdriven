import { createHash } from "node:crypto";
import { digestCall } from "../connectors/grants.ts";
import type { StepEvent } from "../harness.ts";

export const STUCK_DEFAULTS = {
  repeatedCall: 4,
  repeatedError: 3,
} as const;

export const MAX_STUCK_EVIDENCE = 120;

export type StuckReason = "repeated_call" | "repeated_error";

export type StuckTrigger = {
  reason: StuckReason;
  count: number;
  evidence: string;
  outside: boolean;
  note: string;
};

export type StuckLimits = {
  repeatedCall?: number;
  repeatedError?: number;
};

export type StuckGuard = {
  observe(event: StepEvent): StuckTrigger | undefined;
  readonly triggered: StuckTrigger | undefined;
};

/** Computes a SHA-256 digest of tool result text without retaining raw output. */
export function digestResult(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Keeps the first line of an error, removes control/format characters, and caps its length. */
export function cleanErrorLine(text: string, max = MAX_STUCK_EVIDENCE): string {
  const first = text.split(/\r\n|\r|\n|\u2028|\u2029/, 1)[0] ?? "";
  const cleaned = first.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return [...cleaned].slice(0, max).join("");
}

/** Returns the fixed plain retry note for a stuck trigger, with only the count varying. */
export function stuckRetryNote(reason: StuckReason, count: number): string {
  return reason === "repeated_call"
    ? `The last attempt repeated the same call ${count} times. Try a different way.`
    : `The last attempt hit the same error ${count} times. Try a different way.`;
}

/** Creates a per-attempt guard that triggers once when calls or errors repeat past threshold. */
export function createStuckGuard(limits: StuckLimits = {}): StuckGuard {
  const repeatedCall = limits.repeatedCall ?? STUCK_DEFAULTS.repeatedCall;
  const repeatedError = limits.repeatedError ?? STUCK_DEFAULTS.repeatedError;
  const callCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  let trigger: StuckTrigger | undefined;

  return {
    get triggered() {
      return trigger;
    },
    observe(event) {
      if (trigger !== undefined) return undefined;
      if (event.error !== undefined) {
        const key = cleanErrorLine(event.error);
        const count = (errorCounts.get(key) ?? 0) + 1;
        errorCounts.set(key, count);
        if (count >= repeatedError) {
          trigger = {
            reason: "repeated_error",
            count,
            evidence: key,
            outside: true,
            note: stuckRetryNote("repeated_error", count),
          };
          return trigger;
        }
        return undefined;
      }
      const key = JSON.stringify([digestCall(event.tool, event.input), event.resultDigest]);
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);
      if (count >= repeatedCall) {
        trigger = {
          reason: "repeated_call",
          count,
          evidence: event.tool.replace(/[\p{Cc}\p{Cf}\r\n\u2028\u2029]/gu, ""),
          outside: false,
          note: stuckRetryNote("repeated_call", count),
        };
        return trigger;
      }
      return undefined;
    },
  };
}
