import { z } from "zod";
import {
  CheckType,
  ContentHash,
  Effect,
  Id,
  InputType,
  IsoDateTime,
  OutputType,
  Place,
  RouteOption,
  RuleEffect,
  SemVer,
  StepDo,
  TouchId,
  TouchRule,
  Weekday,
} from "./common.ts";
import { RunState, RunSummary } from "./run.ts";

export const FlowKind = z.enum(["build", "light"]);
export type FlowKind = z.infer<typeof FlowKind>;
export const Check = z.object({
  type: CheckType,
  required: z.boolean().default(true),
  summary: z.string(),
  cmd: z.string().optional(),
  args: z.array(z.string()).optional(),
  of: z.string().optional(),
});
export type Check = z.infer<typeof Check>;
export const Effort = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof Effort>;
export const WorkerPreference = z.object({
  effort: Effort.optional(),
  prefer: z.array(z.string()).optional(),
  needs: z.array(z.string()).optional(),
});
export type WorkerPreference = z.infer<typeof WorkerPreference>;
export const OutputDecl = z.object({
  id: Id,
  type: OutputType,
  path: z.string().optional(),
  from_step: Id.optional(),
});
export type OutputDecl = z.infer<typeof OutputDecl>;
export const InputDecl = z.object({
  id: Id,
  type: InputType,
  label: z.string(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  remember: z.boolean().optional(),
  example: z.string().optional(),
  choices: z.array(z.strictObject({ key: z.string(), label: z.string() })).optional(),
});
export type InputDecl = z.infer<typeof InputDecl>;
export const RequirementType = z.enum([
  "harness",
  "skill",
  "plugin",
  "mcp_server",
  "cli_tool",
  "gui_app",
  "account",
  "browser_session",
  "path",
  "web",
  "desktop",
  "trigger",
]);
export type RequirementType = z.infer<typeof RequirementType>;
export const Requirement = z.object({
  id: Id,
  type: RequirementType,
  ref: z.string(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  why: z.string(),
  connect: z.enum(["native", "gateway"]).optional(),
  tools: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
  session: z.enum(["none", "managed", "own"]).optional(),
  url_patterns: z.array(z.string()).optional(),
  rate: z
    .object({ per_run: z.number().int().min(1).optional(), per_day: z.number().int().min(1).optional() })
    .optional(),
  on_challenge: z.literal("stop").optional(),
  access: z.enum(["read", "read_write"]).optional(),
  routes: z.array(RouteOption).default([]),
  mode: z.enum(["open", "read", "act"]).optional(),
  apps: z.array(z.string()).optional(),
  kinds: z.array(z.string()).optional(),
});
export type Requirement = z.infer<typeof Requirement>;
export const AskDecl = z.object({
  question: z.string(),
  choose_from: z.string(),
  max_pick: z.union([z.number().int().min(1), z.string()]),
  approves: z.array(z.string()),
  expires: z.string(),
  on_expiry: z.enum(["end", "fail"]),
});
export type AskDecl = z.infer<typeof AskDecl>;
const stepFields = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string(),
  do: StepDo,
  instructions: z.string(),
  when: z.string().optional(),
  skill: z.string().optional(),
  flow: z.string().optional(),
  builtin: z.string().optional(),
  ask: AskDecl.optional(),
  uses: z.array(Id).default([]),
  skills: z.array(z.string()).optional(),
  connectors: z.array(z.string()).optional(),
  worker: WorkerPreference.optional(),
  outputs: z.array(OutputDecl).default([]),
  checks: z.array(Check).default([]),
  retry: z.number().int().min(0).default(2),
  risky: z.array(z.string()).optional(),
  idempotent: z.boolean().optional(),
};
function needsChecks(step: { do: StepDo; checks: Check[] }, ctx: z.RefinementCtx): void {
  if (step.do !== "ask" && step.do !== "loop" && step.checks.length === 0) {
    ctx.addIssue({ code: "custom", path: ["checks"], message: "A step needs at least one check." });
  }
}
export const LeafStep = z.object(stepFields).superRefine((step, ctx) => {
  needsChecks(step, ctx);
  if (step.do === "loop")
    ctx.addIssue({ code: "custom", path: ["do"], message: "A nested step cannot be a loop." });
  if ((step.do === "ask") !== (step.ask !== undefined))
    ctx.addIssue({
      code: "custom",
      path: ["ask"],
      message: "An ask object is required exactly for an ask step.",
    });
});
export type LeafStep = z.infer<typeof LeafStep>;
export const LoopDecl = z.object({
  for_each: z.string(),
  as: z.string(),
  key: z.string().optional(),
  max: z.number().int().min(1).optional(),
  on_item_fail: z.enum(["skip", "stop"]),
  steps: z.array(LeafStep).min(1),
});
export type LoopDecl = z.infer<typeof LoopDecl>;
export const Step = z.object({ ...stepFields, loop: LoopDecl.optional() }).superRefine((step, ctx) => {
  needsChecks(step, ctx);
  if ((step.do === "loop") !== (step.loop !== undefined))
    ctx.addIssue({
      code: "custom",
      path: ["loop"],
      message: "A loop object is required exactly for a loop step.",
    });
  if ((step.do === "ask") !== (step.ask !== undefined))
    ctx.addIssue({
      code: "custom",
      path: ["ask"],
      message: "An ask object is required exactly for an ask step.",
    });
});
export type Step = z.infer<typeof Step>;
export const TRIGGER_KINDS = [
  "manual",
  "schedule",
  "new_item",
  "file_change",
  "link",
  "webhook",
  "flow_done",
] as const;
export const Trigger = z.object({ kind: z.enum(TRIGGER_KINDS), summary: z.string() });
export type Trigger = z.infer<typeof Trigger>;
export const ParamDecl = z.object({
  type: z.enum(["number", "text", "bool", "enum"]),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  options: z.array(z.string()).optional(),
  label: z.string().optional(),
});
export type ParamDecl = z.infer<typeof ParamDecl>;
export const Limits = z.object({
  max_duration: z.string().optional(),
  max_items: z.number().int().min(1).optional(),
  max_runs_per_day: z.number().int().min(1).optional(),
  max_attempts: z.number().int().min(1).optional(),
});
export type Limits = z.infer<typeof Limits>;
export const FLOW_FORMATS = ["flowdriven-flow/1", "flowdriven-flow/1.1", "flowdriven-flow/1.2"] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const whenItsTime = z.enum(["ask", "last"]);
export const ScheduleSpec = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("manual") }),
  z.strictObject({ type: z.literal("daily"), time, whenItsTime: whenItsTime.optional() }),
  z.strictObject({ type: z.literal("weekdays"), time, whenItsTime: whenItsTime.optional() }),
  z.strictObject({ type: z.literal("weekly"), day: Weekday, time, whenItsTime: whenItsTime.optional() }),
  z.strictObject({ type: z.literal("after"), afterFlowId: Id, whenItsTime: whenItsTime.optional() }),
]);
export type ScheduleSpec = z.infer<typeof ScheduleSpec>;
export const ScheduleView = z.strictObject({
  type: z.enum(["manual", "daily", "weekdays", "weekly", "after"]),
  time: time.optional(),
  day: Weekday.optional(),
  afterFlow: z.strictObject({ id: Id, name: z.string() }).optional(),
  whenItsTime,
  needsAnswers: z.boolean(),
  canUseLast: z.boolean(),
  nextAt: IsoDateTime.optional(),
});
export type ScheduleView = z.infer<typeof ScheduleView>;
export const FlowManifest = z.object({
  format: z.enum(FLOW_FORMATS),
  result: z
    .strictObject({
      kind: z.enum(["chat", "report"]),
      answer: z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]).optional(),
    })
    .optional(),
  touches: z
    .array(
      z.strictObject({
        id: TouchId,
        sentence: z.string(),
        effect: Effect,
        place: Place.optional(),
        rule: TouchRule,
        covers: z.array(z.string()),
      }),
    )
    .optional(),
  schedule: ScheduleSpec.optional(),
  triggers: z.array(Trigger).optional(),
  params: z.record(z.string(), ParamDecl).optional(),
  limits: Limits.optional(),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  version: SemVer,
  publisher: z.string().optional(),
  license: z.string(),
  kind: FlowKind,
  inputs: z.array(InputDecl),
  outputs: z.array(OutputDecl),
  requirements: z.array(Requirement),
  defaults: z.object({
    skills: z.array(z.string()).optional(),
    connectors: z.array(z.string()).optional(),
    worker: WorkerPreference.optional(),
  }),
  steps: z.array(Step).min(1),
});
export type FlowManifest = z.infer<typeof FlowManifest>;
export const SignOffState = z.enum(["approved", "stale", "none"]);
export type SignOffState = z.infer<typeof SignOffState>;
export const FlowSignOff = z.object({ state: SignOffState, version: SemVer.optional() });
export type FlowSignOff = z.infer<typeof FlowSignOff>;
export const Playback = z.object({
  goal: z.string(),
  touches: z.array(z.string()),
  asksApprovalFor: z.array(z.string()),
});
export type Playback = z.infer<typeof Playback>;
export const ClarifyQuestion = z.object({
  id: Id,
  text: z.string(),
  suggestions: z.array(z.string()).min(1).max(4),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestion>;
export const ChatMessage = z.object({
  id: Id,
  role: z.enum(["user", "agent"]),
  text: z.string(),
  at: IsoDateTime,
  questions: z.array(ClarifyQuestion).max(3).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
export const FlowState = z.enum(["new", "changed", "confirmed"]);
export type FlowState = z.infer<typeof FlowState>;
export const FlowSummary = z.strictObject({
  id: Id,
  name: z.string(),
  summary: z.string(),
  state: FlowState,
  live: z.enum(["running", "needs_you"]).nullable(),
  steps: z.array(z.strictObject({ id: Id, title: z.string() })).max(50),
  schedule: ScheduleView,
  result: z.enum(["chat", "report"]),
  asksFor: z.array(z.string()),
  lastRun: z.strictObject({ runId: Id, state: RunState, at: IsoDateTime }).optional(),
  madeFromSkill: z.strictObject({ skillId: Id, name: z.string() }).optional(),
  format: z.enum(["flowdriven-flow/1.1", "flowdriven-flow/1.2"]),
  createdAt: IsoDateTime,
});
export type FlowSummary = z.infer<typeof FlowSummary>;
export const InputView = z.strictObject({
  id: Id,
  label: z.string(),
  type: InputType,
  required: z.boolean(),
  example: z.string().optional(),
  choices: z.array(z.strictObject({ key: z.string(), label: z.string() })).optional(),
  default: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("value"), value: z.string() }),
      z.strictObject({ kind: z.literal("today") }),
      z.strictObject({ kind: z.literal("now") }),
    ])
    .optional(),
  remember: z.boolean(),
  remembered: z.string().optional(),
  line: z.enum(["remembers", "default", "asks", "optional"]),
});
export type InputView = z.infer<typeof InputView>;
export const TouchView = z.strictObject({
  id: TouchId,
  sentence: z.string(),
  effect: Effect,
  place: Place.optional(),
  fixedPlace: z.boolean(),
  alwaysAsks: z.boolean(),
  declared: TouchRule,
  list: z.enum(["on_its_own", "asks_first", "never"]),
  byRule: Id.optional(),
});
export type TouchView = z.infer<typeof TouchView>;
export const StandingRuleView = z
  .strictObject({
    id: Id,
    flowId: Id,
    touchId: TouchId,
    sentence: z.string(),
    effect: RuleEffect,
    place: Place,
    createdAt: IsoDateTime,
    createdBy: z.enum(["always_allow", "confirm"]),
    lastUsedAt: IsoDateTime.optional(),
  })
  .refine((rule) =>
    rule.effect === "change"
      ? ["account", "folder"].includes(rule.place.kind)
      : rule.effect === "local_write"
        ? rule.place.kind === "folder"
        : rule.place.kind === "command",
  );
