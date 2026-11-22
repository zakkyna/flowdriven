import { Approval, Payload } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { canAlwaysAllow } from "../rules/always-allow.ts";
import type { ApprovalRow, RunRow, Store } from "../storage.ts";

export function toDecision(row: ApprovalRow, run: RunRow, store: Store): Approval {
  const flow = store.getFlow(run.flowId, run.flowHash);
  if (!flow) throw new Error("Flow not found");
  const manifest = FlowManifest.parse(flow.manifest);
  const step = manifest.steps.flatMap((s) => ("do" in s ? [s] : s.steps)).find((s) => s.id === row.stepId);
  if (!step) throw new Error("Approval step not found");
  let payload: Payload;
  if (row.kind === "ask") {
    if (
      !row.payload ||
      typeof row.payload !== "object" ||
      Array.isArray(row.payload) ||
      !Array.isArray(row.payload.options)
    )
      throw new Error("Invalid choice payload");
    payload = Payload.parse({
      kind: "choice",
      question: row.payload.question,
      options: row.payload.options.map((option) => {
        if (!option || typeof option !== "object" || Array.isArray(option))
          throw new Error("Invalid choice option");
        return { key: option.key, label: option.label };
      }),
      maxPick: row.payload.maxPick,
      approves: row.approves,
    });
  } else {
    const structured = Payload.safeParse(row.payload);
    payload = structured.success ? structured.data : Payload.parse({ kind: "text", text: row.payload });
  }
  return Approval.parse({
    id: row.id,
    kind: row.kind,
    state: row.state,
    flowId: run.flowId,
    flowName: manifest.name,
    runId: row.runId,
    stepId: row.stepId,
    stepTitle: step.title ?? step.id,
    itemKey: row.itemKey || undefined,
    summary: row.summary,
    payload,
    editable: row.kind === "risky_action" && (payload.kind === "email" || payload.kind === "text"),
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    picks: row.picks,
    ...(row.outside === true ? { outside: true } : {}),
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
