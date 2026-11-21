import { expect, test } from "vitest";
import { LeafStepRun, RunDetail, RunState, RunSummary, WAITING_REASONS, Waiting } from "./index.ts";

test("the four waiting reasons of spec 21.8, with a time when one is known", () => {
  expect(WAITING_REASONS).toEqual(["memory", "quota", "ceiling", "flow_overlap"]);
  expect(
    Waiting.parse({ reason: "quota", until: "2026-11-11T14:05:00.000Z", harnessId: "claude-code" }).until,
  ).toBeDefined();
  expect(Waiting.parse({ reason: "ceiling", running: 4, ceiling: 4 }).running).toBe(4);
  expect(Waiting.safeParse({ reason: "disk" }).success).toBe(false);
});
test("there is no new run state", () => {
  expect(RunState.options).toEqual([
    "queued",
    "checking",
    "blocked",
    "running",
    "waiting_approval",
    "retrying",
    "interrupted",
    "done",
    "failed",
  ]);
});
test("a run summary may carry a waiting reason", () => {
  const base = {
    id: "r",
    flowId: "f",
    flowName: "F",
    flowVersion: "1.0.0",
    oneTime: false,
    project: "/p",
    state: "queued",
    startedAt: "2026-11-11T09:00:00.000Z",
  };
  expect(RunSummary.parse({ ...base, waiting: { reason: "flow_overlap" } }).waiting?.reason).toBe(
    "flow_overlap",
  );
});
test("steps and run details accept optional waiting reasons and reject invalid counts", () => {
  expect(LeafStepRun.shape.waiting.safeParse({ reason: "memory" }).success).toBe(true);
  expect(LeafStepRun.shape.waiting.safeParse(undefined).success).toBe(true);
  expect(RunDetail.shape.waiting.safeParse({ reason: "memory" }).success).toBe(true);
  expect(Waiting.safeParse({ reason: "ceiling", running: -1 }).success).toBe(false);
  expect(Waiting.safeParse({ reason: "ceiling", ceiling: 0 }).success).toBe(false);
  expect(Waiting.safeParse({ reason: "ceiling", running: 1.5 }).success).toBe(false);
});
