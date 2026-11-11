import { FlowDetail, FlowManifest, FlowSummary, ReadinessReport, Settings } from "@flowdriven/contracts";
import { Check, Requirement, Trigger } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { FlowRow, RunRow } from "../storage.ts";
import {
  coreVersion,
  defaultSettings,
  describeCheck,
  toFlowDetail,
  toFlowManifest,
  toFlowSummary,
  toReadinessReport,
} from "./map-flow.ts";

const date = "2026-11-11T00:00:00.000Z";
function row(): FlowRow {
  const { manifest, files } = demoFlow();
  return {
    id: manifest.id,
    version: manifest.version,
    hash: `sha256:${"a".repeat(64)}`,
    manifest,
    files,
    registeredAt: date,
  };
}
function run(id: string, startedAt: string): RunRow {
  return {
    id,
    flowId: row().id,
    flowHash: "a".repeat(64),
    flowVersion: "0.1.0",
    state: "done",
    project: ".",
    inputs: {},
    params: {},
    requirements: [],
    startedAt,
  };
}
test("toFlowManifest maps loops, asks, when lines, params, triggers and requirement defaults", () => {
  const m = demoFlow().manifest;
  m.requirements = [Requirement.parse({ id: "browser", type: "harness" })];
  m.triggers = [Trigger.parse({ kind: "schedule", every: "1h", days: ["mon", "tue"] })];
  const result = FlowManifest.parse(toFlowManifest(m));
  expect(result.steps.map((s) => s.do)).toEqual(["worker", "loop", "ask", "loop"]);
  expect(result.steps.at(1)?.loop?.steps.at(1)?.when).toBe("rough.score.value >= params.min_score");
  expect(result.params?.min_score?.default).toBe(7);
  expect(result.requirements.at(0)?.ref).toBe("browser");
  expect(result.triggers).toEqual([{ kind: "schedule", summary: "Every 1h on mon, tue" }]);
});
test("check summaries fall back to a description", () => {
  const cases: [unknown, string][] = [
    [{ type: "command", cmd: "npm", args: ["test", "x"] }, "Runs npm test x"],
    [{ type: "files", paths: ["a", "b"] }, "Files exist: a, b"],
    [{ type: "schema", file: "a" }, "Matches a"],
    [{ type: "contains", patterns: ["a", "b"] }, "Contains a, b"],
    [{ type: "not_contains", pattern: "x" }, "Does not contain x"],
    [{ type: "judge", rubric: "quality" }, "A reviewer approves it (quality)"],
    [{ type: "user" }, "You approve the result"],
    [{ type: "probe", tool: "app.ping" }, "app.ping answers"],
  ];
  for (const [input, expected] of cases) expect(describeCheck(Check.parse(input))).toBe(expected);
  const m = demoFlow().manifest;
  expect(FlowManifest.parse(toFlowManifest(m)).steps.at(0)?.checks.at(0)?.summary).toBe(
    "Matches checks/alerts.schema.json",
  );
});
test("toFlowSummary and toFlowDetail show the last run, the approved sign-off and the playback", () => {
  const r = row();
  const runs = [run("run-1", date), run("run-2", date)];
  const summary = FlowSummary.parse(toFlowSummary(r, runs));
  expect(summary.lastRun?.runId).toBe("run-2");
  expect(summary.signOff).toEqual({ state: "approved", version: "0.1.0" });
  expect(summary.stepCount).toBe(4);
  expect(summary.saved).toBe(true);
  const detail = FlowDetail.parse(
    toFlowDetail(r, runs, [
      {
        runId: "run-2",
        stepId: "alerts",
        itemKey: "",
        state: "passed",
        attempts: [],
        outputs: {},
        checks: [],
      },
    ]),
  );
  expect(detail.playback.goal).toBe("Sample job review");
  expect(detail.playback.asksApprovalFor).toContain("Which jobs get a prototype?");
  expect(detail.playback.asksApprovalFor).toContain('Approving the result of "proposal"');
  expect(detail.stepStatus).toEqual({
    alerts: "passed",
    review: "pending",
    pick: "pending",
    build: "pending",
  });
  expect(detail.conversation).toEqual([]);
  expect(detail.canUndo).toBe(false);
  expect(coreVersion("1.2.3-beta.1+7")).toBe("1.2.3");
});
test("toReadinessReport gives one unchecked row per requirement and is ready only without required ones", () => {
  const r = row();
  const m = demoFlow().manifest;
  m.requirements = [
    Requirement.parse({ id: "a", type: "harness" }),
    Requirement.parse({ id: "b", type: "account", required: false }),
  ];
  r.manifest = m;
  const report = ReadinessReport.parse(toReadinessReport(r, date));
  expect(report.ready).toBe(false);
  expect(report.items.map((i) => i.state)).toEqual(["unchecked", "unchecked"]);
  expect(report.items.at(0)?.detail).toBe(
    "Not checked yet. Checking requirements arrives with the readiness engine.",
  );
  m.requirements = m.requirements.slice(1);
  expect(ReadinessReport.parse(toReadinessReport(r, date)).ready).toBe(true);
});
test("defaultSettings validates against Settings and names the month", () => {
  expect(Settings.parse(defaultSettings(date)).budget.month).toBe("2026-11");
});