export type StandingRuleView = z.infer<typeof StandingRuleView>;
const touchLists = z.strictObject({
  onItsOwn: z.array(TouchId),
  asksFirst: z.array(TouchId),
  never: z.array(TouchId),
});
export const FlowDetail = z.strictObject({
  summary: FlowSummary,
  description: z.string(),
  hash: ContentHash,
  confirmed: z.strictObject({ hash: ContentHash, at: IsoDateTime }).optional(),
  version: SemVer,
  steps: z
    .array(
      z.strictObject({
        id: Id,
        title: z.string(),
        kind: StepDo,
        asksFirst: z.boolean(),
        skill: z.string().optional(),
        judgedOnly: z.boolean(),
      }),
    )
    .max(50),
  inputs: z.array(InputView),
  result: z.strictObject({ kind: z.enum(["chat", "report"]), answer: z.array(z.string()).optional() }),
  touches: z.array(TouchView),
  lists: touchLists,
  confirmLists: touchLists,
  rules: z.array(StandingRuleView),
  pinsNeeded: z.array(
    z.strictObject({ requirementId: Id, label: z.string(), access: z.enum(["read", "read_write"]) }),
  ),
  changes: z.array(z.strictObject({ sign: z.enum(["+", "-", "~"]), text: z.string() })).optional(),
  recentRuns: z.array(RunSummary).max(5),
  manifest: FlowManifest,
});
export type FlowDetail = z.infer<typeof FlowDetail>;
export const FlowsConfirmInput = z
  .strictObject({
    flowId: Id,
    hash: ContentHash,
    onItsOwn: z.array(TouchId).max(100),
    pins: z.record(z.string().min(1).max(100), z.string().min(1).max(600)).optional(),
  })
  .refine((v) => new Set(v.onItsOwn).size === v.onItsOwn.length && Object.keys(v.pins ?? {}).length <= 50);
