import { FlowManifest, type Touch } from "@flowdriven/sdk";
import { callGrant, digestCall } from "../connectors/grants.ts";
import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, RuleInput, RuleRow, Store } from "../storage.ts";

export function pendingDecision(
  store: Store,
  options: {
    id: string;
    createdAt: string;
    kind?: ApprovalRow["kind"];
    effect?: ApprovalRow["effect"];
  },
): ApprovalRow {
  const { manifest, files } = demoFlow();
  const flowId = `local.flow-${options.id}`;
  const runId = `run-${options.id}`;
  const hash = `sha256:${"a".repeat(64)}`;
  store.putFlow({
    id: flowId,
    hash,
    version: manifest.version,
    manifest: { ...manifest, id: flowId },
    files,
    registeredAt: options.createdAt,
  });
  store.createRun({
    id: runId,
    flowId,
    flowHash: hash,
    flowVersion: manifest.version,
    state: "waiting_approval",
    project: ".",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: options.createdAt,
  });
  store.upsertStep({
    runId,
    stepId: "alerts",
    itemKey: "",
    state: "waiting_approval",
    attempts: [],
    outputs: {},
    checks: [],
  });
  const kind = options.kind ?? "result_sign_off";
  const effect =
    options.effect ?? (kind === "outside_flow" || kind === "risky_action" ? "change" : undefined);
  const riskyAction =
    effect === "send" || effect === "post" || effect === "pay" || effect === "delete" || effect === "merge"
      ? effect
      : undefined;
  const row: ApprovalRow = {
    id: options.id,
    kind,
    ...(effect ? { effect } : {}),
    ...(riskyAction ? { riskyAction } : {}),
    runId,
    stepId: "alerts",
    itemKey: "",
    summary: "Review",
    payload: "Review",
    approves: [],
    onExpiry: "end",
    createdAt: options.createdAt,
    expiresAt: new Date(Date.parse(options.createdAt) + 86_400_000).toISOString(),
    state: "pending",
  };
  store.createApproval(row);
  return row;
}

export function approvedDecision(store: Store, options: { id: string; createdAt: string }): ApprovalRow {
  const pending = pendingDecision(store, options);
  const chatId = `chat-${options.id}`;
  store.putChat({
    id: chatId,
    title: "Timesheet",
    titleSource: "flowdriven",
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  store.updateRun(pending.runId, { start: { source: "chat", chatId } });
  const tool = "log_entry";
  const input = { duration_h: 2 };
  const digest = digestCall(tool, input);
  const row: ApprovalRow = {
    ...pending,
    kind: "risky_action",
    effect: "change",
    state: "approved",
    resolvedAt: options.createdAt,
    resolvedVia: "window",
    chatId,
    call: { tool, input },
    approves: [callGrant("timesheet", tool, digest)],
  };
  store.updateApproval(row.id, row);
  const card = { type: "decision", state: "open" as const, approvalId: row.id };
  store.putMessage({
    id: `message-${options.id}`,
    chatId,
    seq: 1,
    at: options.createdAt,
    role: "flowdriven",
    kind: "card",
    outside: false,
    card,
  });
  store.putCallGrant({
    runId: row.runId,
    stepId: row.stepId,
    itemKey: row.itemKey,
    tool: `timesheet.${tool}`,
    digest,
    kind: "approve",
    createdAt: options.createdAt,
    approvalId: row.id,
  });
  return row;
}

export function standingRule(store: Store, input: Partial<RuleInput> = {}): RuleRow {
  return store.makeRule({
    flowId: "example.fill-timesheet",
    touchId: "log-hours",
    effect: "change",
    place: { kind: "account", value: "timesheet-account", label: "Timesheet" },
    sentence: "Log hours",
    ...input,
  });
}

export function flowWithRules(store: Store, touches: Touch[], extra: Record<string, unknown> = {}) {
  const at = "2026-11-23T00:00:00.000Z";
  const hash = `sha256:${"a".repeat(64)}`;
  const base = demoFlow();
  const manifest = FlowManifest.parse({ ...base.manifest, format: "flowdriven-flow/1.2", touches, ...extra });
  store.putFlow({
    id: manifest.id,
    hash,
    version: manifest.version,
    manifest,
    files: base.files,
    registeredAt: at,
  });
  store.putFlowHead({
    id: manifest.id,
    name: manifest.name,
    summary: manifest.summary,
    headHash: hash,
    createdAt: at,
    updatedAt: at,
    origin: { kind: "chat", chatId: "chat-1", draftId: "draft-1" },
  });
  return { manifest, hash };
}
