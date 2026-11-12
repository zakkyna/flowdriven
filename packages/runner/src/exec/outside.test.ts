import { type LeafStep, parseManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import type { RunRow, StepRow } from "../storage.ts";
import { checkTexts, stepTakesOutsideText, takesOutsideText } from "./outside.ts";

const source = { id: "source", do: "worker", instructions: "Read", checks: [] };
const worker = { id: "work", do: "worker", instructions: "Work", checks: [] };
function manifest(steps: unknown[]) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
const run: RunRow = {
  id: "run",
  flowId: "local.test",
  flowHash: "hash",
  flowVersion: "1",
  state: "running",
  project: "/tmp",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: "2026-11-12T00:00:00Z",
};
const row: StepRow = {
  runId: "run",
  stepId: "source",
  itemKey: "",
  state: "passed",
  attempts: [],
  outputs: {},
  checks: [],
  outside: true,
};
function leaf(checks: unknown[], instructions = "Work"): LeafStep {
  const m = manifest([source, { ...worker, instructions, checks }]);
  const step = m.steps.at(1);
  if (!step || "for_each" in step) throw new Error("missing leaf");
  return step;
}
const expression = "${steps.source.outputs.body}";

test("a contains pattern that takes a value of a marked step marks the step, and an unmarked one does not", () => {
  const step = leaf([{ type: "contains", pattern: expression }]);
  const m = manifest([source, step]);
  expect(stepTakesOutsideText(step, m, run, "", [row])).toBe(true);
  expect(stepTakesOutsideText(step, m, run, "", [{ ...row, outside: false }])).toBe(false);
});
test("each of the patterns of a not_contains check and each path of a files check is looked at", () => {
  for (const check of [
    { type: "not_contains", patterns: [expression, "plain"] },
    { type: "not_contains", patterns: ["plain", expression] },
    { type: "files", paths: [expression, "plain"] },
    { type: "files", paths: ["plain", expression] },
  ]) {
    const step = leaf([check]);
    expect(stepTakesOutsideText(step, manifest([source, step]), run, "", [row])).toBe(true);
  }
});
test("a schema, a judge and a user check add no text", () => {
  const step = leaf([
    { type: "schema", file: expression },
    { type: "judge", rubric: expression },
    { type: "user" },
  ]);
  expect(checkTexts(step.checks)).toEqual([]);
  expect(stepTakesOutsideText(step, manifest([source, step]), run, "", [row])).toBe(false);
});
test("a loop item value (job) in the instructions marks when the loop's for_each takes a marked step, and does not when it takes an unmarked one", () => {
  const m = manifest([
    source,
    {
      id: "loop",
      for_each: "${steps.source.outputs.jobs}",
      as: "job",
      steps: [{ ...worker, instructions: "${job.title}" }],
    },
  ]);
  const loop = m.steps.at(1);
  if (!loop || !("for_each" in loop)) throw new Error("missing loop");
  const step = loop.steps.at(0);
  if (!step) throw new Error("missing step");
  expect(stepTakesOutsideText(step, m, run, "j1", [row])).toBe(true);
  expect(stepTakesOutsideText(step, m, run, "j1", [{ ...row, outside: false }])).toBe(false);
});
test("the loop rule needs the step to be inside that loop: the same name in another place marks nothing", () => {
  const m = manifest([
    source,
    { id: "loop", for_each: "${steps.source.outputs.jobs}", as: "job", steps: [worker] },
    { ...worker, id: "other", instructions: "${job.title}" },
  ]);
  expect(takesOutsideText("${job.title}", "other", m, run, "", [row])).toBe(false);
});
test("a trigger value marks a run started by a webhook, a link or a new_item trigger, and marks nothing for a manual or schedule run or a run with no trigger", () => {
  const m = manifest([worker]);
  for (const kind of ["webhook", "link", "new_item"])
    expect(takesOutsideText("${trigger.payload.x}", "work", m, { ...run, trigger: { kind } }, "", [])).toBe(
      true,
    );
  for (const kind of ["manual", "schedule"])
    expect(takesOutsideText("${trigger.payload.x}", "work", m, { ...run, trigger: { kind } }, "", [])).toBe(
      false,
    );
  expect(takesOutsideText("${trigger.payload.x}", "work", m, run, "", [])).toBe(false);
});
test("an expression that cannot be read still fails closed", () => {
  const m = manifest([source, worker]);
  expect(takesOutsideText("${steps.source.outputs.}", "work", m, run, "", [row])).toBe(true);
  expect(takesOutsideText("${steps.source.outputs.}", "work", m, run, "", [{ ...row, outside: false }])).toBe(
    false,
  );
});
