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
export interface Store {
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
