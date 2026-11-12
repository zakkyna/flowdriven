import { afterEach, expect, test } from "vitest";
import { cleanup } from "../test-helpers/tmp.ts";
import { r4Flow, triggerFlow, triggerRig } from "../test-helpers/trigger-rig.ts";
import { localDay } from "./schedule.ts";
import { createTriggerService } from "./service.ts";

afterEach(cleanup);
const up = "local.up",
  down = "local.down";
async function rig(cap = 24, status: "done" | "any" = "done", fail = false) {
  return triggerRig(
    [
      { manifest: triggerFlow(up, [{ kind: "manual" }]) },
      {
        manifest: triggerFlow(down, [{ kind: "flow_done", flow: up, status }], {
          limits: { max_runs_per_day: cap },
        }),
      },
    ],
    fail ? { steps: { a: { exit: "failed" } } } : undefined,
  );
}
async function finish(r: Awaited<ReturnType<typeof rig>>, id = up) {
  const begun = r.engine.beginStart(id, { project: r.project });
  await begun.settled;
  return begun.run.id;
}
function service(r: Awaited<ReturnType<typeof rig>>) {
  return createTriggerService({
    store: r.store,
    now: r.clock.now,
    dayOf: localDay,
    projectDir: r.project,
    begin: r.engine.beginStart,
    every: () => () => {},
    watch: () => undefined,
    summaryOf: (t) => t.kind,
  });
}
test("a finished upstream run starts the downstream flow once, with payload flow, run, status and depth 1", async () => {
  const r = await rig();
  r.enable(down, 0);
  const id = await finish(r);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(down)).toHaveLength(1);
  expect(r.runsOf(down).at(0)?.trigger).toEqual({
    kind: "flow_done",
    payload: { flow: up, run: id, status: "done", depth: 1 },
    index: 0,
  });
  await r.svc.tick();
  expect(r.runsOf(down)).toHaveLength(1);
});
test("status done ignores a failed upstream run and status any takes it", async () => {
  const r = await rig(24, "any", true);
  r.enable(down, 0);
  const id = await finish(r);
  expect(r.store.getRun(id)?.state).toBe("blocked");
  r.store.updateRun(id, { state: "failed", endedAt: r.clock.now().toISOString() });
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(down).at(0)?.trigger?.payload).toEqual({ flow: up, run: id, status: "failed", depth: 1 });
  const s = await rig(24, "done", true);
  s.enable(down, 0);
  const other = await finish(s);
  expect(s.store.getRun(other)?.state).toBe("blocked");
  s.store.updateRun(other, { state: "failed", endedAt: s.clock.now().toISOString() });
  await s.svc.tick();
  expect(s.runsOf(down)).toHaveLength(0);
});
test("an upstream run that ended before the downstream trigger was enabled is not replayed", async () => {
  const r = await rig();
  await finish(r);
  r.clock.advance(1);
  r.enable(down, 0);
  await r.svc.tick();
  expect(r.runsOf(down)).toHaveLength(0);
});
test("restart: a run that ended while the runner was down starts the downstream once, and a second service over the same store does not start it again", async () => {
  const r = await rig();
  r.enable(down, 0);
  r.svc.stop();
  await finish(r);
  const s = service(r);
  await s.tick();
  await r.idle();
  expect(r.runsOf(down)).toHaveLength(1);
  await service(r).tick();
  expect(r.runsOf(down)).toHaveLength(1);
});
test("poke() runs one tick without re-entering the store call that caused it", async () => {
  const r = await rig();
  r.enable(down, 0);
  let inside = false;
  let reentered = false;
  const store = new Proxy(r.store, {
    get(target, key, receiver) {
      if (key === "listTriggers")
        return () => {
          reentered ||= inside;
          return target.listTriggers();
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const svc = createTriggerService({
    store,
    now: r.clock.now,
    dayOf: localDay,
    projectDir: r.project,
    begin: r.engine.beginStart,
    every: () => () => {},
    watch: () => undefined,
    summaryOf: (t) => t.kind,
  });
  svc.start();
  await svc.settled();
  const id = await finish(r);
  inside = true;
  store.updateRun(id, { endedAt: r.clock.now().toISOString() });
  svc.poke();
  expect(r.runsOf(down)).toHaveLength(0);
  inside = false;
  await svc.settled();
  expect(reentered).toBe(false);
  expect(r.runsOf(down)).toHaveLength(1);
});
test("a chain of flows each started by the one before stops at depth 3, records depth and an audit line; a cycle of two flows stops too", async () => {
  const ids = ["local.a", "local.b", "local.c", "local.d", "local.e"];
  const r = await triggerRig(
    ids.map((id, i) => ({
      manifest: triggerFlow(
        id,
        i === 0 ? [{ kind: "manual" }] : [{ kind: "flow_done", flow: ids.at(i - 1) }],
      ),
    })),
  );
  for (const id of ids.slice(1)) r.enable(id, 0);
  await finish(r, "local.a");
  for (let i = 0; i < 5; i++) {
    await r.svc.tick();
    await r.idle();
  }
  expect(r.runsOf("local.d").at(0)?.trigger?.payload).toMatchObject({ depth: 3 });
  expect(r.runsOf("local.e")).toHaveLength(0);
  expect(r.store.getTrigger("local.e", 0)?.lastFire?.outcome).toBe("depth");
  expect(r.store.listAudit().some((a) => a.kind === "trigger_depth")).toBe(true);
  const c = await triggerRig([
    { manifest: triggerFlow("local.x", [{ kind: "manual" }, { kind: "flow_done", flow: "local.y" }]) },
    { manifest: triggerFlow("local.y", [{ kind: "flow_done", flow: "local.x" }]) },
  ]);
  c.enable("local.x", 1);
  c.enable("local.y", 0);
  await finish(c, "local.x");
  for (let i = 0; i < 6; i++) {
    await c.svc.tick();
    await c.idle();
  }
  expect(c.store.listAudit().some((a) => a.kind === "trigger_depth")).toBe(true);
  expect(c.runsOf("local.x")).toHaveLength(2);
  expect(c.runsOf("local.y")).toHaveLength(2);
});
test("200 finished upstream runs: at most 50 are handled per tick and the daily cap of 24 holds, with one flood event", async () => {
  const r = await rig();
  r.enable(down, 0);
  for (let i = 0; i < 200; i++) await finish(r);
  for (let i = 0; i < 200; i++) {
    const before = r.runsOf(down).length + r.store.counter(`dropped:${down}`, "2026-11-11");
    await r.svc.tick();
    await r.idle();
    const after = r.runsOf(down).length + r.store.counter(`dropped:${down}`, "2026-11-11");
    expect(after - before).toBeLessThanOrEqual(50);
    if (after === 200) break;
  }
  expect(r.runsOf(down)).toHaveLength(24);
  expect(r.store.counter(`dropped:${down}`, "2026-11-11")).toBe(176);
  expect(r.floods).toHaveLength(1);
});
test("a missing upstream flow fires nothing and tick does not throw", async () => {
  const r = await rig();
  const trigger = r.store.getFlow(down);
  expect(trigger).toBeDefined();
  const manifest = triggerFlow(down, [{ kind: "flow_done", flow: "local.missing" }]);
  if (!trigger) throw new Error("missing flow");
  r.store.putFlow({ ...trigger, manifest });
  r.store.putTrigger({
    flowId: down,
    index: 0,
    enabled: true,
    hash: trigger.hash,
    spec: JSON.stringify(manifest.triggers.at(0)),
    enabledAt: r.clock.now().toISOString(),
  });
  await expect(r.svc.tick()).resolves.toBeUndefined();
  expect(r.runsOf(down)).toHaveLength(0);
});
test("a downstream run refused by R4 records refused and consumes the key, so it is not retried every tick", async () => {
  const bad = r4Flow(down);
  const manifest = { ...bad, triggers: triggerFlow(down, [{ kind: "flow_done", flow: up }]).triggers };
  const r = await triggerRig([{ manifest: triggerFlow(up, [{ kind: "manual" }]) }, { manifest, raw: true }]);
  r.store.putTrigger({
    flowId: down,
    index: 0,
    enabled: true,
    hash: r.hashOf(down),
    spec: JSON.stringify(manifest.triggers.at(0)),
    enabledAt: r.clock.now().toISOString(),
  });
  await finish(r);
  await r.svc.tick();
  expect(r.store.getTrigger(down, 0)?.lastFire?.outcome).toBe("refused");
  await r.svc.tick();
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_refused")).toHaveLength(1);
  expect(r.runsOf(down)).toHaveLength(0);
});
test("a capped upstream run is counted once, not once per tick: 30 upstream runs against a cap of 3 give dropped 27 after one tick and still 27 after five more ticks, and the next local day does not replay them", async () => {
  const r = await rig(3);
  r.enable(down, 0);
  for (let i = 0; i < 3; i++) {
    await finish(r);
    await r.svc.tick();
    await r.idle();
  }
  for (let i = 0; i < 27; i++) await finish(r);
  await r.svc.tick();
  await r.idle();
  expect(r.store.counter(`dropped:${down}`, "2026-11-11")).toBe(27);
  for (let i = 0; i < 5; i++) await r.svc.tick();
  expect(r.store.counter(`dropped:${down}`, "2026-11-11")).toBe(27);
  r.setDay(() => "2026-11-12");
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(down)).toHaveLength(3);
});

test("a claimed upstream run does not replace the last outcome when the queue is full", async () => {
  const r = await rig();
  r.enable(down, 0);
  const id = await finish(r);
  await r.svc.tick();
  await r.idle();
  const last = r.store.getTrigger(down, 0)?.lastFire;
  const previous = r.runsOf(down).at(0);
  if (!previous) throw new Error("missing downstream run");
  r.store.updateRun(previous.id, { state: "queued" });
  r.store.createRun({ ...previous, id: "queued-extra", state: "queued" });
  await r.svc.tick();
  expect(r.store.getTrigger(down, 0)?.lastFire).toEqual(last);
  expect(r.store.claimKey(down, 0, id, r.clock.now().toISOString())).toBe(false);
});
