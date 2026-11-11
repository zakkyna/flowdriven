import { type FlowManifest, type LoopStep, type Scope, stepView, type Value } from "@flowdriven/sdk";
import type { ItemRow, RunRow, StepRow } from "../storage.ts";

export function makeScope(run: RunRow, rows: StepRow[], manifest: FlowManifest, items: ItemRow[]): Scope {
  const steps = Object.fromEntries(
    manifest.steps.flatMap((step) => {
      const row = rows.find((r) => r.stepId === step.id && r.itemKey === "");
      if (!row || !["passed", "skipped", "failed"].includes(row.state)) return [];
      const view = stepView(row.state, row.outputs);
      if (!("for_each" in step) || view === null || typeof view !== "object" || Array.isArray(view))
        return [[step.id, view]];
      const loopItems = items
        .filter((item) => item.loopId === step.id)
        .map((item) => ({
          key: item.key,
          item: item.item,
          status: item.status,
          steps: Object.fromEntries(
            step.steps.flatMap((nested) => {
              const found = rows.find((r) => r.stepId === nested.id && r.itemKey === item.key);
              return found && item.note !== "skipped: duplicate key"
                ? [[nested.id, { status: found.state, outputs: found.outputs }]]
                : [];
            }),
          ),
        }));
      return [[step.id, { ...view, items: loopItems }]];
    }),
  ) as Record<string, Value>;
  return {
    ...steps,
    steps,
    params: run.params,
    inputs: run.inputs,
    trigger: run.trigger ?? { kind: "manual" },
  };
}
export function itemScope(scope: Scope, loop: LoopStep, item: Value, rows: StepRow[], key: string): Scope {
  const nested = Object.fromEntries(
    loop.steps.flatMap((step) => {
      const row = rows.find((r) => r.stepId === step.id && r.itemKey === key);
      return row && ["passed", "skipped", "failed"].includes(row.state)
        ? [[step.id, stepView(row.state, row.outputs)]]
        : [];
    }),
  ) as Record<string, Value>;
  return { ...scope, [loop.as]: item, ...nested };
}
