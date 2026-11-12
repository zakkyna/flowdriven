import path from "node:path";
import { expect, test } from "vitest";
import { parseRoute } from "../src/nav/route";
import {
  BROWSER_WALK_STEPS,
  browserWalkFlowFile,
  browserWalkPaths,
  isPageRunDone,
} from "./browser-walk-steps";

test("the walk paths are distinct and under the plan 05 scratch folder", () => {
  const paths = Object.values(browserWalkPaths("/repo"));
  expect(new Set(paths).size).toBe(3);
  for (const value of paths)
    expect(value.startsWith(`${path.join("/repo", ".workflow/scratch/plan-05/walk")}${path.sep}`)).toBe(true);
});

test("the steps have unique names and valid routes", () => {
  expect(new Set(BROWSER_WALK_STEPS.map((step) => step.name)).size).toBe(BROWSER_WALK_STEPS.length);
  expect(BROWSER_WALK_STEPS.map((step) => step.name)).toEqual(["touch-before", "touch-after", "run-page"]);
  for (const step of BROWSER_WALK_STEPS) expect(parseRoute(step.hash).screen).not.toBe("not_found");
});

test("only a terminal run of local.chrome-check is complete", () => {
  const run = (flowId: string, state: string) => ({ flowId, state });
  expect(isPageRunDone([run("local.chrome-check", "done")])).toBe(true);
  expect(isPageRunDone([run("local.chrome-check", "blocked")])).toBe(true);
  expect(isPageRunDone([run("local.chrome-check", "failed")])).toBe(true);
  expect(isPageRunDone([run("local.other", "done")])).toBe(false);
  expect(isPageRunDone([run("local.chrome-check", "running")])).toBe(false);
  expect(isPageRunDone([run("local.chrome-check", "waiting_approval")])).toBe(false);
  expect(isPageRunDone([])).toBe(false);
  expect(isPageRunDone(null)).toBe(false);
  expect(isPageRunDone({})).toBe(false);
  expect(isPageRunDone(["local.chrome-check"])).toBe(false);
});

test("the walk takes another check flow only when BROWSER_WALK_FLOW_FILE names one", () => {
  expect(browserWalkFlowFile({})).toBeUndefined();
  expect(browserWalkFlowFile({ BROWSER_WALK_FLOW_FILE: "" })).toBeUndefined();
  expect(browserWalkFlowFile({ BROWSER_WALK_FLOW_FILE: "/scratch/u5/flow.yaml" })).toBe(
    "/scratch/u5/flow.yaml",
  );
});
