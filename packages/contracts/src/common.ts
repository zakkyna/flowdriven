import { z } from "zod";

export const RiskLabel = z.enum(["official", "gray", "unofficial"]);
export type RiskLabel = z.infer<typeof RiskLabel>;
export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export const ContentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export type ContentHash = z.infer<typeof ContentHash>;
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
export type SemVer = z.infer<typeof SemVer>;
export const RouteOption = z.object({ via: z.string(), risk: RiskLabel, note: z.string().optional() });
export type RouteOption = z.infer<typeof RouteOption>;
export const CheckType = z.enum([
  "command",
  "files",
  "schema",
  "contains",
  "not_contains",
  "judge",
  "user",
  "probe",
]);
export type CheckType = z.infer<typeof CheckType>;
export const StepDo = z.enum(["worker", "agent", "builtin"]);
export type StepDo = z.infer<typeof StepDo>;
export const OutputType = z.enum(["file", "folder", "text", "url", "json"]);
export type OutputType = z.infer<typeof OutputType>;
