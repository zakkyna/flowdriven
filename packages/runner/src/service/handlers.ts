import { isAbsolute } from "node:path";
import {
  CONTRACT_VERSION,
  type OperationInput,
  type OperationName,
  type OperationOutput,
  operations,
  RUNNER_ERROR_CODES,
  RunnerError,
  type RunnerErrorCode,
} from "@flowdriven/contracts";
import { FlowManifest, hasErrors, type Value } from "@flowdriven/sdk";
import { FlowFileError, loadFlowFolder } from "@flowdriven/sdk/node";
import type { Engine } from "../engine.ts";
import { renderRunReport, reportLines } from "../report.ts";
import type { ApprovalRow, FlowRow, RunRow, Store } from "../storage.ts";
import type { HarnessService } from "./claude-harness.ts";
import { toApproval } from "./map-approval.ts";
import { defaultSettings, toFlowDetail, toFlowSummary, toReadinessReport } from "./map-flow.ts";
import { toAuditRecord, toRunDetail, toRunSummary } from "./map-run.ts";
import type { createWeekly } from "./weekly-limit.ts";

export type HandlerContext = {
  engine: Engine;
  store: Store;
  mode: "demo" | "live";
  projectDir: string;
  now: () => Date;
  harnessIdOf: (workerName: string) => string;
  harnesses?: Pick<HarnessService, "list" | "rescan" | "setConsent">;
  weekly?: ReturnType<typeof createWeekly>;
};
export type Handlers = {
  [N in OperationName]: (input: OperationInput<N>) => OperationOutput<N> | Promise<OperationOutput<N>>;
};
export function createDispatcher(
  handlers: Handlers,
  audit: (kind: string, detail: Value) => void,
): (name: string, input: unknown) => Promise<unknown> {
  return async (name, input) => {
    if (!Object.hasOwn(operations, name))
      throw new RunnerError("not_found", `There is no operation ${name}.`);
    const key = name as OperationName;
    const parsed = operations[key].input.safeParse(input);
    if (!parsed.success)
      throw new RunnerError("invalid_input", parsed.error.issues.at(0)?.message ?? "Invalid input.");
    try {
      const handler = handlers[key] as (input: unknown) => unknown;
      return operations[key].output.parse(await handler(parsed.data));
    } catch (error) {
      if (error instanceof Error && "code" in error && RUNNER_ERROR_CODES.some((code) => code === error.code))
        throw new RunnerError(error.code as RunnerErrorCode, error.message);
      try {
        audit("internal_error", {
          method: name,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {}
      throw new RunnerError("unavailable", "Internal error");
    }
  };
}
export function createHandlers({
  engine,
  store,
  mode,
  projectDir,
  now,
  harnessIdOf,
  harnesses,
  weekly,
}: HandlerContext): Handlers {
  function flow(id: string): FlowRow {
    const row = store.getFlow(id);
    if (!row) throw new RunnerError("not_found", `There is no flow ${id}.`);
    return row;
  }
  function run(id: string): RunRow {
    const row = store.getRun(id);
    if (!row) throw new RunnerError("not_found", `There is no run ${id}.`);
    return row;
  }
  function flowName(row: RunRow): string {
    const f = store.getFlow(row.flowId, row.flowHash);
    if (!f) throw new Error("Flow not found.");
    return FlowManifest.parse(f.manifest).name;
  }
  function detail(row: FlowRow) {
    const runs = store.listRuns({ flowId: row.id });
    const last = runs.reduce<RunRow | undefined>(
      (a, b) => (!a || b.startedAt >= a.startedAt ? b : a),
      undefined,
    );
    return toFlowDetail(row, runs, last ? store.listSteps(last.id) : []);
  }
  function approval(row: ApprovalRow) {
    const r = run(row.runId);
    const f = store.getFlow(r.flowId, r.flowHash);
    if (!f) throw new Error("Flow not found.");
    return toApproval(row, r, FlowManifest.parse(f.manifest));
  }
  function approvalById(id: string) {
    const row = store.getApproval(id);
    if (!row) throw new RunnerError("not_found", `There is no approval ${id}.`);
    return row;
  }
  function unavailable(message: string): never {
    throw new RunnerError("unavailable", message);
  }
  return {
    "flows.list": () => store.listFlows().map((r) => toFlowSummary(r, store.listRuns({ flowId: r.id }))),
    "flows.get": ({ flowId }) => detail(flow(flowId)),
    "flows.build": () => unavailable("Building a flow from chat arrives with the agent."),
    "flows.update": () => unavailable("Editing a flow in the app arrives with the agent."),
    "flows.run": (input) => {
      if ("description" in input) return unavailable("One-time flows arrive with the agent.");
      const f = flow(input.flowId);
      const begun = engine.beginStart(input.flowId, {
        project: projectDir,
        inputs: input.inputs,
        params: input.params,
      });
      return toRunSummary(begun.run, FlowManifest.parse(f.manifest).name);
    },
    "runs.list": ({ flowId, project, state }) =>
      store
        .listRuns({ flowId, state })
        .filter((r) => project === undefined || r.project === project)
        .reverse()
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map((r) => {
          let first: string | undefined;
          try {
            first = reportLines(engine.getRun(r.id)).at(0);
          } catch {}
          return toRunSummary(r, flowName(r), first, engine.waitingOf(r.id).run);
        }),
    "runs.status": ({ runId }) => {
      run(runId);
      return toRunDetail(engine.getRun(runId), harnessIdOf);
    },
    "runs.report": ({ runId }) => {
      run(runId);
      return { runId, lines: reportLines(engine.getRun(runId)), saveOffer: false };
    },
    "runs.export": ({ runId }) => {
      run(runId);
      return { markdown: renderRunReport(engine.getRun(runId)) };
    },
    "runs.resume": ({ runId }) => {
      run(runId);
      const begun = engine.beginResume(runId);
      return toRunSummary(begun.run, flowName(begun.run));
    },
    "readiness.check": ({ flowId }) => toReadinessReport(flow(flowId), now().toISOString()),
    "readiness.install": () => unavailable("Installing a requirement arrives with the readiness engine."),
    "approvals.list": ({ state }) =>
      [
        ...engine.listApprovals({ state }).reverse().map(approval),
        ...(weekly?.list() ?? []).filter((a) => !state || a.state === state),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    "approvals.answer": ({ approvalId, picks }) => {
      engine.beginAnswer(approvalId, { picks });
      return [approval(approvalById(approvalId))];
    },
    "approvals.resolve": ({ approvalId, decision, applyToSimilar }) => {
      if (approvalId.startsWith("weekly-limit:")) {
        if (applyToSimilar) throw new RunnerError("not_allowed", "Nothing here can be approved as a batch.");
        if (decision === "edit") throw new RunnerError("invalid_input", "Only text can be edited.");
        if (!weekly) throw new RunnerError("not_found", `There is no approval ${approvalId}.`);
        return weekly.resolve(approvalId, decision);
      }
      const row = approvalById(approvalId);
      if (applyToSimilar) throw new RunnerError("not_allowed", "Nothing here can be approved as a batch.");
      if (row.kind === "ask")
        throw new RunnerError("invalid_input", "This is a choice. Pick from its options.");
      if (decision === "edit") throw new RunnerError("invalid_input", "Only text can be edited.");
      engine.beginDecide(approvalId, decision);
      return [approval(approvalById(approvalId))];
    },
    "flows.import": ({ path }) => {
      if (!isAbsolute(path))
        throw new RunnerError("invalid_input", "The flow folder must be an absolute path.");
      try {
        const loaded = loadFlowFolder(path);
        if (hasErrors(loaded.issues)) return { issues: loaded.issues };
        const files = Object.fromEntries(
          [...loaded.files].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)]),
        );
        const row = engine.registerFlow(loaded.manifest, loaded.hash, files);
        return { flow: detail(row), issues: loaded.issues, hash: loaded.hash };
      } catch (error) {
        if (error instanceof FlowFileError) throw new RunnerError("invalid_input", error.message);
        if (error instanceof Error && "code" in error && error.code === "ENOENT")
          throw new RunnerError("not_found", "There is no folder at that path.");
        throw error;
      }
    },
    "audit.list": ({ runId }) => {
      if (runId) run(runId);
      return store.listAudit(runId).map(toAuditRecord);
    },
    "runner.info": () => ({ contractVersion: CONTRACT_VERSION, mode }),
    "harnesses.list": () => harnesses?.list() ?? [],
    "harnesses.rescan": () =>
      harnesses
        ? harnesses.rescan()
        : unavailable("Looking for harnesses arrives with the harness adapters."),
    "harnesses.setConsent": ({ harnessId, consent }) =>
      harnesses
        ? harnesses.setConsent(harnessId, consent)
        : unavailable("Harness consent arrives with the harness adapters."),
    "queue.list": () => ({ running: 0, waiting: 0, ceiling: 4, rows: [] }),
    "queue.move": () => unavailable("The queue arrives in this plan's Task 15."),
    "usage.summary": () => ({ harnesses: [] }),
    "settings.get": () => defaultSettings(now().toISOString()),
    "settings.update": () => unavailable("Changing settings arrives with the agent."),
  };
}
