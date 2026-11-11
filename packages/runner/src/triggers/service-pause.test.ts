import { afterEach, expect, test } from "vitest";
import { cleanup } from "../test-helpers/tmp.ts";
import { triggerFlow, triggerRig } from "../test-helpers/trigger-rig.ts";

afterEach(cleanup);
const id = "local.pause";
const blocked = () => ({ ready: false as const, reason: "No harness is connected yet." });
async function rig(options: { onPaused?: () => void } = {}) {
  const r = await triggerRig(
    [{ manifest: triggerFlow(id, [{ kind: "schedule", every: "1m" }]) }],
    undefined,
    { readiness: blocked, ...options },
  );
  r.enable(id, 0);
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
async function pause(r: Rig) {
  await fire(r, 3);
  r.svc.poke();
  await r.svc.settled();
}
test("three blocked runs in a row from one trigger pause it: the row is off with pausedAt and empty recentRuns, the watcher is closed, one trigger_paused audit line is written and onPaused is called once", async () => {
  const r = await rig();
  await pause(r);
  const at = r.clock.now().toISOString();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, pausedAt: at, recentRuns: [] });
  expect(r.watchers.size).toBe(0);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_paused")).toMatchObject([
    { detail: { flowId: id, index: 0 } },
  ]);
  expect(r.pauses).toEqual([{ flowId: id, index: 0, flowName: "Test", pausedAt: at }]);
  await r.svc.tick();
  expect(r.pauses).toHaveLength(1);
});
test.each(["done", "failed", "running", "missing"] as const)(
  "a third run that is %s keeps the trigger from pausing",
  async (state) => {
    const r = await rig();
    await fire(r, 3);
    const row = r.store.getTrigger(id, 0);
    const last = row?.recentRuns?.at(-1);
    if (!row || !last) throw new Error("missing recent run");
    if (state === "missing")
      r.store.putTrigger({ ...row, recentRuns: [...(row.recentRuns ?? []).slice(0, 2), "missing-run"] });
    else r.store.updateRun(last, { state });
    await r.svc.tick();
    expect(r.store.getTrigger(id, 0)?.enabled).toBe(true);
    expect(r.pauses).toHaveLength(0);
  },
);
test("a paused trigger fires nothing on later ticks, its view is off with the Paused reason, and the daily counters and the cursor do not change", async () => {
  const r = await rig();
  await pause(r);
  const row = r.store.getTrigger(id, 0);
  const counts = [
    r.store.counter(`runs:${id}`, "2026-11-11"),
    r.store.counter(`dropped:${id}`, "2026-11-11"),
  ];
  await fire(r, 5);
  expect(r.runsOf(id)).toHaveLength(3);
  expect(r.svc.list(id).at(0)).toMatchObject({
    state: "off",
    reason: "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on.",
  });
  expect(r.store.getTrigger(id, 0)?.cursorMs).toBe(row?.cursorMs);
  expect([
    r.store.counter(`runs:${id}`, "2026-11-11"),
    r.store.counter(`dropped:${id}`, "2026-11-11"),
  ]).toEqual(counts);
});
test("turning it on again clears pausedAt and recentRuns, resets the cursor and does not catch up the paused time; three more blocked runs pause it again", async () => {
  const r = await rig();
  await pause(r);
  r.clock.advance(600_000);
  r.enable(id, 0);
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: true, cursorMs: r.clock.now().getTime() });
  expect(r.store.getTrigger(id, 0)?.pausedAt).toBeUndefined();
  expect(r.store.getTrigger(id, 0)?.recentRuns ?? []).toEqual([]);
  await r.svc.tick();
  expect(r.runsOf(id)).toHaveLength(3);
  await pause(r);
  expect(r.runsOf(id)).toHaveLength(6);
  expect(r.pauses).toHaveLength(2);
  expect(r.store.getTrigger(id, 0)?.enabled).toBe(false);
});
test("a blocked run that the owner resumed and that is now done does not count: blocked, blocked, then resumed and done, then one more blocked run does not pause it", async () => {
  const r = await rig();
  await fire(r, 2);
  const run = r.store.getTrigger(id, 0)?.recentRuns?.at(-1);
  if (!run) throw new Error("missing run");
  r.store.updateRun(run, { state: "done" });
  await fire(r);
  await r.svc.tick();
  expect(r.store.getTrigger(id, 0)?.enabled).toBe(true);
  expect(r.pauses).toHaveLength(0);
});
test("the pause applies to file_change and to flow_done", async () => {
  let ready = false;
  const r = await triggerRig(
    [
      { manifest: triggerFlow("local.up", [{ kind: "manual" }]) },
      {
        manifest: triggerFlow(id, [
          { kind: "file_change", path: "inbox" },
          { kind: "flow_done", flow: "local.up" },
        ]),
      },
    ],
    undefined,
    { readiness: () => (ready ? { ready: true } : blocked()) },
  );
  r.writeFile("inbox/base");
  r.enable(id, 0);
  r.enable(id, 1);
  await r.svc.tick();
  expect(r.watchers.size).toBe(1);
  for (let i = 0; i < 3; i++) {
    r.writeFile(`inbox/${i}`);
    r.signal();
    r.clock.advance(10_000);
    await r.svc.tick();
    await r.idle();
    ready = true;
    const upstream = r.engine.beginStart("local.up", { project: r.project });
    await upstream.settled;
    ready = false;
    await r.svc.tick();
    await r.idle();
  }
  await r.svc.tick();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, recentRuns: [] });
  expect(r.store.getTrigger(id, 1)).toMatchObject({ enabled: false, recentRuns: [] });
  expect(r.watchers.size).toBe(0);
  expect(r.pauses.map((p) => p.index).sort()).toEqual([0, 1]);
});
test("a flow with two triggers: pausing the schedule leaves the file_change on", async () => {
  const r = await triggerRig(
    [
      {
        manifest: triggerFlow(id, [
          { kind: "schedule", every: "1m" },
          { kind: "file_change", path: "inbox" },
        ]),
      },
    ],
    undefined,
    { readiness: blocked },
  );
  r.writeFile("inbox/base");
  r.enable(id, 0);
  r.enable(id, 1);
  await r.svc.tick();
  await pause(r);
  expect(r.store.getTrigger(id, 0)?.enabled).toBe(false);
  expect(r.store.getTrigger(id, 1)?.enabled).toBe(true);
  expect(r.watchers.size).toBe(1);
});
test("an error thrown by onPaused is swallowed and the trigger is still paused", async () => {
  const r = await rig({
    onPaused: () => {
      throw new Error("notice failed");
    },
  });
  await pause(r);
  expect(r.store.getTrigger(id, 0)?.enabled).toBe(false);
  expect(r.pauses).toHaveLength(1);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_paused")).toHaveLength(1);
});
