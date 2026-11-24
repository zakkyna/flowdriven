import { z } from "zod";

export const NOTICE_KINDS = [
  "approval_waiting",
  "run_blocked",
  "weekly_limit",
  "flood_cap",
  "trigger_paused",
] as const;
export const NoticeId = z.string().regex(/^[A-Za-z0-9:._-]{1,100}$/);
export type NoticeId = z.infer<typeof NoticeId>;
export const NoticeTarget = z.discriminatedUnion("screen", [
  z.strictObject({ screen: z.literal("inbox"), approvalId: NoticeId.optional() }),
  z.strictObject({ screen: z.literal("run"), runId: NoticeId }),
  z.strictObject({ screen: z.literal("builder"), flowId: NoticeId }),
]);
export type NoticeTarget = z.infer<typeof NoticeTarget>;
export const Notice = z.strictObject({
  id: z.string().min(1).max(200),
  kind: z.enum(NOTICE_KINDS),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(240),
  target: NoticeTarget,
});
export type Notice = z.infer<typeof Notice>;
