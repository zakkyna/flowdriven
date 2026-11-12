import path from "node:path";
import { expect, test } from "vitest";
import { parseRoute } from "../src/nav/route";
import {
  auditCounts,
  CONNECTOR_WALK_FLOW,
  CONNECTOR_WALK_FLOW_ID,
  CONNECTOR_WALK_STEPS,
  connectorWalkPaths,
  inboxHash,
  isRunInState,
  runHash,
} from "./connector-walk-steps";

test("the walk paths are distinct and under the plan 05b scratch folder", () => {
  const paths = Object.values(connectorWalkPaths("/repo"));
  expect(new Set(paths).size).toBe(3);
  for (const value of paths)
    expect(value.startsWith(`${path.join("/repo", ".workflow/scratch/plan-05b/walk")}${path.sep}`)).toBe(
      true,
    );
});
test("the fixed steps have unique names and valid routes, and runHash and inboxHash parse to the run and inbox screens with their ids", () => {
  expect(CONNECTOR_WALK_STEPS.map((step) => step.name)).toEqual(["touch-before", "touch-after"]);
  expect(new Set(CONNECTOR_WALK_STEPS.map((step) => step.name)).size).toBe(CONNECTOR_WALK_STEPS.length);
  for (const step of CONNECTOR_WALK_STEPS)
    expect(parseRoute(step.hash)).toEqual({ screen: "builder", flowId: CONNECTOR_WALK_FLOW_ID });
  expect(parseRoute(runHash("run /1"))).toEqual({ screen: "run", runId: "run /1" });
  expect(parseRoute(inboxHash("approval /1"))).toEqual({ screen: "inbox", approvalId: "approval /1" });
  expect(CONNECTOR_WALK_STEPS.map((step) => step.waitFor)).toEqual([
    ["What this flow may touch", "Allow"],
    ["Allowed for this version", "Withdraw"],
  ]);
});
test("the check flow declares the gmail requirement with exactly search_threads and delete_draft, the alert query and the hold-test draft id, and is a manual flow with two worker steps", async () => {
  const { parseFlowYaml } = await import("../../../packages/sdk/src/node.ts");
  const { FlowManifest } = await import("../../../packages/sdk/src/index.ts");
  const flow = FlowManifest.parse(parseFlowYaml(CONNECTOR_WALK_FLOW));
  expect(flow.id).toBe("local.gmail-check");
  expect(flow.requirements).toEqual([
    expect.objectContaining({
      id: "gmail",
      type: "mcp_server",
      ref: "connector:gmail",
      connect: "native",
      sensitive: true,
      tools: ["search_threads", "delete_draft"],
    }),
  ]);
  expect(flow.triggers.every((trigger) => trigger.kind === "manual")).toBe(true);
  expect(flow.steps).toHaveLength(2);
  expect(flow.steps).toEqual([
    expect.objectContaining({
      id: "alerts",
      title: "Count the alert threads",
      do: "worker",
      uses: ["gmail"],
      worker: { effort: "low" },
      instructions: expect.stringContaining("from:donotreply@upwork.com newer_than:7d"),
      outputs: [expect.objectContaining({ id: "count", type: "text" })],
    }),
    expect.objectContaining({
      id: "hold",
      title: "Hold test",
      do: "worker",
      uses: ["gmail"],
      worker: { effort: "low" },
      instructions: expect.stringContaining("flowdriven-hold-test-no-such-draft"),
    }),
  ]);
});
test("isRunInState reads a runs list by run id and state and refuses anything that is not a list", () => {
  expect(
    isRunInState(
      [
        { id: "a", state: "waiting_approval" },
        { id: "b", state: "done" },
      ],
      "a",
      ["waiting_approval"],
    ),
  ).toBe(true);
  expect(isRunInState([{ id: "a", state: "done" }], "b", ["done"])).toBe(false);
  expect(isRunInState([{ id: "a", state: "done" }], "a", ["failed"])).toBe(false);
  for (const value of [null, {}, "a", [null, "a", {}]])
    expect(isRunInState(value, "a", ["done"])).toBe(false);
});
test("auditCounts counts the three kinds and prints no detail", () => {
  expect(
    auditCounts(
      [
        { kind: "connector_call", detail: "secret" },
        { kind: "call_held" },
        { kind: "tool_denied" },
        { kind: "other" },
      ],
      ["connector_call", "call_held", "tool_denied"],
    ),
  ).toBe("counts: connector_call=1 call_held=1 tool_denied=1");
  expect(auditCounts(null, ["call_held"])).toBe("counts: call_held=0");
});

test("every step of the check flow has a required check, so the flow can be imported", () => {
  expect(CONNECTOR_WALK_FLOW.match(/^ {4}checks:$/gm)?.length).toBe(2);
  expect(CONNECTOR_WALK_FLOW.match(/^ {6}- \{ type: not_contains, patterns: \["@"\] \}$/gm)?.length).toBe(2);
});
