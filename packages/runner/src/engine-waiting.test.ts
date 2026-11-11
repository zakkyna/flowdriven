import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { scriptedHarness } from "./scripted-harness.ts";
import { setup } from "./test-helpers/engine.ts";
import { gate, OK, oneStepFlow } from "./test-helpers/flows.ts";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
test("a second run of the same flow waits for the earlier run, says so, and loses the reason when its turn comes", async () => {
  const g = gate();
  const harness = {
    ...scriptedHarness({}),
    runStep: async () => {
      await g.wait();
      return OK;
    },
  };
  const { engine } = await setup(oneStepFlow("local.wait"), {}, { harness, queue: { waitingOf: () => [] } });
  const a = engine.beginStart("local.wait", { project: tmpdir() });
  const b = engine.beginStart("local.wait", { project: tmpdir() });
  expect(b.run.state).toBe("queued");
  expect(engine.waitingOf(b.run.id)).toEqual({ run: { reason: "flow_overlap" }, steps: [] });
  expect(engine.waitingOf(a.run.id)).toEqual({ steps: [] });
  g.release();
  await a.settled;
  await flush();
  expect(engine.waitingOf(b.run.id).run).toBeUndefined();
  g.release();
  expect((await b.settled).state).toBe("done");
});
test("a step that waits at the keeper is the reason of its run, which keeps its state", async () => {
  const g = gate();
  const entry = { stepId: "a", itemKey: "", waiting: { reason: "ceiling" as const, running: 1, ceiling: 1 } };
  const harness = {
    ...scriptedHarness({}),
    runStep: async () => {
      await g.wait();
      return OK;
    },
  };
  const { engine } = await setup(
    oneStepFlow("local.wait"),
    {},
    { harness, queue: { waitingOf: (id) => (id === "run-1" ? [entry] : []) } },
  );
  const a = engine.beginStart("local.wait", { project: tmpdir() });
  await flush();
  expect(engine.waitingOf("run-1")).toEqual({ run: entry.waiting, steps: [entry] });
  expect(engine.getRun("run-1").waiting).toEqual(engine.waitingOf("run-1"));
  expect(engine.getRun("run-1").run.state).toBe("running");
  g.release();
  expect((await a.settled).state).toBe("done");
});
