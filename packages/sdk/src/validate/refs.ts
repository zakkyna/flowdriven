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
        const valid =
          root === "params"
            ? name !== undefined && Object.hasOwn(manifest.params, name)
            : root === "inputs"
              ? name !== undefined && manifest.inputs.some((input) => input.id === name)
              : root === "steps"
                ? name !== undefined && earlier.has(name)
                : root === "trigger" || (root !== undefined && (root === variable || earlier.has(root)));
        if (!valid)
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
