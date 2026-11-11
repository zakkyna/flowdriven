import path from "node:path";
import { expect, test } from "vitest";
import { parseRoute } from "../src/nav/route";
import { isTriggeredRunDone, TRIGGER_WALK_STEPS, triggerWalkPaths } from "./trigger-walk-steps";

test("the walk paths are distinct and under the scratch folder", () => {
  const paths = Object.values(triggerWalkPaths("/repo"));
  expect(new Set(paths).size).toBe(3);
  for (const value of paths)
    expect(value.startsWith(`${path.join("/repo", ".workflow/scratch/plan-04/walk")}${path.sep}`)).toBe(true);
});

test("the walk steps have unique names and valid routes", () => {
  expect(new Set(TRIGGER_WALK_STEPS.map((step) => step.name)).size).toBe(TRIGGER_WALK_STEPS.length);
  for (const step of TRIGGER_WALK_STEPS) expect(parseRoute(step.hash).screen).not.toBe("not_found");
});

test("only a terminal schedule run is complete", () => {
  expect(isTriggeredRunDone([{ trigger: { kind: "schedule" }, state: "done" }])).toBe(true);
  expect(isTriggeredRunDone([{ trigger: { kind: "schedule" }, state: "blocked" }])).toBe(true);
  expect(isTriggeredRunDone([{ trigger: { kind: "schedule" }, state: "failed" }])).toBe(true);
  expect(isTriggeredRunDone([{ trigger: { kind: "manual" }, state: "done" }])).toBe(false);
  expect(isTriggeredRunDone([{ trigger: { kind: "schedule" }, state: "running" }])).toBe(false);
  expect(isTriggeredRunDone([])).toBe(false);
  expect(isTriggeredRunDone(null)).toBe(false);
  expect(isTriggeredRunDone({})).toBe(false);
});
