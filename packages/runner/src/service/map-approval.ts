import { Approval, Payload } from "@flowdriven/contracts/v1";
import type { FlowManifest } from "@flowdriven/sdk";
import type { ApprovalRow, RunRow } from "../storage.ts";
export function toApproval(row: ApprovalRow, run: RunRow, manifest: FlowManifest): Approval {
  const step = manifest.steps.flatMap((s) => ("do" in s ? [s] : s.steps)).find((s) => s.id === row.stepId);
  if (!step) throw new Error("Approval step not found");
  let payload: Payload;
  if (row.kind === "ask") {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload))
      throw new Error("Invalid choice payload");
    const { question, options, maxPick } = row.payload;
    if (typeof question !== "string" || !Array.isArray(options) || typeof maxPick !== "number")
      throw new Error("Invalid choice payload");
    payload = Payload.parse({
      kind: "choice",
      question,
      options: options.map((option) => {
        if (
          !option ||
          typeof option !== "object" ||
          Array.isArray(option) ||
          typeof option.key !== "string" ||
          typeof option.label !== "string"
        )
          throw new Error("Invalid choice option");
        return { key: option.key, label: option.label };
      }),
      maxPick,
      approves: row.approves,
    });
  } else {
    if (typeof row.payload !== "string") throw new Error("Invalid sign-off payload");
    payload = { kind: "text", text: row.payload };
  }
  return Approval.parse({
    id: row.id,
    kind: row.kind,
    flowId: run.flowId,
    flowName: manifest.name,
    runId: row.runId,
    stepId: row.stepId,
    stepTitle: step.title ?? step.id,
    itemKey: row.itemKey || undefined,
    summary: row.summary,
    payload,
    editable: false,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    state: row.state,
    resolvedAt: row.resolvedAt,
    picks: row.picks,
    ...(row.kind !== "ask" && row.riskyAction !== undefined ? { riskyAction: row.riskyAction } : {}),
    ...(row.outside === true ? { outside: true } : {}),
  });
}
