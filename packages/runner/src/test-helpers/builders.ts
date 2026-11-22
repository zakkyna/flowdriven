import { demoFlow } from "../demo/demo-flow.ts";
import type { ApprovalRow, Store } from "../storage.ts";

export function pendingDecision(store: Store, options: { id: string; createdAt: string }): ApprovalRow {
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
  const row: ApprovalRow = {
    id: options.id,
    kind: "result_sign_off",
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
