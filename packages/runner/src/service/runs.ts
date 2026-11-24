import { type OperationInput, RunnerError } from "@flowdriven/contracts";
import type { Engine } from "../engine.ts";
import { reportLines } from "../report.ts";
import type { RunRow, Store } from "../storage.ts";
import { currentStep, runTrigger, toRunDetail, toRunSummary } from "./map-run.ts";

export function createRunHandlers(store: Store, engine: Engine, harnessIdOf: (name: string) => string) {
  const flowNameOf = (id: string) => {
    const manifest = store.getFlow(id)?.manifest;
    return manifest && typeof manifest === "object" && "name" in manifest && typeof manifest.name === "string"
      ? manifest.name
      : undefined;
  };
  const run = (id: string) => {
    const row = store.getRun(id);
    if (!row) throw new RunnerError("not_found", `There is no run ${id}.`);
    return row;
  };
  const headHash = (row: RunRow) =>
    store.getFlowHead(row.flowId)?.headHash ?? store.getFlow(row.flowId)?.hash;
  return {
    list: (input: OperationInput<"runs.list">) =>
      store
        .listRuns({ flowId: input.flowId, state: input.state })
        .filter(
          (row) =>
            (!input.source || row.start?.source === input.source) &&
            (!input.before || (row.endedAt ?? row.startedAt) < input.before),
        )
        .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))
        .slice(0, input.limit ?? 50)
        .map((row) => {
          let first: string | undefined;
          let current: ReturnType<typeof currentStep>;
          try {
            const view = engine.getRun(row.id);
            current = currentStep(view);
            first = reportLines(view)[0];
          } catch {}
          return toRunSummary(
            row,
            row.flowName ?? flowNameOf(row.flowId) ?? row.flowId,
            first,
            engine.waitingOf(row.id).run,
            runTrigger(row, flowNameOf),
            headHash(row),
            current,
          );
        }),
    stop: ({ runId }: OperationInput<"runs.stop">) => {
      const row = run(runId);
      const result = [
        "queued",
        "checking",
        "running",
        "retrying",
        "waiting_approval",
        "needs_login",
      ].includes(row.state)
        ? engine.stopRun(runId, "person")
        : { run: row, changed: false };
      return {
        changed: result.changed,
        run: toRunSummary(
          result.run,
          result.run.flowName ?? flowNameOf(result.run.flowId) ?? result.run.flowId,
          undefined,
          engine.waitingOf(runId).run,
          runTrigger(result.run, flowNameOf),
          headHash(result.run),
        ),
      };
    },
    status: ({ runId }: OperationInput<"runs.status">) => {
      const row = run(runId);
      const head = store.getFlowHead(row.flowId);
      return toRunDetail(
        engine.getRun(runId),
        harnessIdOf,
        flowNameOf,
        head ? !head.deletedAt : !!store.getFlow(row.flowId),
        headHash(row),
      );
    },
    report: ({ runId }: OperationInput<"runs.report">) => {
      const row = run(runId);
      return {
        runId,
        lines: reportLines(engine.getRun(runId)),
        decisionLines: row.decisionLines ?? [],
        result: { kind: row.result?.kind ?? ("report" as const) },
      };
    },
  };
}
