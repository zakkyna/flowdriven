import {
  FlowDetail,
  FlowManifest,
  FlowSummary,
  isReady,
  ReadinessReport,
  Settings,
} from "@flowdriven/contracts";
import {
  type Check,
  type LeafStep,
  FlowManifest as SdkManifest,
  type Step,
  type Trigger,
} from "@flowdriven/sdk";
import type { FlowRow, RunRow, StepRow } from "../storage.ts";

export function coreVersion(version: string): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error("Invalid version");
  return `${match[1]}.${match[2]}.${match[3]}`;
}
export function describeCheck(check: Check): string {
  switch (check.type) {
    case "command":
      return `Runs ${[check.cmd, ...check.args].join(" ")}`.trim();
    case "files":
      return `Files exist: ${check.paths.join(", ")}`;
    case "schema":
      return `Matches ${check.file}`;
    case "contains":
      return `Contains ${(check.patterns ?? [check.pattern ?? ""]).join(", ")}`;
    case "not_contains":
      return `Does not contain ${(check.patterns ?? [check.pattern ?? ""]).join(", ")}`;
    case "judge":
      return `A reviewer approves it (${check.rubric})`;
    case "user":
      return "You approve the result";
    case "probe":
      return `${check.tool} answers`;
  }
}
function leaf(step: LeafStep) {
  return {
    ...step,
    title: step.title ?? step.id,
    instructions: "instructions" in step ? step.instructions : step.do === "ask" ? step.ask.question : "",
    checks:
      step.do === "ask"
        ? []
        : step.checks.map((check) => ({
            type: check.type,
            required: check.required,
            summary: check.summary ?? describeCheck(check),
            ...("of" in check && check.of !== undefined ? { of: check.of } : {}),
            ...(check.type === "command" ? { cmd: check.cmd, args: check.args } : {}),
          })),
  };
}
function stepModel(step: Step) {
  if ("do" in step) return leaf(step);
  return {
    id: step.id,
    title: step.title ?? step.id,
    do: "loop" as const,
    instructions: "",
    when: step.when,
    uses: [],
    outputs: [],
    checks: [],
    retry: 0,
    loop: {
      for_each: step.for_each,
      as: step.as,
      key: step.key,
      max: step.max,
      on_item_fail: step.on_item_fail,
      steps: step.steps.map(leaf),
    },
  };
}
function triggerSummary(t: Trigger): string {
  switch (t.kind) {
    case "manual":
      return "Run by hand";
    case "schedule":
      if ((t.every === undefined) === (t.at === undefined)) throw new Error("Invalid schedule");
      return `${t.every !== undefined ? `Every ${t.every}` : `At ${t.at}`}${t.days ? ` on ${t.days.join(", ")}` : ""}`;
    case "new_item":
      return `New item from ${t.source} every ${t.every}`;
    case "file_change":
      return `Files change in ${t.path}`;
    case "link":
      return "Opened from a link";
    case "webhook":
      return "Called by a webhook";
    case "flow_done":
      return `After ${t.flow}`;
  }
}
export function toFlowManifest(manifest: SdkManifest): FlowManifest {
  return FlowManifest.parse({
    ...manifest,
    version: coreVersion(manifest.version),
    requirements: manifest.requirements.map((r) => ({ ...r, ref: r.ref ?? r.id, routes: r.routes ?? [] })),
    defaults: {
      ...manifest.defaults,
      worker: manifest.defaults.worker === undefined ? undefined : { prefer: [manifest.defaults.worker] },
    },
    inputs: manifest.inputs.map((input) => {
      const { default: value, ...rest } = input;
      return typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
        ? { ...rest, default: value }
        : rest;
    }),
    triggers: manifest.triggers.map((t) => ({ kind: t.kind, summary: triggerSummary(t) })),
    steps: manifest.steps.map(stepModel),
  });
}
function manifestOf(row: FlowRow): SdkManifest {
  return SdkManifest.parse(row.manifest);
}
export function toFlowSummary(row: FlowRow, runs: RunRow[]): FlowSummary {
  const m = manifestOf(row);
  const last = runs
    .filter((r) => r.flowId === row.id)
    .reduce<RunRow | undefined>((a, b) => (!a || b.startedAt >= a.startedAt ? b : a), undefined);
  return FlowSummary.parse({
    id: m.id,
    name: m.name,
    summary: m.summary,
    version: coreVersion(m.version),
    kind: m.kind,
    saved: true,
    signOff: { state: "approved", version: coreVersion(m.version) },
    stepCount: m.steps.length,
    lastRun: last && { runId: last.id, state: last.state, startedAt: last.startedAt },
  });
}
export function toFlowDetail(row: FlowRow, runs: RunRow[], lastRunSteps: StepRow[]): FlowDetail {
  const m = manifestOf(row);
  const summary = toFlowSummary(row, runs);
  const all = m.steps.flatMap((s) => ("do" in s ? [s] : s.steps));
  return FlowDetail.parse({
    manifest: toFlowManifest(m),
    hash: row.hash,
    saved: true,
    signOff: summary.signOff,
    playback: {
      goal: m.summary || m.name,
      touches: m.requirements.map((r) => r.ref ?? r.id),
      asksApprovalFor: all.flatMap((s) => [
        ...(s.do === "ask" ? [s.ask.question] : []),
        ...(s.checks.some((c) => c.type === "user") ? [`Approving the result of "${s.title ?? s.id}"`] : []),
      ]),
    },
    conversation: [],
    canUndo: false,
    stepStatus: Object.fromEntries(
      m.steps.map((s) => [
        s.id,
        lastRunSteps.find((r) => r.stepId === s.id && r.itemKey === "" && r.runId === summary.lastRun?.runId)
          ?.state ?? "pending",
      ]),
    ),
  });
}
export function toReadinessReport(row: FlowRow, checkedAt: string): ReadinessReport {
  const m = manifestOf(row);
  const items = m.requirements.map((r) => ({
    requirementId: r.id,
    name: r.ref ?? r.id,
    type: r.type,
    why: r.why,
    required: r.required,
    sensitive: r.sensitive,
    state: "unchecked" as const,
    detail: "Not checked yet. Checking requirements arrives with the readiness engine.",
    route: { via: "FlowDriven", risk: "official" as const },
    autoInstall: "guided" as const,
    guide: { steps: ["Nothing to do yet."], commands: [], verified: false },
    checkedAt,
  }));
  return ReadinessReport.parse({ flowId: m.id, flowName: m.name, checkedAt, ready: isReady(items), items });
}
export function defaultSettings(now: string): Settings {
  return Settings.parse({
    brain: { main: null, subscriptionOrder: [], apiKeyOrder: [] },
    backends: [],
    budget: { month: now.slice(0, 7), capUsd: 0, perRunCapUsd: null, spentUsd: 0 },
    offerSaveOneTime: true,
  });
}
