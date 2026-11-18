import "../config.ts";
import { z } from "zod";

const durationFactors: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
export const Duration = z
  .string()
  .regex(/^[1-9]\d*(s|m|h|d)$/)
  .refine((value) => {
    const factor = durationFactors[value.slice(-1)];
    const result = Number(value.slice(0, -1)) * (factor ?? NaN);
    return Number.isSafeInteger(result) && result <= 365 * 86400000;
  });
export type Duration = z.infer<typeof Duration>;
export function durationMs(text: string): number {
  const value = Duration.parse(text);
  const unit = value.slice(-1);
  const factor = durationFactors[unit];
  if (factor === undefined) throw new Error("Invalid duration");
  const result = Number(value.slice(0, -1)) * factor;
  if (!Number.isSafeInteger(result)) throw new Error("Duration out of range");
  return result;
}
export const valueId = z.string().regex(/^[a-z][a-z0-9_]*$/);
export const OutputDecl = z.strictObject({
  id: valueId,
  type: z.enum(["file", "folder", "text", "url", "json"]),
  path: z.string().optional(),
  from_step: z.string().optional(),
});
export type OutputDecl = z.infer<typeof OutputDecl>;
export const Limits = z.strictObject({
  max_duration: Duration.optional(),
  max_items: z.number().int().positive().optional(),
  max_runs_per_day: z.number().int().positive().optional(),
  max_attempts: z.number().int().min(1).max(12).optional(),
});
export type Limits = z.infer<typeof Limits>;
const checkCommon = {
  required: z.boolean().default(true),
  summary: z.string().optional(),
  of: valueId.optional(),
};
const counts = {
  min_count: z.number().int().nonnegative().optional(),
  max_count: z.number().int().nonnegative().optional(),
  min_bytes: z.number().int().nonnegative().optional(),
  max_bytes: z.number().int().nonnegative().optional(),
};
const pattern = {
  pattern: z.string().optional(),
  patterns: z.array(z.string()).optional(),
  ignore_case: z.boolean().optional(),
};
export const Check = z.discriminatedUnion("type", [
  z.strictObject({
    ...checkCommon,
    type: z.literal("command"),
    cmd: z
      .string()
      .regex(/^[A-Za-z0-9._-]+$/)
      .refine((s) => s !== "." && s !== ".."),
    args: z.array(z.string()).default([]),
  }),
  z.strictObject({ ...checkCommon, type: z.literal("files"), paths: z.array(z.string()), ...counts }),
  z.strictObject({ ...checkCommon, type: z.literal("schema"), file: z.string() }),
  z
    .strictObject({ ...checkCommon, type: z.literal("contains"), ...pattern })
    .refine((v) => (v.pattern !== undefined) !== (v.patterns !== undefined)),
  z
    .strictObject({ ...checkCommon, type: z.literal("not_contains"), ...pattern })
    .refine((v) => (v.pattern !== undefined) !== (v.patterns !== undefined)),
  z.strictObject({ ...checkCommon, type: z.literal("judge"), rubric: z.string() }),
  z.strictObject({ ...checkCommon, type: z.literal("user"), own_text: z.boolean().optional() }),
  z.strictObject({
    ...checkCommon,
    type: z.literal("probe"),
    tool: z.string().regex(/^[a-z][a-z0-9_-]*\.[A-Za-z0-9_-]+$/),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
]);
export type Check = z.infer<typeof Check>;
const stepBase = {
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().optional(),
  when: z.string().optional(),
  limits: Limits.optional(),
};
const leafBase = {
  ...stepBase,
  uses: z.array(z.string()).default([]),
  outputs: z.array(OutputDecl).default([]),
  checks: z.array(Check).default([]),
  retry: z.number().int().min(0).max(10).default(2),
  risky: z.array(z.string()).optional(),
  idempotent: z.boolean().optional(),
  skills: z.array(z.string()).optional(),
  connectors: z.array(z.string()).optional(),
  worker: z
    .strictObject({
      effort: z.enum(["low", "medium", "high"]).optional(),
      prefer: z.array(z.string()).optional(),
      needs: z.array(z.string()).optional(),
    })
    .optional(),
};
export const LeafStep = z.discriminatedUnion("do", [
  z.strictObject({ ...leafBase, do: z.literal("worker"), instructions: z.string() }),
  z.strictObject({ ...leafBase, do: z.literal("agent"), instructions: z.string() }),
  z.strictObject({ ...leafBase, do: z.literal("skill"), skill: z.string(), instructions: z.string() }),
  z.strictObject({
    ...leafBase,
    do: z.literal("builtin"),
    builtin: z.string(),
    with: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    ...leafBase,
    do: z.literal("flow"),
    flow: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+@\S+$/),
    with: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    ...leafBase,
    do: z.literal("ask"),
    ask: z.strictObject({
      question: z.string(),
      choose_from: z.string(),
      max_pick: z.union([z.number().int().positive(), z.string()]).default(1),
      approves: z.array(z.string()).default([]),
      expires: Duration.default("24h"),
      on_expiry: z.enum(["end", "fail"]).default("end"),
    }),
  }),
]);
export type LeafStep = z.infer<typeof LeafStep>;
export const LoopStep = z.strictObject({
  ...stepBase,
  for_each: z.string(),
  as: valueId,
  key: z.string().optional(),
  max: z.number().int().positive().optional(),
  parallel: z.number().int().positive().default(1),
  on_item_fail: z.enum(["skip", "stop"]).default("skip"),
  steps: z.array(LeafStep).min(1),
});
export type LoopStep = z.infer<typeof LoopStep>;
export const Step = z.union([LoopStep, LeafStep]);
export type Step = z.infer<typeof Step>;
