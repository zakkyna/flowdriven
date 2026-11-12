import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { Script } from "../scripted-harness.ts";
import type { Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const source = {
  id: "source",
  do: "worker",
  instructions: "Read",
  checks: [{ type: "contains", pattern: "ok" }],
  outputs: [
    { id: "body", type: "text" },
    { id: "jobs", type: "json" },
  ],
};
const worker = {
  id: "work",
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
};
async function ready(steps: unknown[], script: Script) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, script);
  c.engine.registerFlow(
    { ...parsed.manifest, triggers: [{ kind: "webhook", schema: "trigger.json" }] },
    `sha256:${"0".repeat(64)}`,
    { "trigger.json": "{}" },
  );
  stores.push(c.store);
  return c;
}
const reply = (outside: boolean) => ({
  text: "ok",
  outputs: { body: "ok", jobs: [{ id: "j1", title: "ok" }] },
  outside,
});

test("a step whose check pattern takes the output of a marked step is marked before its harness call", async () => {
  let seen: boolean | undefined;
  const c = await ready(
    [source, { ...worker, checks: [{ type: "contains", pattern: "${steps.source.outputs.body}" }] }],
    {
      steps: {
        source: reply(true),
        work: (req) => {
          seen = c.store.getStep(req.runId, "work")?.outside;
          return { text: "ok" };
        },
      },
    },
  );
  const run = await c.engine.startRun("local.test", { project: "/tmp" });
  expect(run.state).toBe("done");
  expect(seen).toBe(true);
});
test("a step inside a loop whose instructions use the item value is marked when the loop's source step is marked, and is not when it is not", async () => {
  for (const outside of [true, false]) {
    const c = await ready(
      [
        source,
        {
          id: "loop",
          for_each: "${steps.source.outputs.jobs}",
          as: "job",
          key: "${job.id}",
          steps: [{ ...worker, instructions: "${job.title}" }],
        },
      ],
      { steps: { source: reply(outside), work: { text: "ok" } } },
    );
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(run.state).toBe("done");
    expect(c.store.getStep(run.id, "work", "j1")?.outside).toBe(outside ? true : undefined);
  }
});
test("a step that uses ${trigger.payload.x} is marked in a run started by a webhook and not in a manual run", async () => {
  for (const kind of ["webhook", "manual"]) {
    const c = await ready([{ ...worker, instructions: "${trigger.payload.x}" }], {
      steps: { work: { text: "ok" } },
    });
    const run = await c.engine.startRun("local.test", {
      project: "/tmp",
      trigger: { kind, payload: { x: "ok" } },
    });
    expect(run.state).toBe("done");
    expect(c.store.getStep(run.id, "work")?.outside).toBe(kind === "webhook" ? true : undefined);
  }
});
test("an ask whose step row is marked gives an approval with outside true, and the approval of an unmarked ask has no outside key", async () => {
  for (const outside of [true, false]) {
    const c = await ready(
      [
        source,
        {
          id: "pick",
          do: "ask",
          ask: { question: "Pick", choose_from: "${steps.source.outputs.jobs}", max_pick: 1 },
        },
      ],
      { steps: { source: reply(outside) } },
    );
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(run.state).toBe("waiting_approval");
    const approval = c.store.listApprovals({ runId: run.id }).at(0);
    expect(c.store.getStep(run.id, "pick")?.outside).toBe(outside ? true : undefined);
    expect(approval).toBeDefined();
    if (!approval) throw new Error("missing approval");
    expect(Object.hasOwn(approval, "outside")).toBe(outside);
    if (outside) expect(approval.outside).toBe(true);
  }
});
test("the present behaviour is kept: a step that takes only an unmarked step's output stays unmarked", async () => {
  const c = await ready([source, { ...worker, instructions: "${steps.source.outputs.body}" }], {
    steps: { source: reply(false), work: { text: "ok" } },
  });
  const run = await c.engine.startRun("local.test", { project: "/tmp" });
  expect(run.state).toBe("done");
  expect(c.store.getStep(run.id, "work")?.outside).toBeUndefined();
});
