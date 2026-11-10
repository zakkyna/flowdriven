import { expect, test } from "vitest";
import { flowState } from "./flow-state";
import { statusOf } from "./status";

test("a flow shows the state of its last run, or that it has no runs", () => {
  expect(
    flowState({ lastRun: { runId: "run-0006", state: "blocked", startedAt: "2026-11-10T08:40:00.000Z" } }),
  ).toEqual(statusOf("run", "blocked"));
  expect(flowState({})).toEqual({ icon: "dash", label: "No runs yet", tone: "neutral" });
});
