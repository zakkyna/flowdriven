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
const pageStep = {
  id: "page",
  do: "worker",
  instructions: "Read the page",
  checks: [{ type: "contains", pattern: "ok" }],
  outputs: [{ id: "body", type: "text" }],
};
const plainStep = {
  id: "plain",
  do: "worker",
  instructions: "Make a note",
  checks: [{ type: "contains", pattern: "ok" }],
  outputs: [{ id: "note", type: "text" }],
};
const nextStep = {
  id: "next",
  do: "worker",
  instructions: "Summarize ${steps.page.outputs.body}",
  checks: [{ type: "contains", pattern: "ok" }],
};
test("a step whose instructions take an output of a step marked outside is marked outside too, before its harness call", async () => {
  const seen: Array<boolean | undefined> = [];
  const c = await ready(
    {
      steps: {
        page: { text: "ok", outside: true, outputs: { body: "ok" } },
        next: (req) => {
          seen.push(c.store.getStep(req.runId, "next")?.outside);
          return { text: "ok" };
        },
      },
    },
    [pageStep, nextStep],
  );
  const run = await c.start();
  expect(run.state).toBe("done");
  expect(seen).toEqual([true]);
  expect(c.store.getStep(run.id, "next")?.outside).toBe(true);
});
test("a step that takes an output of an unmarked step, or no output at all, is not marked", async () => {
  const c = await ready(
    {
      steps: {
        page: { text: "ok", outputs: { body: "ok" } },
        plain: { text: "ok", outside: true, outputs: { note: "ok" } },
        next: { text: "ok" },
        alone: { text: "ok" },
      },
    },
    [
      pageStep,
      { ...plainStep, instructions: "Make a note, no output taken" },
      nextStep,
      { ...worker, id: "alone", instructions: "Do it alone" },
    ],
  );
  const run = await c.start();
  expect(run.state).toBe("done");
  expect(c.store.getStep(run.id, "page")?.outside).toBeUndefined();
  expect(c.store.getStep(run.id, "next")?.outside).toBeUndefined();
  // a marked step that nothing takes an output from does not mark the step after it
  expect(c.store.getStep(run.id, "plain")?.outside).toBe(true);
  expect(c.store.getStep(run.id, "alone")?.outside).toBeUndefined();
});
test("inside a loop the mark follows the row of the same item, and an item whose page step was not marked stays unmarked", async () => {
  const c = await ready(
    {
      steps: {
        list: { text: "ok", outputs: { jobs: [{ id: "j1" }, { id: "j2" }], message: "ok" } },
        page: (req) => ({ text: "ok", outputs: { body: "ok" }, outside: req.itemKey === "j1" }),
        next: { text: "ok" },
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
        steps: [pageStep, { ...nextStep, instructions: "Summarize ${page.outputs.body}" }],
      },
    ],
  );
  const run = await c.start();
  expect(run.state).toBe("done");
  expect(c.store.getStep(run.id, "next", "j1")?.outside).toBe(true);
  expect(c.store.getStep(run.id, "next", "j2")?.outside).toBeUndefined();
  expect(c.store.getStep(run.id, "page", "j2")?.outside).toBeUndefined();
});
test("the mark is kept when the marked step fails, blocks or is tried again", async () => {
  for (const reply of [
    { exit: "failed" as const, outside: true, noRetry: "No retry" },
    { block: "Blocked", outside: true },
    [
      { exit: "failed" as const, outside: true },
      { text: "ok", outputs: { body: "ok" } },
    ],
  ]) {
    const c = await ready({ steps: { page: reply, next: { text: "ok" } } }, [pageStep, nextStep]);
    const run = await c.start();
    expect(c.store.getStep(run.id, "page")?.outside).toBe(true);
    if (Array.isArray(reply)) {
      // the step after it takes the output of the retried step, which is still marked
      expect(run.state).toBe("done");
      expect(c.store.getStep(run.id, "next")?.outside).toBe(true);
    } else {
      expect(c.store.getStep(run.id, "next")).toBeUndefined();
    }
  }
});
const jobsStep = {
  id: "page",
  do: "worker",
  instructions: "Read the page",
  checks: [{ type: "contains", pattern: "ok" }],
  outputs: [
    { id: "jobs", type: "json" },
    { id: "body", type: "text" },
  ],
};
const askStep = {
  id: "pick",
  do: "ask",
  ask: { question: "Pick one", choose_from: "${steps.page.outputs.jobs}", max_pick: 1 },
};
const afterAsk = {
  id: "next",
  do: "worker",
  instructions: "Review ${steps.pick.outputs.choice}",
  checks: [{ type: "contains", pattern: "ok" }],
};
test("an ask whose choose_from takes an output of a marked step is marked outside, and the step that takes its choice is marked too", async () => {
  const c = await ready(
    {
      steps: {
        page: { text: "ok", outside: true, outputs: { jobs: [{ id: "j1", title: "T" }], body: "ok" } },
        next: { text: "ok" },
      },
    },
    [jobsStep, askStep, afterAsk],
  );
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  const approval = c.engine.listApprovals({ state: "pending" }).at(0);
  if (!approval) throw new Error("missing approval");
  const after = await c.engine.answerAsk(approval.id, { picks: ["j1"] });
  expect(after.state).toBe("done");
  expect(c.store.getStep(run.id, "page")?.outside).toBe(true);
  expect(c.store.getStep(run.id, "pick")?.outside).toBe(true);
  expect(c.store.getStep(run.id, "next")?.outside).toBe(true);
});
test("an ask that takes nothing from a marked step is not marked, and neither is the step after it", async () => {
  const c = await ready(
    {
      steps: {
        page: { text: "ok", outside: true, outputs: { jobs: [{ id: "j1" }], body: "ok" } },
        list: { text: "ok", outputs: { jobs: [{ id: "k1", title: "K" }], body: "ok" } },
        next: { text: "ok" },
      },
    },
    [
      jobsStep,
      { ...jobsStep, id: "list" },
      { ...askStep, ask: { ...askStep.ask, choose_from: "${steps.list.outputs.jobs}" } },
      afterAsk,
    ],
  );
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  const approval = c.engine.listApprovals({ state: "pending" }).at(0);
  if (!approval) throw new Error("missing approval");
  const after = await c.engine.answerAsk(approval.id, { picks: ["k1"] });
  expect(after.state).toBe("done");
  expect(c.store.getStep(run.id, "page")?.outside).toBe(true);
  expect(c.store.getStep(run.id, "pick")?.outside).toBeUndefined();
  expect(c.store.getStep(run.id, "next")?.outside).toBeUndefined();
});
test("the ask's mark is there before the owner answers", async () => {
  const c = await ready(
    {
      steps: {
        page: { text: "ok", outside: true, outputs: { jobs: [{ id: "j1" }], body: "ok" } },
        next: { text: "ok" },
      },
    },
    [jobsStep, askStep, afterAsk],
  );
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  expect(c.store.getStep(run.id, "pick")).toMatchObject({ state: "waiting_approval", outside: true });
  expect(c.store.getStep(run.id, "next")).toBeUndefined();
});
