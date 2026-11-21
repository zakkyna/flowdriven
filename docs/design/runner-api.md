# FlowDriven runner API (contract version 2)

Status: complete for the V1 build, 2026-11-21.

This file is the runner API contract version 2: every operation the renderer (and later a paired phone and other AI tools on this Mac) can call, the read models they return, the cards of the chat and their actions, the events and notices, the error codes, and the IPC layer between the window, Electron main and the runner. It lives in `packages/contracts` and extends contract version 1; most operations stay. The architecture decisions it follows are in `architecture.md` (AD-02 processes, AD-03 contract, AD-06 and AD-07 decisions and rules, AD-10 assistant, AD-13 starts, AD-14 words, AD-15 appearance, AD-16 renderer). The stored entities behind these read models are in `data-model.md`. Safety rules `SR-1` to `SR-9` and the start rule `START` are defined in `architecture.md`.

Contract version 2 holds the V1 operations only. The later operations of V2 and V3 are sketched in section 13; they raise the contract version when they ship. Changing the contract is its own build step (B-01).

## 1. What changes from version 1

| Group | Kept (some changed) | New | Retired |
|---|---|---|---|
| Runner | `runner.info` | - | - |
| Agents | - | `agents.list`, `agents.setUp`, `agents.signIn`, `agents.rescan`, `agents.models` | `harnesses.list`, `harnesses.rescan`, `harnesses.setConsent` |
| Settings | `settings.get`, `settings.update` | - | - |
| Chats | - | `chats.list`, `chats.get`, `chats.create`, `chats.send`, `chats.act`, `chats.setAgent`, `chats.setComposer`, `chats.delete` | - |
| Flows | `flows.list`, `flows.get`, `flows.import` | `flows.start`, `flows.confirm`, `flows.setSchedule`, `flows.tryNextRun`, `flows.duplicate`, `flows.delete` | `flows.build`, `flows.update`, `flows.run`, `flows.capabilities`, `flows.allowCapabilities`, `flows.withdrawCapabilities` |
| Starts | - | `starts.next` | - |
| Runs | `runs.list`, `runs.status`, `runs.report`, `runs.export`, `runs.resume` | `runs.stop` | `queue.list`, `queue.move`, `usage.summary` |
| Decisions | `approvals.list`, `approvals.resolve`, `approvals.answer` | `approvals.resolveSimilar` | - |
| Rules | - | `rules.list`, `rules.revoke` | - |
| Activity, Search, Skills | - | `activity.summary`, `search.query`, `skills.list`, `skills.makeFlow` | - |
| Other | `audit.list`, `readiness.check`, `readiness.install`, `triggers.list`, `triggers.setEnabled` | - | - |

19 operations stay (most change a shape or a table field), 28 are new and 12 retire: contract version 2 has 47 live operations. The 12 retired names stay in the table as retired entries while the builder-first screens stay in the code, unrouted (chair decision for V1, revisable): the real runner answers each `unavailable` with reason `retired` (section 7).

## 2. Conventions

### 2.1 Schemas

- Every input and output is a zod 4 schema in `packages/contracts/src/`, run with `z.config({ jitless: true })` (`config.ts`; guarded by `jitless.test.ts`), so zod never builds code at run time.
- New objects are `z.strictObject`: an unknown key is refused. Every string has a maximum length and every array a maximum size, given in the sketches below.
- Shared primitives in `common.ts`: `Id` (v2: `^[A-Za-z0-9._:-]{1,100}$`), the id aliases below, `IsoDateTime`, `ContentHash`, `SemVer`, and the new `Line`, `Place` and `ModelId` (`^[a-z][a-z0-9.-]{0,63}$`, the pattern the Claude Code adapter already enforces).
- New files: `chat.ts`, `card.ts`, `rules.ts`, `agents.ts`, `activity.ts`, `search.ts`, `skills.ts`, `starts.ts` and `window.ts` (all new; `window.ts` holds the window API schemas of section 12.1); `run.ts`, `approval.ts`, `flow.ts`, `settings.ts`, `notice.ts`, `operations.ts`, `client.ts`, `wire.ts` and `version.ts` change. `CONTRACT_VERSION = 2`.

```ts
type FlowId = Id; type RunId = Id; type StepId = Id; type DecisionId = Id; type RuleId = Id;
type ChatId = Id; type MessageId = Id; type DraftId = Id; type QuestionId = Id; type StartId = Id;
type AgentId = string;      // ^[a-z][a-z0-9-]{0,31}$: "claude-code", "codex"
type SkillId = Id;          // "claude-code:<name>", "flowdriven:<name>"
type TouchId = string;      // ^[a-z0-9][a-z0-9-]{0,63}$
type LanguageCode = string; // ^[a-z]{2,3}(-[A-Z]{2})?$ and one of the codes main passes at spawn (--languages), from apps/desktop/src/i18n/languages.ts
```

### 2.2 The operation table

`operations` in `operations.ts` stays a const record checked with `satisfies`. Version 2 adds three fields:

```ts
type OperationDef = {
  input: z.ZodType;
  output: z.ZodType;
  errors: readonly RunnerErrorCode[];   // codes the handler may return (section 11)
  reasons: readonly ErrorReason[];      // new: stable reasons the handler may return
  reads: readonly RunnerTopic[];        // a query refetches when an event names one of these
  writes: readonly RunnerTopic[];       // topics the runner marks after this operation changes the store
  mcp: "yes" | "restricted" | "no";     // other AI tools on this Mac (V2)
  mcpRule?: string;                     // required when restricted
  phone: "yes" | "restricted" | "no";   // new: a paired phone (V2)
  phoneRule?: string;                   // required when restricted
  personOnly: boolean;                  // new: it changes a confirmation, decision, standing rule, schedule,
                                        // the agent permission or a limit (SR-2)
  retired?: true;                       // new: a version 1 operation kept for the unrouted screens (section 7)
};
```

Rules that `operations.test.ts` checks over the whole table:
1. The live names are exactly the 47 of section 5 and the retired names exactly the 12 of section 7 (snapshots), so nothing is added or retired by accident.
2. Every name matches `^[a-z]+\.[A-Za-z]+$` (the pattern main checks).
3. `personOnly: true` implies `mcp: "no"` and `phone` is `"no"` or `"restricted"`.
4. Decisions and permissions are never `mcp: "yes"`: no `approvals.*`, `rules.*`, `settings.*`, `flows.confirm`, `flows.setSchedule` or `chats.act` has `mcp: "yes"`.
5. `restricted` has its rule text.
6. `errors`, `reasons`, `reads` and `writes` use only listed values.
7. Every input schema refuses an unknown key.
8. A retired entry has `mcp: "no"` and `phone: "no"`, its real handler answers `unavailable` with reason `retired` and writes nothing, and no routed screen calls it (a source-rule test in `apps/desktop`).

### 2.3 Callers

| Caller | How a call arrives | Release |
|---|---|---|
| `window` | JSON-RPC over the runner's stdio from Electron main, which relays only the app window's calls and its own `starts.next` call for the tray (section 12) | V1 |
| `tool` | the local MCP server inside the runner, when the person turned on "Let other AI tools on this Mac start your flows" | V2 |
| `phone` | the bot module inside the runner, for the paired account only | V2 |

The dispatcher (`service/handlers.ts`, `createDispatcher`) tags each call with its caller and refuses an operation the caller may not use (`not_allowed`, reason `caller_not_allowed`). V1 has only the `window` caller. The assistant is not a caller: a chat turn's answer is an intent that `assistant/` turns into messages and cards; `assistant/` has no access to the dispatcher or to the writers of confirmations, decisions, rules, schedules or settings (a source-rule test checks the imports).

### 2.4 Outcomes and errors

- What the person should see is data in the output: a start that asked instead of starting, a form with invalid fields, a run that is still stuck.
- An error means the call changed nothing: `RunnerError(code, message, {reason?, params?})`. `message` is an English line for logs and tests and is never shown. The renderer picks its words from `reason` and `params` through `apps/desktop/src/i18n`, and from `code` when there is no reason.

### 2.5 Words and text

- No words in `packages/*` (AD-14, chair decision for V1, revisable): the runner and the contracts carry codes, `Line` values and typed values, and everything a person reads is drawn in `apps/desktop`, by the renderer or, for system notifications and the menu bar menu, by Electron main. `packages/contracts/src/line-keys.ts` (new) lists every `Line` key the runner may emit (`LINE_KEYS`); `en.ts` must have each, which TypeScript and the language check verify.
- Outputs carry codes and `Line` values (`{key, params}`); the renderer draws them in the app language, or for chat lines in the language stored with the message (AD-14). `params` hold raw values: names and text as they are, numbers as numbers, and moments as `IsoDateTime` (a param named `at` or `until`, or ending in `At`), which the renderer formats in the line's language and the person's zone.
- Text written by a person, an agent or a flow author passes through as text with its `outside` mark (SR-5); the renderer draws it with the safe text renderer (AD-16).

### 2.6 Time and paging

- Moments are UTC `IsoDateTime`; the renderer shows them in the person's zone. Schedule times are `HH:MM` local.
- A list that can grow takes `limit` (1 to 200, default 50) and `before` (the `IsoDateTime` of the last row of the previous page); it returns newest first.

## 3. Shared types

```ts
type StartSource = "chat" | "flows" | "again" | "schedule" | "after" | "try_next" | "proactive" | "phone" | "tool";
type RunState = "queued" | "checking" | "running" | "waiting_approval" | "needs_login" | "retrying"
  | "blocked" | "interrupted" | "stopped" | "done" | "failed";           // v2 adds needs_login and stopped
type StepRunState = "pending" | "running" | "retrying" | "waiting_approval" | "passed" | "failed"
  | "skipped" | "interrupted" | "stopped";                               // v2 adds stopped
type ApprovalState = "pending" | "approved" | "approved_edited" | "rejected" | "expired" | "allowed_always";
type ApprovalDecision = "approve" | "edit" | "reject" | "always_allow";   // v2 adds always_allow
type ApprovalKind = "risky_action" | "flow_sign_off" | "result_sign_off" | "budget_raise"
  | "requirement_addition" | "ask" | "weekly_limit";                     // unchanged
type ResolvedVia = "window" | "chat" | "phone" | "rule" | "expiry" | "stop" | "permission_off";
type FlowState = "new" | "changed" | "confirmed";
type AgentState = "not_installed" | "installing" | "waiting_login" | "needs_login" | "ready" | "unknown";
type TouchRule = "runs_alone" | "asks_first" | "not_allowed";
type Effect = "read" | "local_write" | "run_command" | "change" | "send" | "post" | "pay" | "delete" | "merge";
type Place = { kind: "account" | "folder" | "address" | "site" | "command" | "repo"; value: string; label: string };
type Line = { key: string; params?: Record<string, string | number> };  // key ^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9_]*)+$, at most 100; values at most 400
type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type ScheduleSpec =                                  // input
  | { type: "manual" }
  | { type: "daily" | "weekdays"; time: string; whenItsTime?: "ask" | "last" }   // time ^([01]\d|2[0-3]):[0-5]\d$
  | { type: "weekly"; day: Weekday; time: string; whenItsTime?: "ask" | "last" }
  | { type: "after"; afterFlowId: FlowId; whenItsTime?: "ask" | "last" };
type ScheduleView = {                                // output
  type: "manual" | "daily" | "weekdays" | "weekly" | "after";
  time?: string; day?: Weekday;
  afterFlow?: { id: FlowId; name: string };
  whenItsTime: "ask" | "last";
  needsAnswers: boolean;      // the flow has required inputs without a value: show "When it's time"
  canUseLast: boolean;        // the last answers cover the required inputs ("Use my last answers" enabled)
  firstRunNote: boolean;      // no done run yet: turning on a time schedule runs it once now (FS-j28.P11)
  nextAt?: IsoDateTime;       // next slot of a time schedule
};

type StartOutcome =
  | { outcome: "started"; startId: StartId; runId: RunId; chatId?: ChatId }
  | { outcome: "asked"; startId: StartId; chatId: ChatId; questionId: QuestionId; reused: boolean }
  | { outcome: "needs_confirmation"; startId: StartId; chatId: ChatId; questionId: QuestionId; reused: boolean }
  | { outcome: "refused"; startId: StartId; reason: "permission_off" | "daily_limit" | "flow_deleted" | "agent_cannot_be_limited" };

type CauseCode =
  | "agent_signed_out" | "site_sign_in" | "permission_off" | "agent_not_set_up" | "usage_limit" | "spending_limit"
  | "checks_failing" | "requirement_missing" | "flow_not_confirmed" | "limits_not_applied" | "crash"
  | "step_failed" | "stopped" | "flow_deleted" | "agent_cannot_be_limited" | "daily_limit" | "cost_not_reported" | "internal_error";
type Cause = { code: CauseCode; params?: Record<string, string> };   // params: agent, site, step, tries, until, missing, flow

type InputProblem = "empty" | "unreadable" | "zero" | "too_long" | "too_long_text" | "out_of_range"
  | "not_a_choice" | "hidden_characters";
type FieldProblem = { inputId: string; problem: InputProblem; params?: { min?: number; max?: number } };
```

`Cause` and the run state give the plain-words row of FS-j25.P4: for example `blocked` with `usage_limit` reads "Claude Code has no usage left right now. It will be available again at 14:05." with "Try again", and `stopped` with `permission_off` reads "Stopped because you turned off permission." `InputProblem` and the input type give the parser messages of FS-j27.E3: (`date`, `unreadable`) "Which date?"; (`duration`, `zero`) "How long? Zero hours can't be logged."; (`duration`, `too_long`) "That's more than a working day. How long did you work?"; (`number`, `out_of_range`) "Enter a number from <min> to <max>."; (`file`, `empty`) "Choose <label>."; (`longtext`, `too_long_text`) "Keep it under 4,000 characters."

