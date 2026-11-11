import { expect, test } from "vitest";
import { createKeeper } from "./keeper.ts";
import type { Keeper, Ticket } from "./types.ts";

function rig(
  config = { ceiling: 4, reserveMb: 1000, fiveHourLine: 0.9, sevenDayLine: 0.9 },
  extra: Partial<Parameters<typeof createKeeper>[0]> = {},
) {
  const clock = { now: 1_000_000 };
  const jobs = new Set<() => void>();
  const count = { started: 0, cancelled: 0 };
  const rss = new Map<number, number>();
  const probe = { avail: 8000 as number | undefined, level: 1 as number | undefined };
  const probes = {
    refresh: async () => {},
    availableMb: () => probe.avail,
    pressureLevel: () => probe.level,
    groupRssMb: (pid: number) => rss.get(pid),
    totalMb: () => 16000,
  };
  const weekly: { asked: number[] } = { asked: [] };
  const keeper = createKeeper({
    config: () => config,
    probes,
    nowMs: () => clock.now,
    every: (_ms, fn) => {
      jobs.add(fn);
      count.started++;
      return () => {
        jobs.delete(fn);
        count.cancelled++;
      };
    },
    weeklyAnswer: () => undefined,
    onWeekly: (_h, w) => weekly.asked.push(w.utilization ?? 0),
    ...extra,
  });
  const tick = async () => {
    for (const j of [...jobs]) j();
    await keeper.settled();
  };
  return { clock, jobs, count, rss, probe, config, keeper, tick, weekly };
}
const tk = (runId: string, over: Partial<Ticket> = {}): Ticket => ({
  runId,
  stepId: "a",
  itemKey: "",
  kind: "worker",
  harnessId: "claude-code",
  cls: 1,
  underWay: false,
  runStartedAt: "2026-11-11T09:00:00.000Z",
  weightMb: 200,
  ...over,
});
const sig = () => new AbortController().signal;
const names = (k: Keeper) => k.snapshot().rows.map((r) => `${r.ticket.runId}:${r.state}`);
async function admitted(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

test("ceiling 1: the second step waits and says why, then runs when the first ends", async () => {
  const r = rig({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 });
  let waits = 0;
  const a = r.keeper.acquire(tk("a"), sig(), () => {
    waits += 100;
  });
  const b = r.keeper.acquire(tk("b"), sig(), () => {
    waits++;
  });
  await r.keeper.settled();
  expect(names(r.keeper)).toEqual(["a:running", "b:waiting"]);
  expect(waits).toBe(1);
  expect(r.keeper.waitingOf("b")).toEqual([
    {
      stepId: "a",
      itemKey: "",
      waiting: { reason: "ceiling", harnessId: "claude-code", running: 1, ceiling: 1 },
    },
  ]);
  (await a).release();
  await r.keeper.settled();
  expect(await admitted(b)).toBe(true);
  expect(names(r.keeper)).toEqual(["b:running"]);
});
test("order: owner runs before triggered, runs under way before new ones, oldest first, and a move goes to the front", async () => {
  const r = rig({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 });
  const first = await r.keeper.acquire(tk("first"), sig());
  void r.keeper.acquire(tk("trig", { cls: 2 }), sig());
  void r.keeper.acquire(tk("new-late", { runStartedAt: "2026-11-11T10:00:00.000Z" }), sig());
  void r.keeper.acquire(tk("new-early"), sig());
  void r.keeper.acquire(tk("under-way", { underWay: true, runStartedAt: "2026-11-11T10:30:00.000Z" }), sig());
  await r.keeper.settled();
  expect(names(r.keeper)).toEqual([
    "first:running",
    "under-way:waiting",
    "new-early:waiting",
    "new-late:waiting",
    "trig:waiting",
  ]);
  expect(r.keeper.move("trig")).toBe(true);
  expect(r.keeper.move("nobody")).toBe(false);
  expect(names(r.keeper).at(1)).toBe("trig:waiting");
  first.release();
  await r.keeper.settled();
  expect(names(r.keeper).at(0)).toBe("trig:running");
});
test("claimed weights count for 30 seconds, then the probe's own reading stands", async () => {
  const r = rig({ ceiling: 8, reserveMb: 1000, fiveHourLine: 0.9, sevenDayLine: 0.9 });
  r.probe.avail = 1500;
  await r.keeper.acquire(tk("a"), sig());
  await r.keeper.acquire(tk("b"), sig());
  const c = r.keeper.acquire(tk("c"), sig());
  await r.keeper.settled();
  expect(r.keeper.waitingOf("c").at(0)?.waiting.reason).toBe("memory");
  r.clock.now += 30_001;
  await r.tick();
  expect(await admitted(c)).toBe(true);
});
test("a waiting step that is aborted leaves the queue; nothing waits forever on an idle keeper", async () => {
  const r = rig({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 });
  const a = await r.keeper.acquire(tk("a"), sig());
  const ctl = new AbortController();
  const b = r.keeper.acquire(tk("b"), ctl.signal);
  await r.keeper.settled();
  ctl.abort();
  await expect(b).rejects.toThrow("aborted");
  expect(names(r.keeper)).toEqual(["a:running"]);
  a.release();
  await r.keeper.settled();
  expect(r.count).toEqual({ started: 1, cancelled: 1 });
  expect(r.jobs.size).toBe(0);
});
test("the peak is the largest sampled RSS times the correction", async () => {
  const r = rig();
  const slot = await r.keeper.acquire(tk("a"), sig());
  slot.attach(77);
  r.rss.set(77, 300);
  await r.tick();
  r.rss.set(77, 240);
  await r.tick();
  expect(slot.release().peakMb).toBeCloseTo(200, 6);
});
test("a refusal holds the harness until its reset, or backs off 15 then 30 minutes; a success clears it", async () => {
  const r = rig({ ceiling: 4, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 });
  r.keeper.noteLimits("claude-code", [{ status: "rejected", windows: {} }]);
  expect(r.keeper.quotaOf("claude-code").rejectedUntil).toBeUndefined(); // windows only: one refusal is counted once, by noteRefused
  r.keeper.noteRefused("claude-code");
  const b = r.keeper.acquire(tk("b"), sig());
  await r.keeper.settled();
  expect(r.keeper.waitingOf("b").at(0)?.waiting).toEqual({
    reason: "quota",
    harnessId: "claude-code",
    until: new Date(1_000_000 + 15 * 60_000).toISOString(),
  });
  r.keeper.noteRefused("claude-code");
  expect(r.keeper.quotaOf("claude-code").rejectedUntil).toBe(1_000_000 + 30 * 60_000);
  r.keeper.noteSuccess("claude-code");
  await r.keeper.settled();
  expect(await admitted(b)).toBe(true);
});
test("the weekly line is reported once per limit event and the 5-hour window is kept", async () => {
  const r = rig();
  r.keeper.noteLimits("claude-code", [
    {
      status: "allowed_warning",
      type: "seven_day",
      utilization: 0.95,
      resetsAt: 2_000,
      windows: {
        five_hour: { utilization: 0.3, resetsAt: 1_500 },
        seven_day: { utilization: 0.95, resetsAt: 2_000 },
      },
    },
  ]);
  expect(r.weekly.asked).toEqual([0.95]);
  expect(r.keeper.quotaOf("claude-code").fiveHour).toEqual({ utilization: 0.3, resetsAt: 1_500 });
});
test("windows survive a restart: a stored weekly window at 0.95 holds a triggered ticket and lets an owner ticket go", async () => {
  const saved: unknown[] = [];
  const stored = { "claude-code": { sevenDay: { utilization: 0.95, resetsAt: 2_000 } } };
  const r = rig(undefined, { loadQuota: () => stored, saveQuota: (h, w) => saved.push([h, w]) });
  void r.keeper.acquire(tk("trig", { cls: 2 }), sig());
  const owner = r.keeper.acquire(tk("owner"), sig());
  await r.keeper.settled();
  expect(names(r.keeper)).toEqual(["owner:running", "trig:waiting"]);
  await owner;
  r.keeper.noteLimits("claude-code", [
    { status: "allowed", windows: { five_hour: { utilization: 0.2, resetsAt: 1_500 } } },
  ]);
  expect(saved).toEqual([
    [
      "claude-code",
      { fiveHour: { utilization: 0.2, resetsAt: 1_500 }, sevenDay: { utilization: 0.95, resetsAt: 2_000 } },
    ],
  ]);
});
test("a failing evaluation never admits and never hangs the queue; onChange fires only on a change", async () => {
  let boom = true;
  let changes = 0;
  const base = { ceiling: 4, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 };
  const probes = {
    refresh: async () => {
      if (boom) throw new Error("unreadable");
    },
    availableMb: () => 8000,
    pressureLevel: () => 1,
    groupRssMb: () => undefined,
    totalMb: () => 16000,
  };
  const r = rig(base, {
    probes,
    onChange: () => {
      changes++;
    },
  });
  const a = r.keeper.acquire(tk("a"), sig());
  await r.keeper.settled();
  expect(names(r.keeper)).toEqual(["a:waiting"]);
  expect(r.keeper.waitingOf("a").at(0)?.waiting.reason).toBe("memory");
  boom = false;
  r.keeper.recheck();
  await r.keeper.settled();
  expect(await admitted(a)).toBe(true);
  const seen = changes;
  r.keeper.recheck();
  await r.keeper.settled();
  expect(changes).toBe(seen);
});

test("a bad ticket does not stop the others", async () => {
  const r = rig();
  void r.keeper.acquire(tk("bad", { weightMb: Number.NaN }), sig());
  const good = r.keeper.acquire(tk("good"), sig());
  await r.keeper.settled();
  expect(r.keeper.waitingOf("bad").at(0)?.waiting).toEqual({ reason: "memory" });
  expect(await admitted(good)).toBe(true);
});

test("invalid probe readings fail closed", async () => {
  const r = rig();
  r.probe.level = Number.NaN;
  void r.keeper.acquire(tk("bad-probe"), sig());
  await r.keeper.settled();
  expect(r.keeper.waitingOf("bad-probe").at(0)?.waiting.reason).toBe("memory");
});
