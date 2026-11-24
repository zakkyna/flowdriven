import { z } from "zod";
import { Id, IsoDateTime } from "./common.ts";
import { Waiting } from "./run.ts";

export const QueueRow = z.object({
  runId: Id,
  flowName: z.string(),
  stepId: Id.optional(),
  stepTitle: z.string().optional(),
  itemKey: z.string().optional(),
  class: z.enum(["owner", "triggered"]),
  harnessId: Id.optional(),
  state: z.enum(["running", "waiting"]),
  waiting: Waiting.optional(),
  queuedSeconds: z.number().min(0),
});
export type QueueRow = z.infer<typeof QueueRow>;
export const QueueView = z.object({
  running: z.number().int().min(0),
  waiting: z.number().int().min(0),
  ceiling: z.number().int().min(1),
  rows: z.array(QueueRow),
});
export type QueueView = z.infer<typeof QueueView>;
export const Totals = z.object({
  calls: z.number().int().min(0),
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cacheRead: z.number().int().min(0),
  cacheWrite: z.number().int().min(0),
});
export type Totals = z.infer<typeof Totals>;
export const LimitWindow = z.object({
  utilization: z.number().min(0).max(1),
  resetsAt: IsoDateTime.optional(),
});
export type LimitWindow = z.infer<typeof LimitWindow>;
export const HarnessUsage = z.object({
  harnessId: Id,
  name: z.string(),
  today: Totals,
  week: Totals,
  limit: z.object({
    status: z.enum(["ok", "warning", "limited", "unknown"]),
    fiveHour: LimitWindow.optional(),
    sevenDay: LimitWindow.optional(),
    until: IsoDateTime.optional(),
  }),
});
export type HarnessUsage = z.infer<typeof HarnessUsage>;
export const UsageSummary = z.object({ harnesses: z.array(HarnessUsage) });
export type UsageSummary = z.infer<typeof UsageSummary>;