export type FlowsConfirmInput = z.infer<typeof FlowsConfirmInput>;
export const FlowsConfirmOutput = z.strictObject({
  flow: FlowDetail,
  rules: z.strictObject({ created: z.array(Id), kept: z.array(Id), ended: z.array(Id) }),
});
export type FlowsConfirmOutput = z.infer<typeof FlowsConfirmOutput>;
export const FlowsSetScheduleInput = z.strictObject({
  flowId: Id,
  hash: ContentHash,
  schedule: ScheduleSpec,
});
export type FlowsSetScheduleInput = z.infer<typeof FlowsSetScheduleInput>;
export const FlowsSetScheduleOutput = z.strictObject({ schedule: ScheduleView });
export type FlowsSetScheduleOutput = z.infer<typeof FlowsSetScheduleOutput>;
export const FlowEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), stepId: Id, direction: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("duplicate"), stepId: Id }),
  z.object({ kind: z.literal("delete"), stepId: Id }),
  z.object({ kind: z.literal("add"), title: z.string().min(1) }),
  z.object({ kind: z.literal("undo") }),
]);
export type FlowEdit = z.infer<typeof FlowEdit>;
export function isJudgedOnly(checks: Check[]): boolean {
  const required = checks.filter((check) => check.required);
  return required.length > 0 && required.every((check) => check.type === "judge");
}
