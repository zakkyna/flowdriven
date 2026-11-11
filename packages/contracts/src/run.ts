import { z } from "zod";
import { CheckType, Id, IsoDateTime, OutputType, SemVer, StepDo } from "./common.ts";

export const RunState = z.enum([
  "queued",
  "checking",
  "blocked",
  "running",
  "waiting_approval",
  "retrying",
  "interrupted",
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
export const RunReport = z.object({
  runId: Id,
  lines: z.tuple([z.string(), z.string(), z.string()]),
  saveOffer: z.boolean(),
});
export type RunReport = z.infer<typeof RunReport>;
export const RunSummary = z.object({
  id: Id,
  flowId: Id,
  flowName: z.string(),
  flowVersion: SemVer,
  oneTime: z.boolean(),
  project: z.string(),
  state: RunState,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  reportFirstLine: z.string().optional(),
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
  estimatedCostUsd: z.number(),
  report: RunReport.optional(),
  blockedReason: z.string().optional(),
});
export type RunDetail = z.infer<typeof RunDetail>;
export const RESUMABLE_RUN_STATES: readonly RunState[] = ["blocked", "failed", "interrupted"];
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
