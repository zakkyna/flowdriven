import { type OperationInput, RunnerError } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import type { Engine } from "../engine.ts";
import type { Store } from "../storage.ts";

export function createFlowDeleteHandler(store: Store, engine: Engine, now: () => Date) {
  return ({ flowId }: OperationInput<"flows.delete">) => {
    const row = store.getFlow(flowId);
    const head = store.getFlowHead(flowId);
    if (!row || head?.deletedAt)
      throw new RunnerError("not_found", "Flow not found.", {
        reason: head?.deletedAt ? "flow_deleted" : undefined,
      });
    const runs = store.listRuns({ flowId });
    if (runs.some((run) => ["checking", "running", "retrying", "waiting_approval"].includes(run.state)))
      throw new RunnerError("conflict", "This flow is running. Stop it first.", { reason: "flow_running" });
    const at = now().toISOString();
    return store.transaction(() => {
      const manifest = FlowManifest.parse(row.manifest);
      store.putFlowHead({
        ...(head ?? {
          id: flowId,
          name: manifest.name,
          summary: manifest.summary,
          headHash: row.hash,
          createdAt: row.registeredAt,
          updatedAt: row.registeredAt,
          origin: { kind: "import" as const },
        }),
        deletedAt: at,
      });
      store.deleteConfirmation(flowId);
      store.deleteFlowData(flowId);
      store.deleteSchedule(flowId);
      for (const rule of store
        .listRules()
        .filter((item) => item.flowId === flowId && item.state === "active")) {
        store.revokeRule(rule.id, "flow_deleted");
        store.appendAudit({
          at,
          kind: "rule_revoked",
          detail: {
            ruleId: rule.id,
            flowId,
            touchId: rule.touchId,
            effect: rule.effect,
            placeKind: rule.place.kind,
            by: "flow_deleted",
          },
        });
      }
      const schedulesTurnedOff: string[] = [];
      for (const schedule of store.listSchedules().filter((item) => item.afterFlowId === flowId)) {
        store.deleteSchedule(schedule.flowId);
        schedulesTurnedOff.push(schedule.flowId);
        store.appendAudit({
          at,
          kind: "schedule_changed",
          detail: { flowId: schedule.flowId, from: `after ${flowId}`, to: "manual", by: "target_deleted" },
        });
      }
      for (const question of store
        .listQuestions()
        .filter((item) => item.flowId === flowId && item.state === "open"))
        store.putQuestion({ ...question, state: "closed", closedReason: "flow_deleted", updatedAt: at });
      for (const run of runs.filter((item) =>
        ["queued", "needs_login", "blocked", "interrupted"].includes(item.state),
      ))
        engine.stopRun(run.id, "flow_deleted");
      store.appendAudit({ at, kind: "flow_deleted", detail: { flowId, hash: row.hash, schedulesTurnedOff } });
      return { deleted: true as const, schedulesTurnedOff };
    });
  };
}
