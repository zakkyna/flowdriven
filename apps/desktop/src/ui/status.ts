import type {
  ApprovalState,
  CheckVerdict,
  ConnectionState,
  RequirementState,
  RiskLabel,
  RunState,
  SignOffState,
  StepRunState,
} from "@flowdriven/contracts/v1";
import type { IconName } from "./icons";
export type Tone = "ok" | "bad" | "info" | "neutral" | "wait";
export type StatusDomain =
  | "run"
  | "step"
  | "check"
  | "requirement"
  | "approval"
  | "signOff"
  | "connection"
  | "risk";
export interface StatusPresentation {
  icon: IconName;
  label: string;
  tone: Tone;
}
type StatusValues = {
  run: RunState;
  step: StepRunState;
  check: CheckVerdict;
  requirement: RequirementState;
  approval: ApprovalState;
  signOff: SignOffState;
  connection: ConnectionState;
  risk: RiskLabel;
};
export const statuses = {
  run: {
    queued: { icon: "clock", label: "Queued", tone: "neutral" },
    checking: { icon: "ring", label: "Checking readiness", tone: "info" },
    blocked: { icon: "stop", label: "Blocked", tone: "bad" },
    running: { icon: "ring", label: "Running", tone: "info" },
    waiting_approval: { icon: "hand", label: "Waiting for you", tone: "wait" },
    retrying: { icon: "retry", label: "Retrying", tone: "info" },
    interrupted: { icon: "pause", label: "Interrupted", tone: "neutral" },
    done: { icon: "check", label: "Done", tone: "ok" },
    failed: { icon: "cross", label: "Failed", tone: "bad" },
  },
  step: {
    pending: { icon: "dash", label: "Not started", tone: "neutral" },
    running: { icon: "ring", label: "Running", tone: "info" },
    retrying: { icon: "retry", label: "Retrying", tone: "info" },
    waiting_approval: { icon: "hand", label: "Waiting for you", tone: "wait" },
    passed: { icon: "check", label: "Passed", tone: "ok" },
    failed: { icon: "cross", label: "Failed", tone: "bad" },
    skipped: { icon: "dash", label: "Skipped", tone: "neutral" },
    interrupted: { icon: "pause", label: "Interrupted", tone: "neutral" },
  },
  check: {
    passed: { icon: "check", label: "Passed", tone: "ok" },
    failed: { icon: "cross", label: "Failed", tone: "bad" },
    pending: { icon: "clock", label: "Not run yet", tone: "neutral" },
  },
  requirement: {
    ok: { icon: "check", label: "OK", tone: "ok" },
    missing: { icon: "circle-slash", label: "Missing", tone: "bad" },
    needs_login: { icon: "key", label: "Needs login", tone: "wait" },
    failed: { icon: "alert", label: "Failed", tone: "bad" },
    unchecked: { icon: "dash", label: "Not checked yet", tone: "neutral" },
  },
  approval: {
    pending: { icon: "hand", label: "Waiting for you", tone: "wait" },
    approved: { icon: "check", label: "Approved", tone: "ok" },
    rejected: { icon: "cross", label: "Rejected", tone: "bad" },
    expired: { icon: "clock", label: "Expired", tone: "neutral" },
  },
  signOff: {
    approved: { icon: "check", label: "Approved", tone: "ok" },
    stale: { icon: "alert", label: "Changed since approval", tone: "wait" },
    none: { icon: "dash", label: "Not approved yet", tone: "neutral" },
  },
  connection: {
    connected: { icon: "check", label: "Connected", tone: "ok" },
    needs_login: { icon: "key", label: "Needs login", tone: "wait" },
    failed: { icon: "alert", label: "Failed", tone: "bad" },
  },
  risk: {
    official: { icon: "shield", label: "Official", tone: "neutral" },
    gray: { icon: "half", label: "Gray", tone: "neutral" },
    unofficial: { icon: "alert", label: "Unofficial", tone: "bad" },
  },
} satisfies { [D in StatusDomain]: Record<StatusValues[D], StatusPresentation> };
export function statusOf(domain: StatusDomain, value: string): StatusPresentation {
  const table: Record<string, StatusPresentation> = statuses[domain];
  const presentation = Object.hasOwn(table, value) ? table[value] : undefined;
  if (!presentation) throw new Error(`Unknown ${domain} status: ${value}`);
  return presentation;
}
