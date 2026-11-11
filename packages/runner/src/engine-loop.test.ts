import { parseManifest, type Value } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { createEngine } from "./engine.ts";
import { type Script, scriptedHarness } from "./scripted-harness.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  cleanup();
});
const jobs = (...ids: string[]) => ids.map((id) => ({ id }));
function flow(extra: Record<string, unknown> = {}, nested?: unknown[]) {
  const result = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.f",
    name: "Test",
    kind: "build",
    params: { min_score: { type: "number", default: 7 } },
    steps: [
      {
        id: "alerts",
        do: "worker",
        instructions: "Find jobs",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "j1" }],
      },
      {
        id: "review",
        for_each: "${steps.alerts.outputs.jobs}",
        as: "job",
        key: "${job.id}",
        ...extra,
        steps: nested ?? [
          {
            id: "rough",
            do: "agent",
            instructions: "Score ${job}",
            outputs: [
              { id: "score", type: "json" },
              { id: "message", type: "text" },
            ],
            checks: [{ type: "contains", pattern: "ok" }],
          },
          {
            id: "page",
            do: "worker",
            instructions: "Page",
            when: "rough.score.value >= params.min_score",
            checks: [{ type: "contains", pattern: "ok" }],
          },
          {
            id: "full",
            do: "agent",
            instructions: "Full",
            when: "page.passed",
            checks: [{ type: "contains", pattern: "ok" }],
          },
        ],
      },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}
const script = (list: Value[]): Script => ({
  steps: {
    alerts: { text: "j1", outputs: { jobs: list, message: "ok" } },
    rough: { text: "ok", outputs: { score: { value: 9 }, message: "ok" } },
    page: { text: "ok" },
    full: { text: "ok" },
  },
});
async function ready(
  list: Value[],
  extra: Record<string, unknown> = {},
  nested?: unknown[],
  custom?: Script,
) {
  const c = await setup(flow(extra, nested), custom ?? script(list));
  stores.push(c.store);
  return c;
}
const start = (c: Awaited<ReturnType<typeof ready>>) => c.engine.startRun("local.f", { project: "/tmp" });

