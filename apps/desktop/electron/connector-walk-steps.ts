import path from "node:path";

export function connectorWalkPaths(root: string): { output: string; dataDir: string; flowDir: string } {
  const walk = path.join(root, ".workflow/scratch/plan-05b/walk");
  return {
    output: path.join(walk, "pictures"),
    dataDir: path.join(walk, "app data"),
    flowDir: path.join(walk, "flow"),
  };
}
export const CONNECTOR_WALK_FLOW_ID = "local.gmail-check";
export const CONNECTOR_WALK_STEPS = [
  {
    name: "touch-before",
    hash: "#/builder/local.gmail-check",
    waitFor: ["What this flow may touch", "Allow"],
    shot: true,
  },
  {
    name: "touch-after",
    hash: "#/builder/local.gmail-check",
    waitFor: ["Allowed for this version", "Withdraw"],
    shot: true,
  },
];
export const runHash = (runId: string): string => `#/runs/${encodeURIComponent(runId)}`;
export const inboxHash = (approvalId: string): string => `#/inbox/${encodeURIComponent(approvalId)}`;
export function isRunInState(runs: unknown, runId: string, states: string[]): boolean {
  return (
    Array.isArray(runs) &&
    runs.some(
      (run: unknown) =>
        typeof run === "object" &&
        run !== null &&
        "id" in run &&
        run.id === runId &&
        "state" in run &&
        typeof run.state === "string" &&
        states.includes(run.state),
    )
  );
}
export function auditCounts(records: unknown, kinds: string[]): string {
  const rows: unknown[] = Array.isArray(records) ? records : [];
  return `counts: ${kinds.map((kind) => `${kind}=${rows.filter((row) => typeof row === "object" && row !== null && "kind" in row && row.kind === kind).length}`).join(" ")}`;
}
export const CONNECTOR_WALK_FLOW = `format: flowdriven-flow/1.1
id: local.gmail-check
name: Gmail check
kind: build
version: 0.1.0
requirements:
  - id: gmail
    type: mcp_server
    ref: connector:gmail
    connect: native
    sensitive: true
    tools: [search_threads, delete_draft]
steps:
  - id: alerts
    title: Count the alert threads
    do: worker
    uses: [gmail]
    worker: { effort: low }
    instructions: >-
      Use search_threads once with the query from:donotreply@upwork.com newer_than:7d.
      Return only the number of threads as the output count. Copy no email text.
    outputs:
      - { id: count, type: text }
    checks:
      - { type: not_contains, patterns: ["@"] }
  - id: hold
    title: Hold test
    do: worker
    uses: [gmail]
    worker: { effort: low }
    instructions: >-
      Call delete_draft once with the draft id flowdriven-hold-test-no-such-draft.
      FlowDriven is expected to hold the call; if it is held, stop and report that it is held.
    checks:
      - { type: not_contains, patterns: ["@"] }
`;
export const CONNECTOR_WALK_README = `# Gmail check

Counts alert threads and checks that a nonexistent draft deletion is held for rejection. No email text is copied.
`;
