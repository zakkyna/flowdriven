import { type Scope, stepView, type Value } from "@flowdriven/sdk";
import type { RunRow, StepRow } from "../storage.ts";
export function makeScope(run: RunRow, rows: StepRow[]): Scope {
  const steps = Object.fromEntries(
    rows
      .filter(
        (r) => r.itemKey === "" && (r.state === "passed" || r.state === "skipped" || r.state === "failed"),
      )
      .map((r) => [r.stepId, stepView(r.state, r.outputs)]),
  ) as Record<string, Value>;
  return {
    ...steps,
    steps,
    params: run.params,
    inputs: run.inputs,
    trigger: run.trigger ?? { kind: "manual" },
  };
}
