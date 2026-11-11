import { z } from "zod";
import { Id, IsoDateTime } from "./common.ts";
import { TRIGGER_KINDS } from "./flow.ts";

export const TriggerKind = z.enum(TRIGGER_KINDS);
export type TriggerKind = z.infer<typeof TriggerKind>;
export const TRIGGER_SWITCHES = ["off", "on", "needs_ok", "unavailable"] as const;
export const TriggerSwitch = z.enum(TRIGGER_SWITCHES);
export type TriggerSwitch = z.infer<typeof TriggerSwitch>;
export const FIRE_OUTCOMES = [
  "started",
  "skipped_overlap",
  "dropped_cap",
  "dropped_queue_full",
  "duplicate",
  "needs_ok",
  "refused",
  "missed",
  "depth",
  "error",
] as const;
export const FireOutcome = z.enum(FIRE_OUTCOMES);
export type FireOutcome = z.infer<typeof FireOutcome>;
export const TriggerStatus = z.object({
  flowId: Id,
  index: z.number().int().min(0),
  kind: TriggerKind,
  summary: z.string(),
  state: TriggerSwitch,
  canEnable: z.boolean(),
  reason: z.string().max(300).optional(),
  nextAt: IsoDateTime.optional(),
  last: z
    .object({
      at: IsoDateTime,
      outcome: FireOutcome,
      runId: Id.optional(),
      detail: z.string().max(200).optional(),
    })
    .optional(),
  firesToday: z.number().int().min(0),
  droppedToday: z.number().int().min(0),
  dailyCap: z.number().int().min(1),
});
export type TriggerStatus = z.infer<typeof TriggerStatus>;
