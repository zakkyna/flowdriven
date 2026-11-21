import type { FlowManifest } from "../format/manifest.ts";
import type { Requirement } from "../format/requirements.ts";
import type { Step } from "../format/steps.ts";
import type { Issue } from "../issues.ts";
import { isValidHost, parseTemplate } from "../web/template.ts";
import { hasHiddenText } from "./hidden.ts";
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
  if (manifest.format === "flowdriven-flow/1.2") {
    if (manifest.schedule?.type === "after" && manifest.schedule.afterFlowId === manifest.id)
      add("schedule_self", "schedule.afterFlowId");
    const hidden = (value: string | undefined, path: string) => {
      if (value !== undefined && hasHiddenText(value)) add("hidden_text", path);
    };
    hidden(manifest.name, "name");
    manifest.inputs.forEach((input, i) => {
      hidden(input.label, `inputs.${i}.label`);
      hidden(input.example, `inputs.${i}.example`);
      input.choices?.forEach((choice, j) => {
        hidden(choice.key, `inputs.${i}.choices.${j}.key`);
        hidden(choice.label, `inputs.${i}.choices.${j}.label`);
      });
    });
    manifest.touches?.forEach((touch, i) => {
      const path = `touches.${i}`;
      hidden(touch.sentence, `${path}.sentence`);
      if (touch.place) {
        hidden(touch.place.label, `${path}.place.label`);
        hidden(touch.place.value, `${path}.place.value`);
        if (
          (touch.place.kind === "account" || touch.place.kind === "folder") &&
          !manifest.requirements.some(
            (req) => req.id === touch.place?.value && (touch.place.kind !== "folder" || req.type === "path"),
          )
        )
          add("touch_place_undeclared", `${path}.place`);
        if (touch.rule === "not_allowed") add("touch_never_has_place", path, "warning");
      }
      if (touch.rule === "runs_alone" && ["send", "post", "pay", "delete", "merge"].includes(touch.effect))
        add("risky_claims_runs_alone", path, "warning");
    });
    const outputs = new Set(manifest.outputs.map((output) => output.id));
    for (const step of manifest.steps) {
      const leaves = "steps" in step ? step.steps : [step];
      for (const leaf of leaves) for (const output of leaf.outputs) outputs.add(output.id);
    }
    const checkLines = (lines: string[], prefix: string) =>
      lines.forEach((line, i) => {
        const path = `${prefix}[${i}]`;
        hidden(line, path);
        let rest = line;
        while (rest.includes("{") || rest.includes("}")) {
          const match = /^[^{}]*\{([^{}]+)\}/.exec(rest);
          if (!match) {
            add("answer_bad_placeholder", path);
            break;
          }
          const key = match[1] ?? "";
          if (
            !(
              manifest.inputs.some((input) => input.id === key) ||
              (key.startsWith("outputs.") && outputs.has(key.slice(8)))
            )
          )
            add("answer_unknown_placeholder", path);
          rest = rest.slice(match[0].length);
        }
      });
    const answer = manifest.result?.answer;
    if (Array.isArray(answer)) checkLines(answer, "result.answer");
    else if (answer)
      for (const [lang, lines] of Object.entries(answer)) checkLines(lines, `result.answer.${lang}`);
  }
  for (const [id, param] of Object.entries(manifest.params)) {
    const value = param.default;
    if (value === undefined) continue;
    const valid =
      (param.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (param.type === "text" && typeof value === "string") ||
      (param.type === "bool" && typeof value === "boolean") ||
      (param.type === "enum" && typeof value === "string" && (param.options ?? []).includes(value));
    if (!valid) add("param_default_type", `params.${id}.default`);
    else if (
      (typeof value === "number" &&
        ((param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))) ||
      (param.type !== "enum" &&
        param.options !== undefined &&
        (typeof value !== "string" || !param.options.includes(value)))
    )
      add("param_default_range", `params.${id}.default`);
  }
  const ids = new Set<string>();
  const reqIds = new Set<string>();
  manifest.requirements.forEach((req, i) => {
    if (reqIds.has(req.id)) add("duplicate_id", `requirements.${i}`);
    reqIds.add(req.id);
    if (req.type === "path" && req.per_item) {
      if (!req.ref?.startsWith("~/")) add("per_item_ref", `requirements.${i}.ref`);
      if (req.access !== "read_write") add("per_item_access", `requirements.${i}.access`);
    }
    if (req.type !== "web") return;
    const path = `requirements.${i}`;
    if ((req.url_patterns?.length ?? 0) > 8) add("web_template_count", `${path}.url_patterns`);
    if ((req.domains?.length ?? 0) > 8) add("web_domain_count", `${path}.domains`);
    req.domains?.forEach((domain, k) => {
      if (!isValidHost(domain)) add("web_domain_invalid", `${path}.domains.${k}`);
    });
    if (req.session !== "own" || req.mode !== "read") return;
    if (!req.url_patterns?.length) add("web_template_missing", path);
    req.url_patterns?.forEach((source, k) => {
      const parsed = parseTemplate(source);
      const templatePath = `${path}.url_patterns.${k}`;
      if (!parsed.ok) add("web_template_invalid", templatePath);
      else if (req.domains !== undefined && !req.domains.includes(parsed.template.host))
        add("web_template_host", templatePath);
    });
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
          const req = requirement(id);
          if (!req) add("unknown_requirement", `${path}.uses.${k}`);
          if (req?.type === "path" && req.per_item && variable === undefined)
            add("per_item_loop", `${path}.uses.${k}`);
        });
        const ownText = leaf.checks.filter((check) => check.type === "user" && check.own_text === true);
        if (ownText.length > 0 && (leaf.outputs.length !== 1 || leaf.outputs.at(0)?.type !== "text"))
          add("own_text_output", `${path}.outputs`);
        if (ownText.length > 1) add("own_text_once", `${path}.checks`);
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
          if (check.type === "user" && check.own_text && !check.required) add("own_text_required", cp);
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
