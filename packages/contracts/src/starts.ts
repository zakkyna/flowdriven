import { z } from "zod";
import { Id } from "./common.ts";

export const StartOutcome = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("started"), startId: Id, runId: Id, chatId: Id.optional() }),
  z.strictObject({
    outcome: z.literal("asked"),
    startId: Id,
    chatId: Id,
    questionId: Id,
    reused: z.boolean(),
  }),
  z.strictObject({
    outcome: z.literal("needs_confirmation"),
    startId: Id,
    chatId: Id,
    questionId: Id,
    reused: z.boolean(),
  }),
  z.strictObject({
    outcome: z.literal("refused"),
    startId: Id,
    reason: z.enum(["permission_off", "daily_limit", "flow_deleted", "agent_cannot_be_limited"]),
  }),
]);
export type StartOutcome = z.infer<typeof StartOutcome>;
export const FlowsStartInput = z.discriminatedUnion("source", [
  z.strictObject({ flowId: Id, source: z.literal("flows") }),
  z.strictObject({ flowId: Id, source: z.literal("again"), fromRunId: Id }),
]);
export type FlowsStartInput = z.infer<typeof FlowsStartInput>;
export const FlowsStartOutput = StartOutcome;
export type FlowsStartOutput = z.infer<typeof FlowsStartOutput>;
