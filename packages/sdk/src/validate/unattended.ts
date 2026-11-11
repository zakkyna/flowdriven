import type { FlowManifest } from "../format/manifest.ts";
import type { LeafStep } from "../format/steps.ts";
import { classifyCommand, classifyTool } from "./risky.ts";
export function unattendedRisk(step: LeafStep, manifest: FlowManifest): boolean {
  if (step.do === "flow" || (step.risky?.length ?? 0) > 0) return true;
  if (step.do === "builtin" && classifyTool(step.builtin) !== undefined) return true;
  return manifest.requirements.some((req) => {
    if (!step.uses.includes(req.id)) return false;
    if ((req.type === "web" || req.type === "desktop") && req.mode === "act") return true;
    if (req.type === "cli_tool")
      return (req.commands ?? []).some((command) => classifyCommand(command) !== undefined);
    if ((req.type === "mcp_server" || req.type === "plugin") && !req.tools?.length) return true;
    if (!("tools" in req)) return false;
    return (req.tools ?? []).some(
      (tool) =>
        classifyTool(tool) !== undefined ||
        manifest.approvals.extra_risky.includes(`${req.id}.${tool}`) ||
        manifest.approvals.extra_risky.includes(tool),
    );
  });
}
