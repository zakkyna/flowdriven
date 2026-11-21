import "../config.ts";
import { z } from "zod";
import type { Trigger } from "./manifest.ts";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const day = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const whenItsTime = z.enum(["ask", "last"]).default("ask");
export const scheduleSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manual") }),
  z.strictObject({ type: z.literal("daily"), time, whenItsTime }),
  z.strictObject({ type: z.literal("weekdays"), time, whenItsTime }),
  z.strictObject({ type: z.literal("weekly"), day, time, whenItsTime }),
  z.strictObject({
    type: z.literal("after"),
    afterFlowId: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
    whenItsTime,
  }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

export function scheduleToTrigger(schedule: z.input<typeof scheduleSchema>): Trigger | null {
  switch (schedule.type) {
    case "manual":
      return null;
    case "after":
      return { kind: "flow_done", flow: schedule.afterFlowId, status: "done" };
    case "daily":
      return { kind: "schedule", at: schedule.time, catch_up: "once", overlap: "skip" };
    case "weekdays":
      return {
        kind: "schedule",
        at: schedule.time,
        days: ["mon", "tue", "wed", "thu", "fri"],
        catch_up: "once",
        overlap: "skip",
      };
    case "weekly":
      return { kind: "schedule", at: schedule.time, days: [schedule.day], catch_up: "once", overlap: "skip" };
  }
}
