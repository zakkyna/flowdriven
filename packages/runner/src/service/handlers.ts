import { isAbsolute } from "node:path";
import {
  CONTRACT_VERSION,
  type HarnessCard,
  KeeperSettings,
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
import type { HarnessQuota, Keeper } from "../keeper/types.ts";
import { renderRunReport, reportLines } from "../report.ts";
import { needsAllow } from "../router/route.ts";
import type { ApprovalRow, FlowRow, RunRow, Store } from "../storage.ts";
import type { TriggerService } from "../triggers/service.ts";
import type { createCapabilities } from "./capabilities.ts";
import type { HarnessService } from "./claude-harness.ts";
import { ALLOW_FIRST } from "./claude-harness.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";
import { toApproval } from "./map-approval.ts";
import { defaultSettings, toFlowDetail, toFlowSummary, toReadinessReport } from "./map-flow.ts";
import { toQueueView } from "./map-queue.ts";
import { runTrigger, toAuditRecord, toRunDetail, toRunSummary } from "./map-run.ts";
import { toTriggerStatus } from "./map-trigger.ts";
import { liveWindow, summarizeUsage } from "./usage-summary.ts";
import type { createWeekly } from "./weekly-limit.ts";

export type HandlerContext = {
  engine: Engine;
  triggers?: TriggerService;
  store: Store;
  mode: "demo" | "live";
  projectDir: string;
  now: () => Date;
  harnessIdOf: (workerName: string) => string;
  harnesses?: Pick<HarnessService, "list" | "rescan" | "setConsent">;
  keeper?: Keeper;
  weekly?: ReturnType<typeof createWeekly>;
  capabilities?: ReturnType<typeof createCapabilities>;
  webCheck?: () => { chromeFlag: boolean; hostFile: boolean };
  connectors?: () => { name: string; url: string; status: string }[];
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
    if (name === "settings.update" && typeof input === "object" && input !== null && "patch" in input) {
      const patch = input.patch;
      if (typeof patch === "object" && patch !== null && !Array.isArray(patch)) {
        if (Object.keys(patch).some((key) => key !== "keeper"))
          throw new RunnerError("unavailable", "Changing settings arrives with the agent.");
        if ("keeper" in patch && typeof patch.keeper === "object" && patch.keeper !== null) {
          const keeper = patch.keeper;
          const extra = (value: object, allowed: string[]) =>
            Object.keys(value).some((key) => !allowed.includes(key));
          if (
            extra(keeper, ["ceiling", "reserveMb", "quotaLines", "effortModels"]) ||
            ("quotaLines" in keeper &&
              typeof keeper.quotaLines === "object" &&
              keeper.quotaLines !== null &&
              extra(keeper.quotaLines, ["fiveHour", "sevenDay"])) ||
            ("effortModels" in keeper &&
              typeof keeper.effortModels === "object" &&
              keeper.effortModels !== null &&
              Object.values(keeper.effortModels).some(
                (model: unknown) =>
                  typeof model === "object" && model !== null && extra(model, ["low", "medium", "high"]),
              ))
          )
            throw new RunnerError("invalid_input", "Invalid keeper settings.");
        }
      }
    }
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
  triggers,
  store,
  mode,
  projectDir,
  now,
  harnessIdOf,
  harnesses,
  keeper,
  weekly,
  capabilities,
  webCheck,
  connectors,
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
  const flowNameOf = (id: string) => {
    const manifest = store.getFlow(id)?.manifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
    const name = "name" in manifest ? manifest.name : undefined;
    return typeof name === "string" ? name : undefined;
  };
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
  function settings() {
    return { ...defaultSettings(now().toISOString()), keeper: readKeeperSettings(store) };
  }
  function quotaOf(id: string): HarnessQuota {
    if (keeper) return keeper.quotaOf(id);
    const value = store.getSetting(`quota:${id}`);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: HarnessQuota = {};
    for (const key of ["fiveHour", "sevenDay"] as const) {
      const w = value[key];
      if (!w || typeof w !== "object" || Array.isArray(w)) continue;
      if (
        typeof w.utilization !== "number" ||
        !Number.isFinite(w.utilization) ||
        w.utilization < 0 ||
        w.utilization > 1
      )
        continue;
      if (
        w.resetsAt !== undefined &&
        (typeof w.resetsAt !== "number" || !Number.isFinite(w.resetsAt) || w.resetsAt < 0)
      )
        continue;
      result[key] = {
        utilization: w.utilization,
        ...(typeof w.resetsAt === "number" ? { resetsAt: w.resetsAt } : {}),
      };
    }
    return result;
  }
  function summary() {
    return summarizeUsage({ store, now: now(), quotaOf, lines: readKeeperSettings(store).quotaLines });
  }
  function withQuota(card: HarnessCard): HarnessCard {
    if (card.id !== "claude-code") return card;
    const quota = quotaOf(card.id);
    const time = now().getTime();
    const five = liveWindow(quota.fiveHour, time);
    const seven = liveWindow(quota.sevenDay, time);
    const usage = summary().harnesses.find((h) => h.harnessId === card.id);
    const refused =
      quota.rejectedUntil !== undefined &&
      quota.rejectedUntil > time &&
      Number.isFinite(new Date(quota.rejectedUntil).getTime());
    if (!usage && !five && !seven && !refused) return card;
    const count = (t: {
      calls: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }) => ({
      calls: t.calls,
      tokens: Math.min(Number.MAX_SAFE_INTEGER, t.input + t.output + t.cacheRead + t.cacheWrite),
    });
    const empty = { calls: 0, tokens: 0 };
    const windows: NonNullable<HarnessCard["quota"]["windows"]> = [];
    if (five) windows.push({ name: "five_hour", ...five });
    if (seven) windows.push({ name: "seven_day", ...seven });
    return {
      ...card,
      quota: {
        ...card.quota,
        state: refused ? "exhausted" : windows.length ? "available" : "unknown",
        until: refused ? new Date(quota.rejectedUntil as number).toISOString() : undefined,
        today: usage ? count(usage.today) : empty,
        week: usage ? count(usage.week) : empty,
        windows,
      },
    };
  }
  function queue() {
    return toQueueView({
      snapshot: keeper?.snapshot(),
      ceiling: readKeeperSettings(store).ceiling,
      flowName: (id) => flowName(run(id)),
      stepTitle: (id, stepId) => {
        const manifest = engine.getRun(id).manifest;
        const find = (steps: typeof manifest.steps): string | undefined => {
          for (const step of steps) {
            if (step.id === stepId) return step.title ?? step.id;
            if ("steps" in step) {
              const title = find(step.steps);
              if (title) return title;
            }
          }
          return undefined;
        };
        return find(manifest.steps);
      },
      overlap: store
        .listRuns({ state: "queued" })
        .filter((r) => engine.waitingOf(r.id).run?.reason === "flow_overlap")
        .map((r) => ({ runId: r.id, startedAt: r.startedAt })),
      nowMs: now().getTime(),
    });
  }
  return {
    "flows.list": () => store.listFlows().map((r) => toFlowSummary(r, store.listRuns({ flowId: r.id }))),
    "flows.capabilities": ({ flowId }) => {
      flow(flowId);
      return capabilities ? capabilities.get(flowId) : unavailable("The preview arrives in this plan.");
    },
    "flows.allowCapabilities": ({ flowId, hash, pins }) => {
      flow(flowId);
      return capabilities
        ? capabilities.allow(flowId, hash, pins)
        : unavailable("The preview arrives in this plan.");
    },
    "flows.withdrawCapabilities": ({ flowId }) => {
      flow(flowId);
      return capabilities ? capabilities.withdraw(flowId) : unavailable("The preview arrives in this plan.");
    },
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
      return toRunSummary(
        begun.run,
        FlowManifest.parse(f.manifest).name,
        undefined,
        undefined,
        runTrigger(begun.run, flowNameOf),
      );
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
          return toRunSummary(r, flowName(r), first, engine.waitingOf(r.id).run, runTrigger(r, flowNameOf));
        }),
    "runs.status": ({ runId }) => {
      run(runId);
      return toRunDetail(engine.getRun(runId), harnessIdOf, flowNameOf);
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
      return toRunSummary(
        begun.run,
        flowName(begun.run),
        undefined,
        undefined,
        runTrigger(begun.run, flowNameOf),
      );
    },
    "readiness.check": ({ flowId }) =>
      toReadinessReport(flow(flowId), now().toISOString(), webCheck?.(), connectors?.()),
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
    "harnesses.list": () => harnesses?.list().map(withQuota) ?? [],
    "harnesses.rescan": () =>
      harnesses
        ? harnesses.rescan().then((cards) => cards.map(withQuota))
        : unavailable("Looking for harnesses arrives with the harness adapters."),
    "harnesses.setConsent": ({ harnessId, consent }) =>
      harnesses
        ? withQuota(harnesses.setConsent(harnessId, consent))
        : unavailable("Harness consent arrives with the harness adapters."),
    "queue.list": queue,
    "queue.move": ({ runId }) => {
      run(runId);
      if (engine.waitingOf(runId).run?.reason === "flow_overlap")
        throw new RunnerError("not_allowed", "This run waits for the earlier run of its flow.");
      if (!keeper?.move(runId)) throw new RunnerError("not_allowed", "This run is not waiting.");
      return queue();
    },
    "usage.summary": summary,
    "settings.get": settings,
    "triggers.list": ({ flowId }) => {
      flow(flowId);
      if (!triggers) return unavailable("Trigger service is unavailable.");
      return triggers.list(flowId).map(toTriggerStatus);
    },
    "triggers.setEnabled": ({ flowId, index, enabled, hash }) => {
      if (enabled && mode === "demo") throw new RunnerError("not_allowed", "Triggers stay off in the demo.");
      if (!triggers) return unavailable("Trigger service is unavailable.");
      if (enabled) {
        const row = flow(flowId);
        const manifest = FlowManifest.parse(row.manifest);
        if (needsAllow(manifest) && capabilities?.consentOf(flowId) !== "given") {
          // Without the allow the call is always refused. A trigger that cannot be enabled anyway says its own reason.
          const own = triggers.list(flowId).find((entry) => entry.index === index);
          throw new RunnerError(
            "not_allowed",
            own && !own.canEnable && own.reason ? own.reason : ALLOW_FIRST,
          );
        }
      }
      return toTriggerStatus(triggers.setEnabled(flowId, index, enabled, hash));
    },
    "settings.update": ({ patch }) => {
      if (!patch.keeper || Object.keys(patch).some((key) => key !== "keeper"))
        return unavailable("Changing settings arrives with the agent.");
      const current = readKeeperSettings(store);
      const keeper = KeeperSettings.parse({
        ...current,
        ...patch.keeper,
        quotaLines: { ...current.quotaLines, ...patch.keeper.quotaLines },
        effortModels: { ...current.effortModels, ...patch.keeper.effortModels },
      });
      store.putSetting("keeper", keeper);
      return settings();
    },
  };
}
