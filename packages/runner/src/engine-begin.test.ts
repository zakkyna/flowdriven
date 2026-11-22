import { afterEach, expect, test, vi } from "vitest";
import { createEngine } from "./engine.ts";
import type { HarnessAdapter, StepResult } from "./harness.ts";
import { scriptedHarness } from "./scripted-harness.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store } from "./storage.ts";
import { makeFlow } from "./test-helpers/review-flow.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const worker = (id: string, checks: unknown[] = [{ type: "contains", pattern: "ok" }]) => ({
  id,
  do: "worker",
  instructions: "Work",
  checks,
  idempotent: true,
});
const result: StepResult = { exit: "ok", text: "ok", outputs: {} };
function gated() {
  const calls: string[] = [];
  const pending = new Map<string, (value: StepResult) => void>();
  const base = scriptedHarness({});
  const harness: HarnessAdapter = {
    ...base,
    runStep(req) {
      calls.push(`${req.runId}:${req.stepId}`);
      return new Promise((resolve) => pending.set(req.runId, resolve));
    },
  };
  return {
    harness,
    calls,
    release(id: string, value = result) {
      const resolve = pending.get(id);
      if (!resolve) throw new Error(`No pending call for ${id}`);
      pending.delete(id);
      resolve(value);
    },
  };
}
async function setup(steps: unknown[] = [worker("a")], harness: HarnessAdapter = gated().harness) {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let time = Date.parse("2026-11-11T09:00:00Z");
  const ids = new Map<string, number>();
  const newId = (prefix: string) => {
    const n = (ids.get(prefix) ?? 0) + 1;
    ids.set(prefix, n);
    return `${prefix}-${n}`;
  };
  const engine = createEngine({ store, harness, newId, now: () => new Date(time) });
  engine.registerFlow(makeFlow(steps), `sha256:${"0".repeat(64)}`);
  return {
    store,
    engine,
    newId,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
const tick = async () => {
  await vi.waitFor(() => {}, { interval: 1 });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
async function choice() {
  const g = gated();
  const c = await setup(
    [
      {
        ...worker("a"),
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "ok", of: "message" }],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Pick",
          choose_from: "${steps.a.outputs.jobs}",
          max_pick: 1,
          approves: [],
          on_expiry: "end",
        },
      },
      worker("b"),
    ],
    g.harness,
  );
  const b = c.engine.beginStart("local.test", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toHaveLength(1));
  g.release("run-1", { ...result, outputs: { jobs: [{ id: "j1" }], message: "ok" } });
  await b.settled;
  const ap = c.store.listApprovals({ state: "pending" }).at(0);
  if (!ap) throw new Error("Missing approval");
  return { ...c, g, ap };
}
test("beginStart answers after its own write and the walk goes on in the background", {
  timeout: 20_000,
}, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  const b = c.engine.beginStart("local.test", { project: "/tmp" });
  expect(b.run.state).toBe("queued");
  expect(c.store.getRun("run-1")).toBeDefined();
  expect(g.calls).toEqual([]);
  await vi.waitFor(() => expect(g.calls).toEqual(["run-1:a"]));
  g.release("run-1");
  expect((await b.settled).state).toBe("done");
});
test("begin variants refuse bad input at once and write nothing", { timeout: 20_000 }, async () => {
  const c = await setup();
  expect(() => c.engine.beginStart("nope", { project: "/tmp" })).toThrow(
    expect.objectContaining({ code: "not_found" }),
  );
  expect(c.store.listRuns()).toEqual([]);
  const d = await choice();
  const b = d.engine.beginAnswer(d.ap.id, { picks: ["j1"] });
  expect(() => d.engine.beginAnswer(d.ap.id, { picks: ["j1"] })).toThrow(
    expect.objectContaining({
      code: "conflict",
      reason: "already_answered",
      params: { via: "window" },
      message: "This decision was already made.",
    }),
  );
  await vi.waitFor(() => expect(d.g.calls).toHaveLength(2));
  d.g.release("run-1");
  await b.settled;
});
test("beginAnswer commits the decision before it returns", { timeout: 20_000 }, async () => {
  const c = await choice();
  const b = c.engine.beginAnswer(c.ap.id, { picks: ["j1"] });
  expect(c.store.getApproval(c.ap.id)?.state).toBe("approved");
  expect(c.store.getRun("run-1")?.state).toBe("running");
  expect(b.run.state).toBe("running");
  expect(c.g.calls).toHaveLength(1);
  await vi.waitFor(() => expect(c.g.calls).toHaveLength(2));
  c.g.release("run-1");
  expect((await b.settled).state).toBe("done");
});
test("TC-j24-08 beginDecide continues in the background for either decision", {
  timeout: 20_000,
}, async () => {
  for (const decision of ["approve", "reject"] as const) {
    const g = gated();
    const c = await setup([worker("a", [{ type: "user" }]), worker("b")], g.harness);
    const first = c.engine.beginStart("local.test", { project: "/tmp" });
    await vi.waitFor(() => expect(g.calls).toHaveLength(1));
    g.release("run-1");
    await first.settled;
    const ap = c.store.listApprovals({ state: "pending" }).at(0);
    if (!ap) throw new Error("Missing approval");
    const b = c.engine.beginDecide(ap.id, decision);
    expect(b.run.state).toBe("running");
    expect(g.calls).toHaveLength(1);
    await vi.waitFor(() => expect(g.calls).toHaveLength(2));
    g.release("run-1");
    expect((await b.settled).state).toBe("done");
  }
});
test("beginResume returns the run in checking and settles when the walk ends", {
  timeout: 20_000,
}, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  const first = c.engine.beginStart("local.test", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toHaveLength(1));
  g.release("run-1", { ...result, exit: "quota" });
  expect((await first.settled).state).toBe("blocked");
  const b = c.engine.beginResume("run-1");
  expect(b.run.state).toBe("checking");
  await vi.waitFor(() => expect(g.calls).toHaveLength(2));
  g.release("run-1");
  expect((await b.settled).state).toBe("done");
  expect(() => c.engine.beginResume("run-1")).toThrow(expect.objectContaining({ code: "not_allowed" }));
});
test("beginRecover returns the interrupted runs at once and settles when the resumed walks end", {
  timeout: 20_000,
}, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  const first = c.engine.beginStart("local.test", { project: "/tmp" });
  c.engine.shutdown();
  await first.settled;
  const next = createEngine({ store: c.store, harness: g.harness, newId: c.newId });
  const b = next.beginRecover();
  expect(b.runs).toHaveLength(1);
  expect(b.runs.at(0)?.state).toBe("checking");
  await vi.waitFor(() => expect(g.calls).toHaveLength(1));
  g.release("run-1");
  expect((await b.settled).at(0)?.state).toBe("done");
});
test("walks of one flow run first in first out", { timeout: 20_000 }, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  c.engine.registerFlow(
    makeFlow([worker("a")], { id: "local.other", name: "Other" }),
    `sha256:${"1".repeat(64)}`,
  );
  const a = c.engine.beginStart("local.test", { project: "/tmp" });
  const b = c.engine.beginStart("local.test", { project: "/tmp" });
  const d = c.engine.beginStart("local.other", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toEqual(["run-1:a", "run-3:a"]));
  g.release("run-1");
  await vi.waitFor(() => expect(g.calls).toContain("run-2:a"));
  g.release("run-2");
  g.release("run-3");
  await Promise.all([a.settled, b.settled, d.settled]);
});
test("walks of different flows overlap", { timeout: 20_000 }, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  c.engine.registerFlow(
    makeFlow([worker("a")], { id: "local.other", name: "Other" }),
    `sha256:${"1".repeat(64)}`,
  );
  const a = c.engine.beginStart("local.test", { project: "/tmp" });
  const b = c.engine.beginStart("local.other", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toEqual(["run-1:a", "run-2:a"]));
  g.release("run-1");
  g.release("run-2");
  await Promise.all([a.settled, b.settled]);
});
test("settled never rejects", { timeout: 20_000 }, async () => {
  const throwing = scriptedHarness({});
  const c = await setup(undefined, throwing);
  expect((await c.engine.beginStart("local.test", { project: "/tmp" }).settled).state).toBe("blocked");
  const d = createEngine({
    store: c.store,
    harness: throwing,
    newId: c.newId,
    readiness: () => {
      throw new Error("readiness");
    },
  });
  expect((await d.beginStart("local.test", { project: "/tmp" }).settled).state).toBe("blocked");
  const g = gated();
  const e = await setup(undefined, g.harness);
  const b = e.engine.beginStart("local.test", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toHaveLength(1));
  e.store.close();
  stores.splice(stores.indexOf(e.store), 1);
  g.release("run-1");
  await expect(b.settled).resolves.toMatchObject({ id: "run-1" });
});
test("TC-j24-31 sweepExpired leaves a choice waiting without a deadline", {
  timeout: 20_000,
}, async () => {
  const c = await choice();
  c.advance(24 * 3600000 + 1);
  await c.engine.sweepExpired();
  expect(c.store.getApproval(c.ap.id)?.state).toBe("pending");
  expect(c.store.getRun("run-1")?.state).toBe("waiting_approval");
});
test("shutdown refuses new work and drops walks that have not begun", { timeout: 20_000 }, async () => {
  const g = gated();
  const c = await setup(undefined, g.harness);
  const a = c.engine.beginStart("local.test", { project: "/tmp" });
  await vi.waitFor(() => expect(g.calls).toHaveLength(1));
  const b = c.engine.beginStart("local.test", { project: "/tmp" });
  c.engine.shutdown();
  expect(() => c.engine.beginStart("local.test", { project: "/tmp" })).toThrow(
    expect.objectContaining({ code: "unavailable", message: "The engine is stopping." }),
  );
  g.release("run-1");
  await a.settled;
  expect((await b.settled).state).toBe("queued");
  await tick();
  expect(g.calls).toEqual(["run-1:a"]);
});