## 4. Read models

### 4.1 Flows

```ts
type FlowSummary = {
  id: FlowId; name: string; summary: string;
  state: FlowState;
  live: "running" | "needs_you" | null;          // an active run; a pending decision or open question of the flow
  steps: { id: StepId; title: string }[];        // for the track; at most 50
  schedule: ScheduleView;
  result: "chat" | "report";
  asksFor: string[];                             // labels of required inputs with no default and no remembered answer
  lastRun?: { runId: RunId; state: RunState; at: IsoDateTime };
  madeFromSkill?: { skillId: SkillId; name: string };
  format: "flowdriven-flow/1.1" | "flowdriven-flow/1.2";
  createdAt: IsoDateTime;
};
type FlowDetail = {
  summary: FlowSummary;
  description: string;
  hash: ContentHash;                             // the head version
  confirmed?: { hash: ContentHash; at: IsoDateTime };
  version: SemVer;                               // never shown to the person
  steps: { id: StepId; title: string; kind: StepDo; asksFirst: boolean; skill?: string; judgedOnly: boolean }[];
  inputs: InputView[];
  result: { kind: "chat" | "report"; answer?: string[] };
  touches: TouchView[];
  lists: { onItsOwn: TouchId[]; asksFirst: TouchId[]; never: TouchId[] };          // what applies now
  confirmLists: { onItsOwn: TouchId[]; asksFirst: TouchId[]; never: TouchId[] };   // pre-placement for the confirm dialog
  rules: StandingRuleView[];                     // active
  pinsNeeded: { requirementId: string; label: string; access: "read" | "read_write" }[];   // folders to pin at confirm
  changes?: { sign: "+" | "-" | "~"; text: string }[];   // state changed: what differs from the confirmed version
  recentRuns: RunSummary[];                      // newest five
  manifest: FlowManifest;                        // the existing read model, extended for format 1.2
};
type InputView = {
  id: string; label: string; type: InputType; required: boolean;
  example?: string; choices?: { key: string; label: string }[];
  default?: { kind: "value"; value: string } | { kind: "today" } | { kind: "now" };
  remember: boolean;
  remembered?: string;                           // the remembered value as text; never for date or time
  line: "remembers" | "default" | "asks" | "optional";   // FS-j21.S3
};
type TouchView = {
  id: TouchId; sentence: string; effect: Effect; place?: Place; fixedPlace: boolean;
  declared: TouchRule;                           // the rule in the flow file
  list: "on_its_own" | "asks_first" | "never";   // what applies now
  byRule?: RuleId;                               // on its own because of a standing rule: "(you allowed this)"
};
type StandingRuleView = {
  id: RuleId; flowId: FlowId; touchId: TouchId; sentence: string; effect: Effect; place: Place;
  createdAt: IsoDateTime; createdBy: "always_allow" | "confirm"; lastUsedAt?: IsoDateTime;
};
```

`confirmLists` follows SR-1: reads are under "Does on its own"; declared `local_write` and `run_command` too; a `change` with a fixed place is under "Does on its own" for a draft or a change made in the chat; risky kinds and anything without a fixed place are under "Asks you first"; an installed flow (V3) pre-places only reads. Version 1's `kind`, `saved`, `signOff`, `stepCount`, `playback`, `conversation`, `stepStatus` and `canUndo` are gone (mapping: `signOff.state` `approved` -> `confirmed`, `stale` -> `changed`, `none` -> `new`).

### 4.2 Runs

```ts
type RunSummary = {
  id: RunId; flowId: FlowId; flowName: string; flowVersion: SemVer; flowHash: ContentHash;
  state: RunState;
  source: StartSource;
  startWords?: Line;                             // "Started by itself at 14:00", "Started by itself after <flow> finished."
  agent: AgentId; model?: ModelId;               // recorded at start; a version 6 run has no model
  chatId?: ChatId;
  startedAfter?: { runId: RunId; flowName: string };
  behind?: { runId: RunId; needsYou: boolean };  // queued behind an earlier run of the flow: "The earlier run needs you first."
  waiting?: Waiting;                             // as today: memory, quota, ceiling, flow_overlap
  cause?: Cause;
  currentStep?: { index: number; count: number; title: string };   // the F-04.R6 rule
  versionChanged: boolean;                       // the flow changed since this run's version (FS-j25.P10)
  startedAt: IsoDateTime; endedAt?: IsoDateTime;
  reportFirstLine?: string;
  oneTime: boolean; project: string;             // kept from version 1
  trigger?: RunTrigger;                          // kept: format 1.1 manifest triggers
};
type RunDetail = RunSummary & {
  // kept from version 1: inputs, steps, approvalIds, outputs, usage, calls, estimatedCostUsd, report, blockedReason
  decisionLines: Line[];                         // the honest lines (AD-12)
  answer?: { lines: string[]; chatId?: ChatId; messageId?: MessageId };
  costLine: { kind: "plan" } | { kind: "amount"; usd: number } | { kind: "none" };   // "Included in your plan"
  canRunAgain: boolean;                          // the flow still exists
  canTryAgain: boolean;                          // blocked with a cause FlowDriven can re-check, interrupted, or needs_login
};
type RunReport = {                               // changed: version 1's saveOffer is gone
  runId: RunId;
  lines: string[];                               // up to three report lines from the run
  decisionLines: Line[];
  result: { kind: "chat" | "report"; answer?: string[] };
};
```

The screens never show `usage`, `calls` or token numbers (FS-j25.A2); the fields stay for tests and diagnostics.

### 4.3 Decisions

```ts
type Approval = {
  id: DecisionId; kind: ApprovalKind; state: ApprovalState;
  flowId?: FlowId; flowName?: string; runId?: RunId; stepId?: StepId; stepTitle?: string; itemKey?: string;
  summary: string;                               // the title, at most 200
  payload: Payload;                              // unchanged union: email, post, diff, amount, text, choice
  editable: boolean;                             // email and text payloads only
  outside?: boolean;
  riskyAction?: RiskyAction;                     // send, post, pay, delete, merge
  effect?: Effect;                               // required for risky_action in v2
  place?: Place; fixedPlace?: boolean;
  canAlwaysAllow: boolean;                       // risky_action, fixed place not taken from outside text, pending, and the caller is the window
  similarGroup?: string; similarWaiting?: number;   // "Approve all similar (N)"
  stepWaiting: number;                           // other pending decisions of the same step
  createdAt: IsoDateTime; expiresAt: IsoDateTime;
  resolvedAt?: IsoDateTime; resolvedVia?: ResolvedVia;
  picks?: string[]; editedSubject?: string; editedText?: string;
  chatId?: ChatId; ruleId?: RuleId;
};
```

Refinements: `ask` exactly when the payload is `choice` (as today); `risky_action` needs `effect`, and `riskyAction` exactly when `effect` is one of the five risky kinds; `weekly_limit` and `budget_raise` have a text payload and no run, step or item. The runner creates `ask`, `result_sign_off`, `risky_action`, `weekly_limit` and `budget_raise`; `flow_sign_off` and `requirement_addition` stay in the enum and are never created (a flow change goes through Improve with chat).

### 4.4 Chats

```ts
type ChatSummary = {
  id: ChatId; title: string; updatedAt: IsoDateTime; from: "person" | "flowdriven";
  agent: AgentId; model: ModelId; language: LanguageCode;
  waiting: boolean;                              // has an open waiting question
};
type ChatView = {
  chat: ChatSummary & { subject?: { kind: "make" | "improve" | "skill" | "flow" | "change_draft"; flowId?: FlowId } };
  messages: MessageView[];                       // ascending by seq
  more: boolean;                                 // older messages exist (page with before)
  turn: { state: "idle" | "queued" | "thinking"; queued: number };   // the working indicator
  composerText: string;
  starters?: { index: number; label: Line; code: "run" | "run_chain" | "make_flow" | "status"; flowIds?: FlowId[] }[];   // an empty chat only
};
type MessageView = {
  id: MessageId; seq: number; at: IsoDateTime;
  role: "person" | "agent" | "flowdriven";
  kind: "text" | "reply" | "line" | "note" | "result" | "card";
  text?: string; line?: Line;
  result?: { runId: RunId; lines: string[]; values: Record<string, TypedValue>; language: LanguageCode };   // the flow's answer lines with {inputId} placeholders; the renderer fills them
  card?: CardView;                               // section 8
  chips?: ChipView[];
  language?: string;                             // draw a line in this language
  outside: boolean;
};
type ChipView =
  | { kind: "suggestion"; index: number; label: Line | { text: string } }
  | { kind: "act"; label: Line; action: CardAction }
  | { kind: "open"; label: Line; chatId: ChatId };
type DraftView = {
  id: DraftId; kind: "new_flow" | "change";
  state: "drafted" | "replaced" | "saved" | "cancelled" | "stale";
  name: string; nameAdjusted: boolean;
  flowId?: FlowId;                               // change: its flow; saved: the flow it became
  madeFromSkill?: { skillId: SkillId; name: string };
  steps: { title: string; asksFirst: boolean }[];
  inputs: InputView[];
  result: "chat" | "report";
  schedule: ScheduleView;
  lists: { onItsOwn: TouchView[]; asksFirst: TouchView[]; never: TouchView[] };
  outside: boolean;                              // "Includes text from an email or web page"
  assumptions: string[];
  changes?: { sign: "+" | "-" | "~"; text: string }[];
  rulesKept?: StandingRuleView[]; rulesEnded?: StandingRuleView[];   // "Still allowed by your rule", "Your rule ends"
};
```

### 4.5 Agents, settings, activity, search, skills, audit

```ts
type Agent = {
  id: AgentId; name: string; maker: string;
  state: AgentState; version?: string;
  accountLine: Line;                             // "Sign in with your Claude account"
  risk: "official" | "gray" | "unofficial";      // "Supported", "Check the terms", "Not supported"
  riskNote: Line;
  canSetUp: boolean;                             // the catalog has an install command for this platform
  installCommand?: string;                       // shown only in "Install it yourself" (FS-j01.P1)
  billing: "per_use" | "plan" | "unknown";
  models?: Model[]; defaultModel?: ModelId;      // when ready
  usage?: { status: "ok" | "warning" | "limited" | "unknown"; fiveHour?: number; sevenDay?: number; resetsAt?: IsoDateTime };
  capability: { tier: "enforced" | "folder_limited"; accountTools: boolean };   // AD-09
  setUp?: { phase: "installing" | "waiting_login"; since: IsoDateTime };
  problem?: { code: "install_failed" | "sign_in_timeout" | "too_old" | "unreadable"; detail?: string };
};
type Model = { id: ModelId; name: string; note: "mostCapable" | "fastCapable" | "fastest" | "allRound" | "carefulCoding"; isDefault: boolean };

type Settings = {
  language: LanguageCode;
  agentPermission: "unset" | "on" | "off";
  mainAgent: { agent: AgentId; model: ModelId } | null;
  busyFallback: boolean;
  spendingLimit: number;                         // US dollars a month
  spending: { month: string; spentUsd: number; limitUsd: number; state: "ok" | "warning" | "reached"; allOnPlans: boolean };
  background: { keepRunning: boolean; openAtLogin: boolean };
  keeper: KeeperSettings;                        // unchanged
};

type ActivitySummary = {
  needsYou: NeedsYouItem[];                      // open waiting questions first (oldest first), then decisions, newest first
  needsYouCount: number;                         // the rail number: pending decisions plus open proactive questions
  running: RunSummary[];                         // queued, checking, running, retrying, waiting_approval
  earlier: EarlierRow[];                         // newest first, after the filter
  nextBefore?: IsoDateTime;
};
type NeedsYouItem =
  | { kind: "question"; questionId: QuestionId; questionKind: "inputs" | "confirm"; flowId: FlowId; flowName: string; chatId: ChatId; askedAt: IsoDateTime }
  | { kind: "decision"; decision: Approval };
type EarlierRow =
  | { kind: "run"; run: RunSummary }             // needs_login, blocked, interrupted, stopped, done, failed
  | { kind: "missed"; startId: StartId; flowId: FlowId; flowName: string; slotAt: IsoDateTime;
      reason: "permission_off" | "daily_limit" | "too_old" | "clock_changed"; ranLate?: { runId?: RunId; at: IsoDateTime }; canRunNow: boolean }
  | { kind: "skipped"; startId: StartId; flowId: FlowId; flowName: string; slotAt: IsoDateTime;
      reason: "question_open" | "still_running"; questionAskedAt?: IsoDateTime };

type SearchResult = {
  recent: boolean;                               // the text was empty: recent chats and every flow
  chats: { chatId: ChatId; title: string; updatedAt: IsoDateTime; snippet?: string; outside: boolean }[];   // 5 when recent, else at most 20
  flows: { flowId: FlowId; name: string; summary: string }[];   // every flow when recent (at most 200), else at most 50
};

type Skill = {
  id: SkillId; name: string; about: string;
  origin: "agent" | "flowdriven" | "library"; agentId?: AgentId;   // "Claude Code", "Comes with FlowDriven", "More skills"
  usedBy: { flowId: FlowId; name: string }[];
  lastUsedAt?: IsoDateTime;
  readable: boolean; problem?: "hidden_characters" | "invalid_skill_file" | "too_large";
};

type AuditRecord = {                             // changed: detail is an object, plus the id
  id: number; at: IsoDateTime; kind: string; runId?: RunId;
  detail: Record<string, string | number | boolean | null | string[]>;
};
```

