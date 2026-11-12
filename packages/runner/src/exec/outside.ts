import { type FlowManifest, parseExpression, references, templateExpressions } from "@flowdriven/sdk";
import type { RunRow, StepRow } from "../storage.ts";

const STATUS_KEYS = new Set(["status", "passed", "failed", "skipped"]);
const SCOPE_NAMES = new Set(["steps", "params", "inputs", "trigger"]);
// True when the text takes a value of an earlier step whose row in this run is marked outside.
// It fails closed: an expression that cannot be read, or that names a step without a status key,
// counts as taking the step's text. A loop is read through all its items.
export function takesOutsideText(
  template: string,
  stepId: string,
  manifest: FlowManifest,
  run: RunRow,
  itemKey: string,
  rows: StepRow[],
): boolean {
  const marked = (id: string, key: string) =>
    rows.some((r) => r.runId === run.id && r.stepId === id && r.itemKey === key && r.outside === true);
  const home = manifest.steps.find((s) => "for_each" in s && s.steps.some((nested) => nested.id === stepId));
  const sameLoop = home !== undefined && "for_each" in home ? home.steps.map((s) => s.id) : [];
  let paths: string[][];
  try {
    paths = templateExpressions(template).flatMap((source) => references(parseExpression(source)));
  } catch {
    return rows.some((r) => r.runId === run.id && r.outside === true);
  }
  for (const path of paths) {
    const viaSteps = path.at(0) === "steps";
    const id = viaSteps ? path.at(1) : path.at(0);
    const rest = viaSteps ? path.slice(2) : path.slice(1);
    if (id === undefined || (!viaSteps && SCOPE_NAMES.has(id))) continue;
    if (STATUS_KEYS.has(rest.at(0) ?? "")) continue;
    if (!viaSteps && itemKey !== "" && sameLoop.includes(id)) {
      if (marked(id, itemKey)) return true;
      continue;
    }
    const top = manifest.steps.find((s) => s.id === id);
    if (!top) continue;
    if ("for_each" in top) {
      if (
        top.steps.some((nested) =>
          rows.some(
            (r) => r.stepId === nested.id && r.outside === true && r.runId === run.id && r.itemKey !== "",
          ),
        )
      )
        return true;
      continue;
    }
    if (marked(id, "")) return true;
  }
  return false;
}
