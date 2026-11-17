import { homedir } from "node:os";
import { FlowCapabilities, RunnerError } from "@flowdriven/contracts";
import { FlowManifest, parseTemplate } from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";
import { CONNECTORS, type ConnectorEntry, catalogEntry } from "../connectors/catalog.ts";
import { COST, capabilitySentence, needsAllow, routeAll } from "../router/route.ts";
import type { HarnessFacts } from "../router/types.ts";
import { bundledSkill, type LoadedSkill, readSkillFolder, skillSource } from "../skills/skill-folder.ts";
import type { Store } from "../storage.ts";

export const ALLOW_NOT_ROUTED =
  "FlowDriven cannot provide the web pages this flow reads yet, so there is nothing to allow.";
export const ALLOW_NOT_ROUTED_CONNECTOR =
  "FlowDriven cannot provide the connector this flow uses yet, so there is nothing to allow.";
const PREVIEW = "This flow declares more than the preview can show.";
// The one place that decides whether the allow is blocked, used by `get` (which shows it) and by
// `allow` (which refuses on it). Fail closed: a web requirement that a step uses must have a routed row.
function allowIsBlocked(
  manifest: FlowManifest,
  rows: { requirementId: string; routed: boolean; pin?: string }[],
  catalog: ConnectorEntry[],
): string | undefined {
  const used = new Set(
    manifest.steps.flatMap((step) => ("steps" in step ? step.steps : [step]).flatMap((leaf) => leaf.uses)),
  );
  const missing = (req: FlowManifest["requirements"][number]) => {
    if (!used.has(req.id)) return false;
    const row = rows.find((item) => item.requirementId === req.id);
    return !row || !row.routed;
  };
  // A cli_tool without commands is a shape FlowDriven cannot provide yet; like a skill without a
  // known ref it does not block the allow (the gate still refuses such a flow).
  if (
    manifest.requirements.some(
      (req) => req.type === "cli_tool" && (req.commands?.length ?? 0) > 0 && missing(req),
    )
  )
    return "FlowDriven cannot run the commands this flow uses, so there is nothing to allow.";
  if (manifest.requirements.some((req) => req.type === "web" && missing(req))) return ALLOW_NOT_ROUTED;
  if (
    manifest.requirements.some(
      (req) => req.type === "mcp_server" && catalogEntry(req.ref, catalog) && missing(req),
    )
  )
    return ALLOW_NOT_ROUTED_CONNECTOR;
  if (
    manifest.requirements.some((req) => {
      if (req.type !== "skill" || !skillSource(req.ref, { home: "" }) || !used.has(req.id)) return false;
      const row = rows.find((item) => item.requirementId === req.id);
      return !row?.routed || !row.pin;
    })
  )
    return "FlowDriven cannot provide the skill this flow uses yet, so there is nothing to allow.";
  return undefined;
}
export function createCapabilities(o: {
  store: Store;
  now: () => Date;
  facts: () => HarnessFacts;
  catalog?: ConnectorEntry[];
  readSkill?: (
    ref: string | undefined,
    flowId: string,
  ) => { ok: true; skill: LoadedSkill } | { ok: false; reason: string };
}) {
  const catalog = o.catalog ?? CONNECTORS;
  function flow(flowId: string) {
    const row = o.store.getFlow(flowId);
    if (!row) throw new RunnerError("not_found", `There is no flow ${flowId}.`);
    return row;
  }
  const readSkill =
    o.readSkill ??
    ((ref: string | undefined, flowId: string) => {
      const source = skillSource(ref, { home: homedir() });
      if (!source) return { ok: false as const, reason: "This skill cannot be read." };
      return source.kind === "installed"
        ? readSkillFolder(source.dir, source.name)
        : bundledSkill(flow(flowId).files, source.name);
    });
  function consentOf(flowId: string): "none" | "given" | "stale" {
    const row = flow(flowId);
    const consent = o.store.getCapabilityConsent(flowId);
    if (!consent) return "none";
    if (consent.hash !== row.hash) return "stale";
    const manifest = FlowManifest.parse(row.manifest);
    const used = new Set(
      manifest.steps.flatMap((step) => ("steps" in step ? step.steps : [step]).flatMap((leaf) => leaf.uses)),
    );
    for (const req of manifest.requirements) {
      if (req.type !== "skill" || !used.has(req.id) || !skillSource(req.ref, { home: "" })) continue;
      const result = readSkill(req.ref, flowId);
      if (!result.ok || result.skill.hash !== consent.pins?.skills[req.id]) return "stale";
    }
    return "given";
  }
  function get(flowId: string): FlowCapabilities {
    const row = flow(flowId);
    const manifest = FlowManifest.parse(row.manifest);
    if (new Set(manifest.requirements.map((req) => req.id)).size !== manifest.requirements.length)
      throw new RunnerError("not_allowed", PREVIEW);
    const templates = new Map<string, string[]>();
    for (const req of manifest.requirements) {
      if (req.type === "cli_tool" && (req.commands?.length ?? 0) > 8)
        throw new RunnerError("not_allowed", PREVIEW);
      if (req.type !== "web") continue;
      if ((req.url_patterns?.length ?? 0) > 8) throw new RunnerError("not_allowed", PREVIEW);
      const details: string[] = [];
      for (const pattern of req.url_patterns ?? []) {
        const parsed = parseTemplate(pattern);
        if (!parsed.ok) throw new RunnerError("not_allowed", PREVIEW);
        details.push(visible(parsed.template.source, 300));
      }
      templates.set(req.id, details);
    }
    const routes = routeAll(manifest.requirements, o.facts(), catalog);
    if (routes.length > 50) throw new RunnerError("not_allowed", PREVIEW);
    const rows = routes.map((route) => {
      const req = manifest.requirements.find((r) => r.id === route.requirementId);
      if (!req) throw new RunnerError("not_allowed", PREVIEW);
      const common = { requirementId: req.id, type: req.type, sentence: capabilitySentence(req, catalog) };
      if (!route.routed) return { ...common, routed: false, reason: route.reason, away: false, details: [] };
      const loaded = route.provider === "flowdriven-skill" ? readSkill(req.ref, flowId) : undefined;
      if (loaded && !loaded.ok)
        return { ...common, routed: false, reason: visible(loaded.reason, 300), away: false, details: [] };
      const skill = loaded?.ok ? loaded.skill : undefined;
      return {
        ...common,
        ...(skill ? { pin: skill.hash } : {}),
        routed: true,
        provider: route.providerName,
        enforcedBy: route.enforcedBy,
        label: route.label,
        ...(route.labelSentence === undefined ? {} : { labelSentence: route.labelSentence }),
        away: route.away,
        cost: skill
          ? COST.skill(skill.body.length)
          : route.provider === "claude-code-commands"
            ? COST.commands
            : route.provider === "claude-ai-connector"
              ? COST.connector
              : route.provider === "claude-in-chrome"
                ? COST.chrome
                : COST.files,
        details: skill
          ? [
              // A bundled skill has no file times (the flow's files are stored as text), so only an
              // installed skill shows when it changed.
              `Version ${skill.hash.slice(7, 19)}, ${skill.files.size} files, ${skill.body.length} characters${skillSource(req.ref, { home: "" })?.kind === "installed" ? `, changed ${skill.modifiedAt}` : ""}`,
            ]
          : req.type === "cli_tool"
            ? (req.commands ?? []).map((command) => visible(command, 300))
            : req.type === "web"
              ? (templates.get(req.id) ?? [])
              : [],
      };
    });
    const blocked = allowIsBlocked(manifest, rows, catalog);
    const hasTriggers = manifest.triggers.some((trigger) => trigger.kind !== "manual");
    const maxItems = manifest.limits?.max_items ?? (hasTriggers ? 20 : undefined);
    return FlowCapabilities.parse({
      flowId,
      hash: row.hash,
      rows,
      caps: {
        maxRunsPerDay: manifest.limits?.max_runs_per_day ?? 24,
        ...(maxItems === undefined ? {} : { maxItems }),
      },
      hasTriggers,
      needsAllow: needsAllow(manifest),
      consent: consentOf(flowId),
      ...(blocked ? { allowBlocked: blocked } : {}),
    });
  }
  function allow(flowId: string, hash: string, pins?: Record<string, string>): FlowCapabilities {
    const preview = get(flowId);
    if (hash !== preview.hash)
      throw new RunnerError(
        "not_allowed",
        "This flow changed since you looked at it. Reload and check it again.",
      );
    if (preview.allowBlocked !== undefined) throw new RunnerError("not_allowed", preview.allowBlocked);
    const skills: Record<string, string> = {};
    for (const row of preview.rows) {
      if (row.type !== "skill" || !row.routed) continue;
      if (!row.pin || pins?.[row.requirementId] !== row.pin)
        throw new RunnerError(
          "not_allowed",
          "Something this flow uses changed since you looked at it. Reload and check it again.",
        );
      skills[row.requirementId] = row.pin;
    }
    const at = o.now().toISOString();
    const hasSkills = Object.keys(skills).length > 0;
    o.store.putCapabilityConsent({
      flowId,
      hash,
      at,
      ...(hasSkills ? { pins: { skills, folders: {} } } : {}),
    });
    o.store.appendAudit({
      at,
      kind: "capabilities_allowed",
      detail: { flowId, hash, ...(hasSkills ? { skills } : {}) },
    });
    return get(flowId);
  }
  function withdraw(flowId: string): FlowCapabilities {
    flow(flowId);
    o.store.deleteCapabilityConsent(flowId);
    o.store.appendAudit({ at: o.now().toISOString(), kind: "capabilities_withdrawn", detail: { flowId } });
    return get(flowId);
  }
  return { get, allow, withdraw, consentOf };
}
