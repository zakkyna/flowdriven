import { FlowDetail, FlowSummary } from "@flowdriven/contracts";
import { FlowManifest as SdkManifest, type Trigger } from "@flowdriven/sdk";
import { flowState } from "../flow-state.ts";
import { placeTouches } from "../rules/standing.ts";
import type { FlowRow, Store } from "../storage.ts";
import { toFlowManifest } from "./map-flow-v1.ts";
import { toRunSummary } from "./map-run.ts";

export function coreVersion(version: string): string {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error("Invalid version");
  return `${match[1]}.${match[2]}.${match[3]}`;
}
export function triggerSummary(t: Trigger): string {
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
export function toFlowSummary(row: FlowRow, store: Store): FlowSummary {
  const manifest = SdkManifest.parse(row.manifest);
  const head = store.getFlowHead(row.id);
  const runs = store.listRuns({ flowId: row.id }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const last = runs[0];
  const schedule = store.getSchedule(row.id);
  const remembered = store.listRemembered(row.id).filter((item) => item.kind === "remember");
  const hasPending =
    store.listApprovals({ state: "pending" }).some((a) => runs.some((r) => r.id === a.runId)) ||
    store.listQuestions().some((q) => q.flowId === row.id && q.state === "open");
  return FlowSummary.parse({
    id: row.id,
    name: head?.name ?? manifest.name,
    summary: head?.summary ?? manifest.summary,
    state: flowState(store, row.id),
    live: hasPending ? "needs_you" : runs.some((r) => r.state === "running") ? "running" : null,
    steps: manifest.steps.map((s) => ({ id: s.id, title: s.title ?? s.id })),
    schedule: schedule
      ? {
          type: schedule.type,
          time: schedule.time,
          day: schedule.day,
          whenItsTime: schedule.whenItsTime,
          needsAnswers: false,
          canUseLast: false,
          ...(schedule.afterFlowId
            ? {
                afterFlow: {
                  id: schedule.afterFlowId,
                  name: store.getFlowHead(schedule.afterFlowId)?.name ?? schedule.afterFlowId,
                },
              }
            : {}),
        }
      : { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false },
    result: ("result" in manifest ? manifest.result?.kind : undefined) ?? "report",
    asksFor: manifest.inputs
      .filter(
        (i) =>
          i.required &&
          i.default === undefined &&
          !remembered.some((item) => item.inputId === i.id && i.type !== "date" && i.type !== "time"),
      )
      .map((i) => i.label),
    ...(last ? { lastRun: { runId: last.id, state: last.state, at: last.startedAt } } : {}),
    format: manifest.format,
    createdAt: head?.createdAt ?? row.registeredAt,
    ...(head?.origin.kind === "skill"
      ? { madeFromSkill: { skillId: head.origin.skillId, name: head.origin.skillId } }
      : {}),
  });
}

export function toFlowDetail(row: FlowRow, store: Store): FlowDetail {
  const manifest = SdkManifest.parse(row.manifest);
  const confirmation = store.getConfirmation(row.id);
  const active = store
    .listRules()
    .filter(
      (r) =>
        r.flowId === row.id &&
        r.state === "active" &&
        ["local_write", "run_command", "change"].includes(r.effect),
    );
  const touches = "touches" in manifest ? (manifest.touches ?? []) : [];
  const defaults = placeTouches(touches, {
    origin: store.getFlowHead(row.id)?.origin.kind === "market" ? "market" : "chat",
  });
  const lists = { onItsOwn: [] as string[], asksFirst: [] as string[], never: [] as string[] };
  const views = touches.map((touch) => {
    const rule = active.find(
      (r) =>
        r.touchId === touch.id &&
        r.effect === touch.effect &&
        r.place.kind === touch.place?.kind &&
        r.place.value === touch.place.value,
    );
    const alwaysAsks = ["send", "post", "pay", "delete", "merge"].includes(touch.effect);
    const list =
      touch.rule === "not_allowed"
        ? "never"
        : !alwaysAsks && (touch.effect === "read" || rule !== undefined)
          ? "on_its_own"
          : "asks_first";
    lists[list === "on_its_own" ? "onItsOwn" : list === "asks_first" ? "asksFirst" : "never"].push(touch.id);
    return {
      ...touch,
      declared: touch.rule,
      list,
      alwaysAsks,
      fixedPlace: touch.place !== undefined,
      ...(rule ? { byRule: rule.id } : {}),
    };
  });
  const remembered = store.listRemembered(row.id).filter((item) => item.kind === "remember");
  const inputs = manifest.inputs.map((i) => {
    const answer =
      i.type === "date" || i.type === "time" ? undefined : remembered.find((item) => item.inputId === i.id);
    return {
      id: i.id,
      label: i.label,
      type: i.type,
      required: i.required,
      example: "example" in i ? i.example : undefined,
      choices: "choices" in i ? i.choices : undefined,
      remember: "remember" in i ? i.remember : false,
      ...(answer ? { remembered: String(answer.value.value) } : {}),
      line: answer ? "remembers" : i.default !== undefined ? "default" : i.required ? "asks" : "optional",
      ...(i.default === undefined
        ? {}
        : {
            default:
              i.default === "today" && i.type === "date"
                ? { kind: "today" }
                : i.default === "now" && i.type === "time"
                  ? { kind: "now" }
                  : { kind: "value", value: String(i.default) },
          }),
    };
  });
  const previous =
    confirmation && confirmation.hash !== row.hash ? store.getFlow(row.id, confirmation.hash) : undefined;
  const changes: { sign: "+" | "-" | "~"; text: string }[] = [];
  if (previous) {
    const oldManifest = SdkManifest.parse(previous.manifest);
    const oldTouches = "touches" in oldManifest ? (oldManifest.touches ?? []) : [];
    for (const [before, after] of [
      [oldManifest.steps, manifest.steps],
      [oldTouches, touches],
    ] as const) {
      for (const item of before) {
        const next = after.find((candidate) => candidate.id === item.id);
        if (!next)
          changes.push({ sign: "-", text: "sentence" in item ? item.sentence : (item.title ?? item.id) });
        else if (JSON.stringify(item) !== JSON.stringify(next))
          changes.push({ sign: "~", text: "sentence" in next ? next.sentence : (next.title ?? next.id) });
      }
      for (const item of after) {
        if (!before.some((candidate) => candidate.id === item.id))
          changes.push({ sign: "+", text: "sentence" in item ? item.sentence : (item.title ?? item.id) });
      }
    }
  }
  const legacyManifest = toFlowManifest({ ...manifest, format: "flowdriven-flow/1.1", inputs: [] });
  return FlowDetail.parse({
    summary: toFlowSummary(row, store),
    description: manifest.description,
    hash: row.hash,
    ...(confirmation ? { confirmed: { hash: confirmation.hash, at: confirmation.at } } : {}),
    version: coreVersion(manifest.version),
    steps: manifest.steps.map((s) => ({
      id: s.id,
      title: s.title ?? s.id,
      kind: "do" in s ? s.do : "loop",
      asksFirst: "do" in s && s.do === "ask",
      judgedOnly:
        "do" in s && s.do !== "ask" && s.checks.length > 0 && s.checks.every((c) => c.type === "judge"),
    })),
    inputs,
    result: ("result" in manifest ? manifest.result : undefined) ?? { kind: "report" },
    touches: views.map(({ rule: _rule, covers: _covers, ...view }) => view),
    lists,
    confirmLists: defaults,
    rules: active.map(
      ({ id, flowId, touchId, sentence, effect, place, createdAt, createdBy, lastUsedAt }) => ({
        id,
        flowId,
        touchId,
        sentence,
        effect,
        place,
        createdAt,
        createdBy,
        ...(lastUsedAt ? { lastUsedAt } : {}),
      }),
    ),
    pinsNeeded: manifest.requirements
      .filter((r) => r.type === "path")
      .map((r) => ({
        requirementId: r.id,
        label: r.ref ?? r.id,
        access: r.type === "path" ? r.access : "read",
      })),
    ...(previous ? { changes } : {}),
    recentRuns: store
      .listRuns({ flowId: row.id })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 5)
      .map((r) => toRunSummary(r, manifest.name)),
    manifest: {
      ...legacyManifest,
      inputs: manifest.inputs,
      format: manifest.format,
      ...("touches" in manifest ? { touches: manifest.touches } : {}),
      ...("result" in manifest && manifest.result ? { result: manifest.result } : {}),
    },
  });
}
