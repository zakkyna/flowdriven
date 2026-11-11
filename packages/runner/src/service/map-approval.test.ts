import { Approval } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, RunRow } from "../storage.ts";
import { toApproval } from "./map-approval.ts";

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
const row: ApprovalRow = {
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
  state: "pending",
};
test("an ask becomes a choice approval without the items", () => {
  const a = Approval.parse(toApproval(row, run, manifest));
  expect(a.payload).toEqual({
    kind: "choice",
    question: "Pick",
    options: [{ key: "j1", label: "Job one" }],
    maxPick: 1,
    approves: [],
  });
  expect(a.itemKey).toBeUndefined();
  expect(a.editable).toBe(false);
});
test("a sign-off becomes a text approval with its item key and the title of a nested step; resolved states keep picks and resolvedAt", () => {
  const a = Approval.parse(
    toApproval(
      {
        ...row,
        kind: "result_sign_off",
        stepId: "proposal",
        itemKey: "j1",
        payload: "Draft",
        state: "approved",
        picks: ["j1"],
        resolvedAt: date,
      },
      run,
      manifest,
    ),
  );
  expect(a.payload).toEqual({ kind: "text", text: "Draft" });
  expect(a.itemKey).toBe("j1");
  expect(a.stepTitle).toBe("proposal");
  expect(a.picks).toEqual(["j1"]);
  expect(a.resolvedAt).toBe(date);
});
