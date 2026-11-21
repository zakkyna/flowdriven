import { z } from "zod";

export const RiskLabel = z.enum(["official", "gray", "unofficial"]);
export type RiskLabel = z.infer<typeof RiskLabel>;
export const Id = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9._:-]{1,100}$/);
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
export const StepDo = z.enum(["worker", "agent", "builtin", "skill", "flow", "ask", "loop"]);
export type StepDo = z.infer<typeof StepDo>;
export const OutputType = z.enum(["file", "folder", "text", "url", "json"]);
export type OutputType = z.infer<typeof OutputType>;

export const AgentId = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/);
export type AgentId = z.infer<typeof AgentId>;
export const ModelId = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/);
export type ModelId = z.infer<typeof ModelId>;
export const TouchId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type TouchId = z.infer<typeof TouchId>;
export const LanguageCode = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
export type LanguageCode = z.infer<typeof LanguageCode>;
export const Line = z.strictObject({
  key: z
    .string()
    .max(100)
    .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9_]*)+$/),
  params: z.record(z.string(), z.union([z.string().max(400), z.number()])).optional(),
});
export type Line = z.infer<typeof Line>;
export const Place = z.strictObject({
  kind: z.enum(["account", "folder", "address", "site", "command", "repo"]),
  value: z.string().min(1).max(600),
  label: z.string().min(1).max(200),
});
export type Place = z.infer<typeof Place>;
export const AgentState = z.enum([
  "not_installed",
  "installing",
  "waiting_login",
  "needs_login",
  "ready",
  "unknown",
]);
export type AgentState = z.infer<typeof AgentState>;
export const Effect = z.enum([
  "read",
  "local_write",
  "run_command",
  "change",
  "send",
  "post",
  "pay",
  "delete",
  "merge",
]);
export type Effect = z.infer<typeof Effect>;
export const TouchRule = z.enum(["runs_alone", "asks_first", "not_allowed"]);
export type TouchRule = z.infer<typeof TouchRule>;
export const RuleEffect = z.enum(["local_write", "run_command", "change"]);
export type RuleEffect = z.infer<typeof RuleEffect>;
export const StartSource = z.enum([
  "chat",
  "flows",
  "again",
  "schedule",
  "after",
  "try_next",
  "proactive",
  "phone",
  "tool",
]);
export type StartSource = z.infer<typeof StartSource>;
export const Weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof Weekday>;
export const InputType = z.enum([
  "text",
  "longtext",
  "number",
  "bool",
  "date",
  "time",
  "duration",
  "choice",
  "url",
  "file",
  "folder",
  "secret_ref",
  "list<text>",
]);
export type InputType = z.infer<typeof InputType>;
export const TypedValue = z.strictObject({
  type: InputType,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});
export type TypedValue = z.infer<typeof TypedValue>;
