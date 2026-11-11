import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import type { StepRequest, StepResult } from "../harness.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { setup } from "../test-helpers/engine.ts";
import { gate, OK, oneStepFlow } from "../test-helpers/flows.ts";

afterEach(() => vi.useRealTimers());
for (const [pause, state] of [
  [true, "done"],
  [false, "blocked"],
] as const) {
  test(`five minutes in the queue against a one minute limit: ${pause ? "paused, the step passes" : "not paused, the step times out"}`, async () => {
    vi.useFakeTimers();
    const g = gate();
    let resume: () => void = () => {};
    const harness = {
      ...scriptedHarness({}),
      runStep: async (req: StepRequest): Promise<StepResult> => {
        if (pause) resume = req.pauseLimit?.() ?? resume;
        await g.wait();
        resume();
        return OK;
      },
    };
    const { engine } = await setup(
      oneStepFlow("local.pause", { limits: { max_duration: "1m", max_attempts: 1 } }),
      {},
      { harness },
    );
    const begun = engine.beginStart("local.pause", { project: tmpdir() });
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    g.release();
    expect((await begun.settled).state).toBe(state);
    resume(); // a resume after the attempt ended must arm nothing
    expect(vi.getTimerCount()).toBe(0);
  });
}
