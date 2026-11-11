import { expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { createDemoHarness } from "./demo-harness.ts";

function request(runId: string, stepId: string, instructions = ""): StepRequest {
  return {
    runId,
    stepId,
    instructions,
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "",
    uses: [],
    project: "/tmp/p",
    requirements: [],
    outputs: [],
    maxDurationMs: 1000,
    signal: new AbortController().signal,
  };
}
test("the first run uses the first batch, the next the second, and then it starts over", async () => {
  const h = createDemoHarness({ runIndex: (id) => Number(id) });
  for (const [id, expected] of [
    ["0", ["j1", "j2", "j3", "j4"]],
    ["1", ["j3", "j4", "j5"]],
    ["2", ["j1", "j2", "j3", "j4"]],
  ] as const) {
    const result = await h.runStep(request(id, "alerts"));
    expect(result.outputs.jobs).toEqual(expected.map((key) => expect.objectContaining({ id: key })));
  }
});
test("replies like the engine demo", async () => {
  const h = createDemoHarness({ runIndex: () => 0 });
  const instructions = '{"id":"j1"}';
  expect((await h.runStep(request("a", "rough", instructions))).outputs).toEqual({ score: { value: 9 } });
  expect((await h.runStep(request("a", "page", instructions))).text).toBe("Full post: Job one");
  expect((await h.runStep(request("a", "full", instructions))).outputs).toEqual({ verdict: { fit: true } });
  expect((await h.runStep(request("a", "proto", instructions))).text).toBe("Published at /p/j1");
  expect((await h.runStep(request("a", "proposal", instructions))).text).toBe(
    "Hello, here is my plan for Job one.",
  );
});
