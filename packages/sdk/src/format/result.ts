import "../config.ts";
import { z } from "zod";

const lines = z.array(z.string().min(1).max(400)).max(10);
const answer = z.union([lines, z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), lines)]);
export const Result = z
  .strictObject({ kind: z.enum(["chat", "report"]), answer: answer.optional() })
  .superRefine((value, ctx) => {
    if (value.kind === "report" && value.answer !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["answer"],
        message: "Reports cannot have an answer",
        params: { code: "answer_on_report" },
      });
  });
export type Result = z.infer<typeof Result>;
