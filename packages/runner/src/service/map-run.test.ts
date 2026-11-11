import { AuditRecord, RunDetail, RunSummary } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { RunView } from "../engine.ts";
import type { ApprovalRow, ItemRow, StepRow } from "../storage.ts";
import { itemLabel, skipReason, toAuditRecord, toRunDetail, toRunSummary } from "./map-run.ts";

const date = "2026-11-11T00:00:00.000Z";
function view(): RunView {
  const { manifest } = demoFlow();
  return {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: "a".repeat(64),
      flowVersion: "1.2.3-beta+7",
      state: "blocked",
      project: ".",
      inputs: {},
      params: { min_score: 7 },
      requirements: [],
      startedAt: date,
      blockedReason: "Wait",
    },
    steps: manifest.steps.map(
      (step): StepRow => ({
        runId: "run-1",
        stepId: step.id,
        itemKey: "",
        state: "passed",
        attempts: [{ number: 1, replan: false, worker: "Scripted harness", startedAt: date }],
        outputs: step.id === "alerts" ? { jobs: "x".repeat(250) } : {},
        checks: [],
      }),
    ),
    items: [],
    approvals: [],
    audit: [],
  };
}
function map(v: RunView) {
  return RunDetail.parse(toRunDetail(v, () => "scripted"));
}
function approval(): ApprovalRow {
  return {
    id: "ap-1",
    kind: "ask",
    runId: "run-1",
    stepId: "pick",
    itemKey: "",
    summary: "Pick",
    payload: { question: "Pick", options: [{ key: "j1", label: "Job one", item: { id: "j1" } }], maxPick: 1 },
    maxPick: 1,
    approves: [],
    onExpiry: "end",
    createdAt: date,
    expiresAt: date,
    state: "approved",
    picks: ["j1"],
    resolvedAt: date,
  };
}
test("toRunDetail maps top-level steps with limits, workers and attempts", () => {
  const d = map(view());
  expect(d.steps.at(0)?.maxAttempts).toBe(4);
  expect(d.steps.at(0)?.worker).toEqual({ harnessId: "scripted", name: "Scripted harness" });
  expect(d.steps.at(0)?.attempts.at(0)?.replan).toBe(false);
});
test("loop items carry label, state, skip reason and their own steps; a duplicate has none", () => {
  const v = view();
  const items: ItemRow[] = [
    {
      runId: "run-1",
      loopId: "review",
      key: "j1",
      position: 0,
      item: { title: "Job one" },
      status: "passed",
    },
    ...["j3", "j4"].map(
      (key, i): ItemRow => ({
        runId: "run-1",
        loopId: "review",
        key,
        position: i + 1,
        item: { label: key },
        status: "skipped",
        note: "skipped: seen in an earlier run",
      }),
    ),
    {
      runId: "run-1",
      loopId: "review",
      key: "j1",
      position: 3,
      item: {},
      status: "skipped",
      note: "skipped: duplicate key",
    },
  ];
  v.items = items;
  v.steps.push(
    ...["rough", "page", "full"].map(
      (stepId): StepRow => ({
        runId: "run-1",
        stepId,
        itemKey: "j1",
        state: "passed",
        attempts: [],
        outputs: {},
        checks: [],
      }),
    ),
  );
  const result = map(v).steps.at(1)?.items;
  expect(result?.at(0)).toMatchObject({ key: "j1", label: "Job one", state: "passed" });
  expect(result?.at(0)?.steps).toHaveLength(3);
  expect(result?.at(1)?.skip).toBe("seen");
  expect(result?.at(2)?.skip).toBe("seen");
  expect(result?.at(3)?.steps).toEqual([]);
  expect(itemLabel({}, "x")).toBe("x");
  expect(skipReason("skipped: over the item cap")).toBe("capped");
  expect(skipReason("skipped: stopped after an item failed")).toBe("stopped");
});
test("an ask step shows its picks, or an empty list when the choice expired", () => {
  const v = view();
  v.approvals = [approval()];
  expect(map(v).steps.at(2)?.picks).toEqual([{ key: "j1", label: "Job one" }]);
  v.approvals = [{ ...approval(), state: "expired", picks: undefined }];
  const step = v.steps.find((s) => s.stepId === "pick");
  if (!step) throw new Error("missing step");
  step.outputs = { choice: [] };
  expect(map(v).steps.at(2)?.picks).toEqual([]);
});
test("inputs, params, outputs, report lines and the blocked reason are listed", () => {
  const v = view();
  v.run.inputs = { query: "hello" };
  v.manifest.inputs = [{ id: "query", type: "text", label: "Query", required: false }];
  const d = map(v);
  expect(d.inputs).toEqual([
    { id: "query", label: "Query", value: "hello" },
    { id: "min_score", label: "min_score", value: "7" },
  ]);
  expect(d.outputs.at(0)?.id).toBe("alerts.jobs");
  expect(d.outputs.at(0)?.value.endsWith("...")).toBe(true);
  expect(d.report?.lines.at(0)).toMatch(/^Sample job review:/);
  expect(d.blockedReason).toBe("Wait");
});
test("toRunSummary and toAuditRecord", () => {
  expect(RunSummary.parse(toRunSummary(view().run, "Sample")).flowVersion).toBe("1.2.3");
  expect(AuditRecord.parse(toAuditRecord({ at: date, kind: "event", detail: { a: 1 } })).detail).toBe(
    '{"a":1}',
  );
});
