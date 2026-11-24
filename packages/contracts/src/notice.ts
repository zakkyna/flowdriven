import { z } from "zod";
import { LanguageCode } from "./common.ts";
export const NOTICE_KINDS = [
  "approval_waiting",
  "run_blocked",
  "weekly_limit",
  "flood_cap",
  "trigger_paused",
  "question_waiting",
  "confirm_waiting",
] as const;
export const NoticeId = z.string().regex(/^[A-Za-z0-9:._-]{1,100}$/);
export type NoticeId = z.infer<typeof NoticeId>;
export const NoticeTarget = z.discriminatedUnion("screen", [
  z.strictObject({ screen: z.literal("run"), runId: NoticeId, approvalId: NoticeId.optional() }),
  z.strictObject({ screen: z.literal("chat"), chatId: NoticeId }),
  z.strictObject({ screen: z.literal("flow"), flowId: NoticeId }),
  z.strictObject({ screen: z.literal("activity") }),
  z.strictObject({ screen: z.literal("settings") }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;
const keys = {
  approval_waiting: "decision",
  run_blocked: "problem",
  weekly_limit: "limit",
  flood_cap: "limit",
  trigger_paused: "limit",
  question_waiting: "question",
  confirm_waiting: "question",
} as const;
export const Notice = z
  .strictObject({
    id: z.string().min(1).max(200),
    kind: z.enum(NOTICE_KINDS),
    title: z.strictObject({ key: z.string() }),
    body: z.strictObject({ key: z.string() }),
    language: LanguageCode,
    target: NoticeTarget,
  })
  .refine(
    (notice) =>
      notice.title.key === `notice.${keys[notice.kind]}Title` &&
      notice.body.key === `notice.${keys[notice.kind]}Body`,
  );
export type Notice = z.infer<typeof Notice>;
