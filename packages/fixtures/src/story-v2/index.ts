import {
  type ActivitySummary,
  type Agent,
  type Approval,
  type ChatView,
  DEFAULT_KEEPER,
  FlowDetail,
  FlowManifest,
  type InputView,
  RunDetail,
  type RunSummary,
  type SearchResult,
  type Settings,
  type Skill,
  type StandingRuleView,
} from "@flowdriven/contracts";

export const STORY_V2_NOW = "2026-11-20T03:00:00.000Z";
const account = { kind: "account", value: "timesheet-account", label: "Timesheet account" } as const;
const rule: StandingRuleView = {
  id: "rule-1",
  flowId: "example.fill-timesheet",
  touchId: "log-hours",
  sentence: "Log hours",
  effect: "change",
  place: account,
  createdAt: STORY_V2_NOW,
  createdBy: "always_allow",
};
const specs = [
  {
    id: "example.build-apk",
    name: "Build APK and upload it",
    result: "report",
    touches: [
      { id: "read-sources", sentence: "Read app sources", effect: "read", covers: ["app-sources"] },
      { id: "build", sentence: "Build the APK", effect: "run_command", covers: ["flutter build apk"] },
      { id: "write-build", sentence: "Write the build", effect: "local_write", covers: ["builds-out"] },
      {
        id: "upload-apk",
        sentence: "Upload the APK",
        effect: "change",
        place: { kind: "folder", value: "cloud:Builds", label: "Builds folder" },
        covers: ["cloud-storage.upload"],
      },
      {
        id: "post-note",
        sentence: "Post a note",
        effect: "post",
        place: { kind: "site", value: "team.example.test", label: "Team channel" },
        covers: ["social.post"],
      },
    ],
  },
  {
    id: "example.fill-timesheet",
    name: "Fill timesheet",
    result: "chat",
    touches: [
      {
        id: "read-calendar",
        sentence: "Read the calendar",
        effect: "read",
        covers: ["calendar.read_events"],
      },
      {
        id: "log-hours",
        sentence: "Log hours",
        effect: "change",
        place: account,
        covers: ["timesheet.log_entry"],
      },
    ],
  },
  {
    id: "example.weekly-supplier-report",
    name: "Weekly supplier report",
    result: "report",
    touches: [
      { id: "read-orders", sentence: "Read orders", effect: "read", covers: ["orders"] },
      {
        id: "send-report",
        sentence: "Send the report",
        effect: "send",
        place: { kind: "address", value: "boss@example.test", label: "boss@example.test" },
        covers: ["Gmail.send_message"],
      },
    ],
  },
  {
    id: "example.email-triage",
    name: "Email triage",
    result: "chat",
    touches: [
      { id: "read-mail", sentence: "Read mail", effect: "read", covers: ["Gmail.search_threads"] },
      { id: "reply", sentence: "Reply to whoever wrote", effect: "send", covers: ["Gmail.reply"] },
      {
        id: "summary-to-me",
        sentence: "Send a summary",
        effect: "send",
        place: { kind: "address", value: "me@example.test", label: "your own address" },
        covers: ["Gmail.send_message"],
      },
      {
        id: "clean-up",
        sentence: "Clean up mail",
        effect: "delete",
        place: { kind: "account", value: "gmail", label: "Gmail" },
        covers: ["Gmail.trash_thread"],
      },
    ],
  },
  { id: "example.job-review", name: "Job review", result: "report", touches: [] },
] as const;
const inputs: InputView[] = [
  {
    id: "date",
    label: "Date",
    type: "date",
    required: false,
    default: { kind: "today" },
    remember: false,
    line: "default",
  },
  {
    id: "start",
    label: "Start",
    type: "time",
    required: false,
    default: { kind: "value", value: "next free time" },
    remember: false,
    line: "default",
  },
  { id: "duration", label: "Duration", type: "duration", required: true, remember: false, line: "asks" },
  {
    id: "customer",
    label: "Customer",
    type: "text",
    required: false,
    remember: true,
    remembered: "Example Corp",
    line: "remembers",
  },
  {
    id: "project",
    label: "Project",
    type: "text",
    required: false,
    remember: true,
    remembered: "Project Example",
    line: "remembers",
  },
  {
    id: "activity",
    label: "Activity",
    type: "choice",
    required: false,
    remember: true,
    remembered: "Feature work",
    line: "remembers",
    choices: ["Meeting", "Bug fix", "Feature work"].map((label) => ({ key: label, label })),
  },
  { id: "did", label: "What you did", type: "longtext", required: true, remember: false, line: "asks" },
];
const hashes = [
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
];
const schedule = { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false } as const;
const flows = specs.map((spec, index) => {
  const ownInputs = spec.id === "example.fill-timesheet" ? inputs : [];
  const touches = spec.touches.map((touch) => ({
    ...touch,
    rule: touch.effect === "read" ? "runs_alone" : "asks_first",
  }));
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.2",
    id: spec.id,
    name: spec.name,
    summary: spec.name,
    description: spec.name,
    version: "1.0.0",
    license: "MIT",
    kind: "build",
    inputs: ownInputs.map((input) => ({
      id: input.id,
      label: input.label,
      type: input.type,
      required: input.required,
      remember: input.remember,
      ...(input.id === "date" ? { default: "today" } : {}),
      ...(input.choices ? { choices: input.choices } : {}),
    })),
    outputs: [],
    requirements: [],
    defaults: {},
    result: { kind: spec.result },
    touches,
    steps: [
      {
        id: "work",
        title: spec.name,
        do: "worker",
        instructions: spec.name,
        checks: [{ type: "judge", summary: "Check the result" }],
      },
    ],
  });
  const lists = {
    onItsOwn: touches.filter((t) => t.rule === "runs_alone").map((t) => t.id),
    asksFirst: touches.filter((t) => t.rule === "asks_first").map((t) => t.id),
    never: [],
  };
  const summary = {
    id: spec.id,
    name: spec.name,
    summary: spec.name,
    state: "confirmed",
    live:
      spec.id === "example.fill-timesheet"
        ? "needs_you"
        : spec.id === "example.weekly-supplier-report"
          ? "running"
          : null,
    steps: [{ id: "work", title: spec.name }],
    schedule,
    result: spec.result,
    asksFor: ownInputs.filter((i) => i.required).map((i) => i.label),
    format: "flowdriven-flow/1.2",
    createdAt: STORY_V2_NOW,
  };
  return FlowDetail.parse({
    summary,
    description: spec.name,
    hash: hashes[index],
    confirmed: { hash: hashes[index], at: STORY_V2_NOW },
    version: "1.0.0",
    steps: [
      {
        id: "work",
        title: spec.name,
        kind: "worker",
        asksFirst: touches.some((t) => t.rule === "asks_first"),
        judgedOnly: true,
      },
    ],
    inputs: ownInputs,
    result: { kind: spec.result },
    touches: touches
      .map((touch) => ({
        ...touch,
        fixedPlace: "place" in touch,
        alwaysAsks: ["send", "post", "delete"].includes(touch.effect),
        declared: touch.rule,
        list: touch.rule === "runs_alone" ? "on_its_own" : "asks_first",
        ...(touch.id === "log-hours" ? { byRule: rule.id, list: "on_its_own" } : {}),
        covers: undefined,
        rule: undefined,
      }))
      .map(({ covers: _covers, rule: _rule, ...touch }) => touch),
    lists:
      spec.id === "example.fill-timesheet"
        ? { ...lists, onItsOwn: [...lists.onItsOwn, "log-hours"], asksFirst: [] }
        : lists,
    confirmLists: lists,
    rules: spec.id === "example.fill-timesheet" ? [rule] : [],
    pinsNeeded: [],
    recentRuns: [],
    manifest,
  });
});
const runSpecs = [
  ["run-timesheet-wait", 1, "waiting_approval"],
  ["run-supplier-running", 2, "running"],
  ["run-apk-done", 0, "done"],
  ["run-review-signin", 4, "needs_login"],
  ["run-email-failed", 3, "failed"],
  ["run-supplier-blocked", 2, "blocked"],
  ["run-timesheet-interrupted", 1, "interrupted"],
  ["run-apk-stopped", 0, "stopped"],
] as const;
const runSummaries: RunSummary[] = runSpecs.map(([id, index, state], position) => ({
  id,
  flowId: specs[index].id,
  flowName: specs[index].name,
  flowVersion: "1.0.0",
  flowHash: hashes[index] ?? "",
  source: "chat",
  agent: "claude-code",
  model: "sonnet-5.5",
  chatId: "c1",
  versionChanged: false,
  oneTime: false,
  project: "Project Example",
  state,
  startedAt: `2026-11-${String(20 - position).padStart(2, "0")}T02:00:00.000Z`,
}));
const runs = runSummaries.map((summary) =>
  RunDetail.parse({
    ...summary,
    inputs: [],
    steps: [],
    notes: [],
    skippedStarts: [],
    attemptLog: [],
    approvalIds: summary.id === "run-timesheet-wait" ? ["decision-1"] : [],
    outputs: [],
    usage: [],
    estimatedCostUsd: 0,
    decisionLines: [],
    costLine: { kind: "plan" },
    canRunAgain: true,
    canTryAgain: ["blocked", "failed", "interrupted", "needs_login"].includes(summary.state),
  }),
);
const decision: Approval = {
  id: "decision-1",
  kind: "risky_action",
  effect: "change",
  place: account,
  fixedPlace: true,
  canAlwaysAllow: true,
  stepWaiting: 1,
  chatId: "c1",
  flowId: "example.fill-timesheet",
  flowName: "Fill timesheet",
  runId: "run-timesheet-wait",
  stepId: "log-hours",
  stepTitle: "Log hours",
  summary: "Create the timesheet entry",
  payload: { kind: "text", text: "Log work for Project Example" },
  editable: false,
  createdAt: STORY_V2_NOW,
  state: "pending",
};
const chats: ChatView[] = [
  {
    chat: {
      id: "c1",
      title: "Fill timesheet",
      updatedAt: STORY_V2_NOW,
      from: "person",
      agent: "claude-code",
      model: "sonnet-5.5",
      language: "en",
      waiting: true,
    },
    messages: [
      {
        id: "message-1",
        seq: 0,
        at: STORY_V2_NOW,
        role: "person",
        kind: "text",
        text: "Fill my timesheet",
        outside: false,
      },
      {
        id: "message-2",
        seq: 1,
        at: STORY_V2_NOW,
        role: "flowdriven",
        kind: "card",
        card: { type: "decision", state: "open", decision },
        outside: false,
      },
    ],
    more: false,
    turn: { state: "idle", queued: 0 },
    composerText: "",
  },
];
const activity: ActivitySummary = {
  needsYou: [{ kind: "decision", decision }],
  needsYouCount: 1,
  running: runSummaries.slice(1, 2),
  earlier: runSummaries.slice(2).map((run) => ({ kind: "run", run })),
};
const agents: Agent[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    maker: "Anthropic",
    state: "ready",
    accountLine: { key: "agent.ready" },
    risk: "gray",
    riskNote: { key: "agent.risk" },
    canSetUp: true,
    billing: "plan",
    defaultModel: "sonnet-5.5",
    models: [
      { id: "opus-5.5", name: "Opus 5.5", note: "mostCapable", isDefault: false },
      { id: "sonnet-5.5", name: "Sonnet 5.5", note: "fastCapable", isDefault: true },
    ],
    capability: { tier: "enforced", accountTools: true },
  },
  {
    id: "codex",
    name: "Codex",
    maker: "OpenAI",
    state: "not_installed",
    accountLine: { key: "agent.notInstalled" },
    risk: "official",
    riskNote: { key: "agent.risk" },
    canSetUp: true,
    billing: "plan",
    defaultModel: "gpt-6.1-sol",
    models: [
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", note: "allRound", isDefault: true },
      { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", note: "carefulCoding", isDefault: false },
      { id: "gpt-6-luna", name: "GPT-6 Luna", note: "fastest", isDefault: false },
    ],
    capability: { tier: "folder_limited", accountTools: false },
  },
];
const settings: Settings = {
  language: "en",
  agentPermission: "on",
  mainAgent: { agent: "claude-code", model: "sonnet-5.5" },
  busyFallback: false,
  spendingLimit: 100,
  spending: { month: "2026-11", spentUsd: 0, limitUsd: 100, state: "ok", allOnPlans: true },
  keeper: DEFAULT_KEEPER,
};
const skills: Skill[] = [
  {
    id: "timesheet-skill",
    name: "timesheet-skill",
    about: "Log work and check your timesheet",
    origin: "agent",
    agentId: "claude-code",
    usedBy: [{ flowId: "example.fill-timesheet", name: "Fill timesheet" }],
    readable: true,
  },
];
const searchResults: SearchResult[] = [
  {
    recent: true,
    chats: [{ chatId: "c1", title: "Fill timesheet", updatedAt: STORY_V2_NOW, outside: false }],
    flows: flows.map((flow) => ({
      flowId: flow.summary.id,
      name: flow.summary.name,
      summary: flow.summary.summary,
    })),
  },
];
export function buildStoryV2() {
  return structuredClone({
    flows,
    chats,
    runs,
    runSummaries,
    decisions: [decision],
    rules: [rule],
    activity,
    agents,
    settings,
    skills,
    searchResults,
  });
}
