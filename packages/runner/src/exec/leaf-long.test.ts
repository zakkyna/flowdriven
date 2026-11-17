import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import type { Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";
import { oneStepFlow } from "../test-helpers/flows.ts";

const stores: Store[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});

async function ready(duration?: string, keepAwake?: (pid: number) => void) {
  const c = await setup(
    oneStepFlow("local.long", { retry: 1, ...(duration ? { limits: { max_duration: duration } } : {}) }),
    {
      steps: { a: { hang: true } },
    },
    { keepAwake },
  );
  stores.push(c.store);
  return c;
}

test("a step with a 150-minute limit that ran out is not tried again and the step says why", {
  timeout: 20_000,
}, async () => {
  vi.useFakeTimers();
  const c = await ready("150m");
  const run = c.engine.beginStart("local.long", { project: tmpdir() });
  await vi.waitFor(() => expect(c.harness.calls).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(150 * 60_000);
  const result = await run.settled;
  const note = "This step ran for its whole time limit of 150 minutes, so FlowDriven does not try it again.";
  expect(result).toMatchObject({ state: "blocked", blockedReason: note });
  expect(c.store.getStep(result.id, "a")).toMatchObject({
    state: "failed",
    note,
    attempts: [{ exit: "failed" }],
  });
  expect(c.harness.calls).toHaveLength(1);
});

test("a step with the default 30-minute limit that ran out is tried again as before", {
  timeout: 20_000,
}, async () => {
  vi.useFakeTimers();
  const c = await ready();
  const run = c.engine.beginStart("local.long", { project: tmpdir() });
  await vi.waitFor(() => expect(c.harness.calls).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  await vi.waitFor(() => expect(c.harness.calls).toHaveLength(2));
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect((await run.settled).state).toBe("blocked");
  expect(c.harness.calls).toHaveLength(2);
});

test("the step row keeps its time limit in limitMs", { timeout: 20_000 }, async () => {
  vi.useFakeTimers();
  const c = await ready("150m");
  const run = c.engine.beginStart("local.long", { project: tmpdir() });
  await vi.waitFor(() => expect(c.store.getStep(run.run.id, "a")?.limitMs).toBe(150 * 60_000));
  await vi.waitFor(() => expect(c.harness.calls).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(150 * 60_000);
  await run.settled;
});

test("keepAwake gets the child's pid for a step over 30 minutes, and is not called for a shorter step", {
  timeout: 20_000,
}, async () => {
  vi.useFakeTimers();
  const keepAwake = vi.fn();
  for (const duration of ["150m", "30m"]) {
    const c = await ready(duration, keepAwake);
    const run = c.engine.beginStart("local.long", { project: tmpdir() });
    await vi.waitFor(() => expect(c.harness.calls).toHaveLength(1));
    c.harness.calls.at(0)?.onStart?.(42);
    await vi.advanceTimersByTimeAsync(duration === "150m" ? 150 * 60_000 : 30 * 60_000);
    if (duration === "30m") {
      await vi.waitFor(() => expect(c.harness.calls).toHaveLength(2));
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    }
    await run.settled;
  }
  expect(keepAwake).toHaveBeenCalledExactlyOnceWith(42);
});
