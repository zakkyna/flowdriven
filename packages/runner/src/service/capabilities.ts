import { FlowCapabilities, RunnerError } from "@flowdriven/contracts";
import { FlowManifest, parseTemplate } from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";
import { CONNECTORS, type ConnectorEntry, catalogEntry } from "../connectors/catalog.ts";
import { COST, capabilitySentence, needsAllow, routeAll } from "../router/route.ts";
import type { HarnessFacts } from "../router/types.ts";
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
  rows: { requirementId: string; routed: boolean }[],
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
  if (manifest.requirements.some((req) => req.type === "web" && missing(req))) return ALLOW_NOT_ROUTED;
  if (
    manifest.requirements.some(
      (req) => req.type === "mcp_server" && catalogEntry(req.ref, catalog) && missing(req),
    )
  )
    return ALLOW_NOT_ROUTED_CONNECTOR;
  return undefined;
}
export function createCapabilities(o: {
  store: Store;
  now: () => Date;
  facts: () => HarnessFacts;
  catalog?: ConnectorEntry[];
}) {
  const catalog = o.catalog ?? CONNECTORS;
  function flow(flowId: string) {
    const row = o.store.getFlow(flowId);
    if (!row) throw new RunnerError("not_found", `There is no flow ${flowId}.`);
    return row;
  }
  function consentOf(flowId: string): "none" | "given" | "stale" {
    const row = flow(flowId);
    const consent = o.store.getCapabilityConsent(flowId);
    return !consent ? "none" : consent.hash === row.hash ? "given" : "stale";
  }
  function get(flowId: string): FlowCapabilities {
    const row = flow(flowId);
    const manifest = FlowManifest.parse(row.manifest);
    if (new Set(manifest.requirements.map((req) => req.id)).size !== manifest.requirements.length)
      throw new RunnerError("not_allowed", PREVIEW);
    const templates = new Map<string, string[]>();
    for (const req of manifest.requirements) {
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
      return {
        ...common,
        routed: true,
        provider: route.providerName,
        enforcedBy: route.enforcedBy,
        label: route.label,
        ...(route.labelSentence === undefined ? {} : { labelSentence: route.labelSentence }),
        away: route.away,
        cost:
          route.provider === "claude-ai-connector"
            ? COST.connector
            : route.provider === "claude-in-chrome"
              ? COST.chrome
              : COST.files,
        details: req.type === "web" ? (templates.get(req.id) ?? []) : [],
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
  function allow(flowId: string, hash: string): FlowCapabilities {
    const preview = get(flowId);
    if (hash !== preview.hash)
      throw new RunnerError(
        "not_allowed",
        "This flow changed since you looked at it. Reload and check it again.",
      );
    if (preview.allowBlocked !== undefined) throw new RunnerError("not_allowed", preview.allowBlocked);
    const at = o.now().toISOString();
    o.store.putCapabilityConsent({ flowId, hash, at });
    o.store.appendAudit({ at, kind: "capabilities_allowed", detail: { flowId, hash } });
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
