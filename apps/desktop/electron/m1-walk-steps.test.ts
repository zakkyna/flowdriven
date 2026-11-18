import path from "node:path";
import { expect, test } from "vitest";
import {
  M1_OPERATIONS,
  M1_WALK_STEPS,
  m1WalkPaths,
  runRequest,
  summaryLine,
  walkConfig,
} from "./m1-walk-steps";

test("the walk's paths, its data folder included, are under .workflow/scratch/05d/walk/", () => {
  for (const value of Object.values(m1WalkPaths("/repo")))
    expect(value.startsWith(`${path.join("/repo", ".workflow/scratch/05d/walk")}${path.sep}`)).toBe(true);
});
test("the walk rescans, then waits for the consent and the allow before it starts anything", () => {
  expect(M1_WALK_STEPS.map((step) => step.name)).toEqual(["rescan", "consent", "import", "allow", "run"]);
  expect(M1_WALK_STEPS.map((step) => step.waitFor)).toEqual([
    "the harness scan",
    "Claude Code consent",
    "the flow import",
    "the flow allow",
    "a scheduled run",
  ]);
  expect(M1_WALK_STEPS.map((step) => step.operation)).toEqual([
    "harnesses.rescan",
    "harnesses.list",
    "flows.import",
    "flows.capabilities",
    "runs.list",
  ]);
});
test("the attended walk starts the run with params newest 3 and daily_builds 1, and the schedule walk starts none", () => {
  expect(runRequest("attended")).toEqual({
    flowId: "local.upwork-job-review",
    params: { newest: 3, daily_builds: 1 },
  });
  expect(runRequest("schedule")).toBeUndefined();
});
test("the walk never calls an operation that decides for the owner", () => {
  for (const operation of [
    "harnesses.setConsent",
    "flows.allowCapabilities",
    "approvals.answer",
    "approvals.resolve",
    "triggers.setEnabled",
  ])
    expect(M1_OPERATIONS).not.toContain(operation);
});
test("the summary line names the run, its state, the pages read, the commands allowed and refused, and the sends", () => {
  expect(
    summaryLine("r1", "done", [
      { kind: "page_read" },
      { kind: "command_run" },
      { kind: "tool_denied", detail: '{"tool":"Bash"}' },
      { kind: "tool_denied", detail: '{"tool":"Read"}' },
      { kind: "connector_call", detail: '{"tool":"send_message"}' },
    ]),
  ).toBe("run r1: done; pages read 1; commands allowed 1; commands refused 1; sends 1");
});
test("without M1_FLOW_DIR the walk stops with its sentence and opens nothing", () => {
  expect(walkConfig(undefined, "attended")).toEqual({ error: "Set M1_FLOW_DIR to the flow folder." });
  expect(walkConfig("/flow", "other")).toEqual({ error: "Set M1_WALK_MODE to attended or schedule." });
  expect(walkConfig("/flow", "schedule")).toEqual({ flowDir: "/flow", mode: "schedule" });
});
