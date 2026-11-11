import { afterEach, expect, test, vi } from "vitest";
import { gate } from "../test-helpers/flows.ts";
import { cleanup } from "../test-helpers/tmp.ts";
import { r4Flow, triggerFlow, triggerRig } from "../test-helpers/trigger-rig.ts";
import { localDay } from "./schedule.ts";
import { createTriggerService } from "./service.ts";

const H = 3_600_000;
afterEach(cleanup);
test("an hourly schedule fires once an hour, as a triggered run with its slot, and not before it is enabled", async () => {
  const r = await triggerRig([
    { manifest: triggerFlow("local.hourly", [{ kind: "schedule", every: "1h" }]) },
  ]);
  r.clock.advance(2 * H);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf("local.hourly")).toHaveLength(0);
  r.enable("local.hourly", 0);
  r.clock.advance(H);
  await r.svc.tick();
  await r.idle();
  const run = r.runsOf("local.hourly").at(0);
  expect(run?.trigger).toEqual({
    kind: "schedule",
    payload: { slot: "2026-11-11T12:00:00.000Z", missed: 0 },
  });
  expect(run?.state).toBe("done");
  r.clock.advance(H);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf("local.hourly")).toHaveLength(2);
});
test("the daily cap: 30 fires of a flow capped at 3 start 3 runs, drop 27, notify once, and the next local day starts again", async () => {
  const r = await triggerRig([
    {
      manifest: triggerFlow("local.capped", [{ kind: "schedule", every: "1m" }], {
        limits: { max_runs_per_day: 3 },
      }),
    },
  ]);
  r.enable("local.capped", 0);
  for (let i = 0; i < 30; i++) {
    r.clock.advance(60_000);
    await r.svc.tick();
    await r.idle();
  }
  expect(r.runsOf("local.capped")).toHaveLength(3);
  expect(r.store.counter("dropped:local.capped", "2026-11-11")).toBe(27);
  expect(r.floods).toEqual([{ flowId: "local.capped", flowName: "Test", day: "2026-11-11", cap: 3 }]);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_capped")).toHaveLength(2);
  r.setDay(() => "2026-11-12");
  r.clock.advance(60_000);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf("local.capped")).toHaveLength(4);
});
test("enabling stores the hash, the spec and the enable time, refuses a stale hash with not_allowed, refuses an R4 flow with the reason This flow cannot run unattended: unattended prefix at steps.0, and writes an audit line without payload text", async () => {
  const r = await triggerRig([
    { manifest: triggerFlow("local.good", [{ kind: "schedule", every: "1h" }]) },
    { manifest: r4Flow("local.bad"), raw: true },
  ]);
  expect(() => r.svc.setEnabled("local.good", 0, true, "old")).toThrowError(
    expect.objectContaining({ code: "not_allowed" }),
  );
  expect(() => r.enable("local.bad", 0)).toThrow(
    "This flow cannot run unattended: unattended prefix at steps.0",
  );
  r.enable("local.good", 0);
  expect(r.store.getTrigger("local.good", 0)).toMatchObject({
    enabled: true,
    hash: r.hashOf("local.good"),
    spec: JSON.stringify(triggerFlow("local.good", [{ kind: "schedule", every: "1h" }]).triggers[0]),
    enabledAt: "2026-11-11T09:00:00.000Z",
  });
  expect(r.store.listAudit().find((a) => a.kind === "trigger_enabled")?.detail).toEqual({
    flowId: "local.good",
    index: 0,
    kind: "schedule",
    hash: r.hashOf("local.good"),
  });
});
test("a tick that sees an old slot: catch_up none records missed and starts nothing; catch_up once starts one run for five missed slots with missed 5", async () => {
  const r = await triggerRig([
    { manifest: triggerFlow("local.none", [{ kind: "schedule", every: "1h" }]) },
    { manifest: triggerFlow("local.once", [{ kind: "schedule", every: "1h", catch_up: "once" }]) },
  ]);
  r.enable("local.none", 0);
  r.enable("local.once", 0);
  r.clock.advance(5.5 * H);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf("local.none")).toHaveLength(0);
  expect(r.store.getTrigger("local.none", 0)?.lastFire).toMatchObject({
    outcome: "missed",
    detail: "5 missed",
  });
  expect(r.runsOf("local.once")).toHaveLength(1);
  expect(r.runsOf("local.once").at(0)?.trigger?.payload).toMatchObject({ missed: 5 });
});
test("after the flow's hash changes the trigger does not fire, the view says needs_ok, and re-registering the old hash resumes it", async () => {
  const flow = triggerFlow("local.hash", [{ kind: "schedule", every: "1h" }]);
  const r = await triggerRig([{ manifest: flow }]);
  r.enable(flow.id, 0);
  r.engine.registerFlow({ ...flow, name: "Changed" }, `sha256:${"f".repeat(64)}`);
  r.clock.advance(H);
  await r.svc.tick();
  expect(r.runsOf(flow.id)).toHaveLength(0);
  expect(r.svc.list(flow.id).at(0)?.state).toBe("needs_ok");
  r.engine.registerFlow(flow, r.hashOf(flow.id));
  r.clock.advance(H);
  await r.svc.tick();
  await r.idle();
  expect(r.runsOf(flow.id)).toHaveLength(1);
});
test("overlap skip drops the fire while a run is open and consumes the slot; overlap queue starts it behind the open run and stops at 2 queued; a second trigger of the same flow due in the same tick sees the first one's run as open", async () => {
  const hold = gate();
  const r = await triggerRig(
    [
      {
        manifest: triggerFlow("local.overlap", [
          { kind: "schedule", every: "1m" },
          { kind: "schedule", every: "1m", overlap: "queue" },
        ]),
      },
    ],
    undefined,
    { hold },
  );
  r.enable("local.overlap", 0);
  r.enable("local.overlap", 1);
  r.clock.advance(60_000);
  await r.svc.tick();
  expect(r.runsOf("local.overlap")).toHaveLength(2);
  r.clock.advance(60_000);
  await r.svc.tick();
  expect(r.store.getTrigger("local.overlap", 0)?.lastFire?.outcome).toBe("skipped_overlap");
  r.clock.advance(60_000);
  await r.svc.tick();
  expect(r.runsOf("local.overlap")).toHaveLength(3);
  expect(r.store.getTrigger("local.overlap", 1)?.lastFire?.outcome).toBe("dropped_queue_full");
  hold.release();
  hold.release();
  hold.release();
  await r.idle();
});
test("R4 at run start: an enabled row for a flow that fails the validator starts nothing and records refused", async () => {
  const flow = r4Flow("local.r4");
  const r = await triggerRig([{ manifest: flow, raw: true }]);
  r.store.putTrigger({
    flowId: flow.id,
    index: 0,
    enabled: true,
    hash: r.hashOf(flow.id),
    spec: JSON.stringify(flow.triggers[0]),
    enabledAt: r.clock.now().toISOString(),
  });
  r.clock.advance(H);
  await r.svc.tick();
  expect(r.runsOf(flow.id)).toHaveLength(0);
  expect(r.store.getTrigger(flow.id, 0)?.lastFire?.outcome).toBe("refused");
});
test("a clock that moves back fires nothing and does not replay slots when it returns; a cursor far in the future is reset to now and records missed", async () => {
  const r = await triggerRig([{ manifest: triggerFlow("local.clock", [{ kind: "schedule", every: "1h" }]) }]);
  r.enable("local.clock", 0);
  r.clock.advance(H);
  await r.svc.tick();
  await r.idle();
  r.clock.advance(-H);
  await r.svc.tick();
  r.clock.advance(H);
  await r.svc.tick();
  expect(r.runsOf("local.clock")).toHaveLength(1);
  const row = r.store.getTrigger("local.clock", 0);
  if (!row) throw new Error("missing row");
  r.store.putTrigger({ ...row, cursorMs: r.clock.now().getTime() + 2 * 86_400_000 });
  await r.svc.tick();
  expect(r.store.getTrigger("local.clock", 0)?.lastFire).toMatchObject({
    outcome: "missed",
    detail: "clock moved back",
  });
});
test("a missing flow, an unreadable row and an error from begin, onFlood, watch or every fire nothing or are recorded or swallowed, tick never throws, and the other triggers still fire", async () => {
  const flows = ["local.bad", "local.good", "local.cap"].map((id) => ({
    manifest: triggerFlow(id, [{ kind: "schedule", every: "1h" }], { limits: { max_runs_per_day: 1 } }),
  }));
  const r = await triggerRig(flows);
  for (const f of flows) r.enable(f.manifest.id, 0);
  r.store.putTrigger({
    flowId: "local.missing",
    index: 0,
    enabled: true,
    hash: "x",
    spec: "{}",
    enabledAt: r.clock.now().toISOString(),
  });
  const unreadable = {
    flowId: "local.unreadable",
    index: 0,
    enabled: true,
    hash: "x",
    spec: "{}",
    enabledAt: r.clock.now().toISOString(),
  };
  const store = new Proxy(r.store, {
    get(target, key, receiver) {
      if (key === "listTriggers") return () => [unreadable, ...target.listTriggers()];
      return Reflect.get(target, key, receiver);
    },
  });
  const watch = vi.fn(() => {
    throw new Error("watch");
  });
  const svc = createTriggerService({
    store,
    now: r.clock.now,
    dayOf: localDay,
    projectDir: r.project,
    summaryOf: (t) => t.kind,
    watch,
    every: () => {
      throw new Error("every");
    },
    onFlood: () => {
      throw new Error("flood");
    },
    begin: (id, o) => {
      if (id === "local.bad") throw new Error("begin");
      return r.engine.beginStart(id, o);
    },
  });
  svc.start();
  expect(r.store.listAudit().some((a) => a.kind === "trigger_start_failed")).toBe(true);
  r.store.increment("runs:local.cap", "2026-11-11");
  r.clock.advance(H);
  await expect(svc.tick()).resolves.toBeUndefined();
  expect(r.store.getTrigger("local.bad", 0)?.lastFire).toMatchObject({ outcome: "error", detail: "begin" });
  expect(r.store.getTrigger("local.cap", 0)?.lastFire?.outcome).toBe("dropped_cap");
  expect(r.runsOf("local.good")).toHaveLength(1);
  expect(watch).not.toHaveBeenCalled();
  svc.stop();
});
test("disabling stops new fires and leaves a run in progress; re-enabling does not catch up the time it was off", async () => {
  const hold = gate();
  const r = await triggerRig(
    [{ manifest: triggerFlow("local.off", [{ kind: "schedule", every: "1h", catch_up: "once" }]) }],
    undefined,
    { hold },
  );
  r.enable("local.off", 0);
  r.clock.advance(H);
  await r.svc.tick();
  r.svc.setEnabled("local.off", 0, false, r.hashOf("local.off"));
  expect(r.runsOf("local.off")).toHaveLength(1);
  r.clock.advance(5 * H);
  await r.svc.tick();
  r.enable("local.off", 0);
  await r.svc.tick();
  expect(r.runsOf("local.off")).toHaveLength(1);
  hold.release();
  await r.idle();
});
test("a setEnabled(false) that lands between the list and the trigger's section is not overwritten: the row stays off and nothing fires", async () => {
  let disable = () => {};
  const r = await triggerRig(
    [{ manifest: triggerFlow("local.race", [{ kind: "schedule", every: "1h" }]) }],
    undefined,
    { afterList: () => disable() },
  );
  r.enable("local.race", 0);
  disable = () => {
    disable = () => {};
    r.svc.setEnabled("local.race", 0, false, r.hashOf("local.race"));
  };
  r.clock.advance(H);
  await r.svc.tick();
  expect(r.store.getTrigger("local.race", 0)?.enabled).toBe(false);
  expect(r.runsOf("local.race")).toHaveLength(0);
});
