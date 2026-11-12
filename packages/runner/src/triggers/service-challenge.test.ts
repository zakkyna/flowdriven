import { dirname } from "node:path";
import { afterEach, expect, test } from "vitest";
import { STOP } from "../claude/browser-post.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { createRunnerService, type RunnerService } from "../service/service.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { triggerFlow, triggerRig } from "../test-helpers/trigger-rig.ts";

const active: { service: RunnerService; store: Store }[] = [];
afterEach(() => {
  for (const { service, store } of active.splice(0)) {
    service.stop();
    store.close();
  }
  cleanup();
});
const id = "local.challenge";
const blocked = () => ({ ready: false as const, reason: "No harness is connected yet." });
async function rig(options: { onPaused?: () => void; triggers?: number } = {}) {
  const count = options.triggers ?? 1;
  const r = await triggerRig(
    [
      {
        manifest: triggerFlow(
          id,
          Array.from({ length: count }, () => ({ kind: "schedule", every: "1m", overlap: "queue" })),
        ),
      },
    ],
    undefined,
    { readiness: blocked, ...(options.onPaused ? { onPaused: options.onPaused } : {}) },
  );
  for (let i = 0; i < count; i++) r.enable(id, i);
  return r;
}
type Rig = Awaited<ReturnType<typeof rig>>;
async function fire(r: Rig, count = 1) {
  for (let i = 0; i < count; i++) {
    r.clock.advance(60_000);
    await r.svc.tick();
    await r.idle();
  }
}
function runOf(r: Rig, index = 0): string {
  const run = r.store.getTrigger(id, index)?.recentRuns?.at(-1);
  if (!run) throw new Error("the trigger started no run");
  return run;
}

