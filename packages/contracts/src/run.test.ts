import { expect, test } from "vitest";
import { firstUnpassedStep, isResumable, RunReport, RunState, StepRunState } from "./index";

test("run states are the spec's lifecycle", () => {
  expect(RunState.options).toEqual([
    "queued",
    "checking",
    "blocked",
    "running",
    "waiting_approval",
    "retrying",
    "interrupted",
    "done",
    "failed",
  ]);
  expect(StepRunState.options).toEqual([
    "pending",
    "running",
    "retrying",
    "waiting_approval",
    "passed",
    "failed",
    "skipped",
    "interrupted",
  ]);
});
test("blocked, failed and interrupted runs can resume", () => {
  expect(["blocked", "failed", "interrupted"].every((s) => isResumable(s as RunState))).toBe(true);
  expect(isResumable("done")).toBe(false);
});
test("first unpassed step skips passed and skipped steps", () => {
  const s = (stepId: string, state: string) => ({
    stepId,
    title: stepId,
    do: "worker",
    state,
    attempts: [],
    maxAttempts: 3,
    checks: [],
  });
  const run = { steps: [s("a", "passed"), s("b", "skipped"), s("c", "failed"), s("d", "pending")] } as never;
  expect(firstUnpassedStep(run)?.index).toBe(3);
  expect(firstUnpassedStep(run)?.step.stepId).toBe("c");
});
test("a report has exactly three lines", () => {
  expect(RunReport.safeParse({ runId: "r", lines: ["a", "b"], saveOffer: false }).success).toBe(false);
});
