import type { Requirement, Value } from "@flowdriven/sdk";
import type { ApprovalState, CheckVerdict, ExitClass, RunState, StepState } from "./states.ts";

export type Attempt = {
  number: number;
  replan: boolean;
  worker: string;
  startedAt: string;
  endedAt?: string;
  exit?: ExitClass;
}; // worker = the harness name
export type CheckOutcome = {
  type: string;
  required: boolean;
  summary: string;
  verdict: CheckVerdict;
  evidence?: string;
};
export type FlowRow = {
  id: string;
  version: string;
  hash: string;
  manifest: unknown;
  files: Record<string, string>;
  registeredAt: string;
};
export type RunRow = {
  id: string;
  flowId: string;
  flowHash: string;
  flowVersion: string;
  state: RunState;
  project: string;
  inputs: Record<string, Value>;
  params: Record<string, Value>;
  trigger?: { kind: string; payload?: Value };
  requirements: Requirement[];
  startedAt: string;
  endedAt?: string;
  blockedReason?: string;
};
export type StepRow = {
  runId: string;
  stepId: string;
  itemKey: string;
  state: StepState;
  attempts: Attempt[];
  outputs: Record<string, Value>;
  checks: CheckOutcome[];
  note?: string;
};
export type ItemRow = {
  runId: string;
  loopId: string;
  key: string;
  position: number;
  item: Value;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  note?: string;
};
export type ApprovalRow = {
  id: string;
  kind: "ask" | "result_sign_off";
  runId: string;
  stepId: string;
  itemKey: string;
  summary: string;
  payload: Value;
  maxPick?: number;
  approves: string[];
  onExpiry: "end" | "fail";
  createdAt: string;
  expiresAt: string;
  state: ApprovalState;
  picks?: string[];
  resolvedAt?: string;
};
export type AuditEntry = { at: string; kind: string; runId?: string; detail: Value };
export type HarnessStateRow = {
  id: string;
  consent: "not_given" | "given" | "revoked";
  consentAt?: string;
  scan?: Value;
  scanAt?: string;
};
export type ModelUsage = {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
export type CallKind = "worker" | "judge" | "brain" | "poll";
export type UsageEventRow = {
  at: string;
  runId: string;
  stepId: string;
  itemKey: string;
  attempt: number;
  kind: CallKind;
  harness: string;
  models: ModelUsage[];
  turns: number;
  wallMs: number;
  queuedMs: number;
  memoryPeakMb?: number;
  exit: ExitClass;
  costUsd?: number;
};
export type TriggerOutcome =
  | "started"
  | "skipped_overlap"
  | "dropped_cap"
  | "dropped_queue_full"
  | "duplicate"
  | "needs_ok"
  | "refused"
  | "missed"
  | "depth"
  | "error";
export type TriggerRow = {
  flowId: string;
  index: number;
  enabled: boolean;
  hash: string;
  spec: string;
  enabledAt: string;
  cursorMs?: number;
  recentRuns?: string[];
  pausedAt?: string;
  lastFire?: { at: string; outcome: TriggerOutcome; runId?: string; detail?: string };
};
export interface Store {
  getTrigger(flowId: string, index: number): TriggerRow | undefined;
  putTrigger(row: TriggerRow): void;
  listTriggers(flowId?: string): TriggerRow[];
  claimKey(flowId: string, index: number, key: string, at: string): boolean;
  purgeKeys(before: string): number;
  addUsage(row: UsageEventRow): void;
  listUsage(filter?: { runId?: string; since?: string }): UsageEventRow[];
  recentPeaks(q: { flowId: string; stepId: string; kind: CallKind; harness: string; runs: number }): number[];
  getSetting(name: string): Value | undefined;
  putSetting(name: string, value: Value): void;
  deleteSetting(name: string): void;
  getHarnessState(id: string): HarnessStateRow | undefined;
  putHarnessState(row: HarnessStateRow): void;
  transaction<T>(fn: () => T): T; // BEGIN and COMMIT, ROLLBACK on a throw; nested calls use savepoints
  putFlow(row: FlowRow): void;
  getFlow(id: string, hash?: string): FlowRow | undefined; // no hash: the newest registered (highest rowid, not time); the same id and hash replaces
  listFlows(): FlowRow[];
  createRun(row: RunRow): void;
  updateRun(id: string, patch: Partial<Omit<RunRow, "id">>): void;
  getRun(id: string): RunRow | undefined;
  listRuns(filter?: { flowId?: string; state?: RunState }): RunRow[];
  upsertStep(row: StepRow): void;
  getStep(runId: string, stepId: string, itemKey?: string): StepRow | undefined;
  listSteps(runId: string): StepRow[];
  upsertItem(row: ItemRow): void;
  listItems(runId: string, loopId?: string): ItemRow[];
  isSeen(flowId: string, loopId: string, key: string): boolean;
  markSeen(flowId: string, loopId: string, key: string, at: string): void;
  purgeSeen(before: string): number;
  createApproval(row: ApprovalRow): void;
  getApproval(id: string): ApprovalRow | undefined;
  listApprovals(filter?: { state?: ApprovalState; runId?: string }): ApprovalRow[];
  updateApproval(id: string, patch: Partial<Omit<ApprovalRow, "id">>): void;
  addGrant(runId: string, tool: string, itemKey: string): void;
  hasGrant(runId: string, tool: string, itemKey: string): boolean;
  increment(name: string, day: string, by?: number): number;
  counter(name: string, day: string): number;
  appendAudit(entry: AuditEntry): void;
  listAudit(runId?: string): AuditEntry[];
  close(): void;
}
