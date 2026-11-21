import {
  CardAction,
  CONTRACT_VERSION,
  FlowsConfirmInput,
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
  const revokedRules: typeof state.rules = [];
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
  const mainAgent = () => {
    const main = state.settings.mainAgent;
    if (!main) throw new RunnerError("not_allowed", "No main agent.", { reason: "agent_not_ready" });
    return main;
  };
  const handlers: Handlers = {
    "agents.list": () => state.agents,
    "agents.rescan": () => ({ agents: state.agents, found: [] }),
    "agents.setUp": ({ agentId }) => {
      const agent = find(state.agents, (a) => a.id === agentId);
      state.settings.agentPermission = "on";
      return agent;
    },
    "agents.signIn": ({ agentId }) => {
      const agent = find(state.agents, (a) => a.id === agentId);
      if (agent.state === "not_installed")
        throw new RunnerError("not_allowed", "Agent not installed.", { reason: "agent_not_installed" });
      if (agent.state !== "ready") agent.state = "waiting_login";
      return agent;
    },
    "agents.models": ({ agentId }) => {
      const agent = find(state.agents, (a) => a.id === agentId);
      if (agent.state !== "ready")
        throw new RunnerError("not_allowed", "Agent not ready.", { reason: "agent_not_ready" });
      return agent.models ?? [];
    },
    "chats.list": () => state.chats.map((c) => c.chat).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    "chats.get": ({ chatId, before, limit }) => {
      const chat = find(state.chats, (c) => c.chat.id === chatId);
      const messages = chat.messages
        .filter((m) => before === undefined || m.seq < before)
        .map((m) => {
          if (m.card?.type !== "decision") return m;
          const decisionId = m.card.decision.id;
          const decision = state.decisions.find((d) => d.id === decisionId);
          return decision ? { ...m, card: { ...m.card, decision } } : m;
        });
      return { ...chat, messages: messages.slice(-(limit ?? 200)), more: messages.length > (limit ?? 200) };
    },
    "chats.create": ({ subject }) => {
      if (subject?.kind === "improve") flow(subject.flowId);
      let chat = state.chats.find((c) => c.messages.length === 0);
      const reused = !!chat;
      if (!chat) {
        const chatId = `chat-fixture-${++state.counters.chat}`;
        chat = {
          chat: {
            id: chatId,
            title: "New chat",
            updatedAt: now(),
            from: "person",
            agent: mainAgent().agent,
            model: mainAgent().model,
            language: state.settings.language,
            waiting: false,
            ...(subject ? { subject } : {}),
          },
          messages: [],
          more: false,
          turn: { state: "idle", queued: 0 },
          composerText: "",
        };
        state.chats.push(chat);
      }
      chat.chat.updatedAt = now();
      return { chatId: chat.chat.id, reused };
    },
    "chats.send": (input) => {
      const chat = find(state.chats, (c) => c.chat.id === input.chatId);
      if (state.settings.agentPermission !== "on")
        throw new RunnerError("not_allowed", "Permission is off.", { reason: "permission_off" });
      const text =
        "text" in input ? input.text : chat.starters?.find((s) => s.index === input.starter)?.label.key;
      if (!text) throw new RunnerError("invalid_input", "Unknown starter.");
      const messageId = `message-fixture-${++state.counters.message}`;
      if (!chat.messages.some((m) => m.role === "person")) chat.chat.title = text.slice(0, 40);
      chat.messages.push({
        id: messageId,
        seq: Math.max(-1, ...chat.messages.map((m) => m.seq)) + 1,
        at: now(),
        role: "person",
        kind: "text",
        text,
        outside: "pasted" in input && !!input.pasted,
      });
      chat.chat.updatedAt = now();
      chat.composerText = "";
      const form = chat.messages.some((m) => m.card?.type === "form" && m.card.state === "open");
      const agent = state.agents.find((a) => a.id === chat.chat.agent);
      const turn = form ? "form_open" : agent?.state !== "ready" ? "not_ready" : "queued";
      if (turn === "queued") {
        chat.turn.state = "queued";
        chat.turn.queued++;
      }
      return { messageId, turn };
    },
    "chats.setAgent": ({ chatId, agent: agentId, model }) => {
      const chat = find(state.chats, (c) => c.chat.id === chatId);
      const agent = find(state.agents, (a) => a.id === agentId);
      if (agent.state !== "ready")
        throw new RunnerError("not_allowed", "Agent not ready.", { reason: "agent_not_ready" });
      if (!agent.models?.some((m) => m.id === model))
        throw new RunnerError("invalid_input", "Unknown model.", { reason: "model_unknown" });
      chat.chat.agent = agentId;
      chat.chat.model = model;
      audit("chat_agent_changed", { chatId, agent: agentId, model });
      return chat.chat;
    },
    "chats.setComposer": ({ chatId, text }) => {
      find(state.chats, (c) => c.chat.id === chatId).composerText = text;
      return {};
    },
    "chats.delete": ({ chatId }) => {
      const chat = find(state.chats, (c) => c.chat.id === chatId);
      state.chats.splice(state.chats.indexOf(chat), 1);
      audit("chat_deleted", { chatId });
      return { deleted: true };
    },
    "chats.act": (input) => {
      const chat = find(state.chats, (c) => c.chat.id === input.chatId);
      const card = find(chat.messages, (m) => m.id === input.messageId && !!m.card).card;
      if (!card) throw new RunnerError("not_found", "Card not found.");
      const actions: Record<string, string[]> = {
        plan: ["start", "change_plan"],
        ask_run: ["run", "not_now"],
        confirm: ["confirm_flow"],
        inputs_ask: ["use_form", "use_last_answers", "cancel_question"],
        form: ["submit_form", "cancel_question"],
        draft: ["save_flow", "change_draft"],
        change: ["save_change", "cancel_change"],
        schedule: ["set_schedule", "skip_schedule"],
        unschedule: ["turn_off_schedule", "keep_schedule"],
        stop: ["stop_runs", "keep_running"],
        repeat_offer: ["every_time", "only_this_time"],
        run_offer: ["run_now", "not_now", "propose_schedule"],
        choose: ["choose"],
        turn_failed: ["retry_turn"],
      };
      const message = find(chat.messages, (m) => m.id === input.messageId);
      if (
        !actions[card.type]?.includes(input.action) &&
        !(input.action === "suggestion" && message.chips?.some((c) => c.kind === "suggestion"))
      )
        throw new RunnerError("invalid_input", "Unknown action.", { reason: "unknown_action" });
      if (card.state === "flow_deleted")
        throw new RunnerError("not_found", "Flow deleted.", { reason: "flow_deleted" });
      if (card.state === "stale") throw new RunnerError("conflict", "Card stale.", { reason: "card_stale" });
      if (card.state === "replaced")
        throw new RunnerError("conflict", "Card replaced.", { reason: "card_replaced" });
      if (card.state !== "open")
        throw new RunnerError("conflict", "Card answered.", { reason: "card_answered" });
      if (
        ["start", "run", "run_now", "submit_form", "use_last_answers"].includes(input.action) &&
        state.settings.agentPermission !== "on"
      )
        throw new RunnerError("not_allowed", "Permission is off.", { reason: "permission_off" });
      const starts: import("@flowdriven/contracts").StartOutcome[] = [];
      if (input.action === "confirm_flow" && card.type === "confirm")
        handlers["flows.confirm"]?.(
          FlowsConfirmInput.parse({
            flowId: card.flowId,
            ...(typeof input.values === "object" && input.values !== null ? input.values : {}),
          }),
        );
      if ((input.action === "run" || input.action === "run_now") && "flowId" in card) {
        const result = handlers["flows.start"]?.({ flowId: card.flowId, source: "flows" });
        if (result) starts.push(result);
      }
      if (input.action === "start" && card.type === "plan")
        for (const item of card.items) {
          const result = handlers["flows.start"]?.({ flowId: item.flowId, source: "flows" });
          if (result) starts.push(result);
        }
      if (input.action === "stop_runs" && card.type === "stop")
        for (const item of card.runs) handlers["runs.stop"]?.({ runId: item.runId });
      if (input.action === "set_schedule" && card.type === "schedule") {
        const f = flow(card.flowId);
        const s = card.schedule;
        const schedule =
          s.type === "after" && s.afterFlow
            ? { type: "after" as const, afterFlowId: s.afterFlow.id, whenItsTime: s.whenItsTime }
            : s.type === "weekly" && s.time && s.day
              ? { type: "weekly" as const, time: s.time, day: s.day, whenItsTime: s.whenItsTime }
              : (s.type === "daily" || s.type === "weekdays") && s.time
                ? { type: s.type, time: s.time, whenItsTime: s.whenItsTime }
                : { type: "manual" as const };
        handlers["flows.setSchedule"]?.({ flowId: card.flowId, hash: f.hash, schedule });
      }
      card.state = "answered";
      card.answer = { action: CardAction.parse(input.action), at: now() };
      return { card, posted: [], ...(starts.length ? { starts } : {}) };
    },
    "flows.start": ({ flowId, source, ...rest }) => {
      const f = flow(flowId);
      const startId = `start-fixture-${++state.counters.start}`;
      if (source === "again" && "fromRunId" in rest) run(rest.fromRunId);
      if (state.settings.agentPermission !== "on")
        return { outcome: "refused", startId, reason: "permission_off" };
      if (
        f.summary.state !== "confirmed" ||
        f.inputs.some((i) => i.required && !i.default && !i.remembered)
      ) {
        let chat = state.chats.find((c) => c.chat.from === "flowdriven");
        if (!chat) {
          const id = `chat-fixture-${++state.counters.chat}`;
          chat = {
            chat: {
              id,
              title: f.summary.name,
              updatedAt: now(),
              from: "flowdriven",
              agent: mainAgent().agent,
              model: mainAgent().model,
              language: state.settings.language,
              waiting: true,
            },
            messages: [],
            more: false,
            turn: { state: "idle", queued: 0 },
            composerText: "",
          };
          state.chats.push(chat);
        }
        const existing = state.chats
          .flatMap((c) => c.messages.map((message) => ({ c, message })))
          .find(
            ({ message }) =>
              message.card &&
              (message.card.type === "inputs_ask" || message.card.type === "confirm") &&
              message.card.flowId === flowId &&
              message.card.state === "open",
          );
        if (existing)
          return {
            outcome: existing.message.card?.type === "confirm" ? "needs_confirmation" : "asked",
            startId,
            chatId: existing.c.chat.id,
            questionId: existing.message.id,
            reused: true,
          };
        const questionId = `question-fixture-${++state.counters.question}`;
        const card: import("@flowdriven/contracts").CardView =
          f.summary.state === "confirmed"
            ? {
                type: "inputs_ask",
                state: "open",
                flowId,
                name: f.summary.name,
                questionId,
                missing: f.inputs
                  .filter((i) => i.required && !i.default && !i.remembered)
                  .map((i) => ({ inputId: i.id, label: i.label })),
                known: [],
                canUseLast: false,
              }
            : {
                type: "confirm",
                state: "open",
                flowId,
                name: f.summary.name,
                hash: f.hash,
                // biome-ignore lint/suspicious/noThenProperty: The contract names this field then.
                then: "start",
              };
        chat.messages.push({
          id: questionId,
          seq: Math.max(-1, ...chat.messages.map((m) => m.seq)) + 1,
          at: now(),
          role: "flowdriven",
          kind: "card",
          card,
          outside: false,
        });
        chat.chat.waiting = true;
        return {
          outcome: f.summary.state === "confirmed" ? "asked" : "needs_confirmation",
          startId,
          chatId: chat.chat.id,
          questionId,
          reused: false,
        };
      }
      const runId = `run-fixture-${++state.counters.run}`;
      state.runs.push({
        id: runId,
        flowId,
        flowName: f.summary.name,
        flowVersion: f.version,
        flowHash: f.hash,
        source,
        agent: mainAgent().agent,
        model: mainAgent().model,
        versionChanged: false,
        oneTime: false,
        project: "",
        state: "queued",
        startedAt: now(),
        inputs: [],
        steps: [],
        approvalIds: [],
        outputs: [],
        usage: [],
        estimatedCostUsd: 0,
        decisionLines: [],
        costLine: { kind: "plan" },
        canRunAgain: true,
        canTryAgain: false,
      });
      return { outcome: "started", startId, runId };
    },
    "flows.confirm": ({ flowId, hash, onItsOwn, pins }) => {
      const f = flow(flowId);
      if (f.hash !== hash) throw new RunnerError("conflict", "Hash mismatch.", { reason: "hash_mismatch" });
      if (f.manifest.inputs.some((i) => i.type === "secret_ref"))
        throw new RunnerError("not_allowed", "Needs keychain.", { reason: "needs_keychain" });
      if (f.pinsNeeded.some((p) => !pins?.[p.requirementId]))
        throw new RunnerError("invalid_input", "Pins missing.", { reason: "pins_missing" });
      for (const id of onItsOwn) {
        const t = f.touches.find((item) => item.id === id);
        if (!t) throw new RunnerError("invalid_input", "Unknown touch.", { reason: "touch_unknown" });
        if (t.declared === "not_allowed")
          throw new RunnerError("not_allowed", "Never does.", { reason: "never_does" });
        if (["send", "post", "pay", "delete", "merge"].includes(t.effect))
          throw new RunnerError("not_allowed", "Always asks.", { reason: "always_asks" });
        if (
          t.effect !== "read" &&
          (!t.fixedPlace ||
            !t.place ||
            !(
              t.effect === "change"
                ? ["account", "folder"]
                : t.effect === "local_write"
                  ? ["folder"]
                  : ["command"]
            ).includes(t.place.kind))
        )
          throw new RunnerError("not_allowed", "Place not fixed.", { reason: "place_not_fixed" });
      }
      const created: string[] = [],
        kept: string[] = [],
        ended: string[] = [];
      for (const rule of [...state.rules.filter((r) => r.flowId === flowId)]) {
        const t = f.touches.find((item) => item.id === rule.touchId);
        if (
          onItsOwn.includes(rule.touchId) &&
          t?.effect === rule.effect &&
          t.place?.kind === rule.place.kind &&
          t.place.value === rule.place.value
        )
          kept.push(rule.id);
        else {
          state.rules.splice(state.rules.indexOf(rule), 1);
          revokedRules.push(rule);
          ended.push(rule.id);
        }
      }
      for (const t of f.touches) {
        delete t.byRule;
        if (
          onItsOwn.includes(t.id) &&
          t.effect !== "read" &&
          t.place &&
          (t.effect === "change" || t.effect === "local_write" || t.effect === "run_command")
        ) {
          let rule = state.rules.find((r) => r.flowId === flowId && r.touchId === t.id);
          if (!rule) {
            rule = {
              id: `rule-fixture-${++state.counters.start}`,
              flowId,
              touchId: t.id,
              sentence: t.sentence,
              effect: t.effect,
              place: t.place,
              createdAt: now(),
              createdBy: "confirm",
            };
            state.rules.push(rule);
            created.push(rule.id);
          }
          t.byRule = rule.id;
        }
        t.list =
          t.effect === "read" || onItsOwn.includes(t.id)
            ? "on_its_own"
            : t.declared === "not_allowed"
              ? "never"
              : "asks_first";
      }
      f.rules = state.rules.filter((r) => r.flowId === flowId);
      f.lists = {
        onItsOwn: f.touches.filter((t) => t.list === "on_its_own").map((t) => t.id),
        asksFirst: f.touches.filter((t) => t.list === "asks_first").map((t) => t.id),
        never: f.touches.filter((t) => t.list === "never").map((t) => t.id),
      };
      f.confirmed = { hash, at: now() };
      f.summary.state = "confirmed";
      audit("flow_confirmed", { flowId });
      return { flow: f, rules: { created, kept, ended } };
    },
    "flows.setSchedule": ({ flowId, hash, schedule }) => {
      const f = flow(flowId);
      if (f.hash !== hash) throw new RunnerError("conflict", "Hash mismatch.", { reason: "hash_mismatch" });
      if (f.summary.state !== "confirmed" || f.confirmed?.hash !== hash)
        throw new RunnerError("not_allowed", "Flow not confirmed.", { reason: "flow_not_confirmed" });
      if (schedule.type === "after") {
        if (schedule.afterFlowId === flowId)
          throw new RunnerError("invalid_input", "Self schedule.", { reason: "schedule_self" });
        if (!state.flows.some((item) => item.summary.id === schedule.afterFlowId))
          throw new RunnerError("invalid_input", "Missing target.", { reason: "schedule_target_missing" });
        let next: string | undefined = schedule.afterFlowId;
        const visited = new Set([flowId]);
        while (next) {
          if (visited.has(next))
            throw new RunnerError("invalid_input", "Schedule loop.", { reason: "schedule_loop" });
          visited.add(next);
          next = state.flows.find((item) => item.summary.id === next)?.summary.schedule.afterFlow?.id;
        }
      }
      const needsAnswers = f.inputs.some((i) => i.required && !i.default && !i.remembered);
      if (schedule.type !== "manual" && schedule.whenItsTime === "last" && needsAnswers)
        throw new RunnerError("invalid_input", "Answers incomplete.", { reason: "last_answers_incomplete" });
      const view: import("@flowdriven/contracts").ScheduleView = {
        type: schedule.type,
        whenItsTime: schedule.type === "manual" ? "ask" : (schedule.whenItsTime ?? "ask"),
        needsAnswers,
        canUseLast: !needsAnswers,
        ...("time" in schedule ? { time: schedule.time } : {}),
        ...("day" in schedule ? { day: schedule.day } : {}),
        ...(schedule.type === "after"
          ? { afterFlow: { id: schedule.afterFlowId, name: flow(schedule.afterFlowId).summary.name } }
          : {}),
      };
      f.summary.schedule = view;
      audit("schedule_changed", { flowId });
      return { schedule: view };
    },
    "flows.tryNextRun": ({ flowId }) => {
      const f = flow(flowId);
      if (f.summary.schedule.type === "manual")
        throw new RunnerError("not_allowed", "No schedule.", { reason: "no_schedule" });
      const start = handlers["flows.start"]?.({ flowId, source: "flows" });
      if (!start) throw new RunnerError("unavailable", "Start unavailable.");
      return start;
    },
    "flows.delete": ({ flowId }) => {
      const f = flow(flowId);
      if (
        state.runs.some(
          (r) =>
            r.flowId === flowId && ["checking", "running", "retrying", "waiting_approval"].includes(r.state),
        )
      )
        throw new RunnerError("conflict", "Flow running.", { reason: "flow_running" });
      for (const r of state.runs.filter(
        (r) => r.flowId === flowId && ["queued", "needs_login", "blocked", "interrupted"].includes(r.state),
      ))
        handlers["runs.stop"]?.({ runId: r.id });
      const schedulesTurnedOff: string[] = [];
      for (const other of state.flows)
        if (other.summary.schedule.afterFlow?.id === flowId) {
          other.summary.schedule = {
            type: "manual",
            whenItsTime: "ask",
            needsAnswers: false,
            canUseLast: false,
          };
          schedulesTurnedOff.push(other.summary.id);
        }
      for (const rule of state.rules.filter((r) => r.flowId === flowId))
        handlers["rules.revoke"]?.({ ruleId: rule.id });
      for (const chat of state.chats)
        for (const m of chat.messages)
          if (m.card && "flowId" in m.card && m.card.flowId === flowId) m.card.state = "flow_deleted";
      for (const skill of state.skills) skill.usedBy = skill.usedBy.filter((item) => item.flowId !== flowId);
      state.flows.splice(state.flows.indexOf(f), 1);
      audit("flow_deleted", { flowId });
      return { deleted: true, schedulesTurnedOff };
    },
    "runs.stop": ({ runId }) => {
      const r = run(runId);
      const changed = [
        "queued",
        "checking",
        "running",
        "retrying",
        "waiting_approval",
        "needs_login",
      ].includes(r.state);
      if (changed) {
        r.state = "stopped";
        r.cause = { code: "stopped" };
        r.endedAt = now();
        r.canTryAgain = false;
        for (const step of r.steps)
          if (["running", "retrying", "waiting_approval"].includes(step.state)) step.state = "stopped";
        for (const d of state.decisions.filter((d) => d.runId === runId && d.state === "pending")) {
          d.state = "expired";
          d.resolvedAt = now();
          d.resolvedVia = "stop";
          d.canAlwaysAllow = false;
        }
        audit("run_stopped", {}, runId);
      }
      return { run: RunSummary.strip().parse(r), changed };
    },
    "approvals.resolveSimilar": ({ runId, group, approvalIds }) => {
      run(runId);
      expire();
      const decisions = state.decisions.filter(
        (d) => d.runId === runId && d.similarGroup === group && d.state === "pending",
      );
      if (decisions.length !== approvalIds.length || decisions.some((d) => !approvalIds.includes(d.id)))
        throw new RunnerError("conflict", "List changed.", {
          reason: "list_changed",
          params: { ids: decisions.map((d) => d.id).join(",") },
        });
      if (decisions.some((d) => d.kind !== "risky_action" || !["send", "post"].includes(d.riskyAction ?? "")))
        throw new RunnerError("not_allowed", "Not batchable.", { reason: "kind_not_batchable" });
      for (const d of decisions) handlers["approvals.resolve"]?.({ approvalId: d.id, decision: "approve" });
      audit("decisions_batch", { runId, count: decisions.length });
      return { decisions };
    },
    "rules.list": ({ flowId }) =>
      state.rules
        .filter((r) => !flowId || r.flowId === flowId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    "rules.revoke": ({ ruleId }) => {
      const active = state.rules.find((r) => r.id === ruleId);
      const rule = active ?? find(revokedRules, (r) => r.id === ruleId);
      if (active) {
        state.rules.splice(state.rules.indexOf(active), 1);
        revokedRules.push(active);
        const f = state.flows.find((item) => item.summary.id === rule.flowId);
        if (f) {
          f.rules = f.rules.filter((r) => r.id !== ruleId);
          const t = f.touches.find((item) => item.byRule === ruleId);
          if (t) {
            delete t.byRule;
            t.list = "asks_first";
            f.lists.onItsOwn = f.lists.onItsOwn.filter((id) => id !== t.id);
            if (!f.lists.asksFirst.includes(t.id)) f.lists.asksFirst.push(t.id);
          }
        }
        audit("rule_revoked", { ruleId, by: "ask_me_again" });
      }
      return { rule, changed: !!active };
    },
    "activity.summary": ({ filter, before, limit }) => {
      expire();
      const needsYou = state.decisions
        .filter((d) => d.state === "pending")
        .map((decision) => ({ kind: "decision" as const, decision }));
      const rows = state.runs
        .filter((r) => !before || r.startedAt < before)
        .map((r) => RunSummary.strip().parse(r))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const running = rows.filter((r) =>
        ["queued", "checking", "running", "retrying", "waiting_approval"].includes(r.state),
      );
      const earlier = rows
        .filter((r) =>
          filter === "finished"
            ? r.state === "done"
            : filter === "problems"
              ? ["failed", "blocked", "interrupted", "needs_login"].includes(r.state)
              : ["done", "failed", "blocked", "interrupted", "needs_login", "stopped"].includes(r.state),
        )
        .slice(0, limit ?? 200)
        .map((r) => ({ kind: "run" as const, run: r }));
      return { needsYou, needsYouCount: needsYou.length, running, earlier };
    },
    "search.query": ({ text }) => {
      const q = text.toLocaleLowerCase();
      const chats = state.chats
        .filter(
          (c) =>
            !q ||
            c.chat.title.toLocaleLowerCase().includes(q) ||
            c.messages.some(
              (m) =>
                (m.text ?? "").toLocaleLowerCase().includes(q) ||
                m.result?.lines.some((line) => line.toLocaleLowerCase().includes(q)),
            ),
        )
        .sort((a, b) => b.chat.updatedAt.localeCompare(a.chat.updatedAt))
        .slice(0, q ? 20 : 5)
        .map((c) => ({
          chatId: c.chat.id,
          title: c.chat.title,
          updatedAt: c.chat.updatedAt,
          outside: false,
        }));
      const flows = state.flows
        .filter((f) => !q || `${f.summary.name} ${f.summary.summary}`.toLocaleLowerCase().includes(q))
        .slice(0, q ? 50 : 200)
        .map((f) => ({ flowId: f.summary.id, name: f.summary.name, summary: f.summary.summary }));
      return { recent: !q, chats, flows };
    },
    "skills.list": () => state.skills,
    "skills.makeFlow": ({ skillId }) => {
      const skill = find(state.skills, (s) => s.id === skillId);
      const result = handlers["chats.create"]?.({});
      if (!result) throw new RunnerError("unavailable", "Chat unavailable.");
      const chat = find(state.chats, (c) => c.chat.id === result.chatId);
      chat.chat.subject = { kind: "skill" };
      const id = `message-fixture-${++state.counters.message}`;
      chat.messages.push({
        id,
        seq: 0,
        at: now(),
        role: "person",
        kind: "line",
        line: { key: "chat.makeFromSkill", params: { skill: skill.name } },
        outside: false,
      });
      return { chatId: result.chatId };
    },
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
          ["queued", "checking", "running", "waiting_approval", "retrying", "needs_login"].includes(r.state),
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
        if (
          [input.editedText, input.editedSubject ?? ""].some((text) =>
            /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(text),
          )
        )
          throw new RunnerError("invalid_input", "Hidden characters.", { reason: "hidden_characters" });
        d.editedText = input.editedText;
        if (input.editedSubject) d.editedSubject = input.editedSubject;
      }
      if (input.decision === "always_allow") {
        if (d.kind !== "risky_action" || d.effect !== "change")
          throw new RunnerError("not_allowed", "Always asks.", { reason: "always_asks" });
        const heldTouch = state.decisionTouches[d.id];
        if (
          !heldTouch ||
          !d.fixedPlace ||
          !d.place ||
          !d.flowId ||
          d.outside ||
          !["account", "folder"].includes(d.place.kind)
        )
          throw new RunnerError("not_allowed", "Place is not fixed.", { reason: "place_not_fixed" });
        const confirmedFlow = flow(d.flowId);
        const declared = confirmedFlow.manifest.touches?.find((item) => item.id === heldTouch.id);
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
            rule.touchId === heldTouch.id &&
            rule.effect === "change" &&
            rule.place.kind === d.place?.kind &&
            rule.place.value === d.place.value,
        );
        const rule = existing ?? {
          id: `rule-fixture-${++state.counters.start}`,
          flowId: d.flowId,
          touchId: heldTouch.id,
          sentence: heldTouch.sentence,
          effect: "change" as const,
          place: d.place,
          createdAt: now(),
          createdBy: "always_allow" as const,
        };
        if (!existing) state.rules.push(rule);
        const f = flow(d.flowId);
        if (!f.rules.some((item) => item.id === rule.id)) f.rules.push(rule);
        const touch = f.touches.find((item) => item.id === heldTouch.id);
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
        if (
          r.state === "waiting_approval" &&
          state.settings.agentPermission === "on" &&
          !state.decisions.some((a) => a.runId === r.id && a.state === "pending")
        )
          r.state = "running";
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
        if (
          r.state === "waiting_approval" &&
          state.settings.agentPermission === "on" &&
          !state.decisions.some((a) => a.runId === r.id && a.state === "pending")
        )
          r.state = "running";
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
