import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { RunView } from "../engine.ts";
import { toRunDetail } from "./map-run.ts";

test("the run read model carries a step's time limit", () => {
  const { manifest } = demoFlow();
  const step = manifest.steps.at(0);
  if (!step) throw new Error("Missing step");
  const view: RunView = {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: `sha256:${"a".repeat(64)}`,
      flowVersion: "1.2.3",
      state: "running",
      project: ".",
      inputs: {},
      params: { min_score: 7 },
      requirements: [],
      startedAt: "2026-11-17T00:00:00.000Z",
    },
    steps: [
      {
        runId: "run-1",
        stepId: step.id,
        itemKey: "",
        state: "running",
        attempts: [],
        outputs: {},
        checks: [],
        limitMs: 9_000_000,
      },
    ],
    items: [],
    approvals: [],
    audit: [],
  };
  expect(toRunDetail(view, () => "scripted").steps.at(0)?.limitMs).toBe(9_000_000);
  const row = view.steps.at(0);
  if (!row) throw new Error("Missing row");
  delete row.limitMs;
  expect(toRunDetail(view, () => "scripted").steps.at(0)?.limitMs).toBeUndefined();
});
