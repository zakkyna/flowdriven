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
    "running",
    "waiting_approval",
    "needs_login",
    "retrying",
    "blocked",
    "interrupted",
    "stopped",
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
    "stopped",
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
test("a report has up to three lines and version 2 results", () => {
  const report = { runId: "r", lines: ["a", "b"], decisionLines: [], result: { kind: "report" } };
  expect(RunReport.safeParse(report).success).toBe(true);
  expect(RunReport.safeParse({ ...report, lines: ["a", "b", "c", "d"] }).success).toBe(false);
  expect(RunReport.safeParse({ ...report, saveOffer: false }).success).toBe(false);
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

test("TC-CON-12 version 2 states", async () => {
  const c = await import("./index.ts");
  expect(c.RunState.options).toEqual([
    "queued",
    "checking",
    "running",
    "waiting_approval",
    "needs_login",
    "retrying",
    "blocked",
    "interrupted",
    "stopped",
    "done",
    "failed",
  ]);
  expect(c.StepRunState.options).toEqual([
    "pending",
    "running",
    "retrying",
    "waiting_approval",
    "passed",
    "failed",
    "skipped",
    "interrupted",
    "stopped",
  ]);
  expect(c.ApprovalState.options).toEqual([
    "pending",
    "approved",
    "approved_edited",
    "rejected",
    "expired",
    "allowed_always",
  ]);
  expect(c.ApprovalDecision.options).toEqual(["approve", "edit", "reject", "always_allow"]);
  expect(c.ResolvedVia.options).toEqual(["window", "chat", "phone", "rule", "stop", "permission_off"]);
  expect(c.AgentState.options).toEqual([
    "not_installed",
    "installing",
    "waiting_login",
    "needs_login",
    "ready",
    "unknown",
  ]);
  expect(c.FlowState.options).toEqual(["new", "changed", "confirmed"]);
  for (const state of ["paused", "approved_always", "waiting_login"])
    expect(c.RunState.safeParse(state).success).toBe(false);
  expect(c.isResumable("needs_login")).toBe(true);
  expect(c.isResumable("stopped")).toBe(false);
});
test("TC-CON-25 causes and input problems", async () => {
  const c = await import("./run.ts");
  for (const code of [
    "agent_signed_out",
    "site_sign_in",
    "permission_off",
    "agent_not_set_up",
    "usage_limit",
    "spending_limit",
    "checks_failing",
    "requirement_missing",
    "flow_not_confirmed",
    "limits_not_applied",
    "crash",
    "step_failed",
    "stopped",
    "flow_deleted",
    "agent_cannot_be_limited",
    "daily_limit",
    "cost_not_reported",
    "internal_error",
  ])
    expect(c.Cause.safeParse({ code }).success).toBe(true);
  expect(c.Cause.safeParse({ code: "unknown" }).success).toBe(false);
  expect(c.Cause.safeParse({ code: "crash", params: { x: 1 } }).success).toBe(false);
  for (const problem of [
    "empty",
    "unreadable",
    "zero",
    "too_long",
    "too_long_text",
    "out_of_range",
    "not_a_choice",
    "hidden_characters",
  ])
    expect(c.FieldProblem.safeParse({ inputId: "n", problem }).success).toBe(true);
  expect(
    c.FieldProblem.safeParse({ inputId: "n", problem: "out_of_range", params: { min: 1, max: 10 } }).success,
  ).toBe(true);
  expect(c.FieldProblem.safeParse({ inputId: "n", problem: "invalid" }).success).toBe(false);
  expect(c.FieldProblem.safeParse({ inputId: "n", problem: "zero", params: { min: "1" } }).success).toBe(
    false,
  );
});
test("TC-CON-26 version 2 run models", async () => {
  const c = await import("./run.ts");
  const run = {
    id: "r",
    flowId: "f",
    flowName: "F",
    flowVersion: "1.0.0",
    flowHash: `sha256:${"a".repeat(64)}`,
    oneTime: false,
    project: "p",
    state: "stopped",
    source: "schedule",
    agent: "claude-code",
    model: "sonnet-5.5",
    cause: { code: "permission_off" },
    versionChanged: false,
    startedAt: "2026-11-12T00:00:00Z",
  };
  expect(c.RunSummary.safeParse(run).success).toBe(true);
  expect(c.RunSummary.safeParse({ ...run, source: "voice" }).success).toBe(false);
  expect(
    c.RunSummary.safeParse({
      ...run,
      model: undefined,
      currentStep: { index: 2, count: 4, title: "Log the hours" },
    }).success,
  ).toBe(true);
  expect(c.RunSummary.safeParse({ ...run, currentStep: { index: 0, count: 4, title: "x" } }).success).toBe(
    false,
  );
  const detail = {
    ...run,
    inputs: [],
    steps: [],
    approvalIds: [],
    outputs: [],
    usage: [],
    estimatedCostUsd: 0,
    decisionLines: [],
    canRunAgain: true,
    canTryAgain: false,
  };
  for (const costLine of [{ kind: "plan" }, { kind: "amount", usd: 0.42 }, { kind: "none" }])
    expect(c.RunDetail.safeParse({ ...detail, costLine }).success).toBe(true);
  expect(c.RunDetail.safeParse({ ...detail, costLine: { kind: "amount" } }).success).toBe(false);
});
