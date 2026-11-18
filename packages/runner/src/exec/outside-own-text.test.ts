import { parseManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import type { RunRow, StepRow } from "../storage.ts";
import { takesOutsideText } from "./outside.ts";
import { ownTextHash } from "./own-text.ts";

const parsed = parseManifest({
  format: "flowdriven-flow/1.1",
  id: "local.test",
  name: "Test",
  kind: "build",
  steps: [
    { id: "source", do: "worker", instructions: "Read" },
    {
      id: "loop",
      for_each: "${steps.source.outputs.jobs}",
      as: "job",
      steps: [
        { id: "plan", do: "worker", instructions: "Plan" },
        { id: "build", do: "worker", instructions: "Build" },
      ],
    },
    { id: "later", do: "worker", instructions: "Later" },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const manifest = parsed.manifest;
const run: RunRow = {
  id: "r",
  flowId: "local.test",
  flowHash: "hash",
  flowVersion: "1",
  state: "running",
  project: "/tmp",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: "2026-11-18T00:00:00Z",
};
const row: StepRow = {
  runId: "r",
  stepId: "plan",
  itemKey: "#0",
  state: "passed",
  attempts: [],
  outputs: { plan: "Approved" },
  checks: [],
  outside: true,
  ownerApproved: {
    output: "plan",
    hash: ownTextHash("Approved"),
    approvalId: "a",
    at: "2026-11-18T00:00:00Z",
  },
};
const read = (template: string, rows: StepRow[], step = "build", key = "#0") =>
  takesOutsideText(template, step, manifest, run, key, rows);

test("a step that reads an approved plan of its own loop item takes no outside text", () => {
  expect(read("${plan.outputs.plan}", [row])).toBe(false);
  expect(read("${steps.source.outputs.plan}", [{ ...row, stepId: "source", itemKey: "" }], "later", "")).toBe(
    false,
  );
  expect(read("${plan.outputs.plan}", [{ ...row, itemKey: "#1", ownerApproved: undefined }])).toBe(false);
});
test("the same read before the approval takes outside text", () => {
  expect(read("${plan.outputs.plan}", [{ ...row, ownerApproved: undefined }])).toBe(true);
});
test("a plan changed after the approval takes outside text again", () => {
  expect(read("${plan.outputs.plan}", [{ ...row, outputs: { plan: "Changed" } }])).toBe(true);
});
test("a read through a loop's items, the loop variable, or an expression that cannot be parsed still counts as outside after an approval", () => {
  expect(read("${steps.loop.items}", [row], "later", "")).toBe(true);
  const source = { ...row, stepId: "source", itemKey: "" };
  expect(read("${job.title}", [source])).toBe(true);
  expect(read("${steps.source.outputs.}", [row])).toBe(true);
});
test("a steps.<id> reference to a step inside a loop counts as outside", () => {
  expect(read("${steps.plan.outputs.plan}", [], "later", "")).toBe(true);
});
