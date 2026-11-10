import type { CheckType, FlowManifest, Requirement, Step } from "@flowdriven/contracts";
import type { FlowRecord } from "../state";

type StepSpec = [string, string, CheckType[], string[]?, number?];
type ReqSpec = [string, Requirement["type"], string, boolean?];
export function makeFlow(
  id: string,
  name: string,
  kind: FlowManifest["kind"],
  version: string,
  specs: StepSpec[],
  reqs: ReqSpec[],
  number: number,
): FlowRecord {
  const requirements: Requirement[] = reqs.map(([key, type, ref, required = true]) => ({
    id: key,
    type,
    ref,
    required,
    sensitive: false,
    why: `Provides ${ref} for this flow.`,
    routes: [],
  }));
  const steps: Step[] = specs.map(([key, title, types, summaries, retry]) => ({
    id: key,
    title,
    do: "worker",
    instructions: `${title} for this flow.`,
    uses: [requirements[0]?.id ?? "worker"],
    outputs: [],
    checks: types.map((type, i) => ({
      type,
      required: true,
      summary: summaries?.[i] ?? `${title}: ${type} check`,
    })),
    retry: retry ?? 2,
  }));
  const manifest: FlowManifest = {
    format: "flowdriven-flow/1",
    id: `dev.example.${id}`,
    name,
    summary: name,
    description: `A repeatable workflow for ${name.toLowerCase()}.`,
    version,
    license: "AGPL-3.0-only",
    kind,
    inputs: [],
    outputs: [],
    requirements,
    defaults: {},
    steps,
  };
  return {
    manifest,
    hash: `sha256:${number.toString(16).padStart(64, "0")}`,
    saved: true,
    signOff: { state: "approved", version },
    playback: { goal: name, touches: requirements.map((r) => r.ref), asksApprovalFor: [] },
    conversation: [],
    history: [],
    retiredStepIds: [],
  };
}
export function flows(): FlowRecord[] {
  const worker: ReqSpec = ["worker", "harness", "codex"];
  const records = [
    makeFlow(
      "documents-and-reports",
      "Documents and reports",
      "light",
      "1.2.0",
      [
        ["inventory", "List the source files", ["files"]],
        ["extract-facts", "Extract key facts", ["schema"]],
        ["draft-report", "Draft the report", ["contains", "not_contains"]],
        ["cross-check", "Cross-check every number", ["judge"]],
        ["export", "Export the report", ["files"]],
        ["final-approval", "Approve the final report", ["user"]],
      ],
      [
        worker,
        ["sources", "path", "source files"],
        ["output", "path", "report folder"],
        ["pandoc", "cli_tool", "pandoc", false],
      ],
      1,
    ),
    makeFlow(
      "figma-to-flutter",
      "Figma to Flutter",
      "build",
      "1.0.0",
      [
        [
          "read-design",
          "Read the design",
          ["schema", "files"],
          ["design/screens.json matches checks/screens.schema.json", "design/screens.json exists"],
        ],
        [
          "plan-widgets",
          "Plan widgets and tokens",
          ["contains"],
          ["design/plan.md has the sections Screens and Shared widgets"],
        ],
        [
          "build-screens",
          "Build the screens",
          ["command", "command", "files"],
          ["flutter analyze exits 0", "flutter test exits 0", "At least one file matches lib/screens/*.dart"],
          3,
        ],
        [
          "visual-review",
          "Compare with the design",
          ["judge"],
          ["Layout, spacing, text and colors match within reason; every mismatch listed"],
        ],
        ["open-pr", "Push the branch", ["command"], ["git status --porcelain prints nothing"]],
      ],
      [
        ["coder", "harness", "codex"],
        ["figma", "mcp_server", "figma"],
        ["figma-seat", "account", "Figma seat"],
        ["flutter", "cli_tool", "flutter"],
        ["git", "cli_tool", "git"],
        ["project", "path", "Flutter project"],
      ],
      2,
    ),
    makeFlow(
      "email-triage",
      "Email triage and draft replies",
      "light",
      "1.1.0",
      [
        ["fetch-unread", "Fetch unread mail", ["probe"]],
        ["classify", "Sort each thread", ["schema"]],
        ["draft-replies", "Draft replies", ["contains", "judge"]],
        ["create-drafts", "Save the drafts", ["probe"]],
        ["send-approved", "Send approved drafts", ["probe", "user"]],
      ],
      [worker, ["mail", "mcp_server", "mail"], ["mail-account", "account", "mail account"]],
      3,
    ),
    makeFlow(
      "lead-follow-up",
      "Lead follow-up",
      "light",
      "1.3.0",
      [
        ["read-leads", "Read new leads", ["schema"]],
        ["score-leads", "Score and segment leads", ["schema", "judge"]],
        ["draft-follow-ups", "Draft a follow-up per lead", ["contains", "judge"]],
        ["save-drafts", "Save drafts and update status", ["probe"]],
        ["send-approved", "Send approved follow-ups", ["probe", "user"]],
      ],
      [worker, ["sheet", "mcp_server", "spreadsheet"], ["mail", "mcp_server", "mail"]],
      4,
    ),
    makeFlow(
      "social-posts",
      "One source into many social posts",
      "light",
      "1.0.1",
      [
        ["extract-points", "Extract key points and hooks", ["schema"]],
        ["write-posts", "Write a post per platform", ["contains", "judge"]],
        ["make-media", "Make media if requested", ["files"]],
        ["upload-drafts", "Upload drafts", ["probe"]],
        ["publish", "Publish", ["probe"]],
        ["collect-metrics", "Collect metrics and lessons", ["probe", "user"]],
      ],
      [
        ["writer", "harness", "codex"],
        ["source", "path", "source file"],
        ["youtube", "account", "YouTube"],
        ["instagram", "account", "Instagram"],
        ["wordpress", "account", "WordPress"],
        ["tiktok-draft", "account", "TikTok draft upload"],
        ["tiktok-browser", "browser_session", "TikTok", false],
        ["ffmpeg", "cli_tool", "ffmpeg"],
      ],
      5,
    ),
  ];
  const figma = records[1];
  const leads = records[3];
  if (figma && leads) {
    figma.playback.goal =
      "Turn chosen Figma frames into Flutter screens on a new branch, with analyze and tests passing.";
    figma.conversation = [
      {
        id: "msg-1",
        role: "user",
        text: "Turn the frames in our Figma file into Flutter screens and push a branch. Never merge.",
        at: "2026-11-10T08:30:00.000Z",
      },
      {
        id: "msg-2",
        role: "agent",
        text: "Before I begin, please clarify:",
        at: "2026-11-10T08:31:00.000Z",
        questions: [
          {
            id: "project",
            text: "Which project folder holds the Flutter app?",
            suggestions: ["Use the last folder", "Choose another folder"],
          },
          {
            id: "visual",
            text: "Should I compare the result with the Figma screenshots?",
            suggestions: ["Yes, list every mismatch", "No, skip visual review"],
          },
        ],
      },
    ];
    leads.signOff = { state: "stale", version: "1.2.0" };
  }
  for (const record of records)
    for (const step of record.manifest.steps) {
      if (step.id === "send-approved") step.risky = ["send"];
      if (step.id === "publish") step.risky = ["post"];
    }
  return records;
}
