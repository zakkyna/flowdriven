import { parseExpression, references } from "../expr/parse.ts";
import { templateExpressions } from "../expr/template.ts";
import type { FlowManifest } from "../format/manifest.ts";
import type { Issue } from "../issues.ts";
export function checkRefs(
  text: string,
  path: string,
  template: boolean,
  manifest: FlowManifest,
  earlier: ReadonlySet<string>,
  variable?: string,
): Issue[] {
  const issues: Issue[] = [];
  try {
    const expressions = template ? templateExpressions(text) : [text];
    for (const source of expressions) {
      for (const segments of references(parseExpression(source))) {
        const root = segments.at(0);
        const name = segments.at(1);
        const stepId = root === "steps" ? name : root;
        const step = manifest.steps
          .flatMap((entry) => ("steps" in entry ? [entry, ...entry.steps] : [entry]))
          .find((entry) => entry.id === stepId);
        const member = segments.at(root === "steps" ? 2 : 1);
        const output = member === "outputs" ? segments.at(root === "steps" ? 3 : 2) : member;
        const memberValid =
          member === undefined ||
          ["status", "passed", "failed", "skipped"].includes(member) ||
          (member === "items" && step !== undefined && "steps" in step) ||
          (member === "outputs" && output === undefined) ||
          (step !== undefined &&
            "do" in step &&
            ((step.do === "ask" && output === "choice") || step.outputs.some((item) => item.id === output)));
        const valid =
          root === "params"
            ? name !== undefined && Object.hasOwn(manifest.params, name)
            : root === "inputs"
              ? name !== undefined && manifest.inputs.some((input) => input.id === name)
              : root === "steps"
                ? name !== undefined && earlier.has(name)
                : root === "trigger" || (root !== undefined && (root === variable || earlier.has(root)));
        const isStep =
          stepId !== undefined &&
          earlier.has(stepId) &&
          (root === "steps" || (root !== variable && root === stepId));
        if (!valid || (isStep && !memberValid))
          issues.push({
            severity: "error",
            code: "unknown_reference",
            path,
            message: `Unknown reference: ${segments.join(".")}`,
          });
      }
    }
  } catch (error) {
    issues.push({
      severity: "error",
      code: "expression_syntax",
      path,
      message: error instanceof Error ? error.message : "Invalid expression",
    });
  }
  return issues;
}
