import {
  type FlowManifest,
  type LeafStep,
  parseExpression,
  references,
  templateExpressions,
} from "@flowdriven/sdk";
import type { RunRow, StepRow } from "../storage.ts";
import { ownedNow } from "./own-text.ts";

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
  return takesOutside(template, stepId, manifest, run, itemKey, rows, true);
}

function takesOutside(
  template: string,
  stepId: string,
  manifest: FlowManifest,
  run: RunRow,
  itemKey: string,
  rows: StepRow[],
  allowOwned: boolean,
): boolean {
  const marked = (id: string, key: string) =>
    rows.some(
      (r) =>
        r.runId === run.id &&
        r.stepId === id &&
        r.itemKey === key &&
        r.outside === true &&
        (!allowOwned || !ownedNow(r)),
    );
  const home = manifest.steps.find((s) => "for_each" in s && s.steps.some((nested) => nested.id === stepId));
  const sameLoop = home !== undefined && "for_each" in home ? home.steps.map((s) => s.id) : [];
  let paths: string[][];
  try {
    paths = templateExpressions(template).flatMap((source) => references(parseExpression(source)));
  } catch {
    return rows.some((r) => r.runId === run.id && r.outside === true);
  }
  for (const path of paths) {
    const first = path.at(0);
    if (home && "for_each" in home && first === home.as) {
      if (takesOutside(home.for_each, home.id, manifest, run, "", rows, false)) return true;
      continue;
    }
    if (first === "trigger") {
      if (run.trigger && run.trigger.kind !== "manual" && run.trigger.kind !== "schedule") return true;
      continue;
    }
    const viaSteps = first === "steps";
    const id = viaSteps ? path.at(1) : path.at(0);
    const rest = viaSteps ? path.slice(2) : path.slice(1);
    if (id === undefined || (!viaSteps && SCOPE_NAMES.has(id))) continue;
    if (STATUS_KEYS.has(rest.at(0) ?? "")) continue;
    if (!viaSteps && itemKey !== "" && sameLoop.includes(id)) {
      if (marked(id, itemKey)) return true;
      continue;
    }
    const top = manifest.steps.find((s) => s.id === id);
    if (!top) {
      if (
        viaSteps &&
        manifest.steps.some((s) => "for_each" in s && s.steps.some((nested) => nested.id === id))
      )
        return true;
      continue;
    }
    if ("for_each" in top) {
      if (takesOutside(top.for_each, top.id, manifest, run, "", rows, false)) return true;
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

export function checkTexts(checks: LeafStep["checks"]): string[] {
  return checks.flatMap((check) => {
    if (check.type === "contains" || check.type === "not_contains")
      return [...(check.pattern === undefined ? [] : [check.pattern]), ...(check.patterns ?? [])];
    if (check.type === "files") return check.paths;
    return [];
  });
}

export function stepTakesOutsideText(
  step: LeafStep,
  manifest: FlowManifest,
  run: RunRow,
  itemKey: string,
  rows: StepRow[],
): boolean {
  const texts = [...("instructions" in step ? [step.instructions] : []), ...checkTexts(step.checks)];
  return texts.some((text) => takesOutsideText(text, step.id, manifest, run, itemKey, rows));
}