`ReadinessReport`, `TriggerStatus`, `FlowIssue`, `Waiting`, `RunTrigger`, `KeeperSettings` and `Payload` keep their version 1 shapes.

## 5. Operation table

| Operation | Status | Reads | Writes | MCP | Phone | Person only |
|---|---|---|---|---|---|---|
| `runner.info` | changed | - | - | no | no | no |
| `agents.list` | new | agents | agents | no | no | no |
| `agents.setUp` | new | - | agents, settings | no | no | yes |
| `agents.signIn` | new | - | agents | no | no | no |
| `agents.rescan` | new | - | agents | no | no | no |
| `agents.models` | new | agents | - | no | no | no |
| `settings.get` | changed | settings, agents, runs | - | no | no | no |
| `settings.update` | changed | - | settings, agents, runs, approvals, activity | no | no | yes |
| `chats.list` | new | chats | - | no | no | no |
| `chats.get` | new | chats, runs, approvals, flows, agents | - | no | no | no |
| `chats.create` | new | - | chats | no | no | no |
| `chats.send` | new | - | chats | no | no | no |
| `chats.act` | new | - | chats, flows, rules, runs, approvals, activity | no | no | yes |
| `chats.setAgent` | new | - | chats | no | no | no |
| `chats.setComposer` | new | - | - | no | no | no |
| `chats.delete` | new | - | chats, activity | no | no | no |
| `flows.list` | changed | flows, runs, approvals, activity | - | yes | yes | no |
| `flows.get` | changed | flows, runs, rules, activity | - | restricted | no | no |
| `flows.import` | kept, output changed | - | flows, skills | no | no | no |
| `flows.start` | new | - | runs, chats, activity | restricted | restricted | no |
| `flows.confirm` | new | - | flows, rules, chats, activity | no | no | yes |
| `flows.setSchedule` | new | - | flows, runs, chats, activity | no | no | yes |
| `flows.tryNextRun` | new | - | runs, chats, activity | no | no | no |
| `flows.duplicate` | new | - | flows, skills | no | no | no |
| `flows.delete` | new | - | flows, rules, runs, approvals, chats, activity, skills | no | no | yes |
| `starts.next` | new | flows | - | no | no | no |
| `runs.list` | changed | runs | - | no | no | no |
| `runs.status` | changed | runs, approvals | - | restricted | restricted | no |
| `runs.report` | changed | runs | - | no | no | no |
| `runs.export` | changed | - | - | no | no | no |
| `runs.resume` | changed | - | runs, approvals, activity | no | no | no |
| `runs.stop` | new | - | runs, approvals, chats, activity | no | yes | no |
| `approvals.list` | changed | approvals | - | restricted | restricted | no |
| `approvals.resolve` | changed | - | approvals, runs, rules, chats, activity | no | restricted | yes |
| `approvals.answer` | changed | - | approvals, runs, chats, activity | no | restricted | yes |
| `approvals.resolveSimilar` | new | - | approvals, runs, chats, activity | no | no | yes |
| `rules.list` | new | rules | - | no | no | no |
| `rules.revoke` | new | - | rules, flows | no | no | yes |
| `activity.summary` | new | runs, approvals, activity, chats, flows | - | no | restricted | no |
| `search.query` | new | chats, flows | - | no | no | no |
| `skills.list` | new | skills, flows | - | no | no | no |
| `skills.makeFlow` | new | - | chats | no | no | no |
| `audit.list` | changed | runs | - | no | no | no |
| `readiness.check` | kept | readiness, flows | - | no | no | no |
| `readiness.install` | kept | - | readiness, flows | no | no | no |
| `triggers.list` | kept | flows | - | no | no | no |
| `triggers.setEnabled` | kept | - | flows | no | no | yes |

MCP and phone rules (V2; the fields are set in version 2 so the table is checked from the start):
- `flows.get` over MCP: inputs show labels and types only; remembered answers, places and rules are left out.
- `flows.start` over MCP and phone: the source is always `tool` or `phone`, inputs cannot be passed, and missing inputs and confirmations are asked in FlowDriven (`START`).
- `runs.status` over MCP and phone: states, step titles and cause words only; no step outputs and no decision payloads.
- `approvals.list` over MCP: titles, flow names and states only; over the phone: one pending decision at a time, with only the flow, the step and a short summary for runs marked sensitive.
- `approvals.resolve` over the phone: `approve` and `reject` only, one decision at a time, a risky kind needs the second tap ("Tap again to confirm"), never `edit` or `always_allow`. `approvals.answer` over the phone: one tap.
- `activity.summary` over the phone: the Needs-you titles and the running flow names.

## 6. Operations

Each operation lists its input and output, its errors as `code: reason`, its topics, what it does, and the tests to write first. Every handler test runs through the dispatcher (so both schemas apply), on real SQLite in a temporary data folder, with an injected clock, injected ids and the fake agents (`test-plan.md`, layer L3). "Audit" names the audit kinds of `data-model.md`, section 3.16.

### 6.1 Runner

#### `runner.info` (changed)

- Input: `{}`.
- Output: `{contractVersion: number; appVersion: SemVer; storeVersion: number; mode: "sample" | "demo" | "live"}`.
- Errors: none.
- Does: answers at once. Main calls it right after spawning the runner, and the renderer calls it first (section 12.5).
- Tests first: schema accepts `contractVersion: 1` (so a mismatch is reported, not a parse error); handler returns `{contractVersion: 2, storeVersion: 7, mode: "live"}`.

### 6.2 Agents

#### `agents.list` (new)

- Input: `{}`. Output: `Agent[]`, in catalog order (Claude Code, Codex).
- Does: the first call after the runner starts waits for detection of every catalog agent (at most 15 seconds; an agent not done by then is `unknown`); later calls return the stored state and refresh it in the background when it is older than 60 seconds, then mark `agents`. Detection never installs anything and never reads an agent's sign-in files (SR-6).
- Tests first: with the fake claude installed and signed in and no codex, the list is `[claude-code ready, codex not_installed]`; a second call within 60 seconds spawns nothing (fake call log); `installCommand` is present only when `canSetUp`.

#### `agents.setUp` (new)

- Input: `{agentId: AgentId}`. Output: `Agent` (state `installing`, `waiting_login` or `ready`); it returns at once and the rest happens in the background.
- Errors: `not_found: agent_unknown`; `conflict: setup_running`; `unavailable: install_unavailable`.
- Topics: writes `agents`, `settings`. Person only.
- Does, in order (FS-j01.S2): sets `agentPermission` to `on` when it is not (audit `permission_changed`, source `window`); for `not_installed`, sets `installing` and runs the catalog install command as a program with arguments, without a shell; on success sets `waiting_login`, starts the agent's own sign-in and polls its status command every 2 seconds until signed in (`ready`) or 10 minutes pass (`needs_login`, problem `sign_in_timeout`); on install failure sets `not_installed` with problem `install_failed`. A `ready` agent only gets the permission ("Use Claude Code"). Audit `agent_setup` for each phase.
- Tests first: the fake agent goes `not_installed -> installing -> waiting_login -> ready` with no further call; the permission is `on` before the install starts; the spawned command equals the catalog entry and has no shell and no bypass or full-access flag (SR-4); a failing install leaves `not_installed` and the permission `on`; with the injected clock at 10 minutes the state is `needs_login` and polling stops; a second call while installing gets `conflict: setup_running`.

#### `agents.signIn` (new)

- Input: `{agentId}`. Output: `Agent` (`waiting_login`).
- Errors: `not_found: agent_unknown`; `not_allowed: agent_not_installed`; `conflict: setup_running`.
- Does: starts the agent's own sign-in and polls as in Set up. It does not need the permission: it runs no flow. Audit `agent_sign_in`.
- Tests first: `needs_login -> waiting_login -> ready` with the fake agent; FlowDriven never reads the fake agent's sign-in file (the fake logs any read).

#### `agents.rescan` (new)

- Input: `{}`. Output: `{agents: Agent[]; found: AgentId[]}`, where `found` lists agents that were `not_installed` or `unknown` and are now installed.
- Does: detection now ("Scan again"). The renderer words the result: "Found Claude Code. ..." or "Nothing new found." (FS-j01.P2).
- Tests first: installing the fake codex between two calls gives `found: ["codex"]`; nothing new gives `found: []`.

#### `agents.models` (new)

- Input: `{agentId}`. Output: `Model[]`, exactly one with `isDefault: true`.
- Errors: `not_found: agent_unknown`; `not_allowed: agent_not_ready`.
- Does: the agent's own list (Claude Code's model names, Codex's list), else the catalog list for that CLI version (AD-08); cached on the agent row.
- Tests first: every id matches `ModelId`; a model the fake agent stops offering disappears after a rescan.

### 6.3 Settings

#### `settings.get` (changed)

- Input: `{}`. Output: `Settings`.
- Does: absent keys read as their defaults (`data-model.md`, 3.18); `spending` is computed for the person's current local month.
- Tests first: an empty store gives `language: "en"`, `agentPermission: "unset"`, `mainAgent: null`, `busyFallback: false`, `spendingLimit: 10`, `background: {keepRunning: true, openAtLogin: true}`; usage rows with `billing` `plan` do not count in `spentUsd`.

#### `settings.update` (changed)

- Input: `{patch: SettingsPatch}` with at least one key.

```ts
type SettingsPatch = {
  language?: LanguageCode;                       // a registered code
  agentPermission?: "on" | "off";
  mainAgent?: { agent: AgentId; model: ModelId };
  busyFallback?: boolean;
  spendingLimit?: number;                        // above the current limit, at most 10000; rounded to cents
  background?: { keepRunning?: boolean; openAtLogin?: boolean };
  keeper?: KeeperPatch;                          // as version 1
};
```

- Output: `Settings`.
- Errors: `invalid_input: language_unknown`, `limit_not_above` (params `limit`), `limit_too_high`, `model_unknown`; `not_allowed: agent_not_ready`.
- Topics: writes `settings`, plus `runs`, `approvals` and `activity` for the permission and the limit, `agents` for the main agent. Person only.
- Does:
  - `agentPermission: "off"` stops every active run (as `runs.stop`, cause `permission_off`), expires their pending decisions (`resolvedVia: "permission_off"`), stops automatic starts (later slots are `missed` with reason `permission_off`) and refuses chat turns. `"on"` lets them start again; a missed slot never runs later (FS-j12.P2). Audit `permission_changed`.
  - `mainAgent` needs a `ready` agent and one of its models; open chats and running runs keep theirs (FS-j12.S4).
  - `spendingLimit` must be above the current limit (FS-j12.A8); raising it above the month's spending clears `spending-pause`, approves its `budget_raise` decision (`resolvedVia: "window"`) and lets the paused runs go on. Audit `limit_raised`.
  - `background` is the person's record; main applies it (section 12.7).
  - Every changed key writes `setting_changed` with the old and new value.
- Tests first: `{spendingLimit: 10}` with limit 10 gives `invalid_input: limit_not_above` and saves nothing; `{spendingLimit: 25.004}` saves 25; turning the permission off with two running fake runs leaves both `stopped`, their decisions `expired`, and audit `permission_changed` with source `window`; `{mainAgent: {agent: "codex", ...}}` with codex `needs_login` gives `not_allowed: agent_not_ready`; a call from a `tool` caller gets `not_allowed: caller_not_allowed` (V2).

### 6.4 Chats

#### `chats.list` (new)

- Input: `{}`. Output: `ChatSummary[]`, every chat, newest `updatedAt` first (F-02.R2). The renderer groups them into Today, Yesterday and Earlier in the person's zone.
- Tests first: a person message moves its chat to the top; a FlowDriven chat appears with `from: "flowdriven"`.

#### `chats.get` (new)

- Input: `{chatId; before?: number (a seq); limit?: 1..500 (default 200)}`. Output: `ChatView`.
- Errors: `not_found`.
- Does: joins live state into cards (runs, decisions, drafts, flows) and derives `stale` and `flow_deleted` (section 8).
- Tests first: a decision card shows the decision's current state after `approvals.resolve`; a card of a deleted flow has state `flow_deleted`; `turn.state` is `thinking` while the fake brain answers.

#### `chats.create` (new)

- Input: `{subject?: {kind: "make"} | {kind: "improve"; flowId: FlowId}}`. Output: `{chatId: ChatId; reused: boolean}`.
- Errors: `not_found: flow_deleted` (improve).
- Does: reuses the newest chat with no messages and moves it to the top, else makes "New chat"; the chat starts on the main agent and its default model, in the app language. `make` posts "Tell me what it should do, in your own words." with the example chip (FS-j22.S2). `improve` posts "What should change in <flow>?" with two chips; the weekday chip is left out when the flow already runs every weekday at 17:00 (FS-j23.A1).
- Tests first: two calls without a message give the same `chatId` with `reused: true`; `improve` on a deleted flow gives `not_found`.

#### `chats.send` (new)

