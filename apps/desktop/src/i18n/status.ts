import type { ApprovalState, RunState, StepRunState, TouchRule } from "@flowdriven/contracts";

type StatusCode = RunState | StepRunState | ApprovalState | TouchRule;
export const STATUS_KEYS = [
  "status.queued",
  "status.checking",
  "status.running",
  "status.waiting_approval",
  "status.needs_login",
  "status.retrying",
  "status.blocked",
  "status.interrupted",
  "status.stopped",
  "status.done",
  "status.failed",
  "status.pending",
  "status.passed",
  "status.skipped",
  "status.approved",
  "status.approved_edited",
  "status.rejected",
  "status.expired",
  "status.allowed_always",
  "status.another_way",
  "status.runs_alone",
  "status.asks_first",
  "status.not_allowed",
] as const satisfies readonly `status.${StatusCode}`[];
