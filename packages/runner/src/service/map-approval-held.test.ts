import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";
import { toDecision } from "./map-decision.ts";

// TC-j24-23: the version 2 decision mapper keeps these payload assertions.
function toApproval(row: ApprovalRow, run: RunRow, manifest: ReturnType<typeof demoFlow>["manifest"]) {
  const store = { getFlow: () => ({ manifest }), listApprovals: () => [] } as unknown as Store;
  return toDecision(row, run, store);
}

const manifest = demoFlow().manifest;
const date = "2026-11-11T00:00:00.000Z";
const run: RunRow = {
  id: "run-1",
  flowId: manifest.id,
  flowHash: "a".repeat(64),
  flowVersion: manifest.version,
  state: "waiting_approval",
  project: ".",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: date,
};
const ask: ApprovalRow = {
  id: "ap-1",
  kind: "ask",
  runId: run.id,
  stepId: "pick",
  itemKey: "",
  summary: "Pick",
  payload: { question: "Pick", options: [{ key: "j1", label: "Job" }], maxPick: 1 },
  approves: [],
  onExpiry: "end",
  createdAt: date,
  expiresAt: date,
  state: "pending",
};
const risky: ApprovalRow = {
  ...ask,
  kind: "risky_action",
  stepId: "proposal",
  itemKey: "j1",
  payload: "Delete draft",
  riskyAction: "delete",
  outside: true,
};
test("a risky_action row becomes a risky_action approval with riskyAction, the step title, a text payload and outside when the row has it", () => {
  expect(toApproval(risky, run, manifest)).toMatchObject({
    kind: "risky_action",
    riskyAction: "delete",
    stepTitle: "proposal",
    payload: { kind: "text", text: "Delete draft" },
    outside: true,
  });
});
test("an ask row with outside true gives outside true, and without it the key is absent", () => {
  expect(toApproval({ ...ask, outside: true }, run, manifest).outside).toBe(true);
  expect(toApproval(ask, run, manifest)).not.toHaveProperty("outside");
});
test("a risky_action row without riskyAction is refused by the contract", () => {
  expect(() => toApproval({ ...risky, riskyAction: undefined }, run, manifest)).toThrow();
});