- Input: `{chatId; text: string (1..16000, not blank); pasted?: boolean} | {chatId; starter: number}`. `starter` is the index of one of the empty chat's starter chips; chips under a message use `chats.act` `suggestion`.
- Output: `{messageId: MessageId; turn: "queued" | "not_ready" | "form_open"}`. It returns at once; the answer arrives through the `chats` topic (AD-10).
- Errors: `not_found`; `not_allowed: permission_off` (nothing is stored; the text stays in the composer, FS-j20.E2).
- Does:
  1. Stores the person's message and clears `composerText`. The first person message sets the title (first 40 characters); the chat moves to the top.
  2. With an open form card in the chat: posts "Please fill in the form above, then choose Start." and runs no turn (`form_open`).
  3. With the chat's agent not `ready`: posts an `agent_needed` card and runs no turn (`not_ready`, FS-j20.E1).
  4. Otherwise queues one turn (one at a time per chat). The turn is one agent call with no tools and a JSON schema, on the chat's agent and model, with the compact context (at most 12 turns or 24,000 characters) and the standing instruction to answer in the person's language (AD-10, FS-j30.P5). FlowDriven validates the intent against its own state, then posts the reply, lines and cards. A turn whose context holds outside text (outside messages or `pasted`) only posts cards (SR-5). The chat language changes when the turn reports a registered code for typed text (not for `fromChip`).
  5. An invalid answer is asked for once more; two failures post a `turn_failed` card ("I did not understand that. ...") and audit `chat_turn_failed`.
- Tests first: with the fake brain answering `run` for a confirmed flow with nothing missing, exactly one brain call happens with `tools` empty and a schema, and one run starts with source `chat`; with the brain answering `run` for a flow named alone, a question or a negation, an `ask_run` card is posted and no run starts (FS-j20.A5); with outside text in the context, `run` gives an `ask_run` card (FS-j20.A6); with the permission off nothing is stored; two quick sends give two queued turns answered in order; a context over 24,000 characters is cut to the newest turns.

#### `chats.act` (new)

- Input: `{chatId; messageId} & ChatAct`, where `ChatAct` is the union of section 8.2.
- Output: `{card: CardView; posted: MessageId[]; starts?: StartOutcome[]; fields?: FieldProblem[]}`.
- Errors: `not_found` (message, card, `flow_deleted`); `invalid_input: unknown_action` and value errors; `conflict: card_answered`, `card_replaced`, `card_stale`, `question_answered`, `hash_mismatch`; `not_allowed: permission_off`, `flow_not_confirmed`, `place_not_fixed`, `never_does`.
- Topics: writes `chats`, `flows`, `rules`, `runs`, `approvals`, `activity`. Person only.
- Does: section 8.
- Tests first: one per action in section 8.2, plus the common rules of 8.1 (a second click returns `conflict: card_answered` and changes nothing; an action of another card type gives `unknown_action`).

#### `chats.setAgent` (new)

- Input: `{chatId; agent: AgentId; model: ModelId}`. Output: `ChatSummary`.
- Errors: `not_found` (chat; `agent_unknown`); `invalid_input: model_unknown`; `not_allowed: agent_not_ready`.
- Does: stores the choice for this chat only, posts the note "Now using <agent> · <model>" and audits `chat_agent_changed` (FS-j31.S3). Running runs keep theirs. Later calls use the chosen agent with the chosen model through that agent's own model flag; nothing else in them changes: not the sandbox, the tools, the places or the approvals (SR-4).
- Tests first: other chats and `settings.mainAgent` are unchanged; a model id with a space or a leading dash is refused by the schema; a model the agent did not list gives `model_unknown`.

#### `chats.setComposer` (new)

- Input: `{chatId; text: string (0..16000)}`. Output: `{}`.
- Does: keeps the unsent text (F-03.R1). It marks no topic, so typing never refetches the chat. The renderer calls it at most twice a second.
- Tests first: the text survives a runner restart and comes back in `chats.get`.

#### `chats.delete` (new)

- Input: `{chatId}`. Output: `{deleted: true}`.
- Errors: `not_found`.
- Does: `data-model.md`, section 7.2. The dialog is the renderer's; the call itself deletes.
- Tests first: messages, drafts and questions of the chat are gone; a run started from it keeps running; the audit record holds no message text.

### 6.5 Flows

#### `flows.list` (changed)

- Input: `{}`. Output: `FlowSummary[]`, live flows, newest `createdAt` first.
- Tests first: a deleted flow is not listed; `asksFor` lists "Duration" and "What you did" for the sample timesheet flow; `live` is `needs_you` while its decision waits.

#### `flows.get` (changed)

- Input: `{flowId}`. Output: `FlowDetail`.
- Errors: `not_found` (`flow_deleted` for a tombstone).
- Tests first: a risky touch is in `confirmLists.asksFirst` whatever the flow file says; an active standing rule puts its touch under `on_its_own` with `byRule`; `state` is `changed` after a pinned skill's hash changes.

#### `flows.import` (kept, output changed)

- Input: `{path: string (1..1024, absolute)}`. Output: `{flow?: FlowSummary; issues: FlowIssue[]; hash?: ContentHash}`.
- Does: as today (`loadFlowFolder`, `validateManifest`); a new id arrives `new`; an existing id gets a new version and becomes `changed` unless the hash is the confirmed one. For developers and walk scripts; no V1 screen calls it. Audit `flow_imported`.
- Tests first: importing a changed copy of a confirmed flow makes it `changed` and keeps its schedule.

#### `flows.start` (new)

- Input: `{flowId; source: "flows"} | {flowId; source: "again"; fromRunId: RunId}`. Other sources are never accepted from the window: `chat` starts happen inside `chats.act`, `phone` and `tool` come from their callers, and `schedule`, `after`, `try_next` and `proactive` are the runner's own.
- Output: `StartOutcome`.
- Errors: `not_found` (flow; run).
- Topics: writes `runs`, `chats`, `activity`.
- Does: `starts.request(flowId, source, context)` (`START`): a `new` or `changed` flow posts a confirm card in a FlowDriven chat and a Needs-you item (`needs_confirmation`); missing required inputs post one question in a FlowDriven chat ("<flow> needs a few details.") (`asked`); otherwise the run starts on the main agent and its default model (the busy fallback may apply, FS-j12.P3). `again` takes the inputs of `fromRunId` and runs the flow's current confirmed version (FS-j25.P2). With the permission off: `refused`, `permission_off`, and no run.
- Tests first: on a confirmed flow with nothing missing, one run with `source: "flows"`, `agent.choice: "main"`; on a `changed` flow, no run and a `needs_confirmation` outcome with a confirm card; with missing inputs, no run and one waiting question (FS-j21.A3); `again` uses the earlier run's inputs and the current hash; a `source: "chat"` input is refused by the schema.

#### `flows.confirm` (new)

- Input: `{flowId; hash: ContentHash; onItsOwn: TouchId[] (0..100, unique); pins?: Record<string, string (1..600)> (at most 50)}`.
- Output: `{flow: FlowDetail; rules: {created: RuleId[]; kept: RuleId[]; ended: RuleId[]}}`.
- Errors: `not_found` (`flow_deleted`); `conflict: hash_mismatch` (the hash is not the head); `invalid_input: touch_unknown`, `pins_missing`, `pin_invalid`; `not_allowed: place_not_fixed`, `never_does`.
- Topics: writes `flows`, `rules`, `chats`, `activity`. Person only.
- Does: writes the confirmation for exactly `hash` with `onItsOwn` and the pins; creates a standing rule for each non-read touch in `onItsOwn`, keeps a rule whose touch still exists with the same id, effect and place and is still in `onItsOwn`, and revokes the rest (AD-07); closes the flow's open confirm-kind waiting question; open confirm cards of the flow show as answered and do not start anything. Audit `flow_confirmed`, `rule_created`, `rule_revoked`. The same function serves Save flow, Save change and the `confirm_flow` card action.
- Tests first: confirming hash H2 when the head is H3 gives `conflict: hash_mismatch` and writes nothing; a `send` touch with a fixed place in `onItsOwn` makes one rule; a touch without a fixed place gives `not_allowed: place_not_fixed`; a `not_allowed` touch gives `never_does`; a re-confirm after a change keeps the matching rule and revokes the one whose place changed (FS-j24.A14).

#### `flows.setSchedule` (new)

- Input: `{flowId; hash: ContentHash; schedule: ScheduleSpec}`.
- Output: `{schedule: ScheduleView; firstRun?: StartOutcome}`.
- Errors: `not_found`; `not_allowed: flow_not_confirmed`; `conflict: hash_mismatch`; `invalid_input: schedule_self`, `schedule_loop`, `schedule_target_missing`, `bad_time`, `bad_day`, `last_answers_incomplete`.
- Topics: writes `flows`, `runs`, `chats`, `activity`. Person only.
- Does: needs the flow `confirmed` at `hash` (FS-j21.A6). Refuses an `after` that names the flow itself, a missing flow, or a loop (FS-j21.E3), and `whenItsTime: "last"` when the last answers do not cover the required inputs. `manual` removes the schedule. Turning on a time schedule for a flow with no `done` run saves it and then calls `starts.request(flowId, "try_next", {slotAt: now})`; the outcome is `firstRun` (FS-j28.P11). Audit `schedule_changed`.
- Tests first: `{type: "after", afterFlowId: <itself>}` gives `schedule_self`; an `after` that closes a loop gives `schedule_loop`; `time: "25:00"` is refused by the schema; a first time schedule on a never-run flow returns `firstRun.outcome` `started` or `asked`; an `after` schedule never returns `firstRun`; the flow's hash is unchanged.

#### `flows.tryNextRun` (new)

- Input: `{flowId; missedStartId?: StartId}`. Output: `StartOutcome`.
- Errors: `not_found`; `not_allowed: no_schedule` (a manual flow without `missedStartId`); `conflict: already_ran_late`.
- Does: `starts.request(flowId, "try_next", {slotAt})` with `slotAt` now, or the missed slot for "Run it now" on a "Missed" row (FS-j28.P9; the row then reads "Run late"). An open waiting question is reused (`reused: true`).
- Tests first: twice in a row gives one question and `reused: true` the second time; with `missedStartId`, "today" in the started run resolves to the missed slot's date in `Asia/Jakarta`.

#### `flows.duplicate` (new)

- Input: `{flowId}`. Output: `{flowId: FlowId; name: string}`.
- Does: copies the head version's files into a new flow, "<name> (copy)", state `new`, no schedule, no standing rules, no remembered answers (FS-j21.A17). Audit `flow_duplicated`.
- Tests first: the original's hash, rules and schedule are unchanged; the copy is `new`.

#### `flows.delete` (new)

- Input: `{flowId}`. Output: `{deleted: true; schedulesTurnedOff: FlowId[]}`.
- Errors: `not_found`; `conflict: flow_running`.
- Topics: writes `flows`, `rules`, `runs`, `approvals`, `chats`, `activity`, `skills`. Person only (it ends rules, schedules and the confirmation).
- Does: `data-model.md`, section 7.1.
- Tests first: refused while a run is `running`; afterwards the past runs are still in `runs.list`, the flow scheduled after it is `manual`, its open question is `closed`, and `flows.get` gives `not_found`.

### 6.6 Starts

`starts.request(flowId, source, context)` (`packages/runner/src/starts/start-rule.ts`, new) is internal, not an operation: every start outside a typed chat request reaches it (`START`), and it returns a `StartOutcome` and writes one `starts` row.

#### `starts.next` (new)

- Input: `{withinHours: 1..48}`. Output: `{next?: {flowId: FlowId; flowName: string; at: IsoDateTime}; language: LanguageCode}`; main draws the line in that language.
- Does: the next due time schedule of a confirmed flow. Electron main calls it when the menu bar menu opens, for the line "Quitting stops your schedules. Next: <flow>, <time>." (FS-j28.P10).
- Tests first: with schedules at 17:00 today and 08:00 Monday, `withinHours: 24` at 14:00 gives the 17:00 one; nothing due gives `{}`.

### 6.7 Runs

#### `runs.list` (changed)

- Input: `{flowId?; state?: RunState; source?: StartSource; limit?; before?}`. Output: `RunSummary[]`, newest first.
- Tests first: `source: "schedule"` returns only scheduled runs; paging with `before` returns the next page.

#### `runs.status` (changed)

- Input: `{runId}`. Output: `RunDetail`. Errors: `not_found`.
- Tests first: a run of a deleted flow keeps `flowName` and has `canRunAgain: false`; a run after a flow change has `versionChanged: true`; no field holds a token count except `usage` and `calls`.

#### `runs.report` (changed)

- Input: `{runId}`. Output: `RunReport`.
- Tests first: after a rejection, `decisionLines` holds `{key: "report.youSaidNo", params: {title}}` and no answer line for the skipped action.

#### `runs.export` (changed)

- Input: `{runId}`. Output: `{parts: ExportParts; language: LanguageCode}`, where `ExportParts` is `{flowName; startedAt; endedAt?; state: RunState; cause?: Cause; startWords?: Line; summary: string[]; steps: {title: string; state: StepRunState}[]; decisionLines: Line[]; answer?: {lines: string[]; values: Record<string, TypedValue>}; outside: boolean}`.
- Does: the parts of "Copy report" (`data-model.md`, section 8), built on request and never stored. The runner masks anything that looks like a secret as "[hidden]" and replaces hidden characters with their visible marks in every text part before it returns them; the renderer builds the Markdown in the run's language (`apps/desktop/src/screens/activity/copy-report.ts`, new).
- Tests first: runner (L3): a test secret built at run time appears as "[hidden]" in the parts; a zero-width character built with `String.fromCodePoint(0x200b)` appears as its visible mark; no part holds the run id. Renderer (L2): the Markdown starts with `# <flow>, <when>`, has `Result: <words>`, `Ended: <time>` and `## Summary`, in English and in Bahasa Indonesia (FS-j25.A12).

#### `runs.resume` (changed)

