import type { FlowManifest } from "../format/manifest.ts";
import type { Requirement } from "../format/requirements.ts";
import type { Step } from "../format/steps.ts";
import type { Issue } from "../issues.ts";
import { checkRefs } from "./refs.ts";
import { commandAllowed } from "./risky.ts";
import { unattendedRisk } from "./unattended.ts";

const reserved = new Set([
  "and",
  "or",
  "not",
  "in",
  "where",
  "true",
  "false",
  "null",
  "params",
  "inputs",
  "steps",
  "trigger",
]);
const outputReserved = new Set([
  ...reserved,
  "status",
  "passed",
  "failed",
  "skipped",
  "outputs",
  "items",
  "choice",
]);
function toolExists(req: Requirement | undefined, tool: string | undefined): boolean {
  return req !== undefined && tool !== undefined && "tools" in req && (req.tools ?? []).includes(tool);
}
export function hasErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
export function validateManifest(
  manifest: FlowManifest,
  options: { files?: ReadonlySet<string> } = {},
): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, severity: Issue["severity"] = "error") =>
    issues.push({ code, path, severity, message: code.replaceAll("_", " ") });
  const ids = new Set<string>();
  const reqIds = new Set<string>();
  manifest.requirements.forEach((req, i) => {
    if (reqIds.has(req.id)) add("duplicate_id", `requirements.${i}`);
    reqIds.add(req.id);
  });
  const requirement = (id: string | undefined) => manifest.requirements.find((req) => req.id === id);
  const checkFile = (file: string, path: string) => {
    if (options.files && !options.files.has(file)) add("missing_file", path);
  };
  manifest.triggers.forEach((trigger, i) => {
    if (trigger.kind === "webhook") checkFile(trigger.schema, `triggers.${i}.schema`);
  });
  let beforeAsk = manifest.triggers.some((trigger) => trigger.kind !== "manual");
  const last = manifest.steps.at(-1);
  const lastLeaf = last && "steps" in last ? last.steps.at(-1) : last;
  const needsUser =
    manifest.kind === "light" &&
    lastLeaf !== undefined &&
    !(lastLeaf.do === "ask" && last === lastLeaf) &&
    !lastLeaf.checks.some((check) => check.type === "user" && check.required);
  const walk = (steps: Step[], prefix: string, earlier: Set<string>, variable?: string) => {
    steps.forEach((step, i) => {
      const path = `${prefix}.${i}`;
      const leaf = "do" in step ? step : undefined;
      if (leaf) {
        const required = leaf.checks.filter((check) => check.required);
        if (leaf.do !== "ask" && required.length === 0) add("no_required_check", path);
        if (required.length > 0 && required.every((check) => check.type === "judge"))
          add("judged_only", path, "warning");
      }
      if (needsUser && step === lastLeaf) add("light_needs_user_check", path);
      if (leaf) {
        leaf.uses.forEach((id, k) => {
          if (!requirement(id)) add("unknown_requirement", `${path}.uses.${k}`);
        });
        if (
          leaf.do === "skill" &&
          (!leaf.uses.includes(leaf.skill) || requirement(leaf.skill)?.type !== "skill")
        )
          add("skill_requirement", path);
        if (leaf.do === "ask")
          leaf.ask.approves.forEach((value, k) => {
            const [id, tool, ...rest] = value.split(".");
            if (rest.length || !toolExists(requirement(id), tool))
              add("unknown_approves_tool", `${path}.ask.approves.${k}`);
          });
        leaf.checks.forEach((check, k) => {
          const cp = `${path}.checks.${k}`;
          if (
            check.type === "command" &&
            !leaf.uses.some((id) => {
              const req = requirement(id);
              return (
                req?.type === "cli_tool" &&
                (req.commands ?? []).some((entry) => commandAllowed(entry, check.cmd, check.args))
              );
            })
          )
            add("undeclared_command", `${cp}.cmd`);
          if (check.type === "probe") {
            const [id, tool] = check.tool.split(".");
            if (id === undefined || !leaf.uses.includes(id) || !toolExists(requirement(id), tool))
              add("undeclared_probe_tool", `${cp}.tool`);
          }
        });
        if (variable !== undefined && leaf.do === "ask") add("ask_in_loop", path);
      }
      if (ids.has(step.id)) add("duplicate_id", path);
      ids.add(step.id);
      if (reserved.has(step.id)) add("reserved_id", path);
      if ("steps" in step && reserved.has(step.as)) add("reserved_id", `${path}.as`);
      if (leaf)
        leaf.outputs.forEach((output, k) => {
          if (outputReserved.has(output.id)) add("reserved_id", `${path}.outputs.${k}`);
        });
      const ref = (
        text: string | undefined,
        sub: string,
        template = true,
        scope = earlier,
        current = variable,
      ) => {
        if (text !== undefined)
          issues.push(...checkRefs(text, `${path}.${sub}`, template, manifest, scope, current));
      };
      ref(step.when, "when", false);
      if ("steps" in step) {
        ref(step.for_each, "for_each");
        ref(step.key, "key", true, earlier, step.as);
        walk(step.steps, `${path}.steps`, new Set(earlier), step.as);
      } else if (leaf) {
        if ("instructions" in leaf) ref(leaf.instructions, "instructions");
        if (leaf.do === "ask") {
          ref(leaf.ask.question, "ask.question");
          ref(leaf.ask.choose_from, "ask.choose_from");
          if (typeof leaf.ask.max_pick === "string") ref(leaf.ask.max_pick, "ask.max_pick");
        }
        leaf.checks.forEach((check, k) => {
          const cp = `checks.${k}`;
          if (check.type === "files")
            check.paths.forEach((value, n) => {
              ref(value, `${cp}.paths.${n}`);
            });
          if (check.type === "contains" || check.type === "not_contains") {
            ref(check.pattern, `${cp}.pattern`);
            check.patterns?.forEach((value, n) => {
              ref(value, `${cp}.patterns.${n}`);
            });
          }
          if (check.type === "schema") checkFile(check.file, `${path}.${cp}.file`);
          if (check.type === "judge") checkFile(check.rubric, `${path}.${cp}.rubric`);
        });
        if (leaf.do === "ask") {
          if (leaf.when === undefined) beforeAsk = false;
        } else if (beforeAsk && unattendedRisk(leaf, manifest)) add("unattended_prefix", path);
      }
      earlier.add(step.id);
    });
  };
  walk(manifest.steps, "steps", new Set());
  return issues;
}
