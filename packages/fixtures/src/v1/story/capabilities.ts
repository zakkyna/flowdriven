import type { FlowCapabilities, Requirement, Step } from "@flowdriven/contracts/v1";
import type { FlowRecord } from "../state";

// The fixtures package has no dependency on the runner, so this small table repeats the router's
// strings. capabilities.test.ts pins it to the same sentences.
const UNOFFICIAL_SENTENCE =
  "This uses your personal browser. Every site you are logged into is reachable from it.";
const NOT_YET = "FlowDriven cannot provide this yet.";
const COST_CHROME = "Adds about 12,000 tokens to each call of a step that uses it.";
const COST_FILES = "Adds about 10,600 tokens to each call of a step that uses it.";
const NOUNS: Record<string, string> = {
  harness: "A harness",
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
};

function isOwnRead(req: Requirement): boolean {
  return req.type === "web" && req.mode === "read" && req.session === "own";
}
function isProjectRef(ref: string): boolean {
  return ref !== "" && !ref.startsWith("/") && !ref.startsWith("~") && !ref.split("/").includes("..");
}
function hostOf(pattern: string): string | undefined {
  return /^https:\/\/([a-z0-9.-]+)(?:\/|$)/.exec(pattern)?.[1];
}
// The template as the flow wrote it, cut to the 300 characters a row may hold.
function describe(pattern: string): string {
  return pattern.slice(0, 300);
}
function sentenceOf(req: Requirement): string {
  if (isOwnRead(req)) {
    const hosts = [...new Set((req.url_patterns ?? []).flatMap((pattern) => hostOf(pattern) ?? []))];
    return `Reads pages on ${hosts.join(", ")} in your own browser, at most ${req.rate?.per_run ?? 3} per run and ${req.rate?.per_day ?? 10} a day.`;
  }
  if (req.type === "path")
    return `Reads${req.access === "read_write" ? " and writes" : ""} files in ${req.ref || "the project folder"}.`;
  return `${NOUNS[req.type] ?? "Something"}: ${req.ref || req.id}.`;
}
function leaves(steps: Step[]): Step[] {
  return steps.flatMap((step) => ("loop" in step && step.loop ? step.loop.steps : [step]));
}

export const ALLOW_NOT_ROUTED =
  "FlowDriven cannot provide the web pages this flow reads yet, so there is nothing to allow.";

// True when a step uses a web requirement that has no route in the fixture rows.
export function webNotRouted(flow: FlowRecord): boolean {
  const manifest = flow.manifest;
  const used = new Set(leaves(manifest.steps).flatMap((step) => step.uses));
  return manifest.requirements.some((req) => req.type === "web" && used.has(req.id) && !isOwnRead(req));
}

export function capabilitiesOf(flow: FlowRecord, consent: { hash: string } | undefined): FlowCapabilities {
  const manifest = flow.manifest;
  const rows = manifest.requirements
    .filter((req) => req.type !== "harness")
    .map((req) => {
      const common = { requirementId: req.id, type: req.type, sentence: sentenceOf(req) };
      if (isOwnRead(req))
        return {
          ...common,
          routed: true,
          provider: "Claude in Chrome inside Claude Code",
          enforcedBy: "FlowDriven hook in Claude Code" as const,
          label: "unofficial" as const,
          labelSentence: UNOFFICIAL_SENTENCE,
          away: true,
          cost: COST_CHROME,
          details: (req.url_patterns ?? []).map(describe),
        };
      if (req.type === "path" && isProjectRef(req.ref))
        return {
          ...common,
          routed: true,
          provider: "Claude Code file tools",
          enforcedBy: "FlowDriven hook in Claude Code" as const,
          label: "official" as const,
          away: true,
          cost: COST_FILES,
          details: [],
        };
      return { ...common, routed: false, reason: NOT_YET, away: false, details: [] };
    });
  const needs = new Set(
    manifest.requirements.filter((req) => req.type !== "path" && req.type !== "harness").map((req) => req.id),
  );
  const hasTriggers = (manifest.triggers ?? []).some((trigger) => trigger.kind !== "manual");
  const maxItems = manifest.limits?.max_items ?? (hasTriggers ? 20 : undefined);
  return {
    flowId: manifest.id,
    hash: flow.hash,
    rows,
    caps: {
      maxRunsPerDay: manifest.limits?.max_runs_per_day ?? 24,
      ...(maxItems === undefined ? {} : { maxItems }),
    },
    hasTriggers,
    needsAllow: leaves(manifest.steps).some((step) => step.uses.some((id) => needs.has(id))),
    consent: !consent ? "none" : consent.hash === flow.hash ? "given" : "stale",
    ...(webNotRouted(flow) ? { allowBlocked: ALLOW_NOT_ROUTED } : {}),
  };
}
