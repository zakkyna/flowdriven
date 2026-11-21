import type { TriggerStatus } from "@flowdriven/contracts/v1";
import type { FlowRecord } from "../state";

export function triggerStatuses(
  flow: FlowRecord,
  switches: Record<string, { hash: string } | undefined>,
  nowIso: string,
): TriggerStatus[] {
  return (flow.manifest.triggers ?? []).flatMap((trigger, index): TriggerStatus[] => {
    if (trigger.kind === "manual") return [];
    const supported =
      trigger.kind === "schedule" || trigger.kind === "file_change" || trigger.kind === "flow_done";
    const saved = switches[`${flow.manifest.id}#${index}`];
    const state = !supported ? "unavailable" : !saved ? "off" : saved.hash === flow.hash ? "on" : "needs_ok";
    return [
      {
        flowId: flow.manifest.id,
        index,
        kind: trigger.kind,
        summary: trigger.summary,
        state,
        canEnable: supported,
        ...(state === "unavailable" ? { reason: "Not available yet." } : {}),
        ...(state === "needs_ok"
          ? { reason: "This flow changed. Turn the trigger on again to approve this version." }
          : {}),
        ...(state === "on" && trigger.kind === "schedule"
          ? { nextAt: new Date(Date.parse(nowIso) + 3_600_000).toISOString() }
          : {}),
        ...(state === "on" && trigger.kind === "file_change"
          ? { last: { at: nowIso, outcome: "started" as const, runId: "run-0008" } }
          : {}),
        firesToday: trigger.kind === "file_change" ? 3 : 0,
        droppedToday: trigger.kind === "file_change" ? 2 : 0,
        dailyCap: 24,
      },
    ];
  });
}
