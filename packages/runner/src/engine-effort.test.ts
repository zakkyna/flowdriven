import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { setup } from "./test-helpers/engine.ts";
import { oneStepFlow } from "./test-helpers/flows.ts";

test("a low step with room: low, low, medium, then the re-plan, whose attempt also runs at medium", async () => {
  const { engine, harness } = await setup(oneStepFlow("local.e", { retry: 1, effort: "low" }), {
    steps: { a: () => ({ exit: "failed" }) },
    replan: () => ({ instructions: "again" }),
  });
  expect((await engine.beginStart("local.e", { project: tmpdir() }).settled).state).toBe("blocked");
  expect(harness.calls.map((c) => c.effort)).toEqual(["low", "low", "medium", "medium"]);
  expect(harness.replanCalls).toHaveLength(1);
});
test("with max_attempts 3 the re-plan keeps its attempt and no medium attempt happens", async () => {
  const { engine, harness } = await setup(
    oneStepFlow("local.e", { retry: 1, effort: "low", limits: { max_attempts: 3 } }),
    { steps: { a: () => ({ exit: "failed" }) }, replan: () => ({ instructions: "again" }) },
  );
  expect((await engine.beginStart("local.e", { project: tmpdir() }).settled).state).toBe("blocked");
  expect(harness.calls.map((c) => c.effort)).toEqual(["low", "low", "low"]);
  expect(harness.replanCalls).toHaveLength(1);
});
