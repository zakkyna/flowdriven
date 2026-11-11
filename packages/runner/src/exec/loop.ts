import {
  evaluate,
  type FlowManifest,
  type LoopStep,
  resolveValue,
  type Scope,
  truthy,
} from "@flowdriven/sdk";
import type { ResolvedDeps } from "../engine.ts";
import type { ItemRow, RunRow } from "../storage.ts";
import { runLeaf } from "./leaf.ts";
import { itemScope } from "./scope.ts";

export async function runLoop(
  step: LoopStep,
  ctx: { deps: ResolvedDeps; run: RunRow; manifest: FlowManifest; scope: Scope },
): Promise<"passed" | "skipped" | "halt"> {
  const { deps, run, manifest, scope } = ctx;
  const { store, now } = deps;
  let row = store.getStep(run.id, step.id);
  const first = !row;
  row ??= {
    runId: run.id,
    stepId: step.id,
    itemKey: "",
    state: "pending",
    attempts: [],
    outputs: {},
    checks: [],
  };
  const block = (note: string) => {
    row.state = "failed";
    row.note = note;
    store.upsertStep(row);
    store.updateRun(run.id, { state: "blocked", blockedReason: note });
  };
  if (first) {
    try {
      if (step.when && !truthy(evaluate(step.when, scope))) {
        row.state = "skipped";
        row.note = "skipped: condition false";
        store.upsertStep(row);
        return "skipped";
      }
      const list = resolveValue(step.for_each, scope);
      if (!Array.isArray(list)) throw new Error("for_each is not a list.");
      const keys = new Set<string>();
      const cap = Math.min(
        step.max ?? Infinity,
        manifest.limits?.max_items ?? (manifest.triggers.some((t) => t.kind !== "manual") ? 20 : Infinity),
      );
      let eligible = 0,
        dropped = 0;
      const items: ItemRow[] = list.map((item, position) => {
        const value =
          step.key === undefined
            ? `#${position}`
            : resolveValue(step.key, itemScope(scope, step, item, [], ""));
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
          throw new Error("Loop key must resolve to a scalar value.");
        const key = String(value);
        if (!key) throw new Error("Loop key must not be empty.");
        const duplicate = keys.has(key);
        keys.add(key);
        let note: string | undefined;
        if (duplicate) note = "skipped: duplicate key";
        else if (step.key !== undefined && store.isSeen(run.flowId, step.id, key))
          note = "skipped: seen in an earlier run";
        else if (eligible++ >= cap) {
          note = "skipped: over the item cap";
          dropped++;
        }
        return {
          runId: run.id,
          loopId: step.id,
          key,
          position,
          item,
          status: note ? "skipped" : "pending",
          ...(note ? { note } : {}),
        };
      });
      store.transaction(() => {
        row.state = "running";
        store.upsertStep(row);
        for (const item of items) store.upsertItem(item);
        if (dropped)
          store.appendAudit({
            at: now().toISOString(),
            kind: "items_capped",
            runId: run.id,
            detail: { loop: step.id, dropped },
          });
      });
    } catch (e) {
      block(e instanceof Error ? e.message : "Invalid loop.");
      return "halt";
    }
  }
  const items = store.listItems(run.id, step.id);
  for (const item of items) {
    if (item.status !== "pending" && item.status !== "running") continue;
    item.status = "running";
    store.upsertItem(item);
    let failed = false;
    for (const nested of step.steps) {
      const existing = store.getStep(run.id, nested.id, item.key);
      if (existing?.state === "passed" || existing?.state === "skipped") continue;
      const outcome = await runLeaf(nested, {
        deps,
        run,
        manifest,
        itemKey: item.key,
        scope: itemScope(scope, step, item.item, store.listSteps(run.id), item.key),
      });
      if (outcome === "halt") return "halt";
      if (outcome === "failed") {
        failed = true;
        break;
      }
    }
    if (failed) {
      item.status = "failed";
      store.upsertItem(item);
      if (step.on_item_fail === "stop") {
        for (const later of items.filter((i) => i.position > item.position && i.status === "pending")) {
          later.status = "skipped";
          later.note = "skipped: stopped after an item failed";
          store.upsertItem(later);
        }
        block(`Blocked at step "${step.title ?? step.id}": item ${item.key} failed.`);
        return "halt";
      }
      store.updateRun(run.id, { state: "running", blockedReason: undefined });
    } else {
      item.status = "passed";
      store.transaction(() => {
        store.upsertItem(item);
        if (step.key !== undefined) store.markSeen(run.flowId, step.id, item.key, now().toISOString());
      });
    }
  }
  row.state = "passed";
  store.upsertStep(row);
  return "passed";
}
