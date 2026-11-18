import path from "node:path";

export const M1_FLOW_ID = "local.upwork-job-review";
export const M1_OPERATIONS = [
  "harnesses.rescan",
  "harnesses.list",
  "flows.import",
  "flows.capabilities",
  "flows.run",
  "runs.list",
  "runs.status",
  "approvals.list",
  "audit.list",
] as const;
export const M1_WALK_STEPS = [
  { name: "rescan", operation: M1_OPERATIONS[0], waitFor: "the harness scan" },
  { name: "consent", operation: M1_OPERATIONS[1], waitFor: "Claude Code consent" },
  { name: "import", operation: M1_OPERATIONS[2], waitFor: "the flow import" },
  { name: "allow", operation: M1_OPERATIONS[3], waitFor: "the flow allow" },
  { name: "run", operation: M1_OPERATIONS[5], waitFor: "a scheduled run" },
] as const;
export function m1WalkPaths(root: string) {
  const base = path.join(root, ".workflow/scratch/05d/walk");
  return { dataDir: path.join(base, "data"), output: path.join(base, "output") };
}
export function walkConfig(
  flowDir: string | undefined,
  mode: string | undefined,
): { error: string } | { flowDir: string; mode: "attended" | "schedule" } {
  if (!flowDir?.trim()) return { error: "Set M1_FLOW_DIR to the flow folder." };
  if (mode !== "attended" && mode !== "schedule")
    return { error: "Set M1_WALK_MODE to attended or schedule." };
  return { flowDir, mode };
}
export function runRequest(mode: "attended" | "schedule") {
  return mode === "attended" ? { flowId: M1_FLOW_ID, params: { newest: 3, daily_builds: 1 } } : undefined;
}
export function summaryLine(runId: string, state: string, audit: unknown) {
  const counts = { pages: 0, allowed: 0, refused: 0, sends: 0 };
  if (Array.isArray(audit))
    for (const row of audit as unknown[]) {
      if (typeof row !== "object" || row === null || !("kind" in row)) continue;
      let detail: unknown;
      try {
        detail = "detail" in row && typeof row.detail === "string" ? JSON.parse(row.detail) : undefined;
      } catch {
        detail = undefined;
      }
      const fields = typeof detail === "object" && detail !== null ? detail : {};
      if (row.kind === "page_read") counts.pages++;
      if (row.kind === "command_run") counts.allowed++;
      if (row.kind === "tool_denied" && "tool" in fields && fields.tool === "Bash") counts.refused++;
      if (
        row.kind === "connector_call" &&
        "tool" in fields &&
        typeof fields.tool === "string" &&
        ["send_message", "reply", "forward"].includes(fields.tool)
      )
        counts.sends++;
    }
  return `run ${runId}: ${state}; pages read ${counts.pages}; commands allowed ${counts.allowed}; commands refused ${counts.refused}; sends ${counts.sends}`;
}
