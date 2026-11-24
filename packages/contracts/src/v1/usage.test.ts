import { expect, test } from "vitest";
import { LeafStepRun, RunDetail, StepUsage, UsageCall, UsageRow } from "./index.ts";

const call = {
  runId: "run-1",
  stepId: "a",
  itemKey: "",
  attempt: 1,
  kind: "worker",
  harnessId: "claude-code",
  models: [{ model: "claude-haiku-5-5", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 }],
  turns: 2,
  wallSeconds: 4.8,
  queuedSeconds: 0,
  exit: "ok",
  at: "2026-11-11T09:00:00.000Z",
};
test("a usage call carries tokens per model, as reported", () => {
  expect(UsageCall.parse(call).models.at(0)?.cacheRead).toBe(8454);
  expect(UsageCall.safeParse({ ...call, kind: "chat" }).success).toBe(false);
  expect(UsageCall.safeParse({ ...call, models: [{ ...call.models.at(0), input: -1 }] }).success).toBe(false);
});
test("a step usage says whether the harness reported anything", () => {
  const none = {
    calls: 1,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    turns: 0,
    wallSeconds: 1,
    queuedSeconds: 0,
    reported: false,
  };
  expect(StepUsage.parse(none).reported).toBe(false);
});
test("leaf steps and run details take the new optional fields, and UsageRow stays a per-harness total", () => {
  expect(LeafStepRun.shape.usage.safeParse(undefined).success).toBe(true);
  expect(RunDetail.shape.calls.safeParse([call]).success).toBe(true);
  expect(
    UsageRow.parse({ harnessId: "claude-code", name: "Claude Code", calls: 2, wallSeconds: 3 }).calls,
  ).toBe(2);
});
