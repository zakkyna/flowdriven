import type { ActivitySummary, OperationInput } from "@flowdriven/contracts";
import type { Engine } from "../engine.ts";
import { isActive } from "../states.ts";
import type { Store } from "../storage.ts";
import { toDecision } from "./map-decision.ts";
import { runTrigger, toRunSummary } from "./map-run.ts";

export function createActivityHandler(store: Store, engine: Engine) {
  const flowName = (id: string) => {
    const manifest = store.getFlow(id)?.manifest;
    return manifest &&
      typeof manifest === "object" &&
      !Array.isArray(manifest) &&
      "name" in manifest &&
      typeof manifest.name === "string"
      ? manifest.name
      : undefined;
  };
  const summary = (row: import("../storage.ts").RunRow) =>
    toRunSummary(
      row,
      row.flowName ?? flowName(row.flowId) ?? row.flowId,
      undefined,
      engine.waitingOf(row.id).run,
      runTrigger(row, flowName),
      store.getFlowHead(row.flowId)?.headHash ?? store.getFlow(row.flowId)?.hash,
    );
  return (input: OperationInput<"activity.summary">): ActivitySummary => {
    const questions: ActivitySummary["needsYou"] = store
      .listQuestions()
      .filter((row) => row.state === "open" && row.proactive)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((row) => ({
        kind: "question",
        questionId: row.id,
        questionKind: row.kind,
        flowId: row.flowId,
        flowName: store.getFlowHead(row.flowId)?.name ?? flowName(row.flowId) ?? row.flowId,
        chatId: row.chatId,
        askedAt: row.createdAt,
      }));
    const decisions: ActivitySummary["needsYou"] = store
      .listApprovals({ state: "pending" })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((row) => {
        try {
          const run = store.getRun(row.runId);
          if (!run) throw new Error("Run not found");
          return [{ kind: "decision" as const, decision: toDecision(row, run, store) }];
        } catch {
          store.appendAudit({
            at: new Date().toISOString(),
            kind: "internal_error",
            detail: { method: "activity.summary" },
          });
          return [];
        }
      });
    const needsYou = [...questions, ...decisions];
    const rows = store.listRuns();
    const running = rows.filter((row) => isActive(row.state)).map(summary);
    const earlier = rows
      .filter(
        (row) =>
          !isActive(row.state) &&
          (!input.before || (row.endedAt ?? row.startedAt) < input.before) &&
          (input.filter !== "finished" || row.state === "done") &&
          (input.filter !== "problems" ||
            ["failed", "blocked", "interrupted", "needs_login"].includes(row.state)),
      )
      .sort(
        (a, b) =>
          (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt) || a.id.localeCompare(b.id),
      );
    const selected = earlier.slice(0, input.limit ?? 50);
    const mapped = selected.map((row) => ({ kind: "run" as const, run: summary(row) }));
    return {
      needsYou,
      needsYouCount: needsYou.length,
      running,
      earlier: mapped,
      ...(earlier.length > selected.length && selected.length
        ? { nextBefore: selected[selected.length - 1]?.endedAt ?? selected[selected.length - 1]?.startedAt }
        : {}),
    };
  };
}