- Input: `{runId}`. Output: `{outcome: "resumed" | "still_stuck"; run: RunSummary}`.
- Errors: `not_found`; `not_allowed: not_resumable` (any state but `blocked`, `interrupted`, `needs_login` and `failed`), `permission_off`, `flow_deleted`.
- Does: "Try again" and "Sign in and continue" (FS-j25.S3, P3): re-checks the cause once; when it is gone, resets failed or interrupted steps to pending and continues from the step that stopped (passed steps are not repeated), on the run's recorded agent and model and its own version; when it is not, `still_stuck` with the cause and no state change. Audit `run_resumed`.
- Tests first: a `needs_login` run whose fake site still asks for sign-in returns `still_stuck` and starts no loop; once signed in it continues without re-running passed steps; a `stopped` run gives `not_resumable`.

#### `runs.stop` (new)

- Input: `{runId}`. Output: `{run: RunSummary; changed: boolean}`.
- Errors: `not_found`.
- Topics: writes `runs`, `approvals`, `chats`, `activity`.
- Does: for `queued`, `checking`, `running`, `retrying`, `waiting_approval` and `needs_login`: ends the agent's process group at once (SR-8), sets the run and its running step `stopped` with cause `stopped`, expires its pending decisions (`resolvedVia: "stop"`) and clears their notices, starts the next queued run of the same flow, and in a chain posts "Stopped. <names> did not start." A run that already ended returns unchanged with `changed: false`. No dialog. Audit `run_stopped`.
- Tests first: the fake claude's process group is gone within 2 seconds (injected kill seam); the decision is `expired`; a second call returns `changed: false`; the queued run of the flow moves to `checking`.

### 6.8 Decisions

#### `approvals.list` (changed)

- Input: `{state?: ApprovalState; runId?: RunId; flowId?: FlowId}`. Output: `Approval[]`, newest first. It includes the synthetic `weekly_limit` and `budget_raise` decisions.
- Tests first: the expiry sweep runs before the list (a decision 24 hours old reads `expired`); `canAlwaysAllow` is false for a place taken from outside text.

#### `approvals.resolve` (changed)

- Input: `{approvalId; decision: ApprovalDecision; editedText?: string (1..4000); editedSubject?: string (1..300)}`; `editedText` exactly when `decision` is `edit`.
- Output: `{decision: Approval; stepWaiting: number; ruleId?: RuleId}`.
- Errors: `not_found`; `conflict: already_answered` (params `via`), `decision_expired`; `invalid_input: edit_not_allowed`, `empty_text`, `hidden_characters`; `not_allowed: place_not_fixed`, `raise_in_settings` (a `budget_raise` decision), `phone_no_rules` (V2).
- Topics: writes `approvals`, `runs`, `rules`, `chats`, `activity`. Person only (the phone: restricted).
- Does (AD-07):
  - `approve`: a one-time grant for the run, step, item, tool and exact digest; state `approved`; the step re-runs and the call is made once, exactly as written; line "You approved: <title>."
  - `edit` (email and text payloads only; recipients never change): state `approved_edited`; the grant is bound to the digest of the edited call; line "You approved your edited version: <title>."
  - `reject`: state `rejected`; the action is skipped, the step is `skipped`, later steps that needed its result are skipped and listed, and the run goes on; line "You said no: <title>. It was not done." No dialog.
  - `always_allow` (window only, a fixed place not taken from outside text): approves as `approve` and writes a standing rule `{flow, touch, effect, place}`; state `allowed_always`; line "You approved: <title>."
  - Every decision clears its notice (`notice_clear`), audits `decision_made`, and, when the step has no more pending decisions, lets the run continue.
- Tests first: an approved grant allows one exact call and holds the same call with another input (FS-j20.A14); a second resolve gives `conflict: already_answered` with `via: "window"`; at the expiry moment (injected clock) `approve` gives `decision_expired`; `edit` with text built from `String.fromCodePoint(0x202e)` gives `hidden_characters`; `edit` of a `diff` payload gives `edit_not_allowed`; `reject` leaves the run `running` and the step `skipped` (FS-j24.A6); `always_allow` on a reply whose address came from the run gives `place_not_fixed`.

#### `approvals.answer` (changed)

- Input: `{approvalId; picks: string[] (0..50, each 1..100)}`. Output: `{decision: Approval}`.
- Errors: `not_found`; `conflict: already_answered`, `decision_expired`; `invalid_input: too_many_picks` (params `max`), `unknown_pick`.
- Does: an `ask` decision: the picks become the later step's loop items; `[]` is "Pick none" and skips the steps that needed picks (FS-j24.P4); state `approved`.
- Tests first: three picks with `maxPick` 2 give `too_many_picks`; a key outside the choices gives `unknown_pick`.

#### `approvals.resolveSimilar` (new)

- Input: `{runId; group: string (1..100); approvalIds: DecisionId[] (2..50)}`: the items the dialog listed.
- Output: `{decisions: Approval[]}`.
- Errors: `not_found`; `conflict: list_changed` (params: the current ids); `not_allowed: kind_not_batchable`.
- Does: approves exactly those pending decisions of that run and group, each with its own grant bound to its own exact input (FS-j24.P3), when the pending set of the group equals `approvalIds`; otherwise approves nothing. Only `risky_action` decisions with `riskyAction` `send` or `post`. Audit `decisions_batch` and one `decision_made` each.
- Tests first: three pending replies approved by their three ids give three grants with three digests; a fourth reply that arrived after the dialog opened gives `list_changed` and approves nothing; a batch of `delete` decisions gives `kind_not_batchable`.

### 6.9 Rules

#### `rules.list` (new)

- Input: `{flowId?}`. Output: `StandingRuleView[]` (active only), newest first.
- Tests first: a revoked rule is not listed; `flowId` limits the list to that flow; a rule shows the sentence it was made with after its touch's sentence changed.

#### `rules.revoke` (new)

- Input: `{ruleId}`. Output: `{rule: StandingRuleView; changed: boolean}`.
- Errors: `not_found`.
- Does: "Ask me again" at once, no dialog (FS-j21.P7); the next matching call is held. Revoking a revoked rule returns `changed: false`. Audit `rule_revoked`, `by: "ask_me_again"`.
- Tests first: after revoke, the same call in the next run creates a decision; the call already running is not undone.

### 6.10 Activity

#### `activity.summary` (new)

- Input: `{filter?: "all" | "finished" | "problems" (default "all"); limit?; before?}`. Output: `ActivitySummary`.
- Does: Needs you, Running now and Earlier (FS-j25.P1). `finished` keeps runs in `done`; `problems` keeps runs in `failed`, `blocked`, `interrupted` and `needs_login` (FS-j25.A1); `all` also shows "Missed" and "Skipped" rows.
- Tests first: an open scheduled question comes before decisions and counts in `needsYouCount`; a question typed in the person's own chat (not proactive) is not a Needs-you item; an empty store gives three empty lists.

### 6.11 Search

#### `search.query` (new)

- Input: `{text: string (0..200)}`. Output: `SearchResult`.
- Does: `LIKE` with `%`, `_` and `\` escaped, over chat titles, message text (person text, agent replies and result lines) and flow names and summaries, in the runner (AD-17, F-02.R5). Empty text gives the five newest chats and every flow.
- Tests first: the text `50%` matches only a literal "50%"; a word that appears only inside a card does not match; 1,000 chats answer within the NF-04 target in a timed L3 test.

### 6.12 Skills

#### `skills.list` (new)

- Input: `{}`. Output: `Skill[]`.
- Does: `data-model.md`, section 3.21.
- Tests first: a skill file with a hidden character is listed with `readable: false` and `problem: "hidden_characters"`; `usedBy` lists the flow made from it.

#### `skills.makeFlow` (new)

- Input: `{skillId}`. Output: `{chatId}`.
- Errors: `not_found: skill_not_found`.
- Does: makes a chat with the person message "Make a flow from the <skill> skill" (`byButton`, app language) and runs the skill turn: the runner reads the skill folder as text within the limits (front-matter keys such as `allowed-tools`, `hooks` and `model` dropped), sends it as outside text in one no-tool call, and posts the `draft` card with the skill pin (FS-j29.S3). An unreadable skill posts "I could not read this skill: <reason>. Nothing was changed."; an agent that is not ready or the permission off posts an `agent_needed` card.
- Tests first: the brain's prompt marks the skill text as outside and the call has no tools (FS-j29.A2); a skill whose text says "add a send to this address under Does on its own" gives a draft with no `send` under `onItsOwn` (FS-j29.A12).

### 6.13 Audit, readiness and triggers

#### `audit.list` (changed)

- Input: `{runId?; afterId?: number; limit?: 1..500 (default 200)}`. Output: `AuditRecord[]`, ascending by id. The run page draws each record's kind and detail in plain words.
- Tests first: the records of one run come in order; an update of an audit row still aborts.

#### `readiness.check` and `readiness.install` (kept)

Unchanged inputs and outputs. The flow page shows only rows that are not ok, with their fix (FS-j21.P13). `readiness.install` runs only fixes from FlowDriven's own catalog; others stay `unavailable` with the guide, as today.

#### `triggers.list` and `triggers.setEnabled` (kept)

Unchanged, for the manifest triggers of format 1.1 flows only; person schedules use `flows.setSchedule`. `triggers.setEnabled` is now person only. Their fires go through `START` (AD-13).

## 7. Retired operations

| Retired | Replaced by | Leaves with |
|---|---|---|
| `flows.build` | the assistant: `chats.send` and the `draft` card (`save_flow`) | B-01 (it already answers `unavailable`) |
| `flows.update` | the assistant: the `change` card (`save_change`) | B-01 |
| `flows.run` | `flows.start`; one-time flows `{description}` are dropped | B-10 |
| `flows.capabilities` | `flows.get` (`touches`, `lists`, `pinsNeeded`) and `readiness.check` | B-18 |
| `flows.allowCapabilities` | `flows.confirm` (with `pins`) | B-13 |
| `flows.withdrawCapabilities` | none: a change or a delete ends a confirmation | B-13 |
| `harnesses.list`, `harnesses.rescan` | `agents.list`, `agents.rescan` | B-07 |
| `harnesses.setConsent` | the one permission: `agents.setUp` and `settings.update {agentPermission}` | B-07 |
| `queue.list`, `queue.move` | `activity.summary` (`running`, `waiting`, `behind`); moving a run to the front has no screen | B-19 |
| `usage.summary` | `agents.list` (`usage`) and `settings.get` (`spending`) | B-20 |

The builder-first screens are unrouted in V1, not deleted: their code and tests stay and keep passing (chair decision for V1, revisable; AGENTS.md never skips a test). They form a frozen island: `packages/contracts/src/v1/` keeps a read-only copy of contract version 1 and `packages/fixtures/src/v1/` the version 1 sample and fixture client, used only by those screens and their tests. The retired names stay in `operations` as retired entries (`retired: true`, `mcp: "no"`, `phone: "no"`); the real runner answers each `unavailable` with reason `retired` and writes nothing, so nothing writes the frozen tables `capability_consents`, `consent_pins` and `grants`. Removing the island, with its tests, is a later Ask-first item.

## 8. Cards and card actions

### 8.1 Rules for every `chats.act` call

1. The message exists in that chat and holds a card; otherwise `not_found`.
2. The action belongs to the card's type (table 8.2); otherwise `invalid_input: unknown_action`.
3. The card is `open`; otherwise `conflict: card_answered` (with its answer) or `card_replaced`. A derived `stale` card gives `conflict: card_stale`; a `flow_deleted` card gives `not_found: flow_deleted`.
4. Only the `window` caller may call it (person only).
5. An action that starts a run needs `agentPermission: "on"`; otherwise `not_allowed: permission_off`, and the card stays open.
6. The card's answer and the action's effect commit in one transaction; FlowDriven's follow-up messages are posted after it.
7. Typed words never answer a card: while a card that needs a click is open, a turn that would act on it posts "Use the buttons on the card above." (FS-j20.P5). A chat turn never calls `chats.act`.
8. Decision cards and run cards are views of a decision or a run: their buttons call `approvals.resolve`, `approvals.answer`, `approvals.resolveSimilar` and `runs.stop`, the same calls Activity makes, so a decision is answered in one place only (FS-j24.P9).

### 8.2 Card types and actions

```ts
type CardView = CardBase & (
  | { type: "plan"; mode: "chain" | "together"; items: { flowId: FlowId; name: string; flowState: FlowState; values: { label: string; text: string }[] }[]; agent: AgentId; model: ModelId }
  | { type: "ask_run"; flowId: FlowId; name: string; values: { label: string; text: string }[] }
  | { type: "confirm"; flowId: FlowId; name: string; hash: ContentHash; then: "start" | "offer" }
  | { type: "inputs_ask"; flowId: FlowId; name: string; questionId: QuestionId; lead?: Line;
      missing: { inputId: string; label: string; problem?: InputProblem }[]; known: { label: string; text: string }[]; canUseLast: boolean }
  | { type: "form"; flowId: FlowId; name: string; questionId: QuestionId;
      fields: { inputId: string; label: string; type: InputType; required: boolean; value?: string; choices?: { key: string; label: string }[]; example?: string }[] }
  | { type: "runs"; mode: "single" | "chain" | "together"; runs: RunSummary[]; notStarted: string[] }
  | { type: "decision"; decision: Approval }
  | { type: "draft"; draft: DraftView }
  | { type: "change"; draft: DraftView }
  | { type: "schedule"; flowId: FlowId; name: string; schedule: ScheduleView; replaces?: ScheduleView }
  | { type: "unschedule"; flowId: FlowId; name: string; schedule: ScheduleView }
  | { type: "stop"; runs: { runId: RunId; flowName: string }[] }
  | { type: "status"; needsYou: { kind: "decision" | "question"; title: string; runId?: RunId; chatId?: ChatId }[];
      running: { runId: RunId; flowName: string }[]; latest?: { flowName: string; state: RunState; at: IsoDateTime }; problems: { runId: RunId; flowName: string }[] }
  | { type: "repeat_offer"; flowId: FlowId; name: string; afterFlowId: FlowId; afterName: string; replaces?: ScheduleView }
  | { type: "run_offer"; flowId: FlowId; name: string; schedule: ScheduleView; suggested?: ScheduleSpec }
  | { type: "choose"; purpose: "flow" | "skill"; options: { value: string; label: string }[] }
  | { type: "agent_needed"; need: "permission" | "set_up" | "sign_in"; agentId?: AgentId; agentName?: string }
  | { type: "other_agent"; agentId: AgentId; agentName: string; reason: Line; for: "run" | "draft" | "change" }
  | { type: "turn_failed"; forMessageId: MessageId; failure: "not_understood" | "no_usage" | "spending_limit" | "agent_failed" | "timeout" | "interrupted"; agentName?: string; until?: IsoDateTime }
);
type CardBase = { state: "open" | "answered" | "replaced" | "cancelled" | "stale" | "flow_deleted"; answer?: { action: CardAction; at: IsoDateTime } };

