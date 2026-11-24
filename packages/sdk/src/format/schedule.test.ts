import { expect, test } from "vitest";
import { flowV12 } from "../test-data/flow-v12.ts";
import { validateManifest } from "../validate/validate.ts";
import { Trigger } from "./manifest.ts";
import { parseManifest } from "./parse.ts";
import { scheduleSchema, scheduleToTrigger } from "./schedule.ts";

const examples = [
  [
    { type: "weekdays", time: "17:00" },
    {
      kind: "schedule",
      at: "17:00",
      days: ["mon", "tue", "wed", "thu", "fri"],
      catch_up: "once",
      overlap: "skip",
    },
  ],
  [
    { type: "daily", time: "08:00" },
    { kind: "schedule", at: "08:00", catch_up: "once", overlap: "skip" },
  ],
  [
    { type: "weekly", day: "mon", time: "08:00" },
    { kind: "schedule", at: "08:00", days: ["mon"], catch_up: "once", overlap: "skip" },
  ],
  [
    { type: "after", afterFlowId: "example.build-apk" },
    { kind: "flow_done", flow: "example.build-apk", status: "done" },
  ],
  [{ type: "manual" }, null],
] as const;

test("TC-j28-01 maps schedules and rejects invalid shapes", () => {
  for (const [schedule, expected] of examples) expect(scheduleToTrigger(schedule)).toEqual(expected);
  for (const schedule of [
    { type: "daily", time: "5pm" },
    { type: "daily", time: "24:00" },
    { type: "daily", time: "17:60" },
    { type: "weekly", time: "17:00" },
    { type: "after" },
    { type: "daily", time: "17:00", whenItsTime: "never" },
  ])
    expect(scheduleSchema.safeParse(schedule).success).toBe(false);
});

test("TC-SDK-12 maps schedules to valid existing triggers", () => {
  for (const [schedule, expected] of examples) {
    const trigger = scheduleToTrigger(schedule);
    expect(trigger).toEqual(expected);
    if (trigger !== null) expect(Trigger.safeParse(trigger).success).toBe(true);
  }
  expect(scheduleToTrigger({ type: "daily", time: "09:30" })).toEqual({
    kind: "schedule",
    at: "09:30",
    catch_up: "once",
    overlap: "skip",
  });
});

test("TC-SDK-13 validates schedule shapes and self references", () => {
  const parse = (schedule: unknown) => parseManifest(flowV12({ id: "example.build-apk", schedule }));
  const valid = parse({ type: "weekly", day: "fri", time: "17:00", whenItsTime: "last" });
  expect(valid.ok).toBe(true);
  for (const schedule of [
    { type: "daily", time: "25:00" },
    { type: "weekly", time: "17:00" },
    { type: "after" },
    { type: "daily", time: "17:00", whenItsTime: "never" },
    { type: "manual", time: "17:00" },
    { type: "daily" },
    { type: "weekdays" },
  ])
    expect(parse(schedule).ok).toBe(false);
  const self = parse({ type: "after", afterFlowId: "example.build-apk" });
  expect(self.ok).toBe(true);
  if (self.ok)
    expect(validateManifest(self.manifest)).toContainEqual(
      expect.objectContaining({ code: "schedule_self", path: "schedule.afterFlowId" }),
    );
  const defaulted = parse({ type: "daily", time: "09:30" });
  expect(
    defaulted.ok &&
      defaulted.manifest.format === "flowdriven-flow/1.2" &&
      defaulted.manifest.schedule?.type === "daily" &&
      defaulted.manifest.schedule.whenItsTime,
  ).toBe("ask");
});

test("TC-SDK-14 preserves a schedule as a suggestion without creating triggers", () => {
  const schedule = { type: "weekdays", time: "17:00", whenItsTime: "ask" };
  const parsed = parseManifest(flowV12({ schedule }));
  expect(parsed.ok).toBe(true);
  if (parsed.ok && parsed.manifest.format === "flowdriven-flow/1.2") {
    expect(parsed.manifest.schedule).toEqual(schedule);
    expect(parsed.manifest.triggers).toEqual([]);
    expect(validateManifest(parsed.manifest).some((issue) => issue.code === "unattended_prefix")).toBe(false);
  }
});
