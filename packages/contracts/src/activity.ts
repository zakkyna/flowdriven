import { z } from "zod";
import { Approval } from "./approval.ts";
import { Id, IsoDateTime } from "./common.ts";
import { RunSummary } from "./run.ts";

export const NeedsYouItem = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("question"),
    questionId: Id,
    questionKind: z.enum(["inputs", "confirm"]),
    flowId: Id,
    flowName: z.string(),
    chatId: Id,
    askedAt: IsoDateTime,
  }),
  z.strictObject({ kind: z.literal("decision"), decision: Approval }),
]);
export type NeedsYouItem = z.infer<typeof NeedsYouItem>;
export const EarlierRow = z.strictObject({ kind: z.literal("run"), run: RunSummary });
export type EarlierRow = z.infer<typeof EarlierRow>;
export const ActivitySummary = z.strictObject({
  needsYou: z.array(NeedsYouItem),
  needsYouCount: z.number().int().min(0),
  running: z.array(RunSummary),
  earlier: z.array(EarlierRow),
  nextBefore: IsoDateTime.optional(),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;
