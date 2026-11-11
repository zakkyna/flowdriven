import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Approval } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { createKeeper } from "../keeper/keeper.ts";
import type { Ticket } from "../keeper/types.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createRunnerService, type RunnerService } from "./service.ts";
import { createWeekly } from "./weekly-limit.ts";

const SAT = Date.parse("2026-11-14T09:00:00.000Z") / 1000;
const stores: Store[] = [];
const dirs: string[] = [];
const services: RunnerService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function rig() {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const clock = { now: new Date("2026-11-11T09:00:00.000Z") };
  let rechecks = 0;
  const again = () =>
    createWeekly({
      store,
      now: () => clock.now,
      recheck: () => {
        rechecks++;
      },
    });
  return {
    store,
    clock,
    weekly: again(),
    again,
    get rechecks() {
      return rechecks;
    },
  };
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

test("one item per window, with the spec's question", async () => {
  const w = await rig();
  w.weekly.onLimit("claude-code", { utilization: 0.93, resetsAt: SAT });
  w.weekly.onLimit("claude-code", { utilization: 0.95, resetsAt: SAT });
  w.weekly.onLimit("claude-code", {});
  const items = w.weekly.list();
  expect(items).toHaveLength(1);
  expect(items.at(0)).toMatchObject({
    id: "weekly-limit:claude-code",
    kind: "weekly_limit",
    state: "pending",
    summary: "Claude Code's weekly limit is 93% used and resets on Saturday. Keep running triggered flows?",
  });
});
test("the answer stands until the window resets, can be changed before, survives a restart, and a new window asks again", async () => {
  const w = await rig();
  w.weekly.onLimit("claude-code", { utilization: 0.9, resetsAt: SAT });
  expect(w.weekly.answerOf("claude-code")).toBeUndefined();
  expect(w.weekly.resolve("weekly-limit:claude-code", "reject").at(0)?.state).toBe("rejected");
  expect(w.weekly.resolve("weekly-limit:claude-code", "approve").at(0)?.state).toBe("approved");
  expect(w.weekly.answerOf("claude-code")).toBe("keep");
  expect(w.rechecks).toBe(2);
  expect(w.again().answerOf("claude-code")).toBe("keep");
  w.clock.now = new Date((SAT + 1) * 1000);
  expect(w.weekly.answerOf("claude-code")).toBeUndefined();
  w.weekly.onLimit("claude-code", { utilization: 0.91, resetsAt: SAT + 7 * 86400 });
  expect(w.weekly.list().at(0)?.state).toBe("pending");
});
test("an unanswered item expires at the reset; an unknown id is not_found", async () => {
  const w = await rig();
  w.weekly.onLimit("claude-code", { utilization: 0.9, resetsAt: SAT });
  w.clock.now = new Date((SAT + 1) * 1000);
  expect(w.weekly.list()).toEqual([]);
  expect(() => w.weekly.resolve("weekly-limit:nobody", "approve")).toThrow("There is no approval");
});
test("with the keeper: triggered runs wait at the weekly line, owner runs go on, hold keeps them waiting, keep lets them in", async () => {
  const w = await rig();
  let keeper: ReturnType<typeof createKeeper>;
  const weekly = createWeekly({ store: w.store, now: () => w.clock.now, recheck: () => keeper.recheck() });
  keeper = createKeeper({
    config: () => ({ ceiling: 4, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 }),
    probes: {
      refresh: async () => {},
      availableMb: () => 8000,
      pressureLevel: () => 1,
      groupRssMb: () => undefined,
      totalMb: () => 16000,
    },
    nowMs: () => w.clock.now.getTime(),
    every: () => () => {},
    weeklyAnswer: weekly.answerOf,
    onWeekly: weekly.onLimit,
  });
  keeper.noteLimits("claude-code", [
    {
      status: "allowed_warning",
      type: "seven_day",
      utilization: 0.95,
      resetsAt: SAT,
      windows: { seven_day: { utilization: 0.95, resetsAt: SAT } },
    },
  ]);
  const owner = keeper.acquire(tk("owner"), sig());
  const trig = keeper.acquire(tk("trig", { cls: 2 }), sig());
  await keeper.settled();
  const rows = () => keeper.snapshot().rows.map((r) => `${r.ticket.runId}:${r.state}`);
  expect(rows()).toEqual(["owner:running", "trig:waiting"]);
  expect(keeper.waitingOf("trig").at(0)?.waiting).toMatchObject({
    reason: "quota",
    until: "2026-11-14T09:00:00.000Z",
  });
  weekly.resolve("weekly-limit:claude-code", "reject");
  await keeper.settled();
  expect(rows()).toEqual(["owner:running", "trig:waiting"]);
  weekly.resolve("weekly-limit:claude-code", "approve");
  await keeper.settled();
  expect(rows()).toEqual(["owner:running", "trig:running"]);
  (await owner).release();
  (await trig).release();
});
test("the demo service lists and resolves a stored weekly item", async () => {
  const w = await rig();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-")));
  dirs.push(dir);
  const service = createRunnerService({ store: w.store, dataDir: dir, mode: "demo", now: () => w.clock.now });
  services.push(service);
  await service.start().settled;
  expect(
    Approval.array()
      .parse(await service.call("approvals.list", {}))
      .some((a) => a.kind === "weekly_limit"),
  ).toBe(false);
  w.store.putSetting("weekly:claude-code", {
    resetsAt: SAT,
    askedAt: w.clock.now.toISOString(),
    percent: 90,
  });
  expect(
    Approval.array()
      .parse(await service.call("approvals.list", {}))
      .some((a) => a.kind === "weekly_limit"),
  ).toBe(true);
  const result = Approval.array().parse(
    await service.call("approvals.resolve", { approvalId: "weekly-limit:claude-code", decision: "reject" }),
  );
  expect(result.at(0)?.state).toBe("rejected");
});

test("an answer stands when the next event has no readable reset time", async () => {
  const w = await rig();
  w.weekly.onLimit("claude-code", { utilization: 0.9, resetsAt: SAT });
  w.weekly.resolve("weekly-limit:claude-code", "reject");
  w.weekly.onLimit("claude-code", { utilization: 0.95 });
  expect(w.weekly.answerOf("claude-code")).toBe("hold");
  expect(w.weekly.list().at(0)).toMatchObject({
    state: "rejected",
    expiresAt: new Date(SAT * 1000).toISOString(),
  });
});
test("an item past its reset is gone from the list", async () => {
  const w = await rig();
  w.weekly.onLimit("claude-code", { utilization: 0.9, resetsAt: SAT });
  w.clock.now = new Date(SAT * 1000);
  expect(w.weekly.list()).toEqual([]);
  expect(w.store.getSetting("weekly:claude-code")).toBeUndefined();
});
