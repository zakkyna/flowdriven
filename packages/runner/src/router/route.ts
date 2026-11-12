import { type FlowManifest, parseTemplate, type Requirement, type Step, webRates } from "@flowdriven/sdk";
import { isProjectRef } from "../claude/policy.ts";
import { visible } from "../claude/text.ts";
import type { HarnessFacts, Routed } from "./types.ts";

export const UNOFFICIAL_SENTENCE =
  "This uses your personal browser. Every site you are logged into is reachable from it.";
export const DROP = {
  notYet: "FlowDriven cannot provide this yet.",
  noHooks: "This needs a harness that can check each call.",
  noChrome: "This Claude Code cannot use Chrome.",
} as const;
export const COST = {
  chrome: "Adds about 12,000 tokens to each call of a step that uses it.",
  files: "Adds about 10,600 tokens to each call of a step that uses it.",
} as const;
export const NOT_ENFORCED_UNATTENDED =
  "This step would run unattended on a provider FlowDriven cannot enforce.";
export const NOUNS = {
  skill: "A skill",
  plugin: "A plugin",
  mcp_server: "A connector",
  cli_tool: "A command-line tool",
  gui_app: "A desktop app",
  account: "An account",
  browser_session: "A browser session",
  desktop: "Control of this Mac",
  trigger: "A trigger",
  web: "Web access of this kind",
} as const;

export function routeRequirement(req: Requirement, facts: HarnessFacts): Routed | undefined {
  if (req.type === "harness") return undefined;
  const base = { requirementId: req.id, type: req.type };
  if (req.type === "path") {
    if (!isProjectRef(req.ref))
      return { ...base, routed: false, noun: "A folder outside the project", reason: DROP.notYet };
    return {
      ...base,
      routed: true,
      provider: "claude-code-files",
      providerName: "Claude Code file tools",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "official",
      away: true,
    };
  }
  if (req.type === "web" && req.mode === "read" && req.session === "own") {
    if (!facts.hooks) return { ...base, routed: false, noun: NOUNS.web, reason: DROP.noHooks };
    if (!facts.chrome) return { ...base, routed: false, noun: NOUNS.web, reason: DROP.noChrome };
    return {
      ...base,
      routed: true,
      provider: "claude-in-chrome",
      providerName: "Claude in Chrome inside Claude Code",
      enforcedBy: "FlowDriven hook in Claude Code",
      label: "unofficial",
      labelSentence: UNOFFICIAL_SENTENCE,
      away: true,
    };
  }
  return { ...base, routed: false, noun: NOUNS[req.type], reason: DROP.notYet };
}

export function routeAll(requirements: Requirement[], facts: HarnessFacts): Routed[] {
  return requirements.flatMap((req) => {
    const route = routeRequirement(req, facts);
    return route ? [route] : [];
  });
}

export function needsAllow(manifest: FlowManifest): boolean {
  const needs = new Set(
    manifest.requirements.filter((req) => req.type !== "path" && req.type !== "harness").map((req) => req.id),
  );
  return manifest.steps.some((step) =>
    ("steps" in step ? step.steps : [step]).some((leaf) => leaf.uses.some((id) => needs.has(id))),
  );
}

export function capabilityHosts(req: Requirement): string[] {
  if (req.type !== "web") return [];
  const hosts = new Set<string>();
  for (const pattern of req.url_patterns ?? []) {
    const parsed = parseTemplate(pattern);
    if (parsed.ok) hosts.add(parsed.template.host);
  }
  return [...hosts];
}

export function capabilitySentence(req: Requirement): string {
  if (req.type === "web" && req.mode === "read" && req.session === "own") {
    const { perRun, perDay } = webRates(req);
    return `Reads pages on ${capabilityHosts(req)
      .map((host) => visible(host, 253))
      .join(", ")} in your own browser, at most ${perRun} per run and ${perDay} a day.`;
  }
  if (req.type === "path")
    return `Reads${req.access === "read_write" ? " and writes" : ""} files in ${visible(req.ref ?? "the project folder", 120)}.`;
  const noun = req.type === "harness" ? "A harness" : NOUNS[req.type];
  return `${noun}: ${visible(req.ref ?? req.id, 60)}.`;
}

export function unattendedProviderErrors(
  manifest: FlowManifest,
  routes: Routed[],
): { path: string; requirementId: string }[] {
  let beforeAsk = manifest.triggers.some((trigger) => trigger.kind !== "manual");
  const errors: { path: string; requirementId: string }[] = [];
  function walk(steps: Step[], prefix: string): void {
    steps.forEach((step, index) => {
      const path = `${prefix}.${index}`;
      if ("steps" in step) {
        walk(step.steps, `${path}.steps`);
        return;
      }
      if (step.do === "ask") {
        if (step.when === undefined) beforeAsk = false;
        return;
      }
      if (!beforeAsk) return;
      for (const id of step.uses) {
        if (
          routes.some(
            (route) => route.requirementId === id && route.routed && route.enforcedBy === "not enforced",
          )
        )
          errors.push({ path, requirementId: id });
      }
    });
  }
  walk(manifest.steps, "steps");
  return errors;
}
