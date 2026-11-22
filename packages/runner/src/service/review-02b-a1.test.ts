import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";
import { toDecision } from "./map-decision.ts";

// TC-j24-23: the version 2 decision mapper keeps these payload assertions.
function toApproval(row: ApprovalRow, run: RunRow, manifest: ReturnType<typeof demoFlow>["manifest"]) {
  const store = { getFlow: () => ({ manifest }), listApprovals: () => [] } as unknown as Store;
  return toDecision(row, run, store);
}

const date = "2026-11-11T00:00:00.000Z";
const manifest = demoFlow().manifest;
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
test("review: a choice that approves a risky tool tells the person which tool", () => {
  const row: ApprovalRow = {
    id: "ap-1",
    kind: "ask",
    runId: "run-1",
    stepId: "pick",
    itemKey: "",
    summary: "Which jobs get a prototype?",
    payload: {
      question: "Which jobs get a prototype?",
      options: [{ key: "j1", label: "Job one", item: { id: "j1" } }],
      maxPick: 1,
    },
    maxPick: 1,
    approves: ["host.prototype_publish"],
    onExpiry: "end",
    createdAt: date,
    expiresAt: date,
    state: "pending",
  };
  expect(JSON.stringify(toApproval(row, run, manifest))).toContain("host.prototype_publish");
});