type ChatAct =
  | { action: "start" } | { action: "change_plan" }
  | { action: "run" } | { action: "not_now" }
  | { action: "confirm_flow"; values: { hash: ContentHash; onItsOwn: TouchId[]; pins?: Record<string, string> } }
  | { action: "use_form" } | { action: "use_last_answers" } | { action: "cancel_question" }
  | { action: "submit_form"; values: { fields: Record<string, string> } }   // at most 50 fields, each at most 4,000 characters
  | { action: "save_flow" } | { action: "change_draft"; values?: { text: string } }
  | { action: "save_change" } | { action: "cancel_change" }
  | { action: "set_schedule" } | { action: "skip_schedule" }
  | { action: "turn_off_schedule" } | { action: "keep_schedule" }
  | { action: "stop_runs" } | { action: "keep_running" }
  | { action: "every_time" } | { action: "only_this_time" }
  | { action: "run_now" } | { action: "propose_schedule" }
  | { action: "choose"; values: { option: string } }
  | { action: "use_other_agent" }
  | { action: "retry_turn" }
  | { action: "suggestion"; values: { chip: number } };
type CardAction = ChatAct["action"];
```

| Card | Posted when | Button | Action | What FlowDriven does | Guarded by |
|---|---|---|---|---|---|
| `plan` | intent `run_together` or `run_chain` | "Start" | `start` | Records the chat's agent and model now for every run (FS-j31.P6). A `new` or `changed` flow posts a `confirm` card (`then: "start"`) and the plan waits there. Chain: starts the first flow (source `chat`); each later flow starts through `START` with source `after` and key `chain:<id>:<n>` when the one before ends `done`. Together: starts each flow (source `chat`). Posts "Started. I'll tell you here if I need you." and a `runs` card. | SR-3, SR-5, SR-8, SR-4, `START` |
| `plan` | | "Change" | `change_plan` | Posts "Tell me what to change."; the next turn returns a new plan, and this card becomes `replaced` | - |
| `ask_run` | a flow named alone, a question, a negation, a mention; any `run` with outside text in the context | "Run" | `run` | Starts the flow with source `chat` | SR-5, SR-3 |
| `ask_run`, `run_offer`, `other_agent` | | "Not now" | `not_now` | Answers the card; nothing else | - |
| `confirm` | `START` rule 1, or a chat start of a `new` or `changed` flow | "Confirm" in the dialog | `confirm_flow` | The `flows.confirm` function for exactly `values.hash`. Then `then: "start"` (a start the person typed or an answer in this chat) continues the pending start; `then: "offer"` (a start outside the chat) posts "Confirmed. Run it now?" with a `run_offer` card (FS-j28.E7) | SR-1, SR-2, SR-3 |
| `inputs_ask` | `START` rule 2 | "Use a form" | `use_form` | Posts a `form` card filled with every known value | AD-11 |
| `inputs_ask` | | "Use my last answers" | `use_last_answers` | Applies the `last` answers except date and time; asks only for the rest; starts when nothing is missing | AD-11, SR-3 |
| `inputs_ask`, `form` | | "Cancel" | `cancel_question` | The question becomes `cancelled`; posts "Okay, I won't start it." | - |
| `form` | `use_form`, or a flow with a file input | "Start" | `submit_form` | Parses every field with FlowDriven's own parsers. Any problem returns `fields` and changes nothing; otherwise answers the question (key `answer:<question id>`) and starts | AD-11, SR-5 |
| `draft` | intent `make_flow` or `make_flow_from_skill` | "Save flow" | `save_flow` | One transaction: the flow files, the head, the confirmation of exactly the draft's hash, a standing rule per non-read touch in `onItsOwn`, the draft's schedule, the skill pin, the audit; posts "Saved. It runs every Friday at 17:00. Run it now?" or "<name> is ready. Run it now, or put it on a schedule." with a `run_offer` card. Refused for a `replaced` or stale draft ("This draft was replaced. Use the newest one.", "The skill changed since I read it. I'll read it again.") | SR-1, SR-2, SR-3, SR-5 |
| `draft` | | "Change something" | `change_draft` | With `values.text`: one turn with the draft and the change, a new draft card, this card `replaced`. Without: posts "Tell me what to change." and the chat's subject becomes this draft | - |
| `change` | intent `improve_flow` | "Save change" | `save_change` | One transaction: the new version, the head, the confirmation of the new hash, rules kept or revoked, the audit; posts "Saved. The change applies from the next run." Refused when the flow's head is not the draft's base ("This flow changed since I made this suggestion. Ask again.") | SR-1, SR-3 |
| `change` | | "Cancel" | `cancel_change` | The draft becomes `cancelled` | - |
| `schedule` | intent `schedule`, or `propose_schedule` | "Yes, set it" | `set_schedule` | `flows.setSchedule` with the flow's confirmed hash, including the first-run rule; the card says what it replaces | SR-2, SR-3 |
| `schedule` | | "No" | `skip_schedule` | Nothing | - |
| `unschedule` | intent `unschedule` | "Yes, turn it off" | `turn_off_schedule` | The schedule becomes manual | SR-2 |
| `unschedule` | | "No" | `keep_schedule` | Nothing | - |
| `stop` | intent `stop` (typed) | "Stop" | `stop_runs` | `runs.stop` for each listed run that is still active | SR-8 |
| `stop` | | "Keep it running" | `keep_running` | Nothing | - |
| `repeat_offer` | a chain ended `done` with nothing rejected and no `after` schedule yet | "Yes, every time" | `every_time` | Sets the later flow's schedule to `after` the first, replacing its old schedule; posts "Done. Next time ..." | SR-2 |
| `repeat_offer` | | "Only this time" | `only_this_time` | Nothing | - |
| `run_offer` | after Save flow, a skill flow, or a confirm with `then: "offer"` | "Run now", "Run it now" | `run_now` | Starts the flow with source `chat` | SR-3 |
| `run_offer` | | the schedule chip ("Every Friday at 16:00") | `propose_schedule` | Posts a `schedule` card with the suggested schedule; sets nothing | SR-2 |
| `choose` | an unknown or ambiguous flow or skill name | one option per match | `choose` | Continues the pending intent with that flow or skill | - |
| `other_agent` | the chat's agent cannot be limited for the flow (AD-09) | "Run with Claude Code this time", "Use Claude Code for this draft" | `use_other_agent` | Runs the pending start or turn once on the named agent and its default model (`agent.choice: "other_agent"`); the chat's choice stays | SR-4 |
| `turn_failed` | a turn failed or was interrupted | "Try again" | `retry_turn` | Queues the turn of `forMessageId` again | - |
| any card with suggestion chips | | a suggestion chip | `suggestion` | Posts the chip's text in the app language as the person's message with `fromChip`, then runs a turn; the chat's language does not change (FS-j30.P4) | AD-14 |

Cards with no `chats.act` action:

| Card | Buttons and what they call |
|---|---|
| `runs` | "Stop" -> `runs.stop`; "Details" and "See what it needs" -> the run page |
| `decision` | "Approve", "Always allow for this flow", "Reject", "Edit" -> `approvals.resolve`; "Send choice", "Pick none" -> `approvals.answer`; "Approve all similar (N)" -> its dialog, then `approvals.resolveSimilar`; "Details" -> the run page |
| `status` | "Open" links to decisions, chats and runs |
| `agent_needed` | "Sign in to <agent>" -> `agents.signIn`; "Set up <agent>" -> `agents.setUp`; "Open Settings" -> `#/settings` |

Tests first for the card actions (`packages/runner/src/assistant/cards.test.ts`, new, L3 with the fake brain):
- `save_flow`: exactly one flow, `confirmed`, bound to the draft's hash; one standing rule per non-read touch in `onItsOwn`, each with its exact place, and none for reads; the schedule row equals the draft's; audit `flow_saved` with the three lists; a second click gives `conflict: card_answered` and still one flow; a failure injected before the commit leaves no row in `flow_heads`, `confirmations` or `standing_rules` (FS-j22.A6, A8, A14).
- `save_flow` on a draft whose name became taken: the flow gets the name the card showed; the old flow is unchanged (FS-j22.A9).
- `confirm_flow` with `then: "start"` starts the pending run; with `then: "offer"` it posts a `run_offer` card and starts nothing (FS-j28.A11).
- `submit_form` with the duration "0" returns `fields: [{inputId: "duration", problem: "zero"}]`, starts nothing and keeps the card open; a valid form answers the question, starts the run and writes the `remember` and `last` rows (FS-j27.A8, A10).
- `use_last_answers` with last answers that cover the required inputs starts the run with today's date from the default, not the last date (FS-j27.A11).
- `save_change` after the flow's head moved gives `conflict: card_stale` and saves nothing (FS-j23.A12).
- `change_draft` without text posts "Tell me what to change." and sets the chat's subject; with text it posts a new draft card and the old one reads `replaced` (FS-j22.A10).
- `every_time` sets the `after` schedule; no typed sentence in any language does (FS-j20.A18).
- `use_other_agent` records `agent.choice: "other_agent"` on the run and leaves the chat's agent unchanged (FS-j31.A13).
- `suggestion` posts a person message with `fromChip: true`, and the chat's language stays as it was (FS-j30.A9).
- `retry_turn` makes one more brain call with the same text.

### 8.3 Chips

Chips act by code, so they work in any language (brief 24.11). The starter chips of an empty chat are `ChatView.starters`, built by the runner from the person's own flows: "Run <flow>", "Run <flow>, then <flow>", "Make a new flow" and "What needs me?". `chats.send {chatId, starter}` posts the chip's label as the person's message (a `Line` with `fromChip`) and acts on its code without a brain call: `run` and `run_chain` take the path of a typed run, `make_flow` the path of `chats.create {subject: {kind: "make"}}`, `status` posts the `status` card.

A chip under a message is one of: a suggestion (`chats.act` `suggestion` with its index; the runner knows the text, so the renderer cannot change it), an action of the message's card (`chats.act` with that action, for example "Use a form" -> `use_form`), or a link to another chat ("Answer in chat"). The starter chips of an empty chat belong to no message: they are sent with `chats.send {fromChip: true}`.

## 9. Events and topics

The only event stays `{type: "changed"; topics: RunnerTopic[]}`: "refetch what reads these topics" (AD-03). The renderer's `useRunnerQuery` refetches every query whose operation `reads` a named topic, as today. Events are coalesced: one event carries every topic marked since the last one (`createChangeEmitter`).

```ts
type RunnerTopic = "flows" | "runs" | "approvals" | "readiness" | "settings"          // kept
  | "chats" | "rules" | "activity" | "agents" | "skills";                              // new
// "harnesses" retires (replaced by "agents"); V2 adds "memory" and "phone", V3 adds "market"
```

Which store writes mark which topics (`service/events.ts`, `wrapStore`):

| Store write | Topics |
|---|---|
| `flows`, `flow_heads` | `flows`, `skills` |
| `confirmations` | `flows`, `activity` |
| `standing_rules` | `rules`, `flows` |
| `schedules`, `triggers` | `flows` |
| `remembered` | `flows` |
| `starts` | `activity` |
| `runs`, `steps`, `items` | `runs`, `activity` |
| `usage_events` | `runs`, `settings` |
| `approvals` | `approvals`, `runs`, `activity`, `chats` |
| `chats`, `messages`, `drafts` | `chats` |
| `waiting_questions` | `chats`, `activity`, `flows` |
| `harness_state` | `agents`, `settings` |
| `settings` | `settings`; also `approvals` and `activity` for `weekly:*` and `spending-pause` |
| `chats.setComposer`, `call_grants`, `audit_log`, `seen`, `counters`, `fire_keys` | none |

Tests first (`service/events.test.ts`): each row of the table marks exactly its topics; ten writes in one tick give one event.

## 10. Notices

A notice is a runner -> main frame that becomes a system notification; it never reaches the renderer. Notices are only for decisions, problems and scheduled questions, never for progress or success (F-16). Main shows one only when no FlowDriven window is focused (`electronNoticeHandler`), and validates it strictly (`parseNotice`).

