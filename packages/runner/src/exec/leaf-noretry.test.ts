import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { Routed } from "../router/types.ts";
import type { Script } from "../scripted-harness.ts";
import type { Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
});
const route: Routed = {
  routed: false,
  requirementId: "host",
  type: "web",
  noun: "Web",
  reason: "Unavailable",
};
const worker = {
  id: "a",
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
  retry: 2,
};
async function ready(script: Script, steps: unknown[] = [worker], routeOf?: () => Routed[]) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, script, routeOf ? { routeOf } : {});
  stores.push(c.store);
  return { ...c, start: () => c.engine.startRun("local.test", { project: "/tmp" }) };
}
test("a result with noRetry fails the step at once: one attempt, no re-plan, the step note and the run's blocked reason are the sentence", async () => {
  const c = await ready({
    steps: { a: { exit: "failed", noRetry: "Stop here." } },
    replan: () => ({ instructions: "again" }),
  });
  const run = await c.start();
  expect(run).toMatchObject({ state: "blocked", blockedReason: "Stop here." });
  expect(c.store.getStep(run.id, "a")).toMatchObject({
    state: "failed",
    note: "Stop here.",
    attempts: [{ exit: "failed", endedAt: expect.any(String) }],
  });
  expect(c.harness.calls).toHaveLength(1);
  expect(c.harness.replanCalls).toHaveLength(0);
});
test("in a loop with on_item_fail skip the item fails and the next item still runs; with stop the run is blocked", async () => {
  for (const mode of ["skip", "stop"] as const) {
    const c = await ready(
      {
        steps: {
          list: { text: "ok", outputs: { jobs: [{ id: "j1" }, { id: "j2" }], message: "ok" } },
          a: (req) => (req.itemKey === "j1" ? { exit: "failed", noRetry: "Stop here." } : { text: "ok" }),
        },
      },
      [
        {
          id: "list",
          do: "worker",
          instructions: "List",
          checks: [{ type: "contains", pattern: "ok" }],
          outputs: [
            { id: "jobs", type: "json" },
            { id: "message", type: "text" },
          ],
        },
        {
          id: "loop",
          for_each: "${steps.list.outputs.jobs}",
          as: "job",
          key: "${job.id}",
          on_item_fail: mode,
          steps: [worker],
        },
      ],
    );
    const run = await c.start();
    expect(c.store.listItems(run.id).map((i) => i.status)).toEqual(
      mode === "skip" ? ["failed", "passed"] : ["failed", "skipped"],
    );
    expect(run.state).toBe(mode === "skip" ? "done" : "blocked");
    expect(c.harness.calls.filter((x) => x.stepId === "a").map((x) => x.itemKey)).toEqual(
      mode === "skip" ? ["j1", "j2"] : ["j1"],
    );
  }
});
test("outside true on a result marks the step row, also when the attempt then fails, blocks or is retried", async () => {
  for (const reply of [
    { text: "ok", outside: true },
    { exit: "failed" as const, outside: true, noRetry: "No retry" },
    { block: "Blocked", outside: true },
    [{ exit: "failed" as const, outside: true }, { text: "ok" }],
  ]) {
    const c = await ready({ steps: { a: reply } });
    const run = await c.start();
    expect(c.store.getStep(run.id, "a")?.outside).toBe(true);
    if (Array.isArray(reply)) expect(c.harness.calls).toHaveLength(2);
  }
});
test("a result without outside leaves the row unmarked", async () => {
  const c = await ready({ steps: { a: { text: "ok" } } });
  const run = await c.start();
  expect(c.store.getStep(run.id, "a")?.outside).toBeUndefined();
});
test("onOutside marks the row at once: a scripted step that calls req.onOutside() and then hangs until the time limit leaves the row marked, and so does one that calls it and then throws", async () => {
  vi.useFakeTimers();
  for (const mode of ["hang", "throw"] as const) {
    const c = await ready(
      {
        steps: {
          a: (req) => {
            req.onOutside?.();
            expect(c.store.getStep(req.runId, "a")?.outside).toBe(true);
            if (mode === "throw") throw new Error("failed");
            return { hang: true };
          },
        },
      },
      [{ ...worker, limits: { max_duration: "1m", max_attempts: 1 } }],
    );
    const pending = c.start();
    await vi.advanceTimersByTimeAsync(60_000);
    const run = await pending;
    expect(c.store.getStep(run.id, "a")).toMatchObject({ outside: true, state: "failed" });
  }
});
test("the request carries the run's routes, and an empty list for a run that has none", async () => {
  for (const routes of [undefined, [route]]) {
    const c = await ready({ steps: { a: { text: "ok" } } }, [worker], routes ? () => routes : undefined);
    await c.start();
    expect(c.harness.calls.at(0)?.routes).toEqual(routes ?? []);
  }
});
