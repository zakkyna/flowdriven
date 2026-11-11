import type { QueueRow, QueueView } from "@flowdriven/contracts";
import type { KeeperSnapshot } from "../keeper/types.ts";

export function toQueueView(o: {
  snapshot: KeeperSnapshot | undefined;
  ceiling: number;
  flowName: (runId: string) => string;
  stepTitle: (runId: string, stepId: string) => string | undefined;
  overlap: { runId: string; startedAt: string }[];
  nowMs: number;
}): QueueView {
  const rows: QueueRow[] = (o.snapshot?.rows ?? []).map(({ ticket, state, waiting, queuedMs }) => ({
    runId: ticket.runId,
    flowName: o.flowName(ticket.runId),
    stepId: ticket.stepId,
    stepTitle: o.stepTitle(ticket.runId, ticket.stepId),
    itemKey: ticket.itemKey,
    class: ticket.cls === 2 ? "triggered" : "owner",
    harnessId: ticket.harnessId,
    state,
    waiting,
    queuedSeconds: queuedMs / 1000,
  }));
  for (const run of o.overlap)
    rows.push({
      runId: run.runId,
      flowName: o.flowName(run.runId),
      class: "owner",
      state: "waiting",
      waiting: { reason: "flow_overlap" },
      queuedSeconds: Math.max(0, (o.nowMs - Date.parse(run.startedAt)) / 1000),
    });
  return {
    running: rows.filter((r) => r.state === "running").length,
    waiting: rows.filter((r) => r.state === "waiting").length,
    ceiling: o.ceiling,
    rows,
  };
}