| Kind | Status | When | Title and body (words keys) | Target |
|---|---|---|---|---|
| `approval_waiting` | kept | a decision is created (also `budget_raise`) | "Waiting for you" and the decision's title | `run` (with `approvalId`), or `activity` for a decision with no run |
| `run_blocked` | kept | a run becomes `blocked`, `needs_login` or `failed` | the flow name and the cause words | `run` |
| `weekly_limit` | kept | the weekly-limit question | as today | `activity` |
| `flood_cap`, `trigger_paused` | kept | as today | as today | `flow` |
| `question_waiting` | new | a waiting question for missing inputs is created by a start outside the typed chat (FS-j28.S2) | "<flow> needs your answer" and "Open the chat to answer." with no input value | `chat` |
| `confirm_waiting` | new | a start outside the typed chat finds the flow `new` or `changed` and posts the confirm card (`START` rule 1, FS-j28.E7) | the same words as `question_waiting` (FS-j28.E7) | `chat` |
| `flow_withdrawn` | V3 | a marketplace flow was revoked | | `flow` |

```ts
type NoticeTarget =                                        // v2: inbox and builder retire
  | { screen: "run"; runId: NoticeId; approvalId?: NoticeId }   // #/activity/<runId>
  | { screen: "chat"; chatId: NoticeId }                        // #/chat/<chatId>
  | { screen: "flow"; flowId: NoticeId }                        // #/flows/<flowId>
  | { screen: "activity" }                                      // #/activity
  | { screen: "settings" };                                     // #/settings
type Notice = { id: string; kind: NoticeKind; title: Line; body: Line; language: LanguageCode; target: NoticeTarget };   // drawn by main; at most 80 and 240 characters once drawn
```

- The runner sends `title` and `body` as `Line` values with the app language at the moment it sends; main draws them with the words of `apps/desktop/src/i18n` (FS-j30.A16). `parseNotice` accepts only keys of `LINE_KEYS`. They hold fixed words and the flow name only: never an email's text, a payload marked sensitive, an input value or a secret (F-16.R6).
- A notice id is stable per item (for example `approval:<id>`, `question:<id>`), so the same item never notifies twice. Throttling stays in `notify/policy.ts`: at most one per run every 10 minutes unless a decision waits.
- New frame `notice_clear` (`{jsonrpc: "2.0", method: "notice_clear", params: {id: NoticeId}}`): the runner sends it when the item is decided, answered, cancelled, expired, or its run stops; main closes that notification (F-16.R3).

Tests first: `notice.test.ts` refuses a key outside `LINE_KEYS` and an unknown field; main's drawing test refuses a drawn body over 240 characters; the runner sends one `question_waiting` for a new question and none for a reused one (FS-j28.A12); a slot of a `changed` flow sends one `confirm_waiting`; resolving a decision sends `notice_clear` with `approval:<id>`.

## 11. Errors

### 11.1 Codes

| Code | JSON-RPC number | Meaning |
|---|---|---|
| `invalid_input` | -32602 | the input does not fit the schema or the rules; nothing changed |
| `not_found` | -32001 | the thing does not exist (or no longer exists) |
| `not_allowed` | -32002 | the thing exists, but this is not allowed now |
| `unavailable` | -32003 | the runner cannot do it now (it stopped, a later release, an internal error) |
| `conflict` | -32004 (new) | the thing changed since the caller looked; nothing changed |

The frame: `RpcErrorBody = {code: number; message: string; data: {code: RunnerErrorCode; reason?: ErrorReason; params?: Record<string, string | number | string[]>}}`. `RunnerError` gains `reason` and `params`; `IpcRunnerClient` keeps them.

### 11.2 Reasons

| Reason | Code | When |
|---|---|---|
| `contract_mismatch` | unavailable | main or the renderer found another contract version (section 12.5) |
| `engine_stopped` | unavailable | the runner exited; main starts it again on the next call |
| `engine_restart_limit` | unavailable | three starts within 60 seconds; "Restart FlowDriven." |
| `data_folder_locked` | unavailable | runner exit code 3: another runner uses the data folder |
| `store_newer` | unavailable | runner exit code 5: the store version is above 7 |
| `migration_failed`, `backup_failed` | unavailable | runner exit code 6 (`data-model.md`, 5.3) |
| `too_large` | unavailable | the answer is over `MAX_FRAME_BYTES` |
| `internal_error` | unavailable | any other error; audited as `internal_error` |
| `caller_not_allowed` | not_allowed | the caller (tool, phone) may not call this operation |
| `permission_off` | not_allowed | `agentPermission` is not `on` |
| `agent_unknown` | not_found | not an agent of the catalog |
| `agent_not_installed`, `agent_not_ready` | not_allowed | the agent is not installed, or not `ready` |
| `setup_running` | conflict | Set up or Sign in is already running for that agent |
| `install_unavailable` | unavailable | no catalog install command for this platform |
| `model_unknown` | invalid_input | the agent did not list that model |
| `language_unknown` | invalid_input | not one of the codes main passed at spawn |
| `retired` | unavailable | a version 1 operation kept only for the unrouted screens (section 7) |
| `limit_not_above`, `limit_too_high` | invalid_input | a spending limit not above the current one, or above 10,000 |
| `flow_deleted` | not_found | the flow was deleted |
| `flow_running` | conflict | the flow has an active run (delete) |
| `flow_not_confirmed` | not_allowed | the flow is `new` or `changed` |
| `hash_mismatch` | conflict | the hash sent is not the flow's head or confirmed hash |
| `touch_unknown` | invalid_input | `onItsOwn` names a touch the flow does not have |
| `place_not_fixed` | not_allowed | a rule or "Does on its own" needs a fixed place the touch does not have |
| `never_does` | not_allowed | the touch's rule is `not_allowed` |
| `pins_missing`, `pin_invalid` | invalid_input | a folder that needs a pin has none, or the path is not allowed |
| `schedule_self`, `schedule_loop`, `schedule_target_missing`, `bad_time`, `bad_day`, `last_answers_incomplete` | invalid_input | the schedule checks of FS-j21.E3 |
| `no_schedule` | not_allowed | "Try the next run now" on a manual flow |
| `already_ran_late` | conflict | the missed row already ran |
| `card_answered`, `card_replaced`, `card_stale` | conflict | the card is no longer open |
| `question_answered` | conflict | "This question was already answered." |
| `unknown_action` | invalid_input | the action does not belong to the card |
| `already_answered` | conflict | the decision was answered elsewhere (params `via`) |
| `decision_expired` | conflict | "This decision expired. The action was not done." |
| `edit_not_allowed`, `empty_text`, `hidden_characters` | invalid_input | the Edit checks of FS-j24.P1 |
| `too_many_picks`, `unknown_pick` | invalid_input | the choice checks |
| `kind_not_batchable` | not_allowed | Approve all similar on a kind other than send or post |
| `list_changed` | conflict | the similar items changed since the dialog opened |
| `raise_in_settings` | not_allowed | a spending decision is resolved only by raising the limit |
| `not_resumable` | not_allowed | Try again on a run in a state that cannot resume |
| `skill_not_found` | not_found | no such skill |
| `phone_no_rules` | not_allowed | V2: Edit or Always allow from a phone |

Tests first: `wire.test.ts` round-trips `conflict` with `-32004` and a reason; `operations.test.ts` checks that each operation's `reasons` hold only listed reasons and each reason's code is in the operation's `errors`.

## 12. IPC layer

### 12.1 Preload API

`apps/desktop/electron/preload.ts` exposes one frozen object and nothing else: the frozen `runner.call` and `runner.subscribe` of today, and the small `window` API (AD-02, AD-15). No file system, no shell, no dialogs.

```ts
declare global {
  interface Window {
    flowdrivenShell: Readonly<{
      kind: "electron";
      runner?: Readonly<{                                   // present only with --flowdriven-runner=on (the real window)
        call(method: string, input: Record<string, unknown>): Promise<RunnerReply>;   // invoke "runner:call"
        subscribe(listener: (event: unknown) => void): () => void;                     // on "runner:event"
      }>;
      window: Readonly<{                                    // new (AD-15); also in capture windows
        getPrefs(): Promise<WindowReply<WindowPrefs>>;                                  // invoke "window:getPrefs"
        setColorMode(mode: "light" | "system" | "dark"): Promise<WindowReply<WindowPrefs>>;   // "window:setColorMode"
        setBackground(patch: { keepRunning?: boolean; openAtLogin?: boolean }): Promise<WindowReply<WindowPrefs>>;   // "window:setBackground"
        openLink(url: string): Promise<WindowReply<{ opened: boolean }>>;              // "window:openLink"
        quit(): Promise<WindowReply<{}>>;                                               // "window:quit"
      }>;
    }>;
  }
}
type RunnerReply =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string; reason?: string; params?: Record<string, unknown> } };
type WindowReply<T> = { ok: true; result: T } | { ok: false; error: { code: "not_allowed" | "invalid_input" | "unavailable"; message: string } };
type WindowPrefs = { colorMode: "light" | "system" | "dark"; keepRunning: boolean; openAtLogin: boolean; platform: "darwin" | "win32" | "linux" };
```

The renderer reaches the runner only through `RunnerClient` (`IpcRunnerClient` over `runner`, or `FixtureRunnerClient` in a plain browser), and the window through one small module, `apps/desktop/src/shell.ts` (existing). The `WindowPrefs` and `WindowReply` schemas live in `packages/contracts/src/window.ts` (new) so main and the renderer share them; they are versioned with the app, not with `CONTRACT_VERSION`.

### 12.2 Channels

| Channel | Direction | Arguments | Answer | Handler |
|---|---|---|---|---|
| `runner:call` | renderer -> main (invoke) | `(method: string, input: object)` | `RunnerReply` | `electron/runner-ipc.ts` |
| `runner:event` | main -> renderer (send) | `(event: RunnerEvent)` | - | `broadcastRunnerEvent` |
| `window:getPrefs` | renderer -> main (invoke) | `()` | `WindowReply<WindowPrefs>` | `electron/window-api.ts` (new) |
| `window:setColorMode` | renderer -> main (invoke) | `(mode)` | `WindowReply<WindowPrefs>` | `window-api.ts` with `appearance.ts` (new) |
| `window:setBackground` | renderer -> main (invoke) | `(patch)` | `WindowReply<WindowPrefs>` | `window-api.ts` with `tray.ts` and `login-item.ts` (new) |
| `window:openLink` | renderer -> main (invoke) | `(url)` | `WindowReply<{opened}>` | `window-api.ts` |
| `window:quit` | renderer -> main (invoke) | `()` | `WindowReply<{}>` | `window-api.ts` |

Between main and the runner (stdio, newline-delimited JSON-RPC 2.0, `wire.ts`): requests and answers; the notifications `event` (`RunnerEvent`), `notice` (`Notice`) and the new `notice_clear` (`{id}`). There are no other channels.

### 12.3 Validation at every hop

| Hop | Checks |
|---|---|
| Renderer, before sending | `IpcRunnerClient` parses the input with `operations[name].input` |
| Preload | passes only a string and a plain object; holds no logic; frozen |
| Main, `runner:call` | sender check (12.4); exactly two arguments; `method` matches `^[a-z]+\.[A-Za-z]+$` and is one of the operation names exported by contracts (new); `input` is a plain object; its JSON is at most `MAX_FRAME_BYTES` (new); the link is not marked incompatible |
| Runner, frame | `serveRpc`: frame size; `RpcRequest` shape; unknown method -> -32601; a malformed frame is a protocol error (exit code 4) |
| Runner, dispatcher | the name is in `operations`; the caller may call it; `input.safeParse`; the handler; `output.parse` of the result; a `RunnerError` keeps its code, reason and params; any other error is audited (`internal_error`) and answered `unavailable` |
| Main, answer | the answer is relayed as `RunnerReply` |
| Renderer, after the answer | `RunnerReply` shape, then `operations[name].output.parse`; an error becomes a `RunnerError` with its reason |
| Events | main checks each `event` frame with `RunnerEvent` (new) before broadcasting; the renderer checks it again |
| Notices | main parses `notice` with `parseNotice` and `notice_clear` with a strict `{id: NoticeId}`; neither reaches the renderer |
| Window API | main: sender check, exact argument count, the mode in its three values, the patch with only `keepRunning` and `openAtLogin` as booleans (at least one), the URL a string of at most 2,048 characters that parses with `https:` and has no user name or password; the renderer parses the answer with `WindowPrefs` |

### 12.4 Sender checks

- A call is accepted only from the top-level frame of a window whose URL is `app://flowdriven` (`isOwnMainFrame`: the frame exists, has no parent, and passes `isAllowedNavigation`). The same check guards the window channels.
- `runner:event` goes only to windows whose main frame URL is the app origin (`broadcastRunnerEvent`).
- The runner flag (`--flowdriven-runner=on`) is only in the real window's `additionalArguments`; capture windows get the window API but no runner.
- The window keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, the CSP and the session lockdown (NF-23). `openLink` is the only way a link leaves the app: the renderer shows the full address and main checks it before `shell.openExternal` (AD-16).

### 12.5 Version check

1. Main spawns the runner with `--languages=<codes>`, the codes of `apps/desktop/src/i18n/languages.ts`, then sends `runner.info` before it relays any call. When `contractVersion` is not `CONTRACT_VERSION`, main stops the runner, marks the link incompatible, does not restart it, and answers every `runner:call` with `{ok: false, error: {code: "unavailable", reason: "contract_mismatch"}}`.
2. The renderer calls `runner.info` first. On a mismatch it shows "FlowDriven needs an update: the app and its engine do not match." with "Quit" (`window.quit`) and makes no other call (FS-j01.E8).
3. Runner exit codes 3 (`data_folder_locked`), 5 (`store_newer`) and 6 (`migration_failed` or `backup_failed`) are not restarted; main answers every call with that reason, and the renderer shows its plain screen with "Quit".
4. `FixtureRunnerClient` reports `contractVersion: 2`, `mode: "sample"`.

