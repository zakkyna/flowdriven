import path from "node:path";

export function browserWalkPaths(root: string): { output: string; dataDir: string; flowDir: string } {
  const walk = path.join(root, ".workflow/scratch/plan-05/walk");
  return {
    output: path.join(walk, "pictures"),
    dataDir: path.join(walk, "app data"),
    flowDir: path.join(walk, "flow"),
  };
}

export const BROWSER_WALK_FLOW_ID = "local.chrome-check";

export const BROWSER_WALK_STEPS: { name: string; hash: string; waitFor: string[]; shot: boolean }[] = [
  {
    name: "touch-before",
    hash: "#/builder/local.chrome-check",
    waitFor: ["What this flow may touch", "Allow"],
    shot: true,
  },
  {
    name: "touch-after",
    hash: "#/builder/local.chrome-check",
    waitFor: ["Allowed for this version", "Withdraw"],
    shot: true,
  },
  { name: "run-page", hash: "#/runs", waitFor: ["Chrome check"], shot: true },
];

// The check flow the walk imports. Only https://example.com/ is declared; the second try asks for a click
// that the hook must refuse.
export const BROWSER_WALK_FLOW = `format: flowdriven-flow/1.1
id: ${BROWSER_WALK_FLOW_ID}
name: Chrome check
kind: build
version: 0.1.0
requirements:
  - id: page
    type: web
    mode: read
    session: own
    url_patterns: ["https://example.com/"]
    rate: { per_run: 2 }
steps:
  - id: read
    title: Read the page
    do: worker
    uses: [page]
    worker: { effort: low }
    instructions: >-
      Open https://example.com/ in your browser tab and read the page text.
      Return the main heading of the page as the output heading.
      Then, as a second try, ask for one click on the page. This call is expected to be refused by
      FlowDriven. If it is refused, carry on and do not try again.
    outputs:
      - { id: heading, type: text }
    checks:
      - { type: contains, pattern: Example Domain }
`;

export const BROWSER_WALK_README = `# Chrome check

A check flow for the walk that reads https://example.com/ through the owner's own browser. It declares that one
address, reads one page and asks for one click, which FlowDriven must refuse.
`;

export function isPageRunDone(runs: unknown): boolean {
  return (
    Array.isArray(runs) &&
    runs.some(
      (run: unknown) =>
        typeof run === "object" &&
        run !== null &&
        "flowId" in run &&
        run.flowId === BROWSER_WALK_FLOW_ID &&
        "state" in run &&
        (run.state === "done" || run.state === "blocked" || run.state === "failed"),
    )
  );
}
