import {
  durationMs,
  evaluate,
  interpolate,
  type LeafStep,
  resolveValue,
  type Scope,
  truthy,
  type Value,
} from "@flowdriven/sdk";
import type { ResolvedDeps } from "../engine.ts";
import type { RunRow, StepRow } from "../storage.ts";

type AskStep = Extract<LeafStep, { do: "ask" }>;
type Option = { key: string; label: string; item: Value };
const record = (value: Value | undefined): value is { [key: string]: Value } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function runAsk(
  step: AskStep,
  ctx: { deps: ResolvedDeps; run: RunRow; scope: Scope },
): "passed" | "skipped" | "halt" | "end" {
  const {
    deps: { store, now, newId },
    run,
    scope,
  } = ctx;
  const row: StepRow = store.getStep(run.id, step.id) ?? {
    runId: run.id,
    stepId: step.id,
    itemKey: "",
    state: "pending",
    attempts: [],
    outputs: {},
    checks: [],
  };
  let writing = false;
  try {
    if (step.when && !truthy(evaluate(step.when, scope))) {
      writing = true;
      store.upsertStep({ ...row, state: "skipped", note: "skipped: condition false" });
      return "skipped";
    }
    const list = resolveValue(step.ask.choose_from, scope);
    if (!Array.isArray(list)) throw new Error("choose_from is not a list.");
    const maxPick =
      typeof step.ask.max_pick === "number" ? step.ask.max_pick : resolveValue(step.ask.max_pick, scope);
    if (typeof maxPick !== "number" || !Number.isSafeInteger(maxPick) || maxPick < 1)
      throw new Error("max_pick is not a whole number of at least 1.");
    const question = interpolate(step.ask.question, scope);
    const options: Option[] = list.map((element) => {
      const loopItem = record(element) && Object.hasOwn(element, "key") && Object.hasOwn(element, "item");
      const src = loopItem ? element.item : element;
      const key = loopItem ? element.key : record(src) && Object.hasOwn(src, "id") ? src.id : undefined;
      if ((typeof key !== "string" && typeof key !== "number") || !String(key) || src === undefined)
        throw new Error("Choice option must have a key.");
      const label =
        record(src) && Object.hasOwn(src, "title")
          ? src.title
          : record(src) && Object.hasOwn(src, "label")
            ? src.label
            : key;
      if (typeof label !== "string" && typeof label !== "number")
        throw new Error("Choice option label must be text or a number.");
      return { key: String(key), label: String(label), item: src };
    });
    if (new Set(options.map((o) => o.key)).size !== options.length)
      throw new Error("Choice option keys must be unique.");
    writing = true;
    if (!options.length) {
      if (run.trigger && run.trigger.kind !== "manual") {
        store.upsertStep({
          ...row,
          state: "passed",
          outputs: { choice: [] },
          note: "nothing to choose: the run ended here",
        });
        return "end";
      }
      store.upsertStep({ ...row, state: "passed", outputs: { choice: [] } });
      return "passed";
    }
    const pending = store
      .listApprovals({ runId: run.id, state: "pending" })
      .find((a) => a.kind === "ask" && a.stepId === step.id);
    if (!pending) {
      const createdAt = now();
      store.createApproval({
        id: newId("ap"),
        kind: "ask",
        runId: run.id,
        stepId: step.id,
        itemKey: "",
        summary: question,
        payload: { question, options, maxPick },
        maxPick,
        approves: step.ask.approves,
        onExpiry: step.ask.on_expiry,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + durationMs(step.ask.expires)).toISOString(),
        state: "pending",
      });
    }
    store.upsertStep({ ...row, state: "waiting_approval" });
    store.updateRun(run.id, { state: "waiting_approval" });
    return "halt";
  } catch (error) {
    if (writing) throw error;
    const note = error instanceof Error ? error.message : "Invalid choice.";
    store.upsertStep({ ...row, state: "failed", note });
    store.updateRun(run.id, { state: "blocked", blockedReason: note });
    return "halt";
  }
}