Tests first: `runner-link.test.ts` with a stub runner that reports version 1 gets `contract_mismatch` for the next call and no restart; with exit code 5 it gets `store_newer` and no second spawn; `ipc-client.test.ts` keeps `reason` on the error; the renderer test renders the mismatch screen and makes no second call.

### 12.6 Compatibility

- The app and its runner ship together, so the contract version must be equal; there are no version ranges.
- A version 7 runner opens stores of versions 0 to 7 and refuses a newer one (`data-model.md`, section 5).
- Fixtures and sample data validate against contract 2 (`packages/fixtures/src/story-v2/`, new). The unrouted screens use the frozen copies `packages/contracts/src/v1/` and `packages/fixtures/src/v1/` (section 7).
- A retired operation answers `unavailable` with reason `retired`.
- The window API is versioned with the app. V2 and V3 operations raise `CONTRACT_VERSION` (section 13).

### 12.7 Color mode and background

- **Color mode** (AD-15): the renderer calls `window.setColorMode`; main sets `nativeTheme.themeSource` (`light`, `system`, `dark`) and writes `window.json`; at launch main applies the file before the first paint. The CSS follows the media query only. The runner is not called (FS-j12.A2).
- **Background**: the store's `background` is the person's record (`data-model.md`, 3.18); main applies it.
  - In Settings, a switch calls `settings.update {patch: {background}}`, then `window.setBackground` with the same values. Main applies the menu bar mode (`tray.ts`) and the login item (`login-item.ts`), and caches `keepRunning` in `window.json`.
  - At launch the renderer, after `settings.get`, calls `window.getPrefs`. When `openAtLogin` differs, the operating system's value wins (the person changed it in macOS) and the renderer saves it with `settings.update`; when `keepRunning` differs, the store wins and the renderer calls `window.setBackground`.
  - With `keepRunning` off, closing the last window quits; with it on, FlowDriven stays in the menu bar with "Open FlowDriven" and "Quit", and main calls `starts.next {withinHours: 24}` for the quit line (FS-j28.P10).

Tests first: `window-api.test.ts` refuses a call from a frame that is not the app's main frame, an unknown mode, a patch with an extra key and an `http:` link; `setColorMode("dark")` sets `themeSource` and writes the file atomically; an unreadable file gives `system`.

## 13. Later operations (not in contract version 2)

Sketched so the store and the safety rules are ready for them. Each group ships with its own contract version (V2: version 3; V3: version 4), its own topics and its own security review (AGENTS.md). All are person only and `mcp: "no"` unless a line says otherwise.

| Operation | Input -> output | Notes |
|---|---|---|
| `memory.list` | `{scope?, text?}` -> `{always: {part, used, limit}[], proposed: MemoryItemView[], items: MemoryItemView[]}` | parts "You", "Goals", "Kept", "Projects and flows", "Skills" (FS-j26.S1) |
| `memory.keep`, `memory.drop` | `{id}` -> item, `{}` | only the runner writes memory (spec R17) |
| `memory.edit` | `{id, text (1..500)}` -> item | |
| `memory.pin` | `{id, pinned}` -> item | |
| `memory.grant` | `{id, flowId, on}` -> item | the person's per-item grant for one flow (FS-j26.P3); it never widens what a run may do (SR-2) |
| `memory.delete` | `{id}` -> `{}` | secure deletion; the dialog is the renderer's |
| `memory.export` | `{}` -> `{markdown}` | on request only (spec R18) |
| `phone.list` | `{}` -> `{links: PhoneLinkView[], toolAccess}` | |
| `phone.setSecret` | `{kind, secretName}` -> link | the token goes from the renderer to main's keychain through a V2 window API call `secrets.save(purpose, value)` that returns the item's name; it never reaches the runner, the stdio link or the store (SR-6, AD-19) |
| `phone.startPairing` | `{kind}` -> `{code, expiresAt}` | random, single use, 10 minutes; stored as a hash |
| `phone.checkPairing`, `phone.unpair` | `{kind}` -> link | one account per bot |
| `phone.setToolAccess` | `{on}` -> `{toolAccess}` | starts or stops the local MCP server; off by default |
| `skills.approveUpdate`, `skills.keepCurrent` | `{skillId, hash}` / `{skillId}` -> skill | flows that use the skill become `changed` after an approve (FS-j26.S14) |
| `skills.rollBack` | `{skillId, hash}` -> skill | after its dialog |
| `skills.archive` | `{skillId}` -> skill | never for a skill a flow uses |
| `market.search`, `market.get` | `{text}` / `{listingId}` -> listings / listing with the signature check | the runner talks to the service; the renderer loads nothing remote |
| `market.install` | `{listingId}` -> `{flowId}` | signature and revocation checked; the flow arrives `new`, with no rule and no schedule |
| `market.report`, `market.publish` | `{listingId, text}` / `{flowId, audience}` -> result | publishing needs its dialog for any audience but "Only me" |
| `market.revocations` | `{}` -> `{checkedAt, stale}` | status only; fetching is the runner's own work |

V2 also adds, between the runner and main, a request frame `secret_request {name, purpose}` that main answers from the keychain at the moment of use, and the `tool` and `phone` callers of section 2.3.

## 14. Tests first

For each operation, before its handler exists:
1. **Schema test** (L1, `packages/contracts/src/<file>.test.ts`): a valid input and output from the fixtures pass; each limit fails (an empty id, a string one character too long, an unknown key, a value outside an enum); the table entry has the errors, reasons, topics, `mcp`, `phone` and `personOnly` of section 5.
2. **Handler test** (L3, `packages/runner/src/service/<group>-handlers.test.ts`, new): through `createDispatcher`, with real SQLite in a temporary folder, the injected clock and ids, and the fake claude, fake codex or fake brain; check the returned value, the store rows, the topics marked, the audit records and the notices sent. Each error reason of the operation has one case that shows nothing changed.
3. **Renderer tests** (L2) use `FixtureRunnerClient`, which implements every version 2 operation with the same rules on the chat-first sample (`packages/fixtures/src/story-v2/`); `client.test.ts` checks that the fixture client and the real handlers return the same shapes for the same calls.

Shared dispatcher tests (`service/handlers.test.ts`): an unknown name answers -32601; an output that fails its schema is audited `internal_error` and answered `unavailable`; a `personOnly` operation from a `tool` or `phone` caller gets `caller_not_allowed` (V2); and a source-rule test checks that `packages/runner/src/assistant/` imports neither the dispatcher nor the writers of confirmations, decisions, rules, schedules or settings.

## 15. Drafter's calls

- A fifth error code, `conflict`, for "it changed since you looked" (a stale card, a decision answered elsewhere, a hash that moved): the person needs a different line than for "not allowed".
- Errors carry `reason` and `params`, and the renderer picks the words, because data keeps codes (AD-14).
- Outcomes a person sees are data in the output, not errors: a start that asked, form field problems, "Still stuck".
- Decision cards and run cards in a chat call `approvals.*` and `runs.stop` directly, not `chats.act`, so a decision has one path and is answered once.
- `flows.start` accepts only `flows` and `again` from the window; `chat` starts happen inside `chats.act`, and the runner sets every other source.
- `approvals.resolveSimilar` carries the ids the dialog listed, so a changed list approves nothing (FS-j24.P3).
- `approvals.resolve` adds `editedSubject` next to `editedText`, because Edit changes an email's subject and body (FS-j24.P1).
- Every held call is kind `risky_action` with an `effect`, so the timesheet entry (`change`) needs no new kind.
- The spending pause is one synthetic `budget_raise` decision with no run, resolved only by raising the limit in Settings.
- New operations beyond the chair's list: `chats.setComposer` (the per-chat composer text of F-03.R1 survives a restart), `starts.next` (the menu bar's quit line, FS-j28.P10), and the V2 `skills.keepCurrent` ("Keep current version", FS-j26.S14).
- The window API adds `getPrefs`, `openLink` (AD-16: links open only through main's check) and `quit` (the mismatch screen) to color mode and background.
- A `notice_clear` frame removes a notification when its item is decided (F-16.R3).
- MCP exposure: `flows.list` yes; `flows.get`, `flows.start`, `runs.status` and `approvals.list` restricted; everything else no. Listing decisions is restricted, never `yes`.
- `phone` and `personOnly` are table fields from version 2, so the rules are tested before the phone exists.
- Retired: `queue.list`, `queue.move` and `usage.summary` go with the Runs and old Settings screens; their data is in `activity.summary`, `agents.list` and `settings.get`.
- Later operations raise the contract version (3 for V2, 4 for V3) instead of sitting unimplemented in version 2.
- Activity: "Running now" is `queued`, `checking`, `running`, `retrying` and `waiting_approval`; `needs_login` runs are under Earlier and Problems (FS-j25.S1). The rail number counts pending decisions and open proactive questions of both kinds.
- A confirm card continues the start only when the person typed it or answered in that chat; after a start outside the chat it offers "Run now" (FS-j28.E7, FS-j21.P2).
- `chats.send` with the permission off stores nothing (FS-j20.E2); with the agent not ready it stores the message and posts a card (FS-j20.E1).
- Message text and composer text are limited to 16,000 characters, under the 24,000-character context of a turn.
- `runs.stop` on a run that already ended returns it unchanged, so a race between two windows is not an error.
- `agents.signIn` does not need the agent permission: it runs no flow.
- Name mappings (old name -> chosen name, file):
  - "Confirm" card action (no name, `j20-run-from-chat.md`; `confirm_flow`, `j28-proactive-schedule.md`) -> `confirm_flow`.
  - "Yes, turn it off" and "No" (`j20-run-from-chat.md`, P8; `j23-improve-a-flow.md`, P2) -> `turn_off_schedule` and `keep_schedule`.
  - typed stop card "Stop" and "Keep it running" (`j20-run-from-chat.md`, P7) -> `stop_runs` and `keep_running`.
  - "Change" on a plan (`j20-run-from-chat.md`) -> `change_plan`.
  - "Yes, every time" and "Only this time" (`j20-run-from-chat.md`, S8) -> `every_time` and `only_this_time`.
  - "Run now" and "Run it now" (`j22-make-a-flow.md`, `j29-flow-from-skill.md`) -> `run_now` on a `run_offer` card; the schedule chip "Every Friday at 16:00" (`j29-flow-from-skill.md`) -> `propose_schedule`.
  - a chip "sent as the person's own message" (`j20-run-from-chat.md`, S2) -> `chats.act` `suggestion` (`j30-app-language.md`); starter chips of an empty chat -> `chats.send {chatId, starter}`, acting by code.
  - "Try again" after a failed turn (`j22-make-a-flow.md`, E4) -> `retry_turn`; "Run with Claude Code this time" (`j31-agent-and-model.md`) and "Use Claude Code for this run, draft or change" (`j20-run-from-chat.md`, `j22-make-a-flow.md`, `j23-improve-a-flow.md`) -> `use_other_agent`.
  - `flows.start {source: "again", inputs: <the run's inputs>}` (`j25-history-and-problems.md`, P2) -> `flows.start {source: "again", fromRunId}`.
  - `approvals.resolveSimilar {runId, group}` (`j24-decisions.md`) -> adds `approvalIds`.
  - the spent amount from `activity.summary` (`j12-settings.md`, S1) -> `settings.get` (`spending`).
  - `harnesses.setConsent` and per-agent consent -> `settings.update {agentPermission}` and `agents.setUp` (`j01-first-launch.md`).
  - topic `harnesses` -> `agents`; notice targets `inbox` and `builder` -> `run`, `chat`, `flow`, `activity`, `settings`.
  - flow `signOff` `approved`, `stale`, `none` -> `state` `confirmed`, `changed`, `new`.
  - run cause "Flow not confirmed" (`j25-history-and-problems.md`, P4) -> `flow_not_confirmed`; "You stopped this run." -> `stopped`; "Stopped because you turned off permission." (`j12-settings.md`, E5) -> state `stopped` with cause `permission_off`.
  - parser messages (`j27-flow-inputs.md`, E3) -> `InputProblem` codes `empty`, `unreadable`, `zero`, `too_long`, `too_long_text`, `out_of_range`, `not_a_choice`, `hidden_characters`, read together with the input type.
  - slot outcome `skipped` (`j28-proactive-schedule.md`) -> Earlier row kind `skipped`.
  - the notification of a confirm-kind waiting item (`j28-proactive-schedule.md`, E7, which reuses the question's words) -> its own kind `confirm_waiting` with the same words, so the notice policy and its tests can tell the two apart.
  - a start with the permission off: "a new run is `blocked`" (`j25-history-and-problems.md`, E2 and A15) against "no run is created" (`j12-settings.md`, E2; `j21-run-from-flows.md`, E2 and A15) -> no run: `flows.start` returns `refused` with `permission_off`, and a slot is `missed`. The cause `permission_off` stays for a run whose start check finds the permission off.
  - names in `test-cases/journeys.md` that differ: `use_other_agent`, `retry_turn`, `suggestion`, `confirm_flow` are kept; `unschedule_yes` and `unschedule_no` -> `turn_off_schedule` and `keep_schedule`; `repeat_yes` and `repeat_no` -> `every_time` and `only_this_time`; `schedule_chip` -> `propose_schedule`; `stop` -> `stop_runs`; `change` -> `change_plan`; `chats.act {action: "approve"}` -> `approvals.resolve {decision: "approve"}`; `{started: false, reason: "needs_confirmation"}` -> `{outcome: "needs_confirmation"}`; Earlier rows with `text` -> rows with codes, words drawn by the renderer.