test("runs the nested steps once per item and exposes the items", async () => {
  const c = await ready(jobs("j1", "j2", "j3"));
  const run = await start(c);
  expect(c.engine.getRun(run.id).items.map((i) => [i.key, i.status])).toEqual([
    ["j1", "passed"],
    ["j2", "passed"],
    ["j3", "passed"],
  ]);
  expect(c.harness.calls.filter((x) => x.stepId === "rough").map((x) => x.itemKey)).toEqual([
    "j1",
    "j2",
    "j3",
  ]);
});
test("a condition inside a loop sees the item's earlier steps", async () => {
  const s = script(jobs("j1", "j2", "j3"));
  s.steps = {
    ...s.steps,
    rough: (req) => ({
      text: "ok",
      outputs: {
        score: req.itemKey === "j1" ? { value: 9 } : req.itemKey === "j2" ? { value: 4 } : ({} as Value),
        message: "ok",
      },
    }),
  };
  const c = await ready([], {}, undefined, s);
  const run = await start(c);
  expect(c.harness.calls.filter((x) => x.stepId === "page").map((x) => x.itemKey)).toEqual(["j1"]);
  expect(c.store.getStep(run.id, "page", "j2")?.state).toBe("skipped");
  expect(c.store.getStep(run.id, "page", "j3")?.state).toBe("skipped");
  expect(c.store.getStep(run.id, "full", "j2")?.state).toBe("skipped");
});
test("a second run skips the items the first one saw", async () => {
  const path = tempPath();
  let store = await openSqliteStore(path);
  stores.push(store);
  const c = await ready(jobs("j1", "j2", "j3"), {}, undefined, script(jobs("j1", "j2", "j3")));
  const first = createEngine({ store, harness: c.harness, now: c.clock.now, newId: (p) => `${p}-first` });
  first.registerFlow(flow(), "hash");
  await first.startRun("local.f", { project: "/tmp" });
  store.close();
  stores.splice(stores.indexOf(store), 1);
  store = await openSqliteStore(path);
  stores.push(store);
  const harness = scriptedHarness(script(jobs("j2", "j3", "j4")));
  const engine = createEngine({ store, harness, now: c.clock.now, newId: (p) => `${p}-second` });
  const run = await engine.startRun("local.f", { project: "/tmp" });
  const items = engine.getRun(run.id).items;
  expect(items.slice(0, 2).map((i) => i.note)).toEqual([
    "skipped: seen in an earlier run",
    "skipped: seen in an earlier run",
  ]);
  expect(harness.calls.filter((x) => x.stepId === "rough").map((x) => x.itemKey)).toEqual(["j4"]);
});
test("does not mark failed or capped items seen", async () => {
  const list = Array.from({ length: 500 }, (_, i) => ({ id: `j${i + 1}` }));
  const s = script(list);
  s.steps = {
    ...s.steps,
    rough: (req) => ({
      text: req.itemKey === "j2" ? "bad" : "ok",
      outputs: { score: { value: 9 }, message: "ok" },
    }),
  };
  const c = await ready(list, { max: 20 }, undefined, s);
  const run = await start(c);
  const items = c.engine.getRun(run.id).items;
  expect(c.store.isSeen("local.f", "review", "j2")).toBe(false);
  expect(run.state).toBe("done");
  expect(items.filter((i) => i.status === "passed" || i.status === "failed")).toHaveLength(20);
  expect(items.filter((i) => i.status === "skipped").length).toBe(480);
  expect(c.store.listAudit(run.id)).toContainEqual({
    at: expect.any(String),
    kind: "items_capped",
    runId: "run-1",
    detail: { loop: "review", dropped: 480 },
  });
  const before = c.harness.calls.length;
  await start(c);
  expect([
    ...new Set(
      c.harness.calls
        .slice(before)
        .filter((x) => x.stepId === "rough")
        .map((x) => x.itemKey),
    ),
  ]).toEqual(["j2", ...Array.from({ length: 19 }, (_, i) => `j${i + 21}`)]);
});
test("drops duplicate keys inside one list and never marks a loop without key seen", async () => {
  const c = await ready(jobs("j1", "j1", "j2"));
  const run = await start(c);
  expect(c.engine.getRun(run.id).items.map((i) => [i.key, i.note])).toContainEqual([
    "j1",
    "skipped: duplicate key",
  ]);
  expect(c.harness.calls.filter((x) => x.stepId === "rough").map((x) => x.itemKey)).toEqual(["j1", "j2"]);
  const d = await ready(jobs("j1", "j2"), { key: undefined });
  await start(d);
  await start(d);
  expect(d.harness.calls.filter((x) => x.stepId === "rough")).toHaveLength(4);
  expect(d.store.isSeen("local.f", "review", "#0")).toBe(false);
});
test("on_item_fail stop ends the loop and blocks the run", async () => {
  const s = script(jobs("j1", "j2", "j3"));
  s.steps = { ...s.steps, "rough@j2": { text: "bad", outputs: { score: { value: 9 }, message: "ok" } } };
  const c = await ready([], { on_item_fail: "stop" }, undefined, s);
  const run = await start(c);
  const items = c.engine.getRun(run.id).items;
  expect(items.map((i) => i.status)).toEqual(["passed", "failed", "skipped"]);
  expect(items.at(2)?.note).toBe("skipped: stopped after an item failed");
  expect(run).toMatchObject({ state: "blocked", blockedReason: 'Blocked at step "review": item j2 failed.' });
});
test("a user check on a nested step holds the run; approve finishes the item and marks it seen", async () => {
  const nested = [{ id: "draft", do: "worker", instructions: "Draft", checks: [{ type: "user" }] }];
  const s: Script = {
    steps: {
      alerts: { text: "j1", outputs: { jobs: jobs("j1", "j2"), message: "ok" } },
      draft: { text: "ok" },
    },
  };
  const c = await ready([], {}, nested, s);
  const run = await start(c);
  expect(run.state).toBe("waiting_approval");
  const ap1 = c.engine.listApprovals({ state: "pending" }).at(0);
  expect(ap1).toMatchObject({ stepId: "draft", itemKey: "j1" });
  if (!ap1) throw new Error("missing approval");
  expect(c.engine.getRun(run.id).items.map((i) => i.status)).toEqual(["running", "pending"]);
  expect(c.store.isSeen("local.f", "review", "j1")).toBe(false);
  expect((await c.engine.decide(ap1.id, "approve")).state).toBe("waiting_approval");
  expect(c.store.isSeen("local.f", "review", "j1")).toBe(true);
  const ap2 = c.engine.listApprovals({ state: "pending" }).at(0);
  expect(ap2).toMatchObject({ itemKey: "j2" });
  if (!ap2) throw new Error("missing approval");
  expect((await c.engine.decide(ap2.id, "approve")).state).toBe("done");
  expect(c.store.isSeen("local.f", "review", "j2")).toBe(true);
  expect(c.harness.calls.filter((x) => x.stepId === "draft").map((x) => x.itemKey)).toEqual(["j1", "j2"]);
  const d = await ready([], {}, nested, s);
  const rejected = await start(d);
  const ap = d.engine.listApprovals({ state: "pending" }).at(0);
  if (!ap) throw new Error("missing approval");
  expect((await d.engine.decide(ap.id, "reject")).state).toBe("failed");
  expect(d.engine.getRun(rejected.id).items.at(0)?.status).toBe("failed");
  expect(d.store.isSeen("local.f", "review", "j1")).toBe(false);
});
test("a value that looks like a reference is not expanded", async () => {
  const item = JSON.parse('{"id":"j1","title":"${params.min_score}","__proto__":"text"}') as Value;
  const c = await ready([item]);
  await start(c);
  expect(c.harness.calls.find((x) => x.stepId === "rough")?.instructions).toContain(
    '"title":"${params.min_score}"',
  );
  expect(c.harness.calls.find((x) => x.stepId === "rough")?.instructions).toContain('"__proto__":"text"');
});
