import type { SettingsPatch } from "@flowdriven/contracts";
import {
  type ErrorReason,
  operations,
  RUNNER_ERROR_CODES as ROOT_ERROR_CODES,
  RunnerError,
  type RunnerErrorCode,
  StandingRuleView,
  type OperationInput as V2Input,
  type OperationName as V2Name,
  type OperationOutput as V2Output,
} from "@flowdriven/contracts";
import {
  type HarnessCard,
  KeeperSettings,
  operations as legacyOperations,
  type OperationInput,
  type OperationName,
  type OperationOutput,
} from "@flowdriven/contracts/v1";
import { FlowManifest, hasHiddenText, type Value } from "@flowdriven/sdk";
import type { Engine } from "../engine.ts";
import { EngineError } from "../errors.ts";
import type { HarnessQuota, Keeper } from "../keeper/types.ts";
import { renderRunReport } from "../report.ts";
import { needsAllow } from "../router/route.ts";
import { canAlwaysAllow } from "../rules/always-allow.ts";
import { restrictedApprovals } from "../rules/decisions.ts";
import type { ApprovalRow, FlowRow, RunRow, Store } from "../storage.ts";
import type { TriggerService } from "../triggers/service.ts";
import { createActivityHandler } from "./activity.ts";
import type { createCapabilities } from "./capabilities.ts";
import type { HarnessService } from "./claude-harness.ts";
import { ALLOW_FIRST } from "./claude-harness.ts";
import { readKeeperSettings } from "./keeper-wiring.ts";
import { toApproval } from "./map-approval.ts";
import { toDecision } from "./map-decision.ts";
import { type LocalChecks, toReadinessReport } from "./map-flow-v1.ts";
import { toQueueView } from "./map-queue.ts";
import { runTrigger, toRunSummary } from "./map-run-v1.ts";
import { toTriggerStatus } from "./map-trigger.ts";
import { readSettings } from "./settings.ts";
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
  local?: (row: FlowRow) => LocalChecks;
};
export type Handlers = {
  [N in OperationName]: (input: OperationInput<N>) => OperationOutput<N> | Promise<OperationOutput<N>>;
};
export type Caller = "window" | "tool" | "phone";
export type V2Handlers = {
  [N in V2Name]: (input: V2Input<N>, context: { caller: Caller }) => V2Output<N> | Promise<V2Output<N>>;
};
export function createDispatcher({
  v2,
  legacy,
  audit,
}: {
  v2: Partial<Omit<V2Handlers, "approvals.list">> & {
    "approvals.list"?: (input: V2Input<"approvals.list">, context: { caller: Caller }) => unknown;
  };
  legacy: Partial<Handlers> & Partial<Pick<V2Handlers, "activity.summary">>;
  audit: (kind: string, detail: Value) => void;
}): (name: string, input: unknown, caller?: Caller) => Promise<unknown> {
  return async (name, input, caller = "window") => {
    if (!Object.hasOwn(operations, name))
      throw new RunnerError("not_found", `There is no operation ${name}.`);
    const rootKey = name as V2Name;
    if (caller !== "window" && (operations[rootKey].personOnly || "retired" in operations[rootKey])) {
      audit("caller_refused", { operation: name, caller });
      throw new RunnerError("not_allowed", "Caller is not allowed.", { reason: "caller_not_allowed" });
    }
    if (name === "flows.build" || name === "flows.update")
      throw new RunnerError("unavailable", "Operation retired.", { reason: "retired" });
    const v2Handler = (v2[rootKey] ??
      (rootKey === "activity.summary" ? legacy["activity.summary"] : undefined)) as
      | ((input: unknown, context: { caller: Caller }) => unknown)
      | undefined;
    const legacyKey = name as OperationName;
    const legacyHandler = legacy[legacyKey] as ((input: unknown) => unknown) | undefined;
    const handler = v2Handler ?? (legacyHandler ? (input: unknown) => legacyHandler(input) : undefined);
    if (!handler) throw new RunnerError("unavailable", "Operation unavailable.");
    const schema = v2Handler ? operations[rootKey] : legacyOperations[legacyKey];
    const parsed = schema.input.safeParse(input);
    if (
      !parsed.success &&
      name === "approvals.resolve" &&
      input &&
      typeof input === "object" &&
      "decision" in input &&
      input.decision === "edit" &&
      (("editedText" in input && input.editedText === "") ||
        ("editedSubject" in input && input.editedSubject === ""))
    )
      throw new RunnerError("invalid_input", "Write the text first.", { reason: "empty_text" });
    if (
      !parsed.success &&
      caller === "window" &&
      name === "approvals.resolve" &&
      input &&
      typeof input === "object" &&
      "decision" in input &&
      input.decision === "another_way" &&
      "anotherWayText" in input &&
      typeof input.anotherWayText === "string"
    ) {
      if (input.anotherWayText === "")
        throw new RunnerError("invalid_input", "Write the text first.", { reason: "empty_text" });
      if (input.anotherWayText.length > 4000)
        throw new RunnerError("invalid_input", "Keep it under 4,000 characters.", {
          reason: "text_too_long",
        });
      if (hasHiddenText(input.anotherWayText) || /\p{Cf}/u.test(input.anotherWayText))
        throw new RunnerError("invalid_input", "Remove hidden characters.", {
          reason: "hidden_characters",
        });
    }
    if (!parsed.success)
      throw new RunnerError("invalid_input", parsed.error.issues.at(0)?.message ?? "Invalid input.");
    try {
      const result = await handler(parsed.data, { caller });
      if (name === "approvals.list" && caller !== "window" && v2Handler)
        return restrictedApprovals.parse(result);
      return schema.output.parse(result);
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      if (error instanceof Error && "code" in error && ROOT_ERROR_CODES.some((code) => code === error.code))
        throw new RunnerError(error.code as RunnerErrorCode, error.message, {
          reason:
            "reason" in error && typeof error.reason === "string" ? (error.reason as ErrorReason) : undefined,
          ...(error instanceof EngineError ? { params: error.params } : {}),
        });
      try {
        audit("internal_error", {
          method: name,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {}
      throw new RunnerError("unavailable", "Internal error", { reason: "internal_error" });
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
  harnesses,
  keeper,
  weekly,
  capabilities,
  webCheck,
  connectors,
  local,
}: HandlerContext): Omit<
  Handlers,
  | "flows.list"
  | "flows.get"
  | "flows.import"
  | "runner.info"
  | "settings.get"
  | "settings.update"
  | "audit.list"
  | "runs.list"
  | "runs.status"
  | "runs.report"
  | "approvals.answer"
  | "approvals.resolve"
> &
  Pick<V2Handlers, "activity.summary"> {
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
  function approval(row: ApprovalRow) {
    const r = run(row.runId);
    const f = store.getFlow(r.flowId, r.flowHash);
    if (!f) throw new Error("Flow not found.");
    return toApproval(row, r, FlowManifest.parse(f.manifest));
  }
  function unavailable(message: string): never {
    throw new RunnerError("unavailable", message);
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
    "activity.summary": createActivityHandler(store, engine),
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
    "readiness.check": ({ flowId }) => {
      const row = flow(flowId);
      return toReadinessReport(row, now().toISOString(), webCheck?.(), connectors?.(), local?.(row));
    },
    "readiness.install": () => unavailable("Installing a requirement arrives with the readiness engine."),
    "approvals.list": ({ state }) =>
      [
        ...engine.listApprovals({ state }).reverse().map(approval),
        ...(weekly?.list() ?? []).filter((a) => !state || a.state === state),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
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
  };
}

export function createSettingsHandlers(store: Store, now: () => Date, clearNotice: (id: string) => void) {
  const get = () => readSettings(store, now());
  return {
    get,
    update: ({ patch }: { patch: SettingsPatch }) => {
      const before = get();
      if (
        patch.spendingLimit !== undefined &&
        Math.round(patch.spendingLimit * 100) / 100 <= before.spendingLimit
      )
        throw new RunnerError("invalid_input", "Limit must be above the current limit.", {
          reason: "limit_not_above",
          params: { limit: before.spendingLimit },
        });
      const expired =
        patch.agentPermission === "off" && before.agentPermission !== "off"
          ? store.listApprovals({ state: "pending" })
          : [];
      store.transaction(() => {
        for (const approval of expired) {
          const at = now().toISOString();
          store.updateApproval(approval.id, {
            state: "expired",
            resolvedVia: "permission_off",
            resolvedAt: at,
          });
          store.appendAudit({
            at,
            kind: "decision_expired",
            runId: approval.runId,
            detail: { approvalId: approval.id, runId: approval.runId, why: "permission_off" },
          });
        }
        for (const key of [
          "language",
          "agentPermission",
          "mainAgent",
          "busyFallback",
          "spendingLimit",
        ] as const) {
          let value = patch[key];
          if (value === undefined) continue;
          if (key === "spendingLimit" && typeof value === "number") value = Math.round(value * 100) / 100;
          if (JSON.stringify(value) === JSON.stringify(before[key])) continue;
          store.putSetting(key, value);
          store.appendAudit({
            at: now().toISOString(),
            kind: key === "agentPermission" ? "permission_changed" : "setting_changed",
            detail:
              key === "agentPermission"
                ? { from: before[key], to: value, source: "window" }
                : { key, from: before[key], to: value },
          });
        }
        if (patch.keeper) {
          const current = readKeeperSettings(store);
          const keeper = KeeperSettings.parse({
            ...current,
            ...patch.keeper,
            quotaLines: { ...current.quotaLines, ...patch.keeper.quotaLines },
            effortModels: { ...current.effortModels, ...patch.keeper.effortModels },
          });
          if (JSON.stringify(keeper) !== JSON.stringify(current)) {
            store.putSetting("keeper", keeper);
            store.appendAudit({
              at: now().toISOString(),
              kind: "setting_changed",
              detail: { key: "keeper", from: current, to: keeper },
            });
          }
        }
      });
      for (const approval of expired) clearNotice(`approval:${approval.id}`);
      return get();
    },
  };
}

export function createDecisionHandlers(
  store: Store,
  engine: Engine,
  weekly: ReturnType<typeof createWeekly>,
  clear: (id: string) => void,
) {
  const list = (input: V2Input<"approvals.list">, { caller }: { caller: Caller }) => {
    const rows = store
      .listApprovals({ runId: input.runId })
      .filter((row) => !input.state || row.state === input.state)
      .flatMap((row) => {
        const run = store.getRun(row.runId);
        if (run && input.flowId && input.flowId !== run.flowId) return [];
        try {
          if (!run) throw new Error("Run not found");
          return [toDecision(row, run, store)];
        } catch {
          store.appendAudit({
            at: new Date().toISOString(),
            kind: "internal_error",
            detail: { method: "approvals.list" },
          });
          return [];
        }
      });
    const synthetic =
      !input.runId && !input.flowId
        ? weekly
            .list()
            .map(({ expiresAt: _expiresAt, ...row }) => ({ ...row, canAlwaysAllow: false, stepWaiting: 0 }))
        : [];
    const pause = store.getSetting("spending-pause");
    const budget =
      !input.runId &&
      !input.flowId &&
      pause &&
      typeof pause === "object" &&
      !Array.isArray(pause) &&
      typeof pause.id === "string" &&
      typeof pause.reachedAt === "string" &&
      pause.state === "pending" &&
      (!input.state || input.state === "pending")
        ? [
            {
              id: pause.id,
              kind: "budget_raise" as const,
              state: "pending" as const,
              summary: "Spending limit reached",
              payload: { kind: "text" as const, text: "Spending limit reached" },
              editable: false,
              createdAt: pause.reachedAt,
              canAlwaysAllow: false,
              stepWaiting: 0,
            },
          ]
        : [];
    const all = [
      ...rows,
      ...synthetic.filter((row) => !input.state || row.state === input.state),
      ...budget,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return caller === "window"
      ? all
      : rows.map((row) => ({ flowId: row.flowId, stepId: row.stepId, state: row.state }));
  };
  const resolve = (
    input: V2Input<"approvals.resolve">,
    { caller }: { caller: Caller } = { caller: "window" },
  ) => {
    if (caller !== "window" && input.decision === "another_way")
      throw new RunnerError("not_allowed", "Caller is not allowed.", { reason: "caller_not_allowed" });
    if (caller === "phone" && (input.decision === "edit" || input.decision === "always_allow"))
      throw new RunnerError("not_allowed", "This decision is not available from a phone.", {
        reason: "phone_no_rules",
      });
    if (input.approvalId.startsWith("weekly-limit:")) {
      if (input.decision === "another_way")
        throw new RunnerError("invalid_input", "Another way is not allowed for this decision.", {
          reason: "another_way_not_allowed",
        });
      if (input.decision !== "approve" && input.decision !== "reject")
        throw new RunnerError("invalid_input", "Invalid decision.");
      const [old] = weekly.resolve(input.approvalId, input.decision);
      if (!old) throw new RunnerError("not_found", "Approval not found.");
      const { expiresAt: _expiresAt, ...rest } = old;
      clear(`approval:${input.approvalId}`);
      return { decision: { ...rest, canAlwaysAllow: false, stepWaiting: 0 }, stepWaiting: 0 };
    }
    const row = store.getApproval(input.approvalId);
    if (!row) {
      if (input.approvalId === (store.getSetting("spending-pause") as { id?: string } | undefined)?.id) {
        if (input.decision === "another_way")
          throw new RunnerError("invalid_input", "Another way is not allowed for this decision.", {
            reason: "another_way_not_allowed",
          });
        throw new RunnerError("not_allowed", "Raise the limit in settings.", { reason: "raise_in_settings" });
      }
      throw new RunnerError("not_found", "Approval not found.");
    }
    if (row.kind === "ask" && input.decision !== "another_way")
      throw new RunnerError("invalid_input", "This is a choice. Pick from its options.");
    if (row.state === "expired")
      throw new RunnerError("conflict", "This approval expired.", { reason: "decision_expired" });
    if (row.state !== "pending")
      throw new RunnerError("conflict", "This approval was already decided.", {
        reason: "already_answered",
        params: { via: row.resolvedVia ?? "window" },
      });
    if (input.decision === "another_way") {
      if (row.kind !== "risky_action" && row.kind !== "outside_flow" && row.kind !== "result_sign_off")
        throw new RunnerError("invalid_input", "Another way is not allowed for this decision.", {
          reason: "another_way_not_allowed",
        });
      const text = input.anotherWayText;
      if (text === undefined || !text.trim())
        throw new RunnerError("invalid_input", "Write the text first.", { reason: "empty_text" });
      if (text.length > 4000)
        throw new RunnerError("invalid_input", "Keep it under 4,000 characters.", {
          reason: "text_too_long",
        });
      if (hasHiddenText(text) || /\p{Cf}/u.test(text))
        throw new RunnerError("invalid_input", "Remove hidden characters.", {
          reason: "hidden_characters",
        });
    } else if (input.decision === "always_allow") {
      if (row.kind === "outside_flow")
        throw new RunnerError("not_allowed", "Outside calls can only be approved once.", {
          reason: "outside_flow_once",
        });
      if (row.effect && ["send", "post", "pay", "delete", "merge"].includes(row.effect))
        throw new RunnerError("not_allowed", "This action always asks.", { reason: "always_asks" });
      if (
        row.kind !== "risky_action" ||
        !canAlwaysAllow({
          effect: row.effect,
          place: row.outside ? "outside" : row.fixedPlace ? "fixed" : "none",
          caller,
        }) ||
        !row.place ||
        !["account", "folder"].includes(row.place.kind)
      )
        throw new RunnerError("not_allowed", "The place is not fixed.", { reason: "place_not_fixed" });
    } else if (input.decision !== "approve" && input.decision !== "reject" && input.decision !== "edit")
      throw new RunnerError("invalid_input", "Only text can be edited.");
    if (input.decision === "edit") {
      for (const text of [input.editedText, input.editedSubject]) {
        if (text === undefined) continue;
        if (!text.trim())
          throw new RunnerError("invalid_input", "Write the text first.", { reason: "empty_text" });
        if (hasHiddenText(text) || /\p{Cf}/u.test(text))
          throw new RunnerError("invalid_input", "Remove hidden characters.", {
            reason: "hidden_characters",
          });
      }
    }
    engine.beginDecide(
      row.id,
      input.decision,
      input.decision === "edit" && input.editedText !== undefined
        ? { text: input.editedText, subject: input.editedSubject }
        : input.decision === "another_way" && input.anotherWayText !== undefined
          ? { text: input.anotherWayText }
          : undefined,
      caller === "phone" ? "phone" : "window",
    );
    const current = store.getApproval(row.id);
    const run = store.getRun(row.runId);
    if (!current || !run) throw new RunnerError("not_found", "Approval not found.");
    const decision = toDecision(current, run, store);
    clear(`approval:${row.id}`);
    return { decision, stepWaiting: decision.stepWaiting };
  };
  const answer = (input: V2Input<"approvals.answer">) => {
    engine.beginAnswer(input.approvalId, { picks: input.picks });
    const row = store.getApproval(input.approvalId);
    const run = row && store.getRun(row.runId);
    if (!row || !run) throw new RunnerError("not_found", "Approval not found.");
    const decision = toDecision(row, run, store);
    clear(`approval:${row.id}`);
    return { decision };
  };
  const resolveSimilar = (input: V2Input<"approvals.resolveSimilar">) => {
    const run = store.getRun(input.runId);
    if (!run) throw new RunnerError("not_found", "Run not found.");
    const rows = input.approvalIds.map((id) => store.getApproval(id));
    if (rows.some((row) => row?.runId === input.runId && row.kind === "outside_flow"))
      throw new RunnerError("not_allowed", "Outside calls can only be approved once.", {
        reason: "outside_flow_once",
      });
    if (
      rows.some(
        (row) =>
          !row ||
          row.state !== "pending" ||
          row.runId !== input.runId ||
          row.kind !== "risky_action" ||
          (row.riskyAction !== "send" && row.riskyAction !== "post") ||
          row.similarGroup !== input.group,
      )
    )
      throw new RunnerError("not_allowed", "This kind cannot be batched.", { reason: "kind_not_batchable" });
    const current = store
      .listApprovals({ runId: input.runId, state: "pending" })
      .filter((row) => row.similarGroup === input.group)
      .map((row) => row.id);
    if (current.length !== input.approvalIds.length || current.some((id) => !input.approvalIds.includes(id)))
      throw new RunnerError("conflict", "The list changed.", {
        reason: "list_changed",
        params: { approvalIds: current },
      });
    engine.beginDecideSimilar(input.approvalIds, input.group);
    for (const id of input.approvalIds) clear(`approval:${id}`);
    return {
      decisions: input.approvalIds.map((id) => {
        const row = store.getApproval(id);
        if (!row) throw new RunnerError("not_found", "Approval not found.");
        return toDecision(row, run, store);
      }),
    };
  };
  return { list, resolve, answer, resolveSimilar };
}

export function createRuleHandlers(store: Store, now: () => Date) {
  const view = (rule: import("../storage.ts").RuleRow) =>
    StandingRuleView.parse({
      id: rule.id,
      flowId: rule.flowId,
      touchId: rule.touchId,
      sentence: rule.sentence,
      effect: rule.effect,
      place: rule.place,
      createdAt: rule.createdAt,
      createdBy: rule.createdBy,
      ...(rule.lastUsedAt ? { lastUsedAt: rule.lastUsedAt } : {}),
    });
  return {
    list(input: V2Input<"rules.list">) {
      return store
        .listRules()
        .filter((rule) => rule.state === "active" && (!input.flowId || input.flowId === rule.flowId))
        .reverse()
        .map(view);
    },
    revoke(input: V2Input<"rules.revoke">) {
      const rule = store.listRules().find((row) => row.id === input.ruleId);
      if (!rule) throw new RunnerError("not_found", "Rule not found.");
      const changed = rule.state === "active";
      if (changed)
        store.transaction(() => {
          store.revokeRule(rule.id, "ask_me_again");
          store.appendAudit({
            at: now().toISOString(),
            kind: "rule_revoked",
            detail: {
              ruleId: rule.id,
              flowId: rule.flowId,
              touchId: rule.touchId,
              effect: rule.effect,
              placeKind: rule.place.kind,
              by: "ask_me_again",
            },
          });
        });
      return { rule: view(rule), changed };
    },
  };
}
