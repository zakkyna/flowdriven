import { expect, test } from "vitest";
import { createKeeper } from "./keeper.ts";

test("a throwing onChange must not make the pump reject", async () => {
  const keeper = createKeeper({
    config: () => ({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 }),
    probes: {
      refresh: async () => {},
      availableMb: () => 8000,
      pressureLevel: () => 1,
      groupRssMb: () => undefined,
      totalMb: () => 16000,
    },
    nowMs: () => 1_000_000,
    every: () => () => {},
    weeklyAnswer: () => undefined,
    onChange: () => {
      throw new Error("boom");
    },
  });
  const t = {
    runId: "r",
    stepId: "a",
    itemKey: "",
    kind: "worker" as const,
    harnessId: "h",
    cls: 1 as const,
    underWay: false,
    runStartedAt: "2026",
    weightMb: 1,
  };
  await keeper.acquire(t, new AbortController().signal);
  await expect(keeper.settled()).resolves.toBeUndefined();
});

test("throwing scheduler, notifications and probes leave the pump usable and fail closed", async () => {
  let failProbe = true;
  const keeper = createKeeper({
    config: () => ({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 }),
    probes: {
      refresh: async () => {
        if (failProbe) throw new Error("probe");
      },
      availableMb: () => 8000,
      pressureLevel: () => 1,
      groupRssMb: () => undefined,
      totalMb: () => 16000,
    },
    nowMs: () => 1_000_000,
    every: () => {
      throw new Error("scheduler");
    },
    weeklyAnswer: () => undefined,
    onChange: () => {
      throw new Error("change");
    },
    onWeekly: () => {
      throw new Error("weekly");
    },
    saveQuota: () => {
      throw new Error("save");
    },
  });
  const ticket = {
    runId: "r",
    stepId: "a",
    itemKey: "",
    kind: "worker" as const,
    harnessId: "h",
    cls: 1 as const,
    underWay: false,
    runStartedAt: "2026",
    weightMb: 1,
  };
  const pending = keeper.acquire(ticket, new AbortController().signal, () => {
    throw new Error("wait");
  });
  await keeper.settled();
  expect(keeper.snapshot().rows[0]?.state).toBe("waiting");
  keeper.noteLimits("h", [{ status: "allowed", type: "seven_day", utilization: 0.95, windows: {} }]);
  failProbe = false;
  keeper.recheck();
  const slot = await pending;
  slot.release();
  await expect(keeper.settled()).resolves.toBeUndefined();
  keeper.stop();
});

test("throwing memory probes follow the same rule as absent readings", async () => {
  const make = (throws: boolean) =>
    createKeeper({
      config: () => ({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 }),
      probes: {
        refresh: async () => {},
        availableMb: () => {
          if (throws) throw new Error("memory");
          return undefined;
        },
        pressureLevel: () => {
          if (throws) throw new Error("pressure");
          return undefined;
        },
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      nowMs: () => 1_000_000,
      every: () => () => {},
      weeklyAnswer: () => undefined,
    });
  const ticket = {
    runId: "r",
    stepId: "a",
    itemKey: "",
    kind: "worker" as const,
    harnessId: "h",
    cls: 1 as const,
    underWay: false,
    runStartedAt: "2026",
    weightMb: 1,
  };
  for (const throws of [false, true]) {
    const keeper = make(throws);
    const slot = await keeper.acquire(ticket, new AbortController().signal);
    expect(keeper.snapshot().rows[0]?.state).toBe("running");
    slot.release();
    keeper.stop();
  }
});
