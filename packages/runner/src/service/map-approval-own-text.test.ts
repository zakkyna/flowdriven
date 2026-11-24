import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";
import { toDecision } from "./map-decision.ts";

// TC-j24-23: the version 2 decision mapper keeps these payload assertions.
function toApproval(row: ApprovalRow, run: RunRow, manifest: ReturnType<typeof demoFlow>["manifest"]) {
  const store = { getFlow: () => ({ manifest }), listApprovals: () => [] } as unknown as Store;
  return toDecision(row, run, store);
}

test("an own-text sign-off carries no similarGroup, so it is never approved with others", () => {
  const manifest = demoFlow().manifest;
  const date = "2026-11-11T00:00:00.000Z";
  const run: RunRow = {
    id: "r",
    flowId: manifest.id,
    flowHash: "hash",
    flowVersion: manifest.version,
    state: "waiting_approval",
    project: ".",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: date,
  };
  const row: ApprovalRow = {
    id: "a",
    kind: "result_sign_off",
    runId: "r",
    stepId: "proposal",
    itemKey: "job",
    summary: "Approve",
    payload: "The plan",
    approves: [],
    onExpiry: "fail",
    createdAt: date,
    expiresAt: date,
    state: "pending",
    ownText: { output: "plan", hash: "sha256:hash" },
  };
  const mapped = toApproval(row, run, manifest);
  expect(mapped.payload).toEqual({ kind: "text", text: "The plan" });
  expect(mapped.similarGroup).toBeUndefined();
});
