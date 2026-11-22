export type { RiskyAction } from "@flowdriven/sdk";
export { RISKY_ACTIONS } from "@flowdriven/sdk";

export const RUN_STATES = [
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
] as const;
export type RunState = (typeof RUN_STATES)[number];
export const isActive = (state: RunState): boolean =>
  ["queued", "checking", "running", "retrying", "waiting_approval"].includes(state);
export const isEnded = (state: RunState): boolean => ["done", "failed", "stopped"].includes(state);
export const canResume = (state: RunState): boolean =>
  ["blocked", "interrupted", "needs_login", "failed"].includes(state);
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
