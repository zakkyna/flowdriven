import { Approval, Payload } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { canAlwaysAllow } from "../rules/always-allow.ts";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";
import { toApproval } from "./map-approval.ts";

export function toDecision(row: ApprovalRow, run: RunRow, store: Store): Approval {
  const flow = store.getFlow(run.flowId, run.flowHash);
  if (!flow) throw new Error("Flow not found");
  const structured = Payload.safeParse(row.payload);
  const source = {
    ...row,
    ...(structured.success && structured.data.kind !== "choice" ? { payload: "" } : {}),
    ...(row.kind === "risky_action" && !row.riskyAction ? { riskyAction: "send" as const } : {}),
  };
  const { expiresAt: _expiresAt, ...legacy } = toApproval(source, run, FlowManifest.parse(flow.manifest));
  return Approval.parse({
    ...legacy,
    ...(structured.success ? { payload: structured.data } : {}),
    riskyAction: row.riskyAction,
    effect: row.effect ?? row.riskyAction,
    place: row.place,
    fixedPlace: row.fixedPlace,
    chatId: row.chatId,
    similarGroup: row.similarGroup,
    resolvedVia: row.resolvedVia,
    editedSubject: row.editedSubject,
    editedText: row.editedText,
    ruleId: row.ruleId,
    canAlwaysAllow:
      row.kind === "risky_action" &&
      row.state === "pending" &&
      !!row.place &&
      ["account", "folder"].includes(row.place.kind) &&
      canAlwaysAllow({
        effect: row.effect ?? row.riskyAction,
        place: row.outside ? "outside" : row.fixedPlace ? "fixed" : "none",
        caller: "window",
      }),
    ...(row.similarGroup
      ? {
          similarWaiting: store
            .listApprovals({ runId: row.runId, state: "pending" })
            .filter((item) => item.id !== row.id && item.similarGroup === row.similarGroup).length,
        }
      : {}),
    stepWaiting: store
      .listApprovals({ runId: row.runId, state: "pending" })
      .filter((item) => item.stepId === row.stepId && item.id !== row.id).length,
  });
}