test("pauseByRun pauses the trigger that started the run: the row is off with pausedAt and empty recentRuns, one trigger_paused audit line, onPaused once, the view is off with the Paused reason", async () => {
  const r = await rig();
  r.svc.start();
  await r.svc.settled();
  await fire(r);
  const run = runOf(r);
  r.pauseByRun(run);
  const at = r.clock.now().toISOString();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, pausedAt: at, recentRuns: [] });
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_paused")).toMatchObject([
    { detail: { flowId: id, index: 0 } },
  ]);
  expect(r.pauses).toEqual([{ flowId: id, index: 0, flowName: "Test", pausedAt: at }]);
  expect(r.svc.list(id).at(0)).toMatchObject({
    state: "off",
    reason: "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on.",
  });
});
test("a run that no trigger started, a row that is already off and an unknown run id do nothing and do not throw", async () => {
  const r = await rig();
  r.svc.start();
  await r.svc.settled();
  await fire(r);
  const run = runOf(r);
  const before = r.store.getTrigger(id, 0);
  expect(() => r.pauseByRun("run-that-no-trigger-started")).not.toThrow();
  expect(() => r.pauseByRun("")).not.toThrow();
  expect(r.store.getTrigger(id, 0)).toEqual(before);
  expect(r.pauses).toHaveLength(0);
  r.pauseByRun(run);
  expect(r.pauses).toHaveLength(1);
  const off = r.store.getTrigger(id, 0);
  expect(() => r.pauseByRun(run)).not.toThrow();
  expect(r.store.getTrigger(id, 0)).toEqual(off);
  expect(r.pauses).toHaveLength(1);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_paused")).toHaveLength(1);
  const manual = r.store.getTrigger(id, 0);
  if (!manual) throw new Error("missing row");
  r.store.putTrigger({ ...manual, enabled: false, pausedAt: undefined, recentRuns: [run] });
  r.pauseByRun(run);
  expect(r.pauses).toHaveLength(1);
});
test("of two triggers of one flow only the one that started the run is paused", async () => {
  const r = await rig({ triggers: 2 });
  r.svc.start();
  await r.svc.settled();
  await fire(r);
  const first = runOf(r, 0);
  const second = runOf(r, 1);
  expect(first).not.toBe(second);
  r.pauseByRun(first);
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, recentRuns: [] });
  expect(r.store.getTrigger(id, 1)).toMatchObject({ enabled: true, recentRuns: [second] });
  expect(r.pauses).toMatchObject([{ flowId: id, index: 0 }]);
});
test("after the pause the trigger fires nothing, and turning it on again clears the pause as in plan 04", async () => {
  const r = await rig();
  r.svc.start();
  await r.svc.settled();
  await fire(r);
  r.pauseByRun(runOf(r));
  const runs = r.runsOf(id).length;
  await fire(r, 4);
  expect(r.runsOf(id)).toHaveLength(runs);
  r.enable(id, 0);
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: true });
  expect(r.store.getTrigger(id, 0)?.pausedAt).toBeUndefined();
  expect(r.svc.list(id).at(0)?.state).toBe("on");
  await fire(r);
  expect(r.runsOf(id).length).toBeGreaterThan(runs);
});
test("an error from onPaused is swallowed and the trigger is still paused", async () => {
  const r = await rig({
    onPaused: () => {
      throw new Error("notification failed");
    },
  });
  r.svc.start();
  await r.svc.settled();
  await fire(r);
  expect(() => r.pauseByRun(runOf(r))).not.toThrow();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, recentRuns: [] });
  expect(r.store.getTrigger(id, 0)?.pausedAt).toBeDefined();
});
test("the three-blocked-runs pause of plan 04 still works", async () => {
  const r = await rig();
  r.svc.start();
  await r.svc.settled();
  await fire(r, 3);
  r.svc.poke();
  await r.svc.settled();
  const at = r.clock.now().toISOString();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, pausedAt: at, recentRuns: [] });
  expect(r.watchers.size).toBe(0);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_paused")).toMatchObject([
    { detail: { flowId: id, index: 0 } },
  ]);
  expect(r.pauses).toEqual([{ flowId: id, index: 0, flowName: "Test", pausedAt: at }]);
});
test("through the runner service: a run that becomes blocked with exactly the challenge sentence pauses its trigger at once, and one blocked with another sentence does not", async () => {
  const inner = await openSqliteStore(":memory:");
  // The service in live mode with a scripted harness blocks every run at the readiness check. This
  // shim swaps the sentence of that block, standing in for the sentence a harness reply would give.
  let sentence: string | undefined;
  const store: Store = new Proxy(inner, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "updateRun" || typeof value !== "function") return value;
      return (runId: string, patch: Record<string, unknown>) =>
        Reflect.apply(value, target, [
          runId,
          sentence !== undefined && patch.state === "blocked" ? { ...patch, blockedReason: sentence } : patch,
        ]);
    },
  });
  let time = Date.parse("2026-11-12T00:00:00.000Z");
  let next = 0;
  const jobs: (() => void)[] = [];
  const service = createRunnerService({
    store,
    dataDir: dirname(tempPath()),
    mode: "live",
    now: () => new Date(time),
    newId: (prefix) => `${prefix}-${++next}`,
    harness: scriptedHarness({ steps: { a: { block: STOP.challenge } } }),
    keeper: { every: () => () => {} },
    triggers: {
      every: (_ms, fn) => {
        jobs.push(fn);
        return () => {
          const i = jobs.indexOf(fn);
          if (i >= 0) jobs.splice(i, 1);
        };
      },
      watch: () => () => {},
    },
  });
  active.push({ service, store: inner });
  const hash = `sha256:${"1".repeat(64)}`;
  const flow = triggerFlow("local.service-challenge", [{ kind: "schedule", every: "1h" }]);
  service.engine.registerFlow(flow, hash);
  await service.start().settled;
  await service.call("triggers.setEnabled", { flowId: flow.id, index: 0, enabled: true, hash });
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  const fireOnce = async () => {
    time += 3_600_000;
    jobs.at(0)?.();
    await flush();
    const run = inner.getTrigger(flow.id, 0)?.lastFire?.runId;
    if (!run) throw new Error("the trigger started no run");
    return run;
  };
  const paused = () => inner.listAudit().filter((a) => a.kind === "trigger_paused");
  // One other sentence only: three blocked runs in a row would pause the trigger by the older rule.
  for (const other of [`${STOP.challenge} `]) {
    sentence = other;
    const run = await fireOnce();
    expect(inner.getRun(run)).toMatchObject({ state: "blocked", blockedReason: other });
    expect(inner.getTrigger(flow.id, 0)).toMatchObject({ enabled: true });
    expect(paused()).toHaveLength(0);
  }
  sentence = STOP.challenge;
  const run = await fireOnce();
  expect(inner.getRun(run)).toMatchObject({ state: "blocked", blockedReason: STOP.challenge });
  expect(inner.getTrigger(flow.id, 0)).toMatchObject({ enabled: false, recentRuns: [] });
  expect(inner.getTrigger(flow.id, 0)?.pausedAt).toBeDefined();
  expect(paused()).toHaveLength(1);
});
