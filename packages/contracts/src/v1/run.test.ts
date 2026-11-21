import { expect, test } from "vitest";
import {
  Attempt,
  firstUnpassedStep,
  ItemState,
  isResumable,
  RunReport,
  RunState,
  SKIP_REASONS,
  StepRun,
  StepRunState,
} from "./index";

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

test("a looped step run lists items with a state and a skip reason", () => {
  const item = {
    key: "j4",
    label: "Job four",
    state: "skipped",
    skip: "seen",
    note: "skipped: seen in an earlier run",
    steps: [],
  };
  const parsed = StepRun.parse({
    stepId: "loop",
    title: "Loop",
    do: "loop",
    state: "passed",
    attempts: [],
    maxAttempts: 1,
    checks: [],
    items: [item],
  });
  expect(parsed.items).toEqual([item]);
});
test("an item state is one of five and a skip reason one of four", () => {
  expect(ItemState.options).toEqual(["pending", "running", "passed", "failed", "skipped"]);
  expect(SKIP_REASONS).toEqual(["seen", "duplicate", "capped", "stopped"]);
});
test("an attempt can say it was a re-plan and name its worker", () => {
  expect(
    Attempt.parse({ number: 1, startedAt: "2026-11-10T09:30:00.000Z", replan: true, worker: "worker" }),
  ).toMatchObject({ replan: true, worker: "worker" });
});

test("a step run can list blocked calls, each with a count of at least one, at most twenty rows", () => {
  const step = {
    stepId: "a",
    title: "A",
    do: "worker",
    state: "failed",
    attempts: [],
    maxAttempts: 1,
    checks: [],
  };
  const row = { tool: "Write", reason: "Denied", count: 1 };
  expect(StepRun.parse({ ...step, blocked: [row] }).blocked).toEqual([row]);
  expect(StepRun.safeParse({ ...step, blocked: [{ ...row, count: 0 }] }).success).toBe(false);
  expect(StepRun.safeParse({ ...step, blocked: Array.from({ length: 21 }, () => row) }).success).toBe(false);
});
