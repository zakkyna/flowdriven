import { z } from "zod";
import {
  AgentId,
  CheckType,
  ContentHash,
  Id,
  IsoDateTime,
  Line,
  ModelId,
  OutputType,
  SemVer,
  StartSource,
  StepDo,
} from "./common.ts";

export const RunState = z.enum([
  "queued",
  "checking",
  "running",
  "waiting_approval",
  "needs_login",
  "retrying",
  "blocked",
  "interrupted",
  "stopped",
  "done",
  "failed",
]);
export type RunState = z.infer<typeof RunState>;
export const StepRunState = z.enum([
  "pending",
  "running",
  "retrying",
  "waiting_approval",
  "passed",
  "failed",
  "skipped",
  "interrupted",
  "stopped",
]);
export type StepRunState = z.infer<typeof StepRunState>;
export const CheckVerdict = z.enum(["passed", "failed", "pending"]);
export type CheckVerdict = z.infer<typeof CheckVerdict>;
export const ExitClass = z.enum(["ok", "failed", "quota", "auth", "interrupted"]);
export type ExitClass = z.infer<typeof ExitClass>;
export const CheckResult = z.object({
  type: CheckType,
  required: z.boolean(),
  summary: z.string(),
  verdict: CheckVerdict,
  evidence: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;
export const Attempt = z.object({
  number: z.number().int().min(1),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  exit: ExitClass.optional(),
  replan: z.boolean().optional(),
  worker: z.string().optional(),
});
export type Attempt = z.infer<typeof Attempt>;
export const ItemState = z.enum(["pending", "running", "passed", "failed", "skipped"]);
export type ItemState = z.infer<typeof ItemState>;
export const SKIP_REASONS = ["seen", "duplicate", "capped", "stopped"] as const;
export const SkipReason = z.enum(SKIP_REASONS);
export type SkipReason = z.infer<typeof SkipReason>;
export const BlockedCall = z.object({ tool: z.string(), reason: z.string(), count: z.number().int().min(1) });
export type BlockedCall = z.infer<typeof BlockedCall>;
export const ModelTokens = z.object({
  model: z.string().min(1).max(100),
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cacheRead: z.number().int().min(0),
  cacheWrite: z.number().int().min(0),
});
export type ModelTokens = z.infer<typeof ModelTokens>;
export const CALL_KINDS = ["worker", "judge", "brain", "poll"] as const;
export const CallKind = z.enum(CALL_KINDS);
export type CallKind = z.infer<typeof CallKind>;
export const UsageCall = z.object({
  runId: Id,
  stepId: Id,
  itemKey: z.string(),
  attempt: z.number().int().min(0),
  kind: CallKind,
  harnessId: Id,
  models: z.array(ModelTokens),
  turns: z.number().int().min(0),
  wallSeconds: z.number().min(0),
  queuedSeconds: z.number().min(0),
  memoryPeakMb: z.number().min(0).optional(),
  exit: ExitClass,
  costUsd: z.number().min(0).optional(),
  at: IsoDateTime,
});
export type UsageCall = z.infer<typeof UsageCall>;
export const StepUsage = z.object({
  calls: z.number().int().min(0),
  input: z.number().int().min(0),
  output: z.number().int().min(0),
  cacheRead: z.number().int().min(0),
  cacheWrite: z.number().int().min(0),
  turns: z.number().int().min(0),
  wallSeconds: z.number().min(0),
  queuedSeconds: z.number().min(0),
  reported: z.boolean(),
});
export type StepUsage = z.infer<typeof StepUsage>;
export const WAITING_REASONS = ["memory", "quota", "ceiling", "flow_overlap"] as const;
export const WaitingReason = z.enum(WAITING_REASONS);
export type WaitingReason = z.infer<typeof WaitingReason>;
export const Waiting = z.object({
  reason: WaitingReason,
  until: IsoDateTime.optional(),
  running: z.number().int().min(0).optional(),
  ceiling: z.number().int().min(1).optional(),
  harnessId: Id.optional(),
});
export type Waiting = z.infer<typeof Waiting>;
export const LeafStepRun = z.object({
  stepId: Id,
  title: z.string(),
  do: StepDo,
  state: StepRunState,
  worker: z.object({ harnessId: Id, name: z.string() }).optional(),
  attempts: z.array(Attempt),
  maxAttempts: z.number().int().min(1),
  checks: z.array(CheckResult),
  blocked: z.array(BlockedCall).max(20).optional(),
  note: z.string().optional(),
  picks: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
  usage: StepUsage.optional(),
  waiting: Waiting.optional(),
  outside: z.boolean().optional(),
  pagesRead: z.number().int().min(0).optional(),
  limitMs: z.number().int().min(1).optional(),
});
export type LeafStepRun = z.infer<typeof LeafStepRun>;
export const RunItem = z.object({
  key: z.string(),
  label: z.string(),
  state: ItemState,
  skip: SkipReason.optional(),
  note: z.string().optional(),
  steps: z.array(LeafStepRun),
});
export type RunItem = z.infer<typeof RunItem>;
export const StepRun = LeafStepRun.extend({ items: z.array(RunItem).optional() });
export type StepRun = z.infer<typeof StepRun>;
export const Cause = z.strictObject({
  code: z.enum([
    "agent_signed_out",
    "site_sign_in",
    "permission_off",
    "agent_not_set_up",
    "usage_limit",
    "spending_limit",
    "checks_failing",
    "requirement_missing",
    "flow_not_confirmed",
    "limits_not_applied",
    "crash",
    "step_failed",
    "stopped",
    "flow_deleted",
    "agent_cannot_be_limited",
    "daily_limit",
    "cost_not_reported",
    "internal_error",
  ]),
  params: z.record(z.string(), z.string()).optional(),
});
export type Cause = z.infer<typeof Cause>;
export const InputProblem = z.enum([
  "empty",
  "unreadable",
  "zero",
  "too_long",
  "too_long_text",
  "out_of_range",
  "not_a_choice",
  "hidden_characters",
]);
export type InputProblem = z.infer<typeof InputProblem>;
export const FieldProblem = z.strictObject({
  inputId: Id,
  problem: InputProblem,
  params: z.strictObject({ min: z.number().optional(), max: z.number().optional() }).optional(),
});
export type FieldProblem = z.infer<typeof FieldProblem>;
export const RunReport = z.strictObject({
  runId: Id,
  lines: z.array(z.string()).max(3),
  decisionLines: z.array(Line),
  result: z.strictObject({ kind: z.enum(["chat", "report"]), answer: z.array(z.string()).optional() }),
});
export type RunReport = z.infer<typeof RunReport>;
export const RunTrigger = z.object({
  kind: z.string().regex(/^[a-z_]{1,20}$/),
  words: z.string().min(1).max(200),
});
export type RunTrigger = z.infer<typeof RunTrigger>;
export const RunSummary = z.strictObject({
  id: Id,
  flowId: Id,
  flowName: z.string(),
  flowVersion: SemVer,
  flowHash: ContentHash,
  source: StartSource,
  startWords: Line.optional(),
  agent: AgentId,
  model: ModelId.optional(),
  chatId: Id.optional(),
  startedAfter: z.strictObject({ runId: Id, flowName: z.string() }).optional(),
  behind: z.strictObject({ runId: Id, needsYou: z.boolean() }).optional(),
  cause: Cause.optional(),
  currentStep: z
    .strictObject({ index: z.number().int().min(1), count: z.number().int().min(1), title: z.string() })
    .optional(),
  versionChanged: z.boolean(),
  oneTime: z.boolean(),
  project: z.string(),
  state: RunState,
  waiting: Waiting.optional(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  reportFirstLine: z.string().optional(),
  trigger: RunTrigger.optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;
export const UsageRow = z.object({
  harnessId: Id,
  name: z.string(),
  calls: z.number().int(),
  tokens: z.number().int().optional(),
  wallSeconds: z.number(),
  estimatedCostUsd: z.number().optional(),
});
export type UsageRow = z.infer<typeof UsageRow>;
export const RunDetail = RunSummary.extend({
  inputs: z.array(z.object({ id: Id, label: z.string(), value: z.string() })),
  steps: z.array(StepRun),
  approvalIds: z.array(Id),
  outputs: z.array(z.object({ id: Id, type: OutputType, value: z.string() })),
  usage: z.array(UsageRow),
  calls: z.array(UsageCall).optional(),
  estimatedCostUsd: z.number(),
  report: RunReport.optional(),
  blockedReason: z.string().optional(),
  decisionLines: z.array(Line),
  answer: z
    .strictObject({ lines: z.array(z.string()), chatId: Id.optional(), messageId: Id.optional() })
    .optional(),
  costLine: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("plan") }),
    z.strictObject({ kind: z.literal("amount"), usd: z.number().min(0) }),
    z.strictObject({ kind: z.literal("none") }),
  ]),
  canRunAgain: z.boolean(),
  canTryAgain: z.boolean(),
});
export type RunDetail = z.infer<typeof RunDetail>;
export const RESUMABLE_RUN_STATES: readonly RunState[] = ["blocked", "interrupted", "needs_login", "failed"];
export function isResumable(state: RunState): boolean {
  return RESUMABLE_RUN_STATES.includes(state);
}
export function firstUnpassedStep(
  run: Pick<RunDetail, "steps">,
): { index: number; step: StepRun } | undefined {
  const index = run.steps.findIndex((step) => step.state !== "passed" && step.state !== "skipped");
  const step = run.steps[index];
  return step === undefined ? undefined : { index: index + 1, step };
}
