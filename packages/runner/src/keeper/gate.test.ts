import { expect, test } from "vitest";
import { admit, defaultWeightMb, weightFromPeaks } from "./gate.ts";
import type { Ticket } from "./types.ts";

const t = (over: Partial<Ticket> = {}): Ticket => ({
  runId: "r",
  stepId: "a",
  itemKey: "",
  kind: "worker",
  harnessId: "claude-code",
  cls: 1,
  underWay: false,
  runStartedAt: "2026-11-11T09:00:00.000Z",
  weightMb: 300,
  ...over,
});
const config = { ceiling: 4, reserveMb: 600, fiveHourLine: 0.9, sevenDayLine: 0.9 };
const base = {
  ticket: t(),
  running: [{ ticket: t() }],
  claimedMb: 0,
  availableMb: 1000,
  config,
  nowMs: 1_000_000,
};
const reason = (r: ReturnType<typeof admit>) => (r.ok ? "ok" : r.waiting.reason);
test("memory gate: available - claimed - weight >= reserve", () => {
  expect(reason(admit(base))).toBe("ok");
  expect(reason(admit({ ...base, ticket: t({ weightMb: 401 }) }))).toBe("memory");
  expect(reason(admit({ ...base, claimedMb: 101 }))).toBe("memory");
});
test("floor of one: with nothing running a step starts on a tight Mac, unless pressure is at its highest", () => {
  const tight = { ...base, running: [], availableMb: 50 };
  expect(reason(admit(tight))).toBe("ok");
  expect(reason(admit({ ...tight, pressure: 4 }))).toBe("memory");
  expect(reason(admit({ ...base, pressure: 4 }))).toBe("memory");
  expect(reason(admit({ ...tight, availableMb: undefined, pressure: undefined }))).toBe("ok");
});
test("ceiling says how many run", () => {
  const w = admit({ ...base, config: { ...config, ceiling: 1 } });
  expect(w).toEqual({
    ok: false,
    waiting: { reason: "ceiling", harnessId: "claude-code", running: 1, ceiling: 1 },
  });
});
test("a refused harness waits until its reset; the 5-hour line leaves one process", () => {
  const until = 1_000_000 + 600_000;
  expect(admit({ ...base, quota: { rejectedUntil: until } })).toEqual({
    ok: false,
    waiting: { reason: "quota", harnessId: "claude-code", until: new Date(until).toISOString() },
  });
  const five = { fiveHour: { utilization: 0.92, resetsAt: 1_100 } };
  expect(reason(admit({ ...base, quota: five }))).toBe("quota");
  expect(reason(admit({ ...base, running: [], quota: five }))).toBe("ok");
});
test("ignores a window whose reset time has passed", () => {
  expect(reason(admit({ ...base, quota: { fiveHour: { utilization: 0.99, resetsAt: 900 } } }))).toBe("ok");
});
test("weekly line: triggered runs wait for the owner's answer, owner runs go on", () => {
  const quota = { sevenDay: { utilization: 0.95, resetsAt: 1_100 } };
  expect(reason(admit({ ...base, ticket: t({ cls: 2 }), quota }))).toBe("quota");
  expect(reason(admit({ ...base, ticket: t({ cls: 2 }), quota, weeklyAnswer: "hold" }))).toBe("quota");
  expect(reason(admit({ ...base, ticket: t({ cls: 2 }), quota, weeklyAnswer: "keep" }))).toBe("ok");
  expect(reason(admit({ ...base, quota }))).toBe("ok");
  expect(reason(admit({ ...base, ticket: t({ cls: 2 }), quota: { sevenDay: { utilization: 0.8 } } }))).toBe(
    "ok",
  );
});
test("a reset time that is not a date never throws and shows no time", () => {
  expect(admit({ ...base, quota: { rejectedUntil: 1e20 } })).toEqual({
    ok: false,
    waiting: { reason: "quota", harnessId: "claude-code" },
  });
  expect(admit({ ...base, quota: { fiveHour: { utilization: 0.95, resetsAt: 1e20 } } })).toEqual({
    ok: false,
    waiting: { reason: "quota", harnessId: "claude-code" },
  });
});
test("weights: the largest recent peak times 1.25, else the defaults of spec 21.2", () => {
  expect(weightFromPeaks([120, 180], 300)).toBe(225);
  expect(weightFromPeaks([], 300)).toBe(300);
  expect(defaultWeightMb({ harnessId: "claude-code", connectors: 2 })).toBe(500);
  expect(defaultWeightMb({ harnessId: "codex", connectors: 2 })).toBe(300);
});
