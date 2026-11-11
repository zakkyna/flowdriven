export type { RiskyAction } from "@flowdriven/sdk";
export { RISKY_ACTIONS } from "@flowdriven/sdk";

export const RUN_STATES = [
  "queued",
  "checking",
  "blocked",
  "running",
  "waiting_approval",
  "retrying",
  "interrupted",
  "done",
  "failed",
] as const;
export type RunState = (typeof RUN_STATES)[number];
export const STEP_STATES = [
  "pending",
  "running",
  "retrying",
  "waiting_approval",
  "passed",
  "failed",
  "skipped",
  "interrupted",
] as const;
export type StepState = (typeof STEP_STATES)[number];
export const APPROVAL_STATES = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];
export const EXIT_CLASSES = ["ok", "failed", "quota", "auth", "interrupted"] as const;
export type ExitClass = (typeof EXIT_CLASSES)[number];
export const CHECK_VERDICTS = ["passed", "failed", "pending"] as const;
export type CheckVerdict = (typeof CHECK_VERDICTS)[number];
