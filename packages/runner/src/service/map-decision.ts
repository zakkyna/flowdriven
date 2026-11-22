import { Approval } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";
import { toApproval } from "./map-approval.ts";

export function toDecision(row: ApprovalRow, run: RunRow, store: Store): Approval {
  const flow = store.getFlow(run.flowId, run.flowHash);
  if (!flow) throw new Error("Flow not found");
  const { expiresAt: _expiresAt, ...legacy } = toApproval(row, run, FlowManifest.parse(flow.manifest));
  return Approval.parse({
    ...legacy,
    effect: row.effect ?? row.riskyAction,
    place: row.place,
    fixedPlace: row.fixedPlace,
    chatId: row.chatId,
    similarGroup: row.similarGroup,
    resolvedVia: row.resolvedVia,
    editedSubject: row.editedSubject,
    editedText: row.editedText,
    ruleId: row.ruleId,
    canAlwaysAllow: false,
    stepWaiting: store
      .listApprovals({ runId: row.runId, state: "pending" })
      .filter((item) => item.stepId === row.stepId).length,
  });
}
