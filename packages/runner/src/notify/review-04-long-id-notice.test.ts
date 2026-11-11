// Proof for review-04 finding: a valid flow id longer than about 80 characters makes the
// flood and pause notice ids exceed 100 characters, so the policy drops them silently.
// Copy to packages/runner/src/notify/review-04-long-id.test.ts (import "./policy.ts").
import { expect, test } from "vitest";
import { createNoticePolicy } from "./policy.ts";

const flowId = `local.${"a".repeat(84)}`; // 90 characters, valid for the SDK and validId
test("a flood and a pause on a flow with a 90 character id still notify", () => {
  const policy = createNoticePolicy({ nowMs: () => Date.parse("2026-11-12T00:00:00Z") });
  expect(
    policy.decide({ kind: "flood_cap", flowId, flowName: "F", day: "2026-11-12", cap: 24 }),
  ).toBeDefined();
  expect(
    policy.decide({
      kind: "trigger_paused",
      flowId,
      index: 0,
      flowName: "F",
      pausedAt: "2026-11-12T00:00:00.000Z",
    }),
  ).toBeDefined();
});

test("invalid builder targets fall back to inbox and long flow ids still allow blocked notices", () => {
  const policy = createNoticePolicy({ nowMs: () => 0 });
  const flowId = "bad/" + "a".repeat(110);
  expect(
    policy.decide({ kind: "flood_cap", flowId, flowName: "F", day: "2026-11-12", cap: 24 })?.target,
  ).toEqual({ screen: "inbox" });
  expect(
    policy.decide({ kind: "trigger_paused", flowId, index: 0, flowName: "F", pausedAt: "2026-11-12" })
      ?.target,
  ).toEqual({ screen: "inbox" });
  expect(policy.decide({ kind: "run_blocked", flowId, flowName: "F", runId: "run-1" })?.target).toEqual({
    screen: "run",
    runId: "run-1",
  });
});
