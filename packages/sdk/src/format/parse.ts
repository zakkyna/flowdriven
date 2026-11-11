import "../config.ts";
import type { z } from "zod";
import type { Issue } from "../issues.ts";
import { FlowManifest } from "./manifest.ts";
import { LeafStep, LoopStep } from "./steps.ts";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function parseManifest(
  raw: unknown,
): { ok: true; manifest: FlowManifest } | { ok: false; issues: Issue[] } {
  const nested: Issue[] = [];
  if (object(raw) && Array.isArray(raw.steps))
    raw.steps.forEach((step: unknown, i: number) => {
      if (object(step) && Array.isArray(step.steps))
        step.steps.forEach((child: unknown, j: number) => {
          if (object(child) && (Object.hasOwn(child, "for_each") || Object.hasOwn(child, "steps")))
            nested.push({
              severity: "error",
              code: "nested_loop",
              path: `steps.${i}.steps.${j}`,
              message: "Nested loops are not supported",
            });
        });
    });
  if (nested.length) return { ok: false, issues: nested };
  const result = FlowManifest.safeParse(raw);
  if (result.success) return { ok: true, manifest: result.data };
  const issues: Issue[] = [];
  const add = (issue: z.core.$ZodIssue, prefix: PropertyKey[] = []) => {
    const path = [...prefix, ...issue.path];
    if (
      issue.code === "invalid_union" &&
      path.length === 2 &&
      path[0] === "steps" &&
      typeof path[1] === "number" &&
      object(raw) &&
      Array.isArray(raw.steps)
    ) {
      const step: unknown = raw.steps.at(path[1]);
      const branch = object(step) && Object.hasOwn(step, "for_each") ? LoopStep : LeafStep;
      const parsed = branch.safeParse(step);
      if (!parsed.success)
        parsed.error.issues.forEach((item) => {
          add(item, path);
        });
      return;
    }
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys)
        issues.push({
          severity: "error",
          code: "unknown_field",
          path: [...path, key].join("."),
          message: issue.message,
        });
      return;
    }
    issues.push({
      severity: "error",
      code: path.length === 1 && path[0] === "format" ? "unsupported_format" : "schema",
      path: path.join("."),
      message: issue.message,
    });
  };
  result.error.issues.forEach((issue) => {
    add(issue);
  });
  return { ok: false, issues };
}
