import {
  CONTRACT_VERSION,
  isResumable,
  type LiveOperationName,
  type OperationInput,
  type OperationName,
  type OperationOutput,
  operations,
  type RunnerClient,
  RunnerError,
  type RunnerEvent,
  type RunnerTopic,
  RunSummary,
  type TriggerStatus,
} from "@flowdriven/contracts";
import { buildState, FIXTURE_NOW, type FixtureStateV2, type Scenario } from "./state";

export interface FixtureRunnerClient extends RunnerClient {
  readonly state: FixtureStateV2;
  readonly calls: { operation: OperationName; input: unknown }[];
}
type Handlers = { [N in LiveOperationName]?: (input: OperationInput<N>) => OperationOutput<N> };
export function createFixtureRunnerClient(
  options: { scenario?: Scenario; now?: () => Date } = {},
): FixtureRunnerClient {
  const state = buildState(options.scenario);
  const calls: FixtureRunnerClient["calls"] = [];
  const listeners = new Set<(event: RunnerEvent) => void>();
  const now = () => (options.now?.() ?? new Date(FIXTURE_NOW)).toISOString();
  const find = <T>(items: T[], predicate: (item: T) => boolean): T => {
    const item = items.find(predicate);
    if (!item) throw new RunnerError("not_found", "Item not found.");
    return item;
  };
  const flow = (id: string) => find(state.flows, (item) => item.summary.id === id);
  const run = (id: string) => find(state.runs, (item) => item.id === id);
  const audit = (
    kind: string,
    detail: Record<string, string | number | boolean | null | string[]>,
    runId?: string,
  ) => {
    state.audit.push({ id: state.audit.length + 1, at: now(), kind, detail, ...(runId ? { runId } : {}) });
  };
  const expire = () => {
    for (const decision of state.decisions) {
      if (decision.state !== "pending" || decision.kind === "budget_raise" || decision.expiresAt > now())
        continue;
      decision.state = "expired";
      decision.resolvedAt = decision.expiresAt;
      decision.resolvedVia = "expiry";
      decision.canAlwaysAllow = false;
      audit("decision_expired", { why: "expiry" }, decision.runId);
      if (decision.runId) {
        const item = run(decision.runId);
        const step = item.steps.find((s) => s.stepId === decision.stepId);
        if (step) step.state = "skipped";
        item.decisionLines.push({
          key: "report.noAnswer",
          params: { title: decision.stepTitle ?? decision.summary },
        });
        if (
          item.state === "waiting_approval" &&
          !state.decisions.some((d) => d.runId === item.id && d.state === "pending")
        )
          item.state = "running";
      }
    }
  };
  const statuses = (id: string): TriggerStatus[] => {
    const item = flow(id);
    return (item.manifest.triggers ?? []).flatMap((trigger, index): TriggerStatus[] => {
      if (trigger.kind === "manual") return [];
      const supported = ["schedule", "file_change", "flow_done"].includes(trigger.kind);
      const saved = state.triggerSwitches[`${id}#${index}`];
      const status = !supported
        ? "unavailable"
        : !saved
          ? "off"
          : saved.hash === item.hash
            ? "on"
            : "needs_ok";
      return [
        {
          flowId: id,
          index,
          kind: trigger.kind,
          summary: trigger.summary,
          state: status,
          canEnable: supported,
          ...(status === "unavailable" ? { reason: "Not available yet." } : {}),
          ...(status === "needs_ok"
            ? { reason: "This flow changed. Turn the trigger on again to approve this version." }
            : {}),
          ...(status === "on" && trigger.kind === "schedule"
            ? { nextAt: new Date(Date.parse(now()) + 3600000).toISOString() }
            : {}),
          firesToday: 0,
          droppedToday: 0,
          dailyCap: 24,
        },
      ];
    });
  };
  const handlers: Handlers = {
    "runner.info": () => ({
      contractVersion: CONTRACT_VERSION,
      appVersion: "0.1.0",
      storeVersion: 7,
      mode: "sample",
    }),
    "settings.get": () => state.settings,
    "settings.update": ({ patch }) => {
      if (patch.spendingLimit !== undefined && patch.spendingLimit <= state.settings.spendingLimit)
        throw new RunnerError("invalid_input", "Limit must increase.", {
          reason: "limit_not_above",
          params: { limit: state.settings.spendingLimit },
        });
      if (patch.mainAgent) {
        const agent = state.agents.find((a) => a.id === patch.mainAgent?.agent);
        if (!agent || agent.state !== "ready")
          throw new RunnerError("not_allowed", "Agent is not ready.", { reason: "agent_not_ready" });
        if (!(agent.models ?? []).some((m) => m.id === patch.mainAgent?.model))
          throw new RunnerError("invalid_input", "Unknown model.", { reason: "model_unknown" });
      }
      if (patch.language && !["en", "id"].includes(patch.language))
        throw new RunnerError("invalid_input", "Unknown language.", { reason: "language_unknown" });
      if (patch.agentPermission === "off") {
        for (const item of state.runs.filter((r) =>
          ["queued", "checking", "running", "waiting_approval", "retrying"].includes(r.state),
        )) {
          item.state = "stopped";
          item.cause = { code: "permission_off" };
          item.endedAt = now();
          item.canTryAgain = false;
          for (const step of item.steps)
            if (["running", "retrying", "waiting_approval"].includes(step.state)) step.state = "stopped";
          for (const decision of state.decisions.filter(
            (d) => d.runId === item.id && d.state === "pending",
          )) {
            decision.state = "expired";
            decision.resolvedAt = now();
            decision.resolvedVia = "permission_off";
            decision.canAlwaysAllow = false;
          }
        }
        audit("permission_changed", { source: "window", value: "off" });
      }
      for (const [key, value] of Object.entries(patch)) {
        const old = state.settings[key as keyof typeof state.settings];
        if (JSON.stringify(old) !== JSON.stringify(value))
          audit("setting_changed", { key, old: JSON.stringify(old), value: JSON.stringify(value) });
      }
      if (patch.agentPermission === "on" && state.settings.agentPermission !== "on")
        audit("permission_changed", { source: "window", value: "on" });
      const { keeper, ...rest } = patch;
      Object.assign(state.settings, rest);
      if (patch.spendingLimit !== undefined) {
        state.settings.spendingLimit = Math.round(patch.spendingLimit * 100) / 100;
        state.settings.spending.limitUsd = state.settings.spendingLimit;
        state.settings.spending.state =
          state.settings.spending.spentUsd >= state.settings.spendingLimit
            ? "reached"
            : state.settings.spending.spentUsd >= state.settings.spendingLimit * 0.8
              ? "warning"
              : "ok";
        if (state.settings.spending.spentUsd < state.settings.spendingLimit)
          for (const d of state.decisions.filter((a) => a.kind === "budget_raise" && a.state === "pending")) {
            d.state = "approved";
            d.resolvedAt = now();
            d.resolvedVia = "window";
          }
        audit("limit_raised", { limit: state.settings.spendingLimit });
      }
      if (keeper) {
        const { quotaLines, ...other } = keeper;
        Object.assign(state.settings.keeper, other);
        if (quotaLines) Object.assign(state.settings.keeper.quotaLines, quotaLines);
      }
      return state.settings;
    },
    "flows.list": () =>
      state.flows.map((item) => item.summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    "flows.get": ({ flowId }) => flow(flowId),
    "flows.import": () => {
      throw new RunnerError("unavailable", "Import needs the engine.");
    },
    "runs.list": (input) =>
      state.runs
        .filter(
          (r) =>
            (!input.flowId || r.flowId === input.flowId) &&
            (!input.state || r.state === input.state) &&
            (!input.source || r.source === input.source) &&
            (!input.before || r.startedAt < input.before),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, input.limit ?? 200)
        .map((r) => RunSummary.strip().parse(r)),
    "runs.status": ({ runId }) => run(runId),
    "runs.report": ({ runId }) => {
      const r = run(runId);
      return r.report
        ? { ...r.report, decisionLines: r.decisionLines }
        : { runId, lines: [], decisionLines: r.decisionLines, result: { kind: flow(r.flowId).result.kind } };
    },
    "runs.export": ({ runId }) => {
      const r = run(runId);
      const secretIds = new Set(
        state.flows
          .find((f) => f.summary.id === r.flowId)
          ?.manifest.inputs.filter((i) => i.type === "secret_ref")
          .map((i) => i.id) ?? [],
      );
      const secrets = r.inputs.filter((i) => secretIds.has(i.id) && i.value).map((i) => i.value);
      const clean = (text: string) =>
        secrets
          .reduce((value, secret) => value.replaceAll(secret, "[hidden]"), text)
          .replace(/\b(?:sk-|ghp_)[A-Za-z0-9_-]+/g, "[hidden]")
          .replace(/Bearer\s+\S+/gi, "[hidden]")
          .replace(
            /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu,
            (character) =>
              `[U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")} hidden character]`,
          );
      return {
        language: state.settings.language,
        flowName: clean(r.flowName),
        startedAt: r.startedAt,
        ...(r.endedAt ? { endedAt: r.endedAt } : {}),
        state: r.state,
        ...(r.cause ? { cause: r.cause } : {}),
        summary: (r.report?.lines ?? []).map((text) => ({ text: clean(text), outside: false })),
        steps: r.steps.map((s) => ({ title: clean(s.title), state: s.state, outside: s.outside ?? false })),
        decisionLines: r.decisionLines.map((line) => ({
          ...line,
          ...(line.params
            ? {
                params: Object.fromEntries(
                  Object.entries(line.params).map(([key, value]) => [
                    key,
                    typeof value === "string" ? clean(value) : value,
                  ]),
                ),
              }
            : {}),
        })),
        ...(r.answer ? { answer: { lines: r.answer.lines.map(clean), values: {} } } : {}),
      };
    },
    "runs.resume": ({ runId }) => {
      const r = run(runId);
      if (!isResumable(r.state))
        throw new RunnerError("not_allowed", "Run cannot resume.", { reason: "not_resumable" });
      if (state.settings.agentPermission !== "on")
        throw new RunnerError("not_allowed", "Permission is off.", { reason: "permission_off" });
      if (!state.flows.some((f) => f.summary.id === r.flowId))
        throw new RunnerError("not_allowed", "Flow deleted.", { reason: "flow_deleted" });
      if ((r.state === "needs_login" || r.state === "blocked") && state.resumeBlockers[r.id])
        return { outcome: "still_stuck", run: RunSummary.strip().parse(r) };
      r.state = "running";
      r.canTryAgain = false;
      for (const step of r.steps)
        if (step.state === "failed" || step.state === "interrupted") step.state = "pending";
      delete r.cause;
      delete r.endedAt;
      audit("run_resumed", {}, r.id);
      return { outcome: "resumed", run: RunSummary.strip().parse(r) };
    },
    "approvals.list": (input) => {
      expire();
      return state.decisions
        .filter(
          (d) =>
            (!input.state || d.state === input.state) &&
            (!input.runId || d.runId === input.runId) &&
            (!input.flowId || d.flowId === input.flowId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    "approvals.resolve": (input) => {
      expire();
      const d = find(state.decisions, (a) => a.id === input.approvalId);
      if (d.state === "expired")
        throw new RunnerError("conflict", "Decision expired.", { reason: "decision_expired" });
      if (d.state !== "pending")
        throw new RunnerError("conflict", "Already answered.", {
          reason: "already_answered",
          params: { via: d.resolvedVia ?? "window" },
        });
      if (d.kind === "budget_raise")
        throw new RunnerError("not_allowed", "Raise limit in settings.", { reason: "raise_in_settings" });
      if (input.decision === "edit") {
        if (!d.editable || !["email", "text"].includes(d.payload.kind))
          throw new RunnerError("invalid_input", "Cannot edit.", { reason: "edit_not_allowed" });
        if (!input.editedText?.trim())
          throw new RunnerError("invalid_input", "Empty text.", { reason: "empty_text" });
        if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(input.editedText))
          throw new RunnerError("invalid_input", "Hidden characters.", { reason: "hidden_characters" });
        d.editedText = input.editedText;
        if (input.editedSubject) d.editedSubject = input.editedSubject;
      }
      if (input.decision === "always_allow") {
        if (d.kind !== "risky_action" || d.effect !== "change")
          throw new RunnerError("not_allowed", "Always asks.", { reason: "always_asks" });
        if (
          !d.fixedPlace ||
          !d.place ||
          !d.flowId ||
          !d.stepId ||
          d.outside ||
          !["account", "folder"].includes(d.place.kind)
        )
          throw new RunnerError("not_allowed", "Place is not fixed.", { reason: "place_not_fixed" });
        const confirmedFlow = flow(d.flowId);
        const declared = confirmedFlow.manifest.touches?.find((item) => item.id === d.stepId);
        if (
          !confirmedFlow.confirmed ||
          !declared ||
          declared.effect !== "change" ||
          declared.place?.kind !== d.place.kind ||
          declared.place.value !== d.place.value ||
          (d.runId && run(d.runId).flowHash !== confirmedFlow.confirmed.hash)
        )
          throw new RunnerError("not_allowed", "Place is not fixed.", { reason: "place_not_fixed" });
        const existing = state.rules.find(
          (rule) =>
            rule.flowId === d.flowId &&
            rule.touchId === d.stepId &&
            rule.effect === "change" &&
            rule.place.kind === d.place?.kind &&
            rule.place.value === d.place.value,
        );
        const rule = existing ?? {
          id: `rule-${String(state.rules.length + 1).padStart(12, "0")}`,
          flowId: d.flowId,
          touchId: d.stepId,
          sentence: d.stepTitle ?? d.summary,
          effect: "change" as const,
          place: d.place,
          createdAt: now(),
          createdBy: "always_allow" as const,
        };
        if (!existing) state.rules.push(rule);
        const f = flow(d.flowId);
        if (!f.rules.some((item) => item.id === rule.id)) f.rules.push(rule);
        const touch = f.touches.find((item) => item.id === d.stepId);
        if (touch) {
          touch.byRule = rule.id;
          touch.list = "on_its_own";
          f.lists.asksFirst = f.lists.asksFirst.filter((id) => id !== touch.id);
          if (!f.lists.onItsOwn.includes(touch.id)) f.lists.onItsOwn.push(touch.id);
        }
        d.ruleId = rule.id;
      }
      d.state =
        input.decision === "approve"
          ? "approved"
          : input.decision === "edit"
            ? "approved_edited"
            : input.decision === "reject"
              ? "rejected"
              : "allowed_always";
      d.canAlwaysAllow = false;
      d.resolvedAt = now();
      d.resolvedVia = "window";
      if (d.runId) {
        const r = run(d.runId);
        const step = r.steps.find((s) => s.stepId === d.stepId);
        if (step && input.decision === "reject") step.state = "skipped";
        r.decisionLines.push({
          key:
            input.decision === "reject"
              ? "report.youSaidNo"
              : input.decision === "edit"
                ? "report.youApprovedEdited"
                : "report.youApproved",
          params: { title: d.stepTitle ?? d.summary },
        });
        if (!state.decisions.some((a) => a.runId === r.id && a.state === "pending")) r.state = "running";
      }
      audit("decision_made", { decision: d.state }, d.runId);
      return {
        decision: d,
        stepWaiting: state.decisions.filter(
          (a) => a.runId === d.runId && a.stepId === d.stepId && a.state === "pending",
        ).length,
        ...(d.ruleId ? { ruleId: d.ruleId } : {}),
      };
    },
    "approvals.answer": ({ approvalId, picks }) => {
      expire();
      const d = find(state.decisions, (a) => a.id === approvalId);
      if (d.state === "expired")
        throw new RunnerError("conflict", "Decision expired.", { reason: "decision_expired" });
      if (d.state !== "pending")
        throw new RunnerError("conflict", "Already answered.", { reason: "already_answered" });
      if (d.payload.kind !== "choice") throw new RunnerError("invalid_input", "Not a choice.");
      if (picks.length > d.payload.maxPick)
        throw new RunnerError("invalid_input", "Too many picks.", {
          reason: "too_many_picks",
          params: { max: d.payload.maxPick },
        });
      if (
        new Set(picks).size !== picks.length ||
        picks.some((p) => d.payload.kind === "choice" && !d.payload.options.some((o) => o.key === p))
      )
        throw new RunnerError("invalid_input", "Unknown pick.", { reason: "unknown_pick" });
      d.state = "approved";
      d.picks = picks;
      d.resolvedAt = now();
      d.resolvedVia = "window";
      if (d.runId) {
        const r = run(d.runId);
        const step = r.steps.find((s) => s.stepId === d.stepId);
        if (step) step.state = picks.length ? "passed" : "skipped";
        if (!state.decisions.some((a) => a.runId === r.id && a.state === "pending")) r.state = "running";
      }
      audit("decision_made", { decision: d.state }, d.runId);
      return { decision: d };
    },
    "audit.list": (input) =>
      state.audit
        .filter((a) => (!input.runId || a.runId === input.runId) && (!input.afterId || a.id > input.afterId))
        .slice(0, input.limit ?? 200),
    "readiness.check": ({ flowId }) => {
      const f = flow(flowId);
      const items = f.manifest.requirements.map((requirement) => ({
        requirementId: requirement.id,
        name: requirement.ref,
        type: requirement.type,
        why: requirement.why,
        required: requirement.required,
        sensitive: requirement.sensitive,
        state: "unchecked" as const,
        route: requirement.routes[0] ?? { via: "native", risk: "official" as const },
        autoInstall: "guided" as const,
        guide: { steps: [`Set up ${requirement.ref}.`], commands: [], verified: false },
        checkedAt: now(),
      }));
      return {
        flowId,
        flowName: f.summary.name,
        checkedAt: now(),
        ready: items.every((item) => !item.required),
        items,
      };
    },
    "readiness.install": ({ flowId }) => {
      flow(flowId);
      throw new RunnerError("unavailable", "Installation needs the engine.");
    },
    "triggers.list": ({ flowId }) => statuses(flowId),
    "triggers.setEnabled": ({ flowId, index, enabled, hash }) => {
      const f = flow(flowId);
      const trigger = statuses(flowId).find((t) => t.index === index);
      if (!trigger) throw new RunnerError("not_found", "Trigger not found.");
      if (enabled && (hash !== f.hash || !trigger.canEnable))
        throw new RunnerError("invalid_input", "Trigger cannot be enabled.");
      if (enabled) state.triggerSwitches[`${flowId}#${index}`] = { hash };
      else delete state.triggerSwitches[`${flowId}#${index}`];
      return find(statuses(flowId), (t) => t.index === index);
    },
  };
  return {
    state,
    calls,
    async call<N extends LiveOperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>> {
      calls.push({ operation: name, input });
      if (!Object.hasOwn(operations, name)) throw new RunnerError("invalid_input", "Unknown operation.");
      const operation = operations[name];
      if ("retired" in operation)
        throw new RunnerError("unavailable", "Operation retired.", { reason: "retired" });
      if (name === "settings.update" && typeof input === "object" && input !== null && "patch" in input) {
        const patch = input.patch as { spendingLimit?: number };
        if (typeof patch?.spendingLimit === "number" && patch.spendingLimit > 10000)
          throw new RunnerError("invalid_input", "Limit too high.", { reason: "limit_too_high" });
      }
      if (
        name === "approvals.resolve" &&
        typeof input === "object" &&
        input !== null &&
        "decision" in input &&
        input.decision === "edit" &&
        "editedText" in input &&
        typeof input.editedText === "string" &&
        !input.editedText.trim()
      )
        throw new RunnerError("invalid_input", "Empty text.", { reason: "empty_text" });
      const parsed = operation.input.safeParse(input);
      if (!parsed.success) throw new RunnerError("invalid_input", "Invalid input.");
      const handler = handlers[name] as ((value: OperationInput<N>) => OperationOutput<N>) | undefined;
      if (!handler) throw new RunnerError("unavailable", "Not available yet.");
      const result = handler(parsed.data as OperationInput<N>);
      if (operation.writes.length)
        for (const listener of listeners)
          listener({ type: "changed", topics: [...operation.writes] as RunnerTopic[] });
      return structuredClone(result);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
