import type { Check, Value } from "@flowdriven/sdk";
import type { HarnessAdapter } from "../harness.ts";
import type { CheckOutcome } from "../storage.ts";
import type { CommandRunner } from "./command.ts";
import { matchFiles } from "./glob.ts";
import { validateJsonSchema } from "./json-schema.ts";

export type { CommandRunner } from "./command.ts";
export type CheckContext = {
  runId: string;
  stepId: string;
  itemKey: string;
  folder: string;
  files: ReadonlyMap<string, string>;
  declaredOutputs: string[];
  output: { text: string; values: Record<string, Value> };
  bind: (text: string) => string;
  harness: HarnessAdapter;
  signal: AbortSignal;
  runCommand: CommandRunner;
};
export async function runChecks(checks: Check[], ctx: CheckContext): Promise<CheckOutcome[]> {
  const outcomes: (CheckOutcome | undefined)[] = new Array(checks.length);
  let failed = false;
  const order = ["command", "files", "schema", "contains", "not_contains", "judge", "probe", "user"];
  for (const group of [order.slice(0, 5), order.slice(5, 7), order.slice(7)]) {
    for (const [i, c] of checks.entries()) {
      if (!group.includes(c.type)) continue;
      const base = { type: c.type, required: c.required, summary: c.summary ?? c.type };
      if (failed && group !== undefined && (c.type === "judge" || c.type === "probe" || c.type === "user")) {
        outcomes[i] = { ...base, summary: "not run: an earlier check failed", verdict: "pending" };
        continue;
      }
      let verdict: CheckOutcome["verdict"] = "passed";
      let evidence: string | undefined;
      try {
        const name = c.of ?? (ctx.declaredOutputs.length === 1 ? ctx.declaredOutputs.at(0) : undefined);
        const value =
          name === undefined
            ? ctx.output.text
            : Object.hasOwn(ctx.output.values, name)
              ? ctx.output.values[name]
              : undefined;
        if (c.type === "contains" || c.type === "not_contains") {
          if (typeof value !== "string") throw new Error("check value is not text");
          const patterns = c.patterns ?? (c.pattern === undefined ? [] : [c.pattern]);
          if (!patterns.length) throw new Error("missing patterns");
          for (const pattern of patterns) {
            const p = ctx.bind(pattern);
            const offset = (c.ignore_case ? value.toLowerCase() : value).indexOf(
              c.ignore_case ? p.toLowerCase() : p,
            );
            if (c.type === "contains" && offset < 0) {
              verdict = "failed";
              evidence = `'${p}' not found`;
              break;
            }
            if (c.type === "not_contains" && offset >= 0) {
              verdict = "failed";
              evidence = `'${p}' at offset ${offset}`;
              break;
            }
          }
        } else if (c.type === "files") {
          const files = matchFiles(ctx.folder, c.paths.map(ctx.bind));
          if (
            (c.min_count !== undefined && files.length < c.min_count) ||
            (c.max_count !== undefined && files.length > c.max_count) ||
            files.some(
              (f) =>
                (c.min_bytes !== undefined && f.size < c.min_bytes) ||
                (c.max_bytes !== undefined && f.size > c.max_bytes),
            )
          ) {
            verdict = "failed";
            evidence = "file count or size outside bounds";
          }
        } else if (c.type === "schema") {
          const text = ctx.files.get(c.file);
          if (text === undefined) throw new Error(`missing schema ${c.file}`);
          const schema: unknown = JSON.parse(text);
          const schemaProblems = validateJsonSchema(schema, undefined);
          if (schemaProblems.length) throw new Error(schemaProblems.join("; "));
          const data: unknown = name === undefined ? JSON.parse(ctx.output.text) : value;
          if (data === undefined) throw new Error("missing output");
          const problems = validateJsonSchema(schema, data);
          if (problems.length) {
            verdict = "failed";
            evidence = problems.join("; ");
          }
        } else if (c.type === "command") {
          const result = await ctx.runCommand(c.cmd, c.args, {
            cwd: ctx.folder,
            timeoutMs: 30 * 60 * 1000,
            signal: ctx.signal,
          });
          if (result.code !== 0) {
            verdict = "failed";
            evidence = result.stderr.slice(-2000);
          }
        } else if (c.type === "judge") {
          const rubric = ctx.files.get(c.rubric);
          if (rubric === undefined) throw new Error(`missing rubric ${c.rubric}`);
          const result = await ctx.harness.judge({
            runId: ctx.runId,
            stepId: ctx.stepId,
            rubric,
            output: typeof value === "string" ? value : JSON.stringify(value),
            signal: ctx.signal,
          });
          verdict = result.evidence ? result.verdict : "failed";
          evidence = result.evidence || "the judge quoted no evidence";
        } else if (c.type === "probe") {
          const result = await ctx.harness.probe({
            runId: ctx.runId,
            stepId: ctx.stepId,
            tool: c.tool,
            args: c.args as Record<string, Value>,
          });
          verdict = result.ok ? "passed" : "failed";
          evidence = result.detail;
        } else if (c.type === "user") verdict = "pending";
        else throw new Error("unsupported check");
      } catch (error) {
        verdict = "failed";
        evidence = error instanceof Error ? error.message : "check failed";
      }
      outcomes[i] = { ...base, verdict, ...(evidence === undefined ? {} : { evidence }) };
      if (c.required && verdict === "failed" && order.slice(0, 5).includes(c.type)) failed = true;
    }
  }
  return outcomes.map((o) => {
    if (!o) throw new Error("unsupported check");
    return o;
  });
}
