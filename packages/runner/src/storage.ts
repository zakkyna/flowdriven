import type { Requirement, Value } from "@flowdriven/sdk";
import type { Routed } from "./router/types.ts";
import type { ApprovalState, CheckVerdict, ExitClass, RiskyAction, RunState, StepState } from "./states.ts";

type Line = { key: string; params?: Record<string, string | number> };
type StartSource =
  | "chat"
  | "flows"
  | "again"
  | "schedule"
  | "after"
  | "try_next"
  | "proactive"
  | "phone"
  | "tool";
type TypedValue = {
  type:
    | "text"
    | "longtext"
    | "number"
    | "bool"
    | "date"
    | "time"
    | "duration"
    | "choice"
    | "url"
    | "file"
    | "folder"
    | "secret_ref"
    | "list<text>";
  value: string | number | boolean | string[];
};
type Cause = {
  code:
    | "agent_signed_out"
    | "site_sign_in"
    | "permission_off"
    | "agent_not_set_up"
    | "usage_limit"
    | "spending_limit"
    | "checks_failing"
    | "requirement_missing"
    | "flow_not_confirmed"
    | "limits_not_applied"
    | "crash"
    | "step_failed"
    | "stopped"
    | "flow_deleted"
    | "agent_cannot_be_limited"
    | "daily_limit"
    | "cost_not_reported"
    | "internal_error";
  params?: Record<string, string>;
};

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
  format?: "flowdriven-flow/1.1" | "flowdriven-flow/1.2";
  savedBy?: { kind: "save_flow" | "save_change" | "import" | "market" | "demo"; draftId?: string };
  parentHash?: string;
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
  trigger?: { kind: string; payload?: Value; index?: number };
  requirements: Requirement[];
  routes?: Routed[];
  startedAt: string;
  endedAt?: string;
  blockedReason?: string;
  agent?: { agent: string; model?: string; choice: "main" | "chat" | "busy_fallback" };
  language?: string;
  flowName?: string;
  start?: {
    source: StartSource;
    startId?: string;
    chatId?: string;
    messageId?: string;
    chainId?: string;
    chainIndex?: number;
    afterRunId?: string;
    fromRunId?: string;
    questionId?: string;
    slotAt?: string;
  };
  cause?: Cause;
  needsLoginSince?: string;
  decisionLines?: Line[];
  result?: { kind: "chat" | "report"; chatId?: string; messageId?: string };
  stoppedBy?: "person" | "permission_off" | "flow_deleted" | "phone";
};
export type StepRow = {
  runId: string;
  stepId: string;
  itemKey: string;
  state: StepState;
  attempts: Attempt[];
  outputs: Record<string, Value>;
  checks: CheckOutcome[];
  limitMs?: number;
  note?: string;
  noteLine?: Line;
  outside?: boolean;
  ownerApproved?: { output: string; hash: string; approvalId: string; at: string };
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
  kind: "ask" | "result_sign_off" | "risky_action";
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
  riskyAction?: RiskyAction;
  outside?: boolean;
  call?: { tool: string; input: Value };
  ownText?: { output: string; hash: string };
};
export type AuditEntry = { at: string; kind: string; runId?: string; detail: Value };
export type AuditRecord = AuditEntry & { id: number };
export type StartRow = {
  id: string;
  flowId: string;
  at: string;
  source: StartSource;
  outcome: "started" | "asked" | "needs_confirmation" | "refused" | "missed" | "skipped";
  key?: string;
  reason?: string;
  runId?: string;
  chatId?: string;
  messageId?: string;
  questionId?: string;
  slotAt?: string;
  request: {
    chatId?: string;
    messageId?: string;
    chainId?: string;
    chainIndex?: number;
    afterRunId?: string;
    fromRunId?: string;
  };
  agent?: { agent: string; model: string; choice: "chat" | "main" | "busy_fallback" };
  flowHash?: string;
};
export type RuleInput = {
  flowId: string;
  touchId: string;
  effect: string;
  place: { kind: string; value: string; label?: string };
  sentence?: string;
  createdAt?: string;
  createdBy?: "confirm" | "always_allow";
  approvalId?: string;
  confirmationHash?: string;
};
export type RuleRow = RuleInput & {
  id: string;
  state: "active" | "revoked";
  createdAt: string;
  createdBy: "confirm" | "always_allow";
  sentence: string;
  uses: number;
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;
};
export type CallGrant = {
  runId: string;
  stepId: string;
  itemKey: string;
  tool: string;
  digest: string;
  kind: "approve" | "edit" | "similar" | "pick" | "migrated";
  createdAt: string;
  approvalId?: string;
  usedAt?: string;
};
export type WaitingQuestion = {
  id: string;
  flowId: string;
  chatId: string;
  messageId: string;
  kind: "inputs" | "confirm";
  state: "open" | "answered" | "cancelled" | "closed";
  createdAt: string;
  updatedAt: string;
  source: StartSource;
  proactive: boolean;
  flowHash: string;
  given: Record<string, Value>;
  missing: string[];
  pendingStart: { startId: string; source: StartSource; request: Record<string, Value> };
  answeredAt?: string;
  runId?: string;
  closedReason?: "flow_deleted" | "chat_deleted";
};
export type RememberedAnswer = {
  flowId: string;
  inputId: string;
  kind: "remember" | "last";
  value: TypedValue;
  outside: boolean;
  savedAt: string;
  runId: string;
};
export type ChatRow = {
  id: string;
  title: string;
  titleSource: "default" | "first_message" | "flowdriven";
  createdAt: string;
  updatedAt: string;
  from: "person" | "flowdriven";
  language: string;
  languageSource: "app" | "typed";
  agent: string;
  model: string;
  agentSource: "main_default" | "person" | "model_gone";
  composerText?: string;
  subject?: Value;
};
export type MessageRow = {
  id: string;
  chatId: string;
  seq: number;
  at: string;
  role: "person" | "agent" | "flowdriven";
  kind: "text" | "reply" | "line" | "note" | "result" | "card";
  outside: boolean;
  text?: string;
  line?: Line;
  card?: {
    type: string;
    state: "open" | "answered" | "replaced" | "cancelled";
    answer?: { action: string; at: string };
  };
  result?: Value;
  chips?: Value[];
  language?: string;
  fromChip?: boolean;
  pasted?: boolean;
  byButton?: boolean;
  turn?: Value;
};
export type DraftRow = {
  id: string;
  chatId: string;
  messageId: string;
  kind: "new_flow" | "change";
  state: "drafted" | "replaced" | "saved" | "cancelled";
  createdAt: string;
  updatedAt: string;
  files: Record<string, string>;
  hash: string;
  name: string;
  nameAdjusted: boolean;
  lists: { onItsOwn: string[]; asksFirst: string[]; never: string[] };
  schedule?: {
    type: "daily" | "weekdays" | "weekly" | "after";
    time?: string;
    day?: string;
    afterFlowId?: string;
    whenItsTime: "ask" | "last";
  };
  outside: boolean;
  assumptions: string[];
  flowId?: string;
  baseHash?: string;
  saved?: { flowId: string; hash: string; at: string };
};
export type ScheduleRow = {
  flowId: string;
  type: "daily" | "weekdays" | "weekly" | "after";
  time?: string;
  day?: string;
  afterFlowId?: string;
  whenItsTime: "ask" | "last";
  setAt: string;
  setBy: "window" | "chat_card" | "save_flow";
  confirmedHash: string;
  cursorAt?: string;
  pausedAt?: string;
  pausedWhy?: "blocked_runs" | "challenge";
};
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
  pausedWhy?: "blocked_runs" | "challenge";
  lastFire?: { at: string; outcome: TriggerOutcome; runId?: string; detail?: string };
};
export type ConsentPins = {
  skills: Record<string, string>;
  folders: Record<string, { path: string; access: "read" | "read_write" }>;
};
export type CapabilityConsentRow = { flowId: string; hash: string; at: string; pins?: ConsentPins };
export type FlowHead = {
  id: string;
  name: string;
  summary: string;
  headHash: string;
  createdAt: string;
  updatedAt: string;
  origin:
    | { kind: "demo" | "import" }
    | { kind: "chat"; chatId: string; draftId: string }
    | { kind: "skill"; chatId: string; draftId: string; skillId: string }
    | { kind: "market"; listingId: string };
  deletedAt?: string;
};
export type Confirmation = {
  flowId: string;
  hash: string;
  at: string;
  by: "save_flow" | "save_change" | "confirm_dialog" | "chat_card" | "migration";
  onItsOwn: string[];
  pins: ConsentPins;
  legacy?: true;
  chatId?: string;
  draftId?: string;
};
export type RetentionRow = {
  table: "runs" | "starts" | "standing_rules" | "waiting_questions" | "seen" | "fire_keys" | "flows";
  rowid: number;
};
export interface Store {
  retentionCandidates(before90: string, before30: string): RetentionRow[];
  deleteRetentionRows(rows: RetentionRow[]): void;
  claimStart(row: StartRow): { created: boolean; row: StartRow };
  listStarts(): StartRow[];
  makeRule(input: RuleInput): RuleRow;
  listRules(): RuleRow[];
  revokeRule(id: string, by: string): void;
  putCallGrant(row: CallGrant): void;
  findGrant(key: CallGrant): CallGrant | undefined;
  findPickGrant(key: CallGrant): CallGrant | undefined;
  useGrant(key: CallGrant, at: string): void;
  skippedRows(): { approvals?: number; waiting_questions?: number };
  listQuestions(): WaitingQuestion[];
  putQuestion(row: WaitingQuestion): void;
  putRemembered(row: RememberedAnswer): void;
  listRemembered(flowId: string): RememberedAnswer[];
  deleteRemembered(flowId: string, kind: RememberedAnswer["kind"], inputId: string): void;
  deleteFlowData(flowId: string): void;
  getFlowHead(id: string): FlowHead | undefined;
  listFlowHeads(): FlowHead[];
  putFlowHead(row: FlowHead): void;
  hasFlowId(id: string): boolean;
  deleteChat(id: string): void;
  putChat(row: ChatRow): void;
  getChat(id: string): ChatRow | undefined;
  listChats(): ChatRow[];
  setComposer(chatId: string, text: string): void;
  putMessage(row: MessageRow): void;
  getMessage(id: string): MessageRow | undefined;
  listMessages(chatId: string): MessageRow[];
  putDraft(row: DraftRow): void;
  getDraft(id: string): DraftRow | undefined;
  listDrafts(chatId: string): DraftRow[];
  putSchedule(row: ScheduleRow): void;
  getSchedule(flowId: string): ScheduleRow | undefined;
  listSchedules(): ScheduleRow[];
  deleteSchedule(flowId: string): void;
  saveFlow(draftId: string): { flowId: string; hash: string; at: string };
  getConfirmation(id: string): Confirmation | undefined;
  putConfirmation(row: Confirmation): void;
  confirmFlow(input: { confirmation: Confirmation; rules: RuleInput[] }): void;
  schemaVersion(): number;
  getCapabilityConsent(flowId: string): CapabilityConsentRow | undefined;
  putCapabilityConsent(row: CapabilityConsentRow): void;
  deleteCapabilityConsent(flowId: string): void;
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
  addVersion(
    id: string,
    files: Record<string, string>,
    options: { savedBy: NonNullable<FlowRow["savedBy"]> },
  ): FlowRow;
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
  listAuditRecords(filter: { runId?: string; afterId?: number; limit?: number }): AuditRecord[];
  close(): void;
}
