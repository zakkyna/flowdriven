import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";
import { legacyGrant } from "./test-helpers/policy-fixture.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const timeout = { timeout: 20_000 };
async function ready(block = false) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.pick",
    name: "Pick",
    kind: "build",
    requirements: [{ id: "host", type: "mcp_server", tools: ["publish"] }],
    steps: [
      {
        id: "find",
        do: "worker",
        instructions: "Find",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "ok" }],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Pick",
          choose_from: "${steps.find.outputs.jobs}",
          max_pick: 2,
          approves: ["host.publish"],
        },
      },
      {
        id: "build",
        for_each: "${steps.pick.outputs.choice}",
        as: "job",
        steps: [
          {
            id: "publish",
            do: "worker",
            instructions: "Publish ${job.id}",
            checks: [{ type: "contains", pattern: "ok" }],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  let blocked = block;
  const c = await setup(parsed.manifest, {
    steps: {
      find: {
        text: "ok",
        outputs: {
          jobs: [
            { id: "j1", title: "One" },
            { id: "j2", title: "Two" },
          ],
          message: "ok",
        },
      },
      publish: () => (blocked ? { exit: "quota" } : { text: "ok" }),
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "/tmp" });
  const approval = c.store.listApprovals({ state: "pending" }).at(0);
  if (!approval) throw new Error(`Missing approval: ${JSON.stringify(run)}`);
  return {
    ...c,
    run,
    approval,
    unblock: () => {
      blocked = false;
    },
  };
}

test(
  "the keyless loop over the choice keys its items with the picked keys, in option order",
  timeout,
  async () => {
    const c = await ready();
    expect((await c.engine.answerAsk(c.approval.id, { picks: ["j2", "j1"] })).state).toBe("done");
    expect(c.store.listItems(c.run.id, "build").map((i) => i.key)).toEqual(["j1", "j2"]);
    expect(
      c.harness.calls.filter((r) => r.stepId === "publish").map((r) => [r.itemKey, r.pickTools]),
    ).toEqual([
      ["j1", ["host.publish"]],
      ["j2", ["host.publish"]],
    ]);
  },
);

test("resuming the run after a crash keeps the keys and releases as before", timeout, async () => {
  const c = await ready(true);
  expect((await c.engine.answerAsk(c.approval.id, { picks: ["j1"] })).state).toBe("blocked");
  c.store.updateRun(c.run.id, { state: "interrupted" });
  c.unblock();
  expect((await c.engine.resumeRun(c.run.id)).state).toBe("done");
  expect(c.harness.calls.filter((r) => r.stepId === "publish").map((r) => [r.itemKey, r.pickTools])).toEqual([
    ["j1", ["host.publish"]],
    ["j1", ["host.publish"]],
  ]);
  expect(!!c.store.findPickGrant(legacyGrant(c.run.id, "*", "j1", "host.publish"))).toBe(true);
});

test("the keyless loop over the choice writes no seen keys", timeout, async () => {
  const c = await ready();
  await c.engine.answerAsk(c.approval.id, { picks: ["j1"] });
  expect(c.store.listItems(c.run.id, "build").map((i) => i.key)).toEqual(["j1"]);
  expect(c.store.isSeen("local.pick", "build", "j1")).toBe(false);
});

test("a missing approval for the ask blocks the loop with its sentence", timeout, async () => {
  const c = await ready();
  const list = c.store.listApprovals.bind(c.store);
  c.store.listApprovals = (filter) => list(filter).filter((a) => a.state !== "approved");
  expect(await c.engine.answerAsk(c.approval.id, { picks: ["j1"] })).toMatchObject({
    state: "blocked",
    blockedReason: "The picks of pick cannot be matched to this loop.",
  });
});
