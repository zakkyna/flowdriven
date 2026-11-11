import { expect, test } from "vitest";
import { demoFlow } from "./demo/demo-flow.ts";
import type { RunView } from "./engine.ts";
import { renderRunReport, reportLines } from "./report.ts";
import type { RunState } from "./states.ts";
import type { CheckOutcome, StepRow } from "./storage.ts";

function view(overrides: {
  state?: RunState;
  blockedReason?: string;
  itemKey?: string;
  checks?: CheckOutcome[];
}): RunView {
  const { manifest } = demoFlow();
  return {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: "hash",
      flowVersion: manifest.version,
      state: overrides.state ?? "done",
      project: ".",
      inputs: {},
      params: { min_score: 7 },
      requirements: [],
      startedAt: "now",
      ...(overrides.blockedReason ? { blockedReason: overrides.blockedReason } : {}),
    },
    steps: manifest.steps.map(
      (step): StepRow => ({
        runId: "run-1",
        stepId: step.id,
        itemKey: "",
        state: "passed",
        attempts: [{ number: 1, replan: false, worker: "Scripted harness", startedAt: "now" }],
        outputs: step.id === "alerts" ? { jobs: [{ id: "j1", title: "Job one" }] } : {},
        checks: step.id === "alerts" ? (overrides.checks ?? []) : [],
      }),
    ),
    items: Array.from({ length: 5 }, (_, i) => ({
      runId: "run-1",
      loopId: i === 4 ? "build" : "review",
      key: i === 0 ? (overrides.itemKey ?? "j1") : `j${i + 1}`,
      position: i,
      item: {},
      status: "passed",
    })),
    approvals: [
      {
        id: "a",
        kind: "ask",
        runId: "run-1",
        stepId: "pick",
        itemKey: "",
        summary: "Which jobs get a prototype?",
        payload: { question: "Which jobs get a prototype?", options: [], maxPick: 1 },
        approves: [],
        onExpiry: "end",
        createdAt: "now",
        expiresAt: "later",
        state: "pending",
      },
    ],
    audit: [],
  };
}
test("the three report lines for each state", () => {
  expect(reportLines(view({ state: "done" }))).toEqual([
    "Sample job review: done. 4 of 4 steps passed.",
    "Items: 5 processed, 0 skipped as seen, 0 failed.",
    "Nothing needs your attention.",
  ]);
  expect(reportLines(view({ state: "blocked", blockedReason: "The harness needs you to sign in." }))[2]).toBe(
    "Blocked: The harness needs you to sign in.",
  );
  expect(reportLines(view({ state: "waiting_approval" }))[2]).toBe(
    "Waiting for you: Which jobs get a prototype?",
  );
  expect(reportLines(view({ state: "interrupted" }))[2]).toBe("Not finished: interrupted.");
});
test("escapes outside text in tables and in the summary", () => {
  const rlo = String.fromCodePoint(0x202e);
  const md = renderRunReport(
    view({ itemKey: `a|b\nc\`d${rlo}`, state: "blocked", blockedReason: `x\ny${rlo}` }),
  );
  expect(md).toContain("a\\|b c'd<U+202E>");
  expect(md).toContain("Blocked: x y<U+202E>");
  expect(md).not.toContain(rlo);
});
test("a step judged only by a judge is labelled", () =>
  expect(
    renderRunReport(
      view({
        checks: [{ type: "judge", required: true, summary: "s", verdict: "passed", evidence: "line 3" }],
      }),
    ),
  ).toContain("judge: passed \\(judged, not verified\\)"));
test("the steps table names the worker and the evidence is quoted", () => {
  const md = renderRunReport(
    view({
      checks: [
        {
          type: "contains",
          required: true,
          summary: "has /p/",
          verdict: "failed",
          evidence: "'/p/' not found",
        },
      ],
    }),
  );
  expect(md).toContain("| Step | State | Worker | Attempts | Checks |");
  expect(md).toContain("| Scripted harness |");
  expect(md).toContain("- alerts contains: '/p/' not found");
});
test("inputs, params and outputs are listed", () => {
  const md = renderRunReport(view({}));
  expect(md).toContain("- min\\_score: 7");
  expect(md).toContain('- alerts.jobs: \\[{"id":"j1"');
  expect(md).toContain("Usage and cost are not tracked yet (plan 03).");
});
test("the report has the sections in order", () => {
  const md = renderRunReport(view({}));
  const at = [
    "## Summary",
    "## Inputs",
    "## Steps",
    "### Evidence",
    "## Items: review",
    "## Choices",
    "## Outputs",
    "## Usage",
    "## Audit",
  ].map((h) => md.indexOf(h));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});
