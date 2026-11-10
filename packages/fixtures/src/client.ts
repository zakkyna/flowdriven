import {
  approvalExpiresAt,
  attentionCount,
  type ChatMessage,
  type FlowDetail,
  type FlowEdit,
  type FlowSummary,
  firstUnpassedStep,
  isReady,
  isResumable,
  type OperationInput,
  type OperationName,
  type OperationOutput,
  operations,
  type RunDetail,
  type RunnerClient,
  RunnerError,
  type RunnerEvent,
  Settings,
  Step,
} from "@flowdriven/contracts";
import {
  buildEmpty,
  buildLong,
  buildStory,
  FIXTURE_NOW,
  type FixtureState,
  type FlowRecord,
  type Scenario,
} from "./state";

export const PREVIEW_AGENT_REPLY =
  "This preview runs on sample data, so I can't change the flow from chat yet. Use the step list for now.";
export interface FixtureRunnerClient extends RunnerClient {
  readonly state: FixtureState;
}

type Handlers = { [N in OperationName]: (input: OperationInput<N>) => OperationOutput<N> };

export function createFixtureRunnerClient(
  options: { scenario?: Scenario; now?: () => Date } = {},
): FixtureRunnerClient {
  const state = structuredClone(
    options.scenario === "empty" ? buildEmpty() : options.scenario === "long" ? buildLong() : buildStory(),
  );
  const now = () => (options.now?.() ?? new Date(FIXTURE_NOW)).toISOString();
  const listeners = new Set<(event: RunnerEvent) => void>();
  const find = <T>(items: T[], predicate: (item: T) => boolean, noun: string, id: string): T => {
    const item = items.find(predicate);
    if (!item) throw new RunnerError("not_found", `There is no ${noun} ${id}.`);
    return item;
  };
  const flow = (id: string) => find(state.flows, (f) => f.manifest.id === id, "flow", id);
  const run = (id: string) => find(state.runs, (r) => r.id === id, "run", id);
  const report = (id: string) => {
    flow(id);
    const result = state.readiness[id];
    if (!result) throw new RunnerError("not_found", `There is no flow ${id}.`);
    return result;
  };
  const newest = (id: string) =>
    state.runs
      .filter((r) => r.flowId === id)
      .sort(
        (a, b) =>
          b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id, undefined, { numeric: true }),
      )[0];
  const detail = (f: FlowRecord): FlowDetail => {
    const last = newest(f.manifest.id);
    return {
      manifest: f.manifest,
      hash: f.hash,
      saved: f.saved,
      signOff: f.signOff,
      playback: f.playback,
      conversation: f.conversation,
      stepStatus: Object.fromEntries(
        f.manifest.steps.map((s) => [s.id, last?.steps.find((r) => r.stepId === s.id)?.state ?? "pending"]),
      ),
      canUndo: f.history.length > 0,
    };
  };
  const summary = (f: FlowRecord): FlowSummary => {
    const last = newest(f.manifest.id);
    return {
      id: f.manifest.id,
      name: f.manifest.name,
      summary: f.manifest.summary,
      version: f.manifest.version,
      kind: f.manifest.kind,
      saved: f.saved,
      signOff: f.signOff,
      stepCount: f.manifest.steps.length,
      ...(last ? { lastRun: { runId: last.id, state: last.state, startedAt: last.startedAt } } : {}),
    };
  };
  const unique = (f: FlowRecord, base: string, suffixFirst = false) => {
    const used = new Set([...f.retiredStepIds, ...f.manifest.steps.map((s) => s.id)]);
    let id = base;
    let n = 2;
    if (suffixFirst) id = `${base}-${n++}`;
    while (used.has(id)) id = `${base}-${n++}`;
    return id;
  };
  const syncSignOff = (f: FlowRecord, before: FlowRecord["manifest"]) => {
    const pending = state.approvals.filter(
      (a) => a.flowId === f.manifest.id && a.kind === "flow_sign_off" && a.state === "pending",
    );
    const previousPatch =
      pending[0]?.payload.kind === "diff" ? pending[0].payload.files[0]?.patch : undefined;
    for (const a of pending) state.approvals.splice(state.approvals.indexOf(a), 1);
    if (f.signOff.state !== "stale") return;
    const at = now();
    const baseline = f.history.find(
      (h) => h.signOff.state === "approved" && h.signOff.version === f.signOff.version,
    )?.manifest;
    const patch = baseline
      ? `-${JSON.stringify(baseline)}\n+${JSON.stringify(f.manifest)}`
      : `${previousPatch ? `${previousPatch}\n` : `-${JSON.stringify(before)}\n`}+${JSON.stringify(f.manifest)}`;
    const number = Math.max(0, ...state.approvals.map((a) => Number(a.id.match(/^ap-(\d+)$/)?.[1] ?? 0))) + 1;
    state.approvals.push({
      id: pending[0]?.id ?? `ap-${String(number).padStart(4, "0")}`,
      kind: "flow_sign_off",
      flowId: f.manifest.id,
      flowName: f.manifest.name,
      summary: `Approve the changes to ${f.manifest.name} (version ${f.manifest.version})`,
      payload: { kind: "diff", files: [{ path: "flow.yaml", patch }] },
      editable: false,
      createdAt: at,
      expiresAt: approvalExpiresAt(at),
      state: "pending",
    });
  };
  const expireApprovals = () => {
    const at = now();
    let changed = false;
    for (const a of state.approvals) {
      if (a.state !== "pending" || a.expiresAt > at) continue;
      changed = true;
      a.state = "expired";
      a.resolvedAt = a.expiresAt;
      if (a.runId) {
        const r = run(a.runId);
        r.state = "failed";
        const step = r.steps.find((s) => s.stepId === a.stepId);
        if (step) {
          step.state = "failed";
          step.note = "The approval expired after 24 hours.";
        }
      }
    }
    if (changed)
      for (const listener of listeners) listener({ type: "changed", topics: ["approvals", "runs"] });
  };
  const update = (f: FlowRecord, edit: FlowEdit) => {
    if (edit.kind === "undo") {
      const before = structuredClone(f.manifest);
      const approvedVersion = f.signOff.state === "none" ? undefined : f.signOff.version;
      const previous = f.history.pop();
      if (!previous) throw new RunnerError("not_allowed", "Nothing to undo.");
      Object.assign(f, previous);
      if (approvedVersion && approvedVersion !== f.manifest.version)
        f.signOff = { state: "stale", version: approvedVersion };
      syncSignOff(f, before);
      return detail(f);
    }
    const steps = f.manifest.steps;
    const index = "stepId" in edit ? steps.findIndex((s) => s.id === edit.stepId) : -1;
    if ("stepId" in edit && index < 0) throw new RunnerError("not_found", `There is no step ${edit.stepId}.`);
    if (edit.kind === "move" && index === 0 && edit.direction === "up")
      throw new RunnerError("not_allowed", "The first step can't move up.");
    if (edit.kind === "move" && index === steps.length - 1 && edit.direction === "down")
      throw new RunnerError("not_allowed", "The last step can't move down.");
    if (edit.kind === "delete" && steps.length === 1)
      throw new RunnerError("not_allowed", "A flow needs at least one step.");
    if (edit.kind === "add" && !edit.title.trim())
      throw new RunnerError("invalid_input", "Step title cannot be empty.");
    const before = structuredClone(f.manifest);
    f.history.push(structuredClone({ manifest: f.manifest, hash: f.hash, signOff: f.signOff }));
    if (edit.kind === "add") {
      const slug =
        edit.title
          .trim()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "step";
      steps.push(
        Step.parse({
          id: unique(f, slug),
          title: edit.title.trim(),
          do: "worker",
          instructions: "",
          checks: [{ type: "user", required: true, summary: "You approve the result" }],
        }),
      );
    } else {
      const step = steps[index];
      if (!step) throw new Error("Missing validated step");
      if (edit.kind === "move") {
        steps.splice(index, 1);
        steps.splice(index + (edit.direction === "up" ? -1 : 1), 0, step);
      } else if (edit.kind === "duplicate") {
        steps.splice(index + 1, 0, {
          ...structuredClone(step),
          id: unique(f, step.id, true),
          title: `${step.title} (copy)`,
        });
      } else {
        steps.splice(index, 1);
        f.retiredStepIds.push(step.id);
      }
    }
    const version = f.manifest.version.split(".");
    f.manifest.version = `${version[0]}.${version[1]}.${Number(version[2]) + 1}`;
    f.hash = `sha256:${(state.nextHashNumber++).toString(16).padStart(64, "0")}`;
    if (f.signOff.state === "approved") f.signOff = { state: "stale", version: f.signOff.version };
    if (f.signOff.state === "stale") syncSignOff(f, before);
    return detail(f);
  };
  const handlers: Handlers = {
    "flows.list": () => state.flows.map(summary),
    "flows.get": ({ flowId }) => detail(flow(flowId)),
    "flows.build": ({ flowId, message }) => {
      const f = flowId ? flow(flowId) : undefined;
      const at = now();
      const count = f?.conversation.length ?? 0;
      const user: ChatMessage = { id: `message-${count + 1}`, role: "user", text: message, at };
      const reply: ChatMessage = { id: `message-${count + 2}`, role: "agent", text: PREVIEW_AGENT_REPLY, at };
      f?.conversation.push(user, reply);
      return { ...(f ? { flow: detail(f) } : {}), reply };
    },
    "flows.update": ({ flowId, edit }) => update(flow(flowId), edit),
    "flows.run": (input) => {
      if ("description" in input)
        throw new RunnerError("unavailable", "One-time flows arrive with the agent.");
      const f = flow(input.flowId);
      if (f.signOff.state !== "approved") {
        if (
          f.signOff.state === "stale" &&
          !state.approvals.some(
            (a) => a.flowId === f.manifest.id && a.kind === "flow_sign_off" && a.state === "pending",
          )
        ) {
          syncSignOff(f, f.history[0]?.manifest ?? f.manifest);
          for (const listener of listeners) listener({ type: "changed", topics: ["approvals"] });
        }
        throw new RunnerError("not_allowed", "This version needs your approval before it runs.");
      }
      const readiness = report(input.flowId);
      const count = attentionCount(readiness.items);
      const r: RunDetail = {
        id: `run-${String(state.nextRunNumber++).padStart(4, "0")}`,
        flowId: f.manifest.id,
        flowName: f.manifest.name,
        flowVersion: f.manifest.version,
        oneTime: false,
        project:
          input.inputs?.project ??
          state.runs.find((r) => r.flowId === f.manifest.id && r.project)?.project ??
          "~/Projects/sample",
        state: readiness.ready ? "queued" : "blocked",
        startedAt: now(),
        inputs: Object.entries(input.inputs ?? {}).map(([id, value]) => ({
          id,
          label: f.manifest.inputs.find((i) => i.id === id)?.label ?? id,
          value,
        })),
        steps: f.manifest.steps.map((s) => ({
          stepId: s.id,
          title: s.title,
          do: s.do,
          state: "pending",
          attempts: [],
          maxAttempts: s.retry + 1,
          checks: s.checks.map((c) => ({ ...c, verdict: "pending" })),
        })),
        approvalIds: [],
        outputs: [],
        usage: [],
        estimatedCostUsd: 0,
        ...(!readiness.ready ? { blockedReason: `Not ready: ${count} required items need attention.` } : {}),
      };
      state.runs.push(r);
      return r;
    },
    "runs.list": (input) =>
      state.runs
        .filter(
          (r) =>
            (input.flowId === undefined || r.flowId === input.flowId) &&
            (input.project === undefined || r.project === input.project) &&
            (input.state === undefined || r.state === input.state),
        )
        .sort(
          (a, b) =>
            b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id, undefined, { numeric: true }),
        ),
    "runs.status": ({ runId }) => run(runId),
    "runs.report": ({ runId }) => {
      const r = run(runId);
      if (!r.report) throw new RunnerError("unavailable", "The report appears when the run ends.");
      return r.report;
    },
    "runs.resume": ({ runId }) => {
      const r = run(runId);
      if (!isResumable(r.state))
        throw new RunnerError("not_allowed", "Only blocked, failed or interrupted runs can resume.");
      r.state = "running";
      const step = firstUnpassedStep(r);
      if (step) step.step.state = "running";
      delete r.blockedReason;
      return r;
    },
    "readiness.check": ({ flowId }) => ({ ...report(flowId), checkedAt: now() }),
    "readiness.install": ({ flowId, requirementId }) => {
      const r = report(flowId);
      const item = find(r.items, (i) => i.requirementId === requirementId, "requirement", requirementId);
      if (item.autoInstall !== "yes")
        throw new RunnerError("not_allowed", "This item can only be fixed by hand.");
      item.state = "ok";
      item.detail = "Sample data: nothing was installed.";
      r.ready = isReady(r.items);
      return r;
    },
    "approvals.list": ({ state: filter }) => {
      expireApprovals();
      return state.approvals
        .filter((a) => !filter || a.state === filter)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id, undefined, { numeric: true }),
        );
    },
    "approvals.resolve": ({ approvalId, decision, editedText, applyToSimilar }) => {
      expireApprovals();
      const approval = find(state.approvals, (a) => a.id === approvalId, "approval", approvalId);
      if (approval.state === "expired") throw new RunnerError("not_allowed", "This approval expired.");
      if (decision === "edit" && applyToSimilar)
        throw new RunnerError("not_allowed", "Edits apply to one approval only.");
      if (decision === "edit" && !editedText?.trim())
        throw new RunnerError("invalid_input", "Edited text cannot be empty.");
      if (approval.state !== "pending")
        throw new RunnerError("not_allowed", "This decision was already made.");
      const resolved =
        applyToSimilar && approval.similarGroup
          ? state.approvals.filter((a) => a.state === "pending" && a.similarGroup === approval.similarGroup)
          : [approval];
      if (
        decision === "edit" &&
        (editedText === undefined ||
          resolved.some((a) => !a.editable || !["email", "post", "text"].includes(a.payload.kind)))
      )
        throw new RunnerError("invalid_input", "Only text can be edited.");
      const at = now();
      for (const a of resolved) {
        if (decision === "edit" && editedText !== undefined) {
          if (a.payload.kind === "email") a.payload.body = editedText;
          else if (a.payload.kind === "post" || a.payload.kind === "text") a.payload.text = editedText;
        }
        a.state = decision === "reject" ? "rejected" : "approved";
        a.resolvedAt = at;
        if (a.kind === "flow_sign_off" && decision !== "reject") {
          const f = flow(a.flowId);
          f.signOff = { state: "approved", version: f.manifest.version };
        }
      }
      for (const a of resolved) {
        if (!a.runId) continue;
        const r = run(a.runId);
        const step = r.steps.find((s) => s.stepId === a.stepId);
        if (decision === "reject") {
          r.state = "failed";
          if (step) step.state = "failed";
        } else if (
          r.state === "waiting_approval" &&
          !state.approvals.some((pending) => pending.runId === r.id && pending.state === "pending")
        ) {
          r.state = "running";
          if (step?.state === "waiting_approval") step.state = "running";
        }
      }
      return resolved;
    },
    "harnesses.list": () => state.harnesses,
    "harnesses.rescan": () => state.harnesses,
    "harnesses.setConsent": ({ harnessId, consent }) => {
      const card = find(state.harnesses, (h) => h.id === harnessId, "harness", harnessId);
      if (!card.detected) throw new RunnerError("not_allowed", "This harness is not detected.");
      if (card.consent === "not_needed")
        throw new RunnerError("not_allowed", "This harness needs no consent.");
      const backendId =
        harnessId === "claude-code" ? "claude-cli" : harnessId === "antigravity" ? "agy-cli" : harnessId;
      const backend = state.settings.backends.find((b) => b.id === backendId);
      if (consent === "revoked" && state.settings.brain.main === backendId) {
        const fallback = [...state.settings.brain.subscriptionOrder, ...state.settings.brain.apiKeyOrder]
          .map((id) => state.settings.backends.find((b) => b.id === id))
          .find(
            (b) =>
              b && b.id !== backendId && b.available && (b.consent === "given" || b.consent === "not_needed"),
          );
        if (!fallback) throw new RunnerError("not_allowed", "No allowed fallback brain is available.");
        state.settings.brain.main = fallback.id;
      }
      card.consent = consent;
      if (backend) backend.consent = consent;
      return card;
    },
    "settings.get": () => state.settings,
    "settings.update": ({ patch }) => {
      const backend = (id: string) => {
        const b = state.settings.backends.find((item) => item.id === id);
        if (!b) throw new RunnerError("invalid_input", `Unknown brain ${id}.`);
        return b;
      };
      for (const [list, kind] of [
        [patch.brain?.subscriptionOrder, "harness"],
        [patch.brain?.apiKeyOrder, "api_key"],
      ] as const) {
        if (list && new Set(list).size !== list.length)
          throw new RunnerError("invalid_input", "Brain order cannot contain duplicates.");
        for (const id of list ?? []) {
          const b = backend(id);
          if (b.kind !== kind) throw new RunnerError("invalid_input", `${b.name} can't be in this list.`);
        }
      }
      if (patch.brain?.main !== undefined) {
        const b = backend(patch.brain.main);
        if (!b.available || (b.consent !== "not_needed" && b.consent !== "given"))
          throw new RunnerError("not_allowed", `${b.name} can't be the brain yet.`);
      }
      const next = structuredClone(state.settings);
      Object.assign(
        next.brain,
        Object.fromEntries(Object.entries(patch.brain ?? {}).filter(([, value]) => value !== undefined)),
      );
      Object.assign(
        next.budget,
        Object.fromEntries(Object.entries(patch.budget ?? {}).filter(([, value]) => value !== undefined)),
      );
      if (patch.offerSaveOneTime !== undefined) next.offerSaveOneTime = patch.offerSaveOneTime;
      state.settings = Settings.parse(next);
      return state.settings;
    },
  };
  return {
    state,
    async call<N extends OperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>> {
      const definition = operations[name];
      const parsed = definition.input.safeParse(input);
      if (!parsed.success)
        throw new RunnerError("invalid_input", parsed.error.issues[0]?.message ?? "Invalid input.");
      const handler = handlers[name] as (value: OperationInput<N>) => OperationOutput<N>;
      const output = definition.output.parse(handler(parsed.data as OperationInput<N>)) as OperationOutput<N>;
      if (definition.writes.length)
        for (const listener of listeners) listener({ type: "changed", topics: [...definition.writes] });
      return structuredClone(output);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
