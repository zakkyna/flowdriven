import type { CheckType, FlowManifest, Requirement, Step } from "@flowdriven/contracts/v1";
import type { FlowRecord } from "../state";

const work: Record<string, Record<string, { instructions: string; uses: string[]; checks: string[] }>> = {
  "documents-and-reports": {
    inventory: {
      instructions: "List the supplier files supplied for this report.",
      uses: ["worker", "sources"],
      checks: ["The source inventory lists every supplier file"],
    },
    "extract-facts": {
      instructions: "Extract supplier names, dates and figures with their source references.",
      uses: ["worker", "sources"],
      checks: ["Extracted facts include a value and source reference"],
    },
    "draft-report": {
      instructions: "Write a report using the extracted facts and cite each source.",
      uses: ["worker", "sources", "output"],
      checks: [
        "The draft includes a supplier summary and source citations",
        "The draft has no unresolved placeholders",
      ],
    },
    "cross-check": {
      instructions: "Compare every number in the draft with its cited source and explain discrepancies.",
      uses: ["worker", "sources", "output"],
      checks: ["Each reported number agrees with its cited source"],
    },
    export: {
      instructions: "Export the approved draft as Word and Markdown files.",
      uses: ["worker", "output", "pandoc"],
      checks: ["Word and Markdown reports exist in the report folder"],
    },
    "final-approval": {
      instructions: "Ask the user to review the completed report.",
      uses: ["output"],
      checks: ["You approve the final report"],
    },
  },
  "figma-to-flutter": {
    "read-design": {
      instructions: "Read the selected Figma frames and save their screen structure.",
      uses: ["coder", "figma", "figma-seat", "project"],
      checks: [],
    },
    "plan-widgets": {
      instructions: "Plan the screens, shared widgets and design tokens from the frames.",
      uses: ["coder", "figma", "figma-seat", "project"],
      checks: [],
    },
    "build-screens": {
      instructions: "Implement the planned Flutter screens and run analysis and tests.",
      uses: ["coder", "flutter", "project"],
      checks: [],
    },
    "visual-review": {
      instructions: "Compare each screen with the corresponding Figma frame and list mismatches.",
      uses: ["coder", "figma", "figma-seat", "project"],
      checks: [],
    },
    "open-pr": {
      instructions: "Commit the changes and push a branch for review without merging.",
      uses: ["coder", "git", "project"],
      checks: [],
    },
  },
  "email-triage": {
    "fetch-unread": {
      instructions: "Fetch unread threads from the connected mailbox.",
      uses: ["worker", "mail", "mail-account"],
      checks: ["The mailbox returns the unread threads"],
    },
    classify: {
      instructions: "Classify each thread by topic and urgency.",
      uses: ["worker", "mail"],
      checks: ["Every thread has a topic and urgency"],
    },
    "draft-replies": {
      instructions: "Draft a concise reply for each thread using its context.",
      uses: ["worker", "mail"],
      checks: ["Each reply addresses its thread", "Replies are helpful and supported by the thread"],
    },
    "create-drafts": {
      instructions: "Save the replies as drafts in the mailbox.",
      uses: ["worker", "mail", "mail-account"],
      checks: ["Each reply is saved as a mailbox draft"],
    },
    "send-approved": {
      instructions: "Ask before sending each approved draft to its recipient.",
      uses: ["worker", "mail", "mail-account"],
      checks: [
        "The mailbox confirms each approved reply was sent",
        "You approve each reply before it is sent",
      ],
    },
  },
  "lead-follow-up": {
    "read-leads": {
      instructions: "Read new leads from the spreadsheet with their contact details.",
      uses: ["worker", "sheet"],
      checks: ["Each new lead has a name and contact address"],
    },
    "score-leads": {
      instructions: "Score each lead and assign a segment using the supplied criteria.",
      uses: ["worker", "sheet"],
      checks: ["Each lead has a score and segment", "Scores reflect the stated qualification criteria"],
    },
    "draft-follow-ups": {
      instructions: "Write a personal follow-up for each qualified lead.",
      uses: ["worker", "sheet", "mail"],
      checks: [
        "Each follow-up includes the lead's relevant context",
        "The follow-ups are relevant and avoid unsupported claims",
      ],
    },
    "save-drafts": {
      instructions: "Save follow-up drafts and update lead status in the spreadsheet.",
      uses: ["worker", "sheet", "mail"],
      checks: ["Drafts exist and lead statuses are updated"],
    },
    "send-approved": {
      instructions: "Ask before sending each follow-up to its lead.",
      uses: ["worker", "mail"],
      checks: [
        "The mailbox confirms each approved follow-up was sent",
        "You approve each follow-up before it is sent",
      ],
    },
  },
  "social-posts": {
    "extract-points": {
      instructions: "Read the source and extract its main points and possible hooks.",
      uses: ["writer", "source"],
      checks: ["Key points and hooks are present in the extracted outline"],
    },
    "write-posts": {
      instructions: "Adapt the source into a draft for each publishing platform.",
      uses: ["writer", "source", "youtube", "instagram", "wordpress", "tiktok-draft"],
      checks: [
        "Each platform has a draft with a clear hook",
        "Each draft reflects the source and suits its platform",
      ],
    },
    "make-media": {
      instructions: "Create requested media assets in the formats needed by each platform.",
      uses: ["writer", "source", "ffmpeg"],
      checks: ["Requested media files exist in the output folder"],
    },
    "upload-drafts": {
      instructions: "Upload each draft to its corresponding platform without publishing it.",
      uses: ["writer", "youtube", "instagram", "wordpress", "tiktok-draft"],
      checks: ["Each platform confirms its draft was uploaded"],
    },
    publish: {
      instructions: "Ask before publishing each approved post to its platform.",
      uses: ["writer", "youtube", "instagram", "wordpress", "tiktok-draft", "tiktok-browser"],
      checks: ["The platform confirms each approved post is published"],
    },
    "collect-metrics": {
      instructions: "Collect available post metrics and ask the user to review the lessons.",
      uses: ["writer", "youtube", "instagram", "wordpress", "tiktok-draft"],
      checks: ["Available platform metrics are collected", "You review the metrics and lessons"],
    },
  },
};
const reasons: Record<string, string> = {
  worker: "Runs the research and writing steps.",
  coder: "Builds and reviews the Flutter screens.",
  writer: "Writes and prepares the platform drafts.",
  sources: "Supplies the files cited in the report.",
  output: "Stores the finished reports.",
  pandoc: "Converts the report into a Word document.",
  figma: "Reads the selected design frames.",
  "figma-seat": "Grants access to the Figma file.",
  flutter: "Analyzes and tests the Flutter app.",
  git: "Pushes the finished branch for review.",
  project: "Contains the Flutter app and generated design files.",
  mail: "Reads threads and saves or sends approved replies.",
  "mail-account": "Connects the mailbox used for replies.",
  sheet: "Supplies lead details and stores their follow-up status.",
  source: "Supplies the material for the posts.",
  youtube: "Stores and publishes the YouTube draft.",
  instagram: "Stores and publishes the Instagram post.",
  wordpress: "Stores and publishes the WordPress post.",
  "tiktok-draft": "Uploads the TikTok draft.",
  "tiktok-browser": "Provides the optional browser session for TikTok.",
  ffmpeg: "Prepares video assets when media is requested.",
};
const summaries: Record<string, string> = {
  "documents-and-reports": "Turn supplier files into a sourced report.",
  "figma-to-flutter": "Build Flutter screens from selected design frames.",
  "email-triage": "Sort unread threads and prepare replies for review.",
  "lead-follow-up": "Qualify new leads and prepare personal follow-ups.",
  "social-posts": "Adapt one source into drafts for several platforms.",
};
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
    sensitive: type === "account" || type === "browser_session" || key === "mail",
    why: reasons[key] ?? "Runs the review work.",
    routes: [],
  }));
  const steps: Step[] = specs.map(([key, title, types, summaries, retry]) => ({
    id: key,
    title,
    do: "worker",
    instructions: work[id]?.[key]?.instructions ?? "Review the warehouse contracts and record the findings.",
    uses: work[id]?.[key]?.uses ?? [requirements[0]?.id ?? "worker"],
    ...(key === "send-approved" || key === "publish"
      ? { risky: [key === "publish" ? ("post" as const) : ("send" as const)] }
      : {}),
    outputs: [],
    checks: types.map((type, i) => ({
      type,
      required: true,
      summary: summaries?.[i] ?? work[id]?.[key]?.checks[i] ?? "You approve the review",
    })),
    retry: retry ?? 2,
  }));
  const manifest: FlowManifest = {
    format: "flowdriven-flow/1",
    id: `dev.example.${id}`,
    name,
    summary: summaries[id] ?? "Review supplier contracts across the distribution network.",
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
    playback: {
      goal: name,
      touches: requirements.map((r) => r.ref),
      asksApprovalFor: [
        ...new Set(
          steps.flatMap((step) =>
            (step.risky ?? []).map((action) =>
              action === "send" ? "Sending each reply" : "Publishing each post",
            ),
          ),
        ),
      ],
    },
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
  return records;
}
