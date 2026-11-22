# FlowDriven data model

Status: complete for the V1 build, 2026-11-21 (revised after the early review, 2026-11-21).

This file lists every entity the real app stores, the tables of store version 7, the migration from store version 6, and how long data is kept. It extends the store that exists today; it replaces nothing. It follows the architecture decisions in `architecture.md`: AD-05 (the store), AD-06 and AD-07 (decisions and standing rules), AD-10 (the assistant), AD-13 (starts and schedules) and AD-14 (words). The read models the screens get, and the operations that write these entities, are in `runner-api.md`. The safety rules `SR-1` to `SR-9` and the start rule `START` are defined in `architecture.md`; this file cites them.

## 1. Conventions

- **One store, one writer.** One SQLite database, `<data folder>/flowdriven.sqlite`, opened by the runner through `node:sqlite` with the exclusive lock, the WAL journal, `foreign_keys = ON` and a busy timeout, as `sqlite-store.ts` does today. Only the runner writes it (AD-02). Version 7 also sets `secure_delete = ON` on every open, so deleted chats and messages are overwritten on disk.
- **Rows.** Most tables have a few key columns and one `data` column that holds the whole row as JSON, as today (`usage_events`, `seen`, `counters`, `fire_keys` and `audit_log` keep plain columns). A key column repeats a field of `data` that a query filters or sorts on. The store writes both in one statement, and the row decoder checks that they agree, as `decodeTrigger` does today. A row that fails its decoder is skipped and counted; it is never half-read.
- **Ids.** New ids are `<prefix>-<12 hex>` from the injected `newId(prefix)` (`service/service.ts`). Prefixes: `run` (runs), `ap` (decisions), `chat`, `msg`, `draft`, `rule`, `wq` (waiting questions), `start`. Existing ids keep their form. Flow ids keep the reverse-DNS form of format 1.1; flows made in the app get `local.<slug>` (section 3.1).
- **Time.** Moments are ISO 8601 in UTC with milliseconds (`IsoDateTime`). Schedule times are wall-clock `HH:MM` and days are `mon` to `sun`, in the person's time zone, which comes from the operating system through the injected clock. Calendar dates are `YYYY-MM-DD`. Tests inject the clock and the zone.
- **Hashes.** `sha256:<64 hex>` (`ContentHash`), from `contentHash` in the SDK, as today.
- **Words.** Data keeps codes, never FlowDriven's sentences (AD-14). FlowDriven's own lines are stored as a `Line`: a key of `LINE_KEYS` (`packages/contracts/src/line-keys.ts`, new) and the raw values to fill in; `apps/desktop` draws it with its language files in `apps/desktop/src/i18n/`, because no words live in `packages/*` (AD-14, owner decision for V1, revisable). The runner never builds a sentence: it emits a code with values, and the renderer, or Electron main for a system notification, turns it into words. A quoted sentence in this set is only the English drawing of such a `Line`. Text that a person, an agent or a flow author wrote is stored as text, with its language when known. A FlowDriven line keeps the language it was posted in, so a later language change rewrites nothing (FS-j30.S4).
- **Outside text.** Anything that holds outside text carries `outside: true` (SR-5). Text the person approved as their own carries the existing own-text mark (`exec/own-text.ts`).
- **Money.** US dollars, rounded to cents.
- **Releases.** V1 is build steps B-01 to B-24 and B-31; V2 adds Memory, Phone & bots and skill updates; V3 adds the Marketplace and the gateway (`prd.md`, section 9). Each entity names the release that needs it.
- Files that do not exist yet are marked "(new)".

Shared value types (TypeScript-like):

```ts
type StartSource = "chat" | "flows" | "again" | "schedule" | "after" | "try_next" | "proactive" | "phone" | "tool";
type Effect = "read" | "local_write" | "run_command" | "change" | "send" | "post" | "pay" | "delete" | "merge";
type TouchRule = "runs_alone" | "asks_first" | "not_allowed";
type Place = { kind: "account" | "folder" | "address" | "site" | "command" | "repo"; value: string; label: string };
type Line = { key: string; params?: Record<string, string | number> };
type LanguageCode = string;          // a code main passes to the runner at spawn (--languages), from apps/desktop/src/i18n/languages.ts (new): "en", "id"
type InputType = "text" | "longtext" | "number" | "bool" | "date" | "time" | "duration" | "choice"
  | "url" | "file" | "folder" | "secret_ref" | "list<text>";
type TypedValue = { type: InputType; value: string | number | boolean | string[] };
type AgentChoice = "chat" | "main" | "busy_fallback";
type ScheduleSpec =                          // the person-facing schedule, as runner-api.md section 3 gives it
  | { type: "manual" }
  | { type: "daily" | "weekdays"; time: string; whenItsTime?: "ask" | "last" }
  | { type: "weekly"; day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; time: string; whenItsTime?: "ask" | "last" }
  | { type: "after"; afterFlowId: FlowId; whenItsTime?: "ask" | "last" };
```

`Place.value` is canonical: an account is the id of the requirement that reaches it; a folder is the resolved absolute path pinned at confirmation; an address is the lowercased address; a site is a host; a command is the declared command pattern; a repo is `owner/name`. Two places are the same only when `kind` and `value` are both equal. `label` is for display and is never compared.

Place kinds per effect for V1 standing rules (SR-1; decided for V1, revisable): a `change` rule uses an `account` or a `folder` place (the timesheet entry, one cloud folder upload); a `local_write` rule uses a `folder`; a `run_command` rule uses a `command`. No other kind may be the place of a rule. There is no standing rule for `send`, `post`, `pay`, `delete` or `merge` in V1, so the kinds `address`, `site` and `repo` never appear in a rule. If send or post rules are ever allowed, they need destination-level places (every recipient, a channel, with cc, bcc and attachments) and a step-level rule that ignores standing rules after the step read outside-marked results; that is a later approvals change with its own security review. Typed values are canonical too: a date is `YYYY-MM-DD`, a time is `HH:MM`, a duration is whole minutes, a choice is its key.

## 2. Entity map

| Entity | What it is | Stored in | Release | Status |
|---|---|---|---|---|
| Flow | One flow in the person's list: current version, name, origin, a tombstone after delete | `flow_heads` | V1 | new |
| Flow version | The files and manifest of one exact version, by content hash | `flows` | V1 | changed |
| Confirmation | The person's yes for one exact version and what it may do on its own | `confirmations` | V1 | new (generalizes `capability_consents` and `consent_pins`) |
| Standing rule | "Always allow for this flow" for one touch, effect and place | `standing_rules` | V1 | new |
| One-time grant | The person's approval of one exact call | `call_grants` | V1 | new (replaces `grants`) |
| Schedule | When a flow starts by itself, as the person set it | `schedules` | V1 | new |
| Manifest trigger | A format 1.1 trigger and its state | `triggers`, `fire_keys` | V1 | kept |
| Start request | Every request that went through `START`, with its outcome; missed and skipped slots are recorded here too (not shown as rows in Activity in V1) | `starts` | V1 | new |
| Chat | One conversation, its agent and model, its language, the unsent composer text | `chats` | V1 | new |
| Message | One entry in a chat: the person's text, the agent's reply, a FlowDriven line, a note, a run's answer, or a card | `messages` | V1 | new |
| Chat turn | The state of the one agent call that answers a person's message | inside its message | V1 | new |
| Card | Buttons and fields inside a message | inside its message | V1 | new |
| Draft | A flow or a change the chat proposed, before Save | `drafts` | V1 | new |
| Waiting question | A start that waits for missing inputs or for a confirmation | `waiting_questions` | V1 | new |
| Remembered answer | The last value of an input, for "Like last time" and "Use my last answers" | `remembered` | V1 | new |
| Run, step, item, seen | One execution of one flow version | `runs`, `steps`, `items`, `seen` | V1 | changed |
| Decision | Something a run waits on the person for | `approvals`, two `settings` rows | V1 | changed |
| Audit record | The append-only record of every call, decision, permission change and start | `audit_log` | V1 | changed (new kinds) |
| Usage | One agent call's tokens, time and cost | `usage_events` | V1 | changed |
| Settings | The person's choices | `settings` | V1 | changed (new keys) |
| Window preferences | The color mode | main's own file | V1 | new |
| Agent | One AI agent on this Mac: state, version, billing, models | `harness_state` | V1 | changed |
| Model | A model an agent offers | inside the agent row | V1 | new |
| Agent catalog entry | What FlowDriven knows about an agent: install, sign-in and status commands, model catalog | code, never stored | V1 | new |
| Skill | A skill an agent has, or one of FlowDriven's own | scanned, not stored in V1 | V1 | new |
| Skill history | Skill text versions for updates and roll back | `skills`, `skill_versions` | V2 | later |
| Memory item | What the agent remembers about the person, and per-flow grants | `memory_items`, `memory_grants` | V2 | later |
| Phone link | A paired Telegram or Discord bot | `phone_links` | V2 | later |
| Marketplace install | Where an installed flow came from, its signature and revocation state | `market_installs` | V3 | later |

## 3. Entities

### 3.1 Flow and flow versions (V1)

A flow has one row in `flow_heads` and one row in `flows` per version. The existing `flows` table keeps its name and key so that the migration only adds; in this document "flow version" means a `flows` row.

```ts
type FlowHead = {                      // flow_heads.data (new)
  id: FlowId;                          // reverse-DNS, as format 1.1
  name: string;                        // 1..80; unique among flows that are not deleted, ignoring ASCII case
  summary: string;                     // 0..300
  headHash: ContentHash;               // the current version
  createdAt: IsoDateTime;              // order of the Flows list, newest first
  updatedAt: IsoDateTime;
  origin: FlowOrigin;
  deletedAt?: IsoDateTime;             // tombstone: the id is never reused
};
type FlowOrigin =
  | { kind: "chat"; chatId: ChatId; draftId: DraftId }
  | { kind: "skill"; chatId: ChatId; draftId: DraftId; skillId: SkillId }
  | { kind: "import" }                 // flows.import, for developers
  | { kind: "market"; listingId: string }   // V3
  | { kind: "demo" };                  // the runner's --demo mode

type FlowVersion = {                   // flows.data: today's FlowRow plus the version 7 fields
  id: FlowId; version: SemVer; hash: ContentHash;
  manifest: unknown;                   // the SDK manifest as parsed, format 1.1 or 1.2
  files: Record<string, string>;       // path -> UTF-8 text, as today
  registeredAt: IsoDateTime;
  format: "flowdriven-flow/1.1" | "flowdriven-flow/1.2";   // a version 6 row reads as 1.1
  savedBy?: { kind: "save_flow" | "save_change" | "import" | "market" | "demo"; draftId?: DraftId };
  parentHash?: ContentHash;            // the version this one was changed from
};
```

Rules:
- The head is `flow_heads.headHash`. `Store.getFlow(id)` without a hash returns the head version; today it returns the row with the highest rowid, and the two agree after the migration.
- A new version comes from Save change, an import of a folder whose id exists, or a marketplace update (V3). It moves the head in the same transaction. Old versions stay (F-11.R2).
- A flow made in the app gets the id `local.` plus a slug of its name (lowercase ASCII letters, digits and hyphens, at most 60 characters, `flow` when nothing is left). A taken id (live, deleted, or present in `flows`) gets `-2`, `-3` and so on.
- A draft whose name is taken shows the next free name, "Invoice collector 2", before saving (FS-j22.P4). A unique index enforces unique names.
- The flow state shown to the person is derived and never stored:
  - `confirmed`: a confirmation exists, its `hash` equals `headHash`, and every skill hash it pinned still equals the skill's current hash;
  - `changed`: a confirmation exists but one of those checks fails;
  - `new`: no confirmation exists.
- The badges "Running now" and "Needs you" are derived from runs, decisions and waiting questions.
- Changing the main agent, a model, the language, the spending limit or the schedule never changes a flow's hash or state (FS-j12.A14, FS-j21).

The format 1.2 parts the store and the API read (AD-04; defined in `packages/sdk/src/format/inputs.ts`, `result.ts`, `touches.ts` and `schedule.ts`, all new):
- `inputs[]`: `id`, `label`, `type` (`InputType`; `choice` is the alias of `enum`), `required`, `default` (a literal value or the codes `today` and `now`), `example`, `remember`, `choices` for `choice`.
- `result`: `{kind: "chat" | "report", answer?: string[] | Record<LanguageCode, string[]>}`; answer lines hold `{inputId}` placeholders.
- `touches[]`: `{id, sentence, effect, place?, rule, covers}`, where `covers` lists the declared tools or command patterns the touch stands for; FlowDriven checks them against the requirements (each declared tool or command covered by exactly one touch, `architecture.md` AD-04) and classifies `effect` with its own catalog.
- `schedule`: a suggestion only. Save flow copies a draft's schedule into `schedules` once (3.5); a file's schedule never turns on by itself, and a flow file never holds standing rules (AD-04).

### 3.2 Confirmation (V1)

```ts
type Confirmation = {                  // confirmations.data (new); one row per flow
  flowId: FlowId;
  hash: ContentHash;                   // the exact version the person confirmed (SR-3)
  at: IsoDateTime;
  by: "save_flow" | "save_change" | "confirm_dialog" | "chat_card" | "migration";
  onItsOwn: TouchId[];                 // touches the person left or moved under "Does on its own"
  pins: {
    skills: Record<string, ContentHash>;                 // skill ref -> skill content hash at confirmation
    folders: Record<string, { path: string; access: "read" | "read_write" }>;   // requirement id -> pinned folder
  };
  chatId?: ChatId;
  draftId?: DraftId;
  legacy?: true;                       // copied from a version 6 capability consent; the flow has no touches
};
```

Rules:
- One row per flow: the latest confirmation. Earlier confirmations are in the audit log.
- Confirming writes this row, creates, keeps or ends standing rules (3.3), and writes the audit record `flow_saved`, `flow_changed` or `flow_confirmed`, all in one transaction.
- `onItsOwn` never holds a touch whose rule is `not_allowed`, and in V1 it never holds a risky kind (`send`, `post`, `pay`, `delete`, `merge`): drafts place such a touch under "Asks you first", it cannot be moved, and `flows.confirm` refuses it in `onItsOwn` with `not_allowed`, reason `always_asks` (SR-1; decided for V1, revisable). A non-read touch in `onItsOwn` must have a fixed place (SR-1); `local_write` and `run_command` touches are fixed by their declared folder or command, and a `change` touch by its account or folder.
- A `legacy` confirmation covers a format 1.1 flow's declared requirements exactly as the version 6 capability consent did; it has no touches and makes no standing rules.

### 3.3 Standing rule (V1)

```ts
type StandingRule = {                  // standing_rules.data (new)
  id: RuleId;
  flowId: FlowId;
  touchId: TouchId;
  effect: "local_write" | "run_command" | "change";   // V1: never send, post, pay, delete or merge
  place: Place;                        // always a fixed place declared in the flow (SR-1); its kind fits the effect (section 1)
  sentence: string;                    // the touch sentence when the rule was made, for display
  state: "active" | "revoked";
  createdAt: IsoDateTime;
  createdBy: "always_allow" | "confirm";
  approvalId?: DecisionId;             // always_allow: the decision it came from
  confirmationHash?: ContentHash;      // confirm: the confirmed version
  revokedAt?: IsoDateTime;
  revokedBy?: "ask_me_again" | "flow_changed" | "moved_to_asks_first" | "flow_deleted";
  uses: number;
  lastUsedAt?: IsoDateTime;
};
```

Rules:
- Only the person's click in the desktop window makes a rule: "Always allow for this flow" (`approvals.resolve`) or a confirmation (Save flow, Save change, the confirm dialog) (SR-2). "Always allow for this flow" exists exactly as in the prototype: only for a repeatable `change` action at a fixed place, from a pending `risky_action` decision whose effect is `change` (the timesheet entry, one cloud folder upload). It is never offered for `send`, `post`, `pay`, `delete` or `merge`. A phone, a bot, a flow file, a skill, memory, an agent or another AI tool never makes, widens or revives one.
- A rule matches a call only when flow, touch id, effect and place are all equal, and the run's own version has a touch with that id, effect and place (AD-06).
- At a new confirmation an active rule stays only if a touch with the same id, effect and place still exists and is still in `onItsOwn`. Otherwise it is revoked with `flow_changed` (touch gone or changed) or `moved_to_asks_first` (AD-07).
- "Ask me again" revokes at once (`rules.revoke`). A call that already started under the rule is not undone.
- At most one active rule per flow, touch, effect and place; making the same rule again returns the active one.
- The store refuses to make a rule with any other effect (error `rule_effect_not_allowed`) or with a place kind that does not fit its effect (error `rule_place_not_allowed`), so no code path can store a rule for a risky kind; a rule row of another effect, from a damaged or later store, is never matched (SR-1).
- After a Reject in a run, no standing rule applies for the rest of that run; the held call shows the normal decision card.
- The audit records of a rule (`rule_created`, `rule_revoked`, `rule_used`) keep the rule id and the place kind, never the place value (3.16).

### 3.4 One-time grant (V1)

```ts
type OneTimeGrant = {                  // call_grants row (new): key columns plus data
  runId: RunId;
  stepId: string;                      // "*" only for pick grants and migrated grants
  itemKey: string;                     // "" when the step has no loop item
  tool: string;                        // the requirement-qualified tool name
  digest: string;                      // sha256 of the exact call (tool and canonical input), as exec/held.ts computes it; "*" for picks
  kind: "approve" | "edit" | "similar" | "pick" | "migrated";
  approvalId?: DecisionId;
  createdAt: IsoDateTime;
  usedAt?: IsoDateTime;                // set when the call runs; a used grant never matches again
};
```

Rules:
- Approve, Save and approve (bound to the digest of the edited call) and Approve all similar (one grant per decision) each write one grant (AD-07).
- A grant matches only a call in the same run, step and item, with the same tool and digest, once. It ends with its run and never carries to another run.
- A pick grant comes from an `ask` step's `approves` list, as today: it lets the picked item's later steps call that tool, and it is not used up.
- `migrated` grants come from version 6 `grants` rows of runs that were still open (section 5).

### 3.5 Schedule (V1)

```ts
type Schedule = {                      // schedules.data (new); no row means "Only when I start it"
  flowId: FlowId;
  type: "daily" | "weekdays" | "weekly" | "after";
  time?: string;                       // "HH:MM"; required for daily, weekdays and weekly
  day?: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";   // weekly only
  afterFlowId?: FlowId;                // after only
  whenItsTime: "ask" | "last";         // "Ask me in the chat" or "Use my last answers"
  setAt: IsoDateTime;
  setBy: "window" | "chat_card" | "save_flow";
  confirmedHash: ContentHash;          // the confirmed version when the schedule was set
  cursorAt?: IsoDateTime;              // the last slot the trigger service handled
  lastFire?: { at: IsoDateTime; outcome: StartRequest["outcome"]; startId: StartId };
  pausedAt?: IsoDateTime;
  pausedWhy?: "blocked_runs" | "challenge";
};
```

Rules:
- Only the person changes it: in the window, or with a schedule card they click (SR-2). Setting it needs a `confirmed` flow and carries the confirmed hash.
- A schedule is the person's state, not flow content: changing it never changes the flow's hash (FS-j21).
- The trigger service (`triggers/service.ts`) reads `schedules` next to the manifest triggers. `daily`, `weekdays` and `weekly` map onto an `at` and `days` schedule trigger with `catch_up: once` and `overlap: skip`; `after` maps onto `flow_done` on `afterFlowId` with status `done` (AD-13, FS-j28.P1). Every fire goes through `START`.
- Each slot is claimed once through the `starts` key (3.7), so two ticks or a restart never handle a slot twice.
- A flow change keeps the schedule's settings; `START` refuses the changed flow until it is confirmed again (SR-3).
- Deleting a flow deletes its schedule and every schedule whose `afterFlowId` is that flow; those become "Only when I start it".
- Turning a schedule on never starts a run (decided for V1, revisable). The offer "Run it now?" that follows Save flow is a card, not part of the schedule.

### 3.6 Manifest trigger (V1, kept)

Format 1.1 triggers (`schedule` with `every` or `at`, `file_change`, `flow_done`) keep the `triggers` and `fire_keys` tables and today's `TriggerRow`. `triggers.setEnabled` switches them, for format 1.1 flows only. Their fires go through `START` with source `schedule` (`after` for `flow_done`); the run keeps `trigger.kind`.

### 3.7 Start request (V1)

```ts
type StartRequest = {                  // starts row (new)
  id: StartId;
  flowId: FlowId;
  at: IsoDateTime;
  source: StartSource;
  outcome: "started" | "asked" | "needs_confirmation" | "refused" | "missed" | "skipped";
  reason?: "permission_off" | "daily_limit" | "too_old" | "clock_changed" | "question_open" | "still_running"
    | "flow_deleted" | "agent_cannot_be_limited";
  key?: string;                        // idempotency key, unique per flow
  runId?: RunId;                       // started
  chatId?: ChatId;                     // asked, needs_confirmation, or the chat of a chat start
  messageId?: MessageId;               // the question or confirm card
  questionId?: QuestionId;             // asked or needs_confirmation
  slotAt?: IsoDateTime;                // schedule, after and try_next: the slot the start is for
  request: { chatId?: ChatId; messageId?: MessageId; chainId?: string; chainIndex?: number;
             afterRunId?: RunId; fromRunId?: RunId };
  agent?: { agent: AgentId; model: ModelId; choice: AgentChoice };
  flowHash?: ContentHash;
};
```

Keys: `slot:<slot time>` for a schedule slot; `after:<upstream run id>` for "after another flow"; `chain:<chain id>:<index>` for the next flow of a chain; `answer:<question id>` for the start that answers a waiting question. Other starts have no key.

Rules:
- `starts.request(flowId, source, context)` (`packages/runner/src/starts/start-rule.ts`, new) writes exactly one row, in the same transaction as what it creates (run, question, card, chat). A second request with the same key returns the first row and creates nothing (FS-j28.A2, FS-j28.A20).
- A chat-typed start writes a row too, with source `chat`, so the audit and M-07 can count every start.
- A slot that cannot run is a row with outcome `missed` and its reason; a slot that finds the flow busy or its question open is a row with outcome `skipped`. In V1 Activity shows run rows only: missed and skipped slots stay in `starts` and in the audit log (`start_requested`), and no row, "Run late" mark or "Run it now" offer is built for them (decided for V1, revisable; they go into the prototype first).
- `refused` is for a start the person asked for that cannot run (permission off, daily limit, an agent that cannot be limited); no run is created. A slot that cannot run is `missed`, and with the permission off its reason is `permission_off`.

### 3.8 Chat (V1)

```ts
type Chat = {                          // chats.data (new)
  id: ChatId;
  title: string;                       // "" until the first person message (drawn as "New chat"), then that message cut to 40 characters; a starter chip that runs flows sets their names; a FlowDriven chat uses the flow name
  titleSource: "default" | "first_message" | "flowdriven";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;              // order of the chat list; a person message moves the chat to the top of Today
  from: "person" | "flowdriven";
  subject?: { kind: "make" } | { kind: "improve"; flowId: FlowId } | { kind: "skill"; skillId: SkillId }
    | { kind: "flow"; flowId: FlowId } | { kind: "change_draft"; draftId: DraftId };
  language: LanguageCode;              // FlowDriven's posted lines follow it; starts as the app language
  languageSource: "app" | "typed";
  agent: AgentId;                      // the chat's choice (FS-j31)
  model: ModelId;
  agentSource: "main_default" | "person" | "model_gone";
  composerText?: string;               // the unsent composer text, kept until sent (F-03.R1); at most 16,000 characters
};
```

Rules:
- "New chat" reuses an empty chat (one with no messages) and moves it to the top; otherwise it makes an untitled chat (drawn "New chat") on the main agent and its default model.
- The language changes only from text the person typed, when the turn reports a registered code; a chip, a button, outside text, an agent's report and a run's answer never change it (FS-j30.P2).
- The agent and model change only through `chats.setAgent` (the person's click), or fall back to the agent's default when the stored model is no longer offered (FS-j31.P8). A run already going keeps its own.
- A FlowDriven chat (`from: "flowdriven"`) is made for a scheduled question, the answer of a `chat` result started outside a chat, or a confirm card of a start outside a chat. It starts on the main agent and its default model, in the app language.

### 3.9 Message and chat turn (V1)

```ts
type Message = {                       // messages.data (new)
  id: MessageId; chatId: ChatId; seq: number; at: IsoDateTime;
  role: "person" | "agent" | "flowdriven";
  kind: "text" | "reply" | "line" | "note" | "result" | "card";
  text?: string;                       // kind text (the person) or reply (the agent); at most 16,000 characters
  line?: Line;                         // kind line, note, or a person message FlowDriven wrote for a button click
  result?: { runId: RunId; lines: string[]; values: Record<string, TypedValue>; language: LanguageCode };   // a chat result: the flow's answer lines with {inputId} placeholders and the run's values; the renderer fills them in the run's language
  card?: Card;                         // kind card (3.10)
  chips?: Chip[];
  language?: LanguageCode | string;    // the language it was written in; a line renders in it forever
  outside: boolean;                    // holds outside text (SR-5)
  fromChip?: boolean;                  // sent by a chip: never changes the chat's language
  pasted?: boolean;                    // the person pasted part of the text: treated as outside text for SR-5
  byButton?: boolean;                  // written by FlowDriven for the person's click (Make a flow from a skill)
  turn?: ChatTurn;                     // on a person message that needs an answer
};
type Chip =
  | { kind: "suggestion"; label: Line | { text: string } }   // chats.act "suggestion": sent as the person's message
  | { kind: "act"; label: Line; action: CardAction }        // chats.act on this message's card
  | { kind: "open"; label: Line; chatId: ChatId };          // opens another chat ("Answer in chat")
type ChatTurn = {
  state: "queued" | "running" | "done" | "failed" | "interrupted";
  agent: AgentId; model: ModelId;
  queuedAt: IsoDateTime; startedAt?: IsoDateTime; endedAt?: IsoDateTime;
  attempts: number;                    // an answer that fails validation is asked for once more; two failures end the turn
  intent?: "answer" | "run" | "run_together" | "run_chain" | "stop" | "status" | "schedule" | "unschedule"
    | "make_flow" | "make_flow_from_skill" | "improve_flow" | "fill_inputs";   // AD-10
  failure?: "not_understood" | "no_usage" | "spending_limit" | "agent_failed" | "timeout" | "interrupted";
  outsideInContext: boolean;           // SR-5: the turn may only post cards, never start a run
};
```

Rules:
- A chat answers one turn at a time; later person messages wait with `queued` (FS-j20.P14).
- At start after a crash, every turn in `queued` or `running` becomes `interrupted` and gets a `turn_failed` card with "Try again"; nothing runs by itself (FS-j22.E5).
- The prompt of a turn and the agent's raw output are never stored; only the validated intent and what FlowDriven posted.
- Each turn writes one `usage_events` row (3.17).
- `messages.search_text` repeats the person's text, the agent's reply and result lines (with the raw values put in) for Search (AD-17); lines and cards are not searched.

### 3.10 Card (V1)

```ts
type Card = {                          // inside its message; the message id is the card id
  type: CardType;                      // runner-api.md, section 8, lists every type, its fields and actions
  state: "open" | "answered" | "replaced" | "cancelled";
  answer?: { action: CardAction; at: IsoDateTime };
  // plus the type's own fields: ids of what the card is about (flowId, hash, runIds, approvalId, draftId,
  // questionId) and what a click needs (for example pendingStart on a confirm card)
};
```

Rules:
- A card stores ids and the person's answer, not copies of live state. The read model joins the current run, decision, draft or flow when a chat is read, and derives two more states: `stale` (the flow or skill changed since the card was made) and `flow_deleted` ("a deleted flow").
- `messages.card_type` and `messages.card_state` repeat `type` and `state`, so the runner can find open cards with an index.
- `chats.act` answers a card in the same transaction as the card's effect. A second click finds the card answered and changes nothing (FS-j22.A8).
- Decision cards and run cards have no answer of their own: their buttons call `approvals.*` and `runs.stop`, and their state follows the decision or the run.

### 3.11 Draft (V1)

```ts
type Draft = {                         // drafts.data (new)
  id: DraftId; chatId: ChatId; messageId: MessageId;   // the card that shows it
  kind: "new_flow" | "change";
  state: "drafted" | "replaced" | "saved" | "cancelled";
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
  files: Record<string, string>;       // the complete format 1.2 files FlowDriven built (flow.yaml, README.md)
  hash: ContentHash;                   // of files
  name: string;
  nameAdjusted: boolean;               // a suffix was added because the name was taken
  lists: { onItsOwn: TouchId[]; asksFirst: TouchId[]; never: TouchId[] };   // FlowDriven's placement (SR-1), never the agent's
  schedule?: ScheduleSpec;             // what "Runs: ..." shows; Save flow applies it
  outside: boolean;                    // made while the context held outside text: the card carries the tag
  assumptions: string[];               // what the assistant assumed instead of asking a second question (agent text)
  madeFrom?: { skillId: SkillId; skillHash: ContentHash; skillName: string };
  flowId?: FlowId;                     // change: the flow it changes
  baseHash?: ContentHash;              // change: the head when the change was proposed
  changes?: { sign: "+" | "-" | "~"; text: string }[];
  replacedBy?: DraftId;
  saved?: { flowId: FlowId; hash: ContentHash; at: IsoDateTime };
};
```

Rules:
- A draft is not a flow. Nothing exists in `flow_heads`, `flows`, `confirmations`, `standing_rules` or `schedules` for it until Save (FS-j22.A5).
- Save flow and Save change are each one transaction: the flow version, the head, the confirmation, the rules, the schedule, the draft's `saved` state, the card's answer and the audit record (FS-j22.A14, FS-j23.A15).
- A second Save on the same draft returns the saved flow and creates nothing.
- A `change` draft whose `baseHash` is not the flow's head is stale (FS-j23.A12); a skill draft whose skill hash changed is stale (FS-j29.A10). A stale draft cannot be saved.
- Drafts live with their chat and are deleted with it.

### 3.12 Waiting question (V1)

```ts
type WaitingQuestion = {               // waiting_questions.data (new)
  id: QuestionId; flowId: FlowId; chatId: ChatId; messageId: MessageId;
  kind: "inputs" | "confirm";          // missing inputs, or a confirm card for a new or changed flow (FS-j28.P5)
  state: "open" | "answered" | "cancelled" | "closed";
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
  source: StartSource;                 // the start that asked
  proactive: boolean;                  // not typed in this chat: a "Needs you" item that counts in the Activity number
  flowHash: ContentHash;               // the version whose inputs were asked
  slot?: { at: IsoDateTime; date: string; time: string };   // "today" and "now" resolve to the slot (FS-j27.E8)
  given: Record<string, TypedValue>;   // values already parsed
  missing: string[];                   // required inputs still missing or invalid
  pendingStart: { startId: StartId; source: StartSource; request: StartRequest["request"];
                  agent?: { agent: AgentId; model: ModelId } };
  answeredAt?: IsoDateTime;
  runId?: RunId;
  closedReason?: "flow_deleted" | "chat_deleted";
};
```

Rules:
- At most one `open` question per flow, of either kind (a partial unique index). A new request for a flow with an open question reuses it: its chat moves to the top, no second chat and no second notification (FS-j28.P5). A request from another chat gets the line "<flow> is already waiting for your answer." with an "Answer in chat" chip. A slot that finds the question open is recorded `skipped` with reason `question_open`.
- A question survives a restart, and a restart starts nothing (FS-j27.A17). It does not expire (FS-j28.E11).
- If the flow changed before the answer, the start after the answer goes through `START` rule 1 and keeps the values; values for inputs that no longer exist are dropped (FS-j27.E7).

### 3.13 Remembered answer (V1)

```ts
type RememberedAnswer = {              // remembered row (new); key (flow_id, kind, input_id)
  flowId: FlowId; inputId: string;
  kind: "remember" | "last";
  value: TypedValue;
  outside: boolean;                    // the value came from outside text (SR-5) and the person has not typed or confirmed it
  savedAt: IsoDateTime;
  runId: RunId;
};
```

Rules:
- Written when a run starts, not when it ends (FS-j27.A10).
- `remember` rows exist only for inputs that declare `remember`, and never for `date`, `time` or `secret_ref` inputs (AD-11, TC-SR6-05).
- `last` rows hold the run's value of every input except `date`, `time` and `secret_ref`, which return to their defaults (TC-SR6-05 for `secret_ref`); they serve "Use my last answers" (FS-j27.P2, FS-j28.P2).
- `outside` is set when the value of an input came from outside text (an email, a web page, a file read by an agent). A person who types or confirms the value clears the mark.
- "Use my last answers" and `whenItsTime: "last"` are not offered when a needed value is a row with `outside: true`; the person is asked for that value instead (SR-5; decided for V1, revisable).
- "Run again" does not read these rows; it reads the earlier run's own inputs (FS-j25.P2).

### 3.14 Run, step, item and seen (V1, changed)

The `runs`, `steps`, `items` and `seen` tables stay. New fields go into `data`. Version 6 rows are not rewritten: the decoder fills the default in the last column.

| Run field | Type | Meaning | Default for a version 6 row |
|---|---|---|---|
| `state` | `RunState` | adds `needs_login` "Waiting for sign-in" and `stopped` "Stopped by you" | as stored |
| `flowName` | string | the name at start, so a deleted flow's runs still show it | from the run's flow version |
| `start` | `{source: StartSource, startId?, chatId?, messageId?, chainId?, chainIndex?, afterRunId?, fromRunId?, questionId?, slotAt?}` | how the run started | `source` from `trigger.kind`: none or `manual` -> `flows`, `flow_done` -> `after`, any other -> `schedule` |
| `agent` | `{agent: AgentId, model?: ModelId, choice: AgentChoice}` | the agent and model the run used; never changes afterwards (FS-j31) | `{agent: "claude-code", choice: "main"}` with no model |
| `language` | `LanguageCode` | the language of its answer lines and dates | `"en"` |
| `cause` | `{code: CauseCode, params?}` | why it is `blocked`, `needs_login`, `failed`, `interrupted` or `stopped` (`runner-api.md`, `Cause`) | `crash` for `interrupted`, else `step_failed` when `blockedReason` is set |
| `needsLoginSince` | IsoDateTime | start of a sign-in wait; after 12 hours the run becomes `blocked` (FS-j25.A5) | none |
| `decisionLines` | `Line[]` | the honest lines, as codes with the title as a value; the English drawings are "You approved: X.", "Done by your rule: X.", "You said no: X. It was not done." (AD-12) | `[]` |
| `result` | `{kind: "chat" or "report", chatId?, messageId?}` | where the answer went | none |
| `stoppedBy` | `"person"`, `"permission_off"`, `"flow_deleted"` or `"phone"` | who stopped it | none |

Today's fields stay: `flowHash` is the version the run runs (SR-3), `inputs` the resolved typed values, `trigger` the format 1.1 trigger, `requirements` and `routes` the frozen snapshot, `blockedReason` the English sentence the old screens read until they retire.

| Step field | Type | Meaning |
|---|---|---|
| `state` | `StepRunState` | adds `stopped` |
| `ruleUses` | `{ruleId, tool, at}[]` | calls that ran by a standing rule; the evidence "Allowed by your rule" |
| `skipped` | `{because: "rejected" or "no_picks" or "needs_skipped_result", approvalId?, stepId?}` | why a step was skipped, so the report can say it (FS-j24.P2) |

Items and seen keep their version 6 shape.

### 3.15 Decision (V1, changed)

Decisions keep the `approvals` table and today's `ApprovalRow`. New fields go into `data`:

| Field | Type | Meaning | Default for a version 6 row |
|---|---|---|---|
| `state` | `ApprovalState` | adds `approved_edited` and `allowed_always` | as stored |
| `effect` | `Effect` | the kind of the held action, from FlowDriven's catalog | from `riskyAction`, else none |
| `touchId` | TouchId | the touch of the flow it belongs to | none |
| `place` | `Place` | where the call goes, as FlowDriven read it from the call | none |
| `fixedPlace` | boolean | the place equals the touch's fixed place (SR-1); "Always allow for this flow" may be offered only when this is true, the effect is `change` and the place did not come from outside text | false |
| `similarGroup` | string | held calls of the same run and kind that "Approve all similar" may batch | none |
| `chatId` | ChatId | the run's chat, for the decision card | none |
| `resolvedVia` | `"window"`, `"chat"`, `"phone"`, `"rule"`, `"stop"` or `"permission_off"` | what ended it | `"window"` when resolved |
| `editedSubject`, `editedText`, `editedDigest` | strings | Save and approve | none |
| `ruleId` | RuleId | `allowed_always`: the rule it made | none |

Rules:
- In version 7 every held call is kind `risky_action` with an `effect` (for example `change` for a timesheet entry); `riskyAction` stays set for the five risky kinds.
- A run decision never expires by time; it waits for an answer, Stop, permission off or flow deletion. Version 7 is already built (B-03): its `expiresAt` column stays, nothing reads it from B-05.T14 on, and the next store version drops it.
- Two decisions belong to no run and are not rows here: `weekly_limit` (existing, settings key `weekly:<agentId>`) and the spending pause `budget_raise` (new, settings key `spending-pause`). `approvals.list` and Activity show both. Only `settings.update` resolves the spending pause, by raising the limit (SR-9); otherwise it ends when the next local month begins (`spending-pause.expiresAt`). Either way the paused runs continue under the limit, the decision closes with `resolvedVia` `window` or `expiry`, and it never counts as Reject.

### 3.16 Audit record (V1, changed)

The `audit_log` table stays append-only: its triggers abort every UPDATE and DELETE, and nothing trims it (SR-7, NF-15). `detail` is JSON text. It holds ids, codes, hashes, short titles and counts, never message text, email bodies, file contents, prompts, secrets or the value of a place (an address, a folder path), so deleting a chat leaves nothing of its text in the log. Records of a standing rule keep the place kind and the rule id only (decided for V1, revisable).

Existing kinds stay readable and are still written where their code still runs (`run_error`, `run_dropped`, `run_interrupted`, `items_capped`, `ask_answered`, `call_approved`, `call_rejected`, `own_text_approved`, `own_text_changed`, `call_held`, `grant_used`, `connector_call`, `connector_withheld`, `command_run`, `page_read`, `page_withheld`, `tool_denied`, `tool_unchecked`, `tool_calls`, `limits_not_applied`, `internal_error`, `keep_awake_failed`, `keeper_settings_invalid`, `folder_granted`, `trigger_*`). `capabilities_allowed`, `capabilities_withdrawn` and `harness_consent` are no longer written.

New kinds:

| Kind | Written when | Detail |
|---|---|---|
| `store_migrated` | the version 7 migration commits | `from`, `to`, `backup` (file name), counts, `skipped` |
| `permission_changed` | `agentPermission` changes | `from`, `to`, `source` (`window`) |
| `setting_changed` | any other setting changes | `key`, `from`, `to` |
| `limit_raised` | the spending limit is raised | `from`, `to`, the decisions it resolved |
| `agent_setup` | each phase of Set up | `agentId`, `phase` (`installing`, `installed`, `install_failed`, `waiting_login`, `ready`, `sign_in_timeout`) |
| `agent_sign_in` | Sign in | `agentId`, `result` |
| `chat_turn_failed` | a turn fails or is interrupted | `chatId`, `messageId`, `agent`, `model`, `failure` |
| `chat_agent_changed` | `chats.setAgent` | `chatId`, `agent`, `model` |
| `chat_deleted` | `chats.delete` | `chatId`, message count |
| `flow_saved` | Save flow | `flowId`, `hash`, the three lists (touch ids), `draftId`, `skillId` and skill hash |
| `flow_changed` | Save change | `flowId`, `oldHash`, `newHash`, rules kept and ended |
| `flow_confirmed` | the confirm dialog or a confirm card | `flowId`, `hash`, `onItsOwn`, `by` |
| `flow_imported`, `flow_deleted` | import, delete | `flowId`, `hash`, the schedules turned off |
| `schedule_changed` | a schedule is set, changed or removed | `flowId`, `from`, `to`, `by` (`window`, `chat_card`, `save_flow`, `target_deleted`) |
| `start_requested` | every `START` request | `flowId`, `source`, `outcome`, `reason`, `startId`, `runId` |
| `run_stopped`, `run_resumed` | Stop; Try again or Sign in and continue | `runId`, `by`, `outcome` |
| `decision_made` | approve, edit, reject, always allow, answer | `approvalId`, `runId`, `decision`, `via` |
| `decision_expired` | Stop, permission off, flow deletion | `approvalId`, `runId`, `why` |
| `decisions_batch` | Approve all similar | `runId`, `group`, `approvalIds` |
| `rule_created`, `rule_revoked`, `rule_used` | a standing rule is made, revoked or used | `ruleId`, `flowId`, `touchId`, `effect`, place kind (not the value), `by`, `runId`, `stepId` |
| `question_asked`, `question_closed` | a waiting question opens; it is answered, cancelled or closed | `questionId`, `flowId`, `chatId`, `kind`, `missing`, `state` |
| `run_blocked` | a run becomes `blocked`, `needs_login` or `failed` | `runId`, `state`, `cause` |
| `caller_refused` | the dispatcher refuses an operation for its caller (`tool` or `phone`, V2) | `operation`, `caller` |
| `phone_refused` (V2) | the bot module ignores or refuses a phone command | `reason`, link id |

### 3.17 Usage and spending (V1, changed)

`usage_events` keeps its columns (`at`, `run_id`, `step_id`, `item_key`, `attempt`, `kind`, `harness`, `models`, `turns`, `wall_ms`, `queued_ms`, `memory_peak_mb`, `exit`, `cost_usd`) and gains `billing` (`per_use`, `plan`, or null for unknown).

- Every agent call writes one row: steps and checks as today, and each chat turn with `run_id` = the chat id, `step_id` = the person's message id, `item_key` = "" and `kind` = `brain`.
- `billing` comes from the agent row at the time of the call: the agent's own sign-in method, never its account (3.20).
- The spending of a month is the sum of `cost_usd` over rows with `billing` `per_use` or unknown whose `at` falls in the person's current local month. Rows with `plan` are bound by the agent's own usage limits instead (Q-03).
- When the spending reaches the limit, FlowDriven writes the `spending-pause` setting and pauses, with the `budget_raise` decision, every run whose next agent call bills per use or unknown; a chat turn on such an agent ends with the failure `spending_limit` (SR-9). The pause ends when the limit is raised or the next local month begins (3.15). Agents on a plan keep running within their own usage limits.
- A call billed per use whose agent reports no cost cannot be counted, so it is refused while the limit applies: the run is stuck with the cause `cost_not_reported`, and a chat turn ends with the failure `spending_limit` (SR-9; decided for V1, revisable).

### 3.18 Settings keys (V1, changed)

| Key | Value | When absent | Written by |
|---|---|---|---|
| `language` | `LanguageCode` | `"en"`; a code that is not registered also reads as `"en"` | `settings.update` (FS-j30) |
| `agentPermission` | `"unset"`, `"on"` or `"off"` | `"unset"` | `agents.setUp` (the Set up click is the permission), `settings.update` |
| `mainAgent` | `{agent: AgentId, model: ModelId}` | absent until "Start chatting" (FS-j01.S4) | `settings.update` |
| `busyFallback` | boolean | false | `settings.update` |
| `spendingLimit` | number, US dollars a month | 10 | `settings.update` (raise only) |
| `spending-pause` | `{id, month, reachedAt, limitUsd, expiresAt, state}` | no pause | the runner (3.17) |
| `retention` | `{lastSweepAt}` | never swept | the runner (section 6) |
| `keeper` | `KeeperSettings` | `DEFAULT_KEEPER` | as today |
| `quota:<agentId>`, `weekly:<agentId>`, `weekly-index` | as today | as today | as today |
| `toolAccess` (V2) | boolean | false | `phone.setToolAccess` |
| `revocations` (V3) | `{list, signature, fetchedAt}` | none | the runner |

The person's choices (`language` to `spendingLimit`) change only through the person's action in the window (SR-2); no flow, skill, memory item, agent output or other AI tool can call `settings.update`. `keeper.effortModels` stays as the internal default model table (AD-08). The color mode is not a store setting (3.19). V1 has no `background` setting: it adds no menu-bar icon and no Open at login, and keeps today's macOS behaviour, in which the app stays alive when its window closes (`apps/desktop/electron/main.ts`), so schedules keep running until the person quits (decided for V1, revisable).

### 3.19 Window preferences (V1, new)

Electron main keeps a small file in Electron's user data folder: `window.json`, written by main only, atomically (a temporary file, then a rename).

```ts
type WindowFile = { version: 1; colorMode: "light" | "system" | "dark" };
```

- `colorMode` sets `nativeTheme.themeSource` before the first paint (AD-15). A missing or unreadable file gives `system` ("Auto") (FS-j12.A13). It never goes into the store.

### 3.20 Agent and model (V1, changed)

The agent row keeps the `harness_state` table (`id`, `data`); the entity is now an Agent.

```ts
type AgentRow = {                      // harness_state.data
  id: AgentId;                         // "claude-code", "codex"
  consent?: "not_given" | "given" | "revoked";   // version 6, frozen: never read in version 7 (the one permission replaces it)
  consentAt?: IsoDateTime;
  scan?: unknown; scanAt?: IsoDateTime;          // detection and inventory, as today
  state: AgentState;                   // "not_installed" | "installing" | "waiting_login" | "needs_login" | "ready" | "unknown"
  stateAt: IsoDateTime;
  version?: string;
  billing: "per_use" | "plan" | "unknown";       // from the agent's own sign-in status: its method only
  setUp?: { phase: "installing" | "waiting_login"; startedAt: IsoDateTime; pollUntil: IsoDateTime };   // 10-minute sign-in wait
  problem?: { code: "install_failed" | "sign_in_timeout" | "too_old" | "unreadable"; at: IsoDateTime; detail?: string };
  models?: { list: Model[]; at: IsoDateTime; source: "agent" | "catalog" };
};
type Model = {
  id: ModelId;                         // ^[a-z][a-z0-9.-]{0,63}$, passed only through the agent's model flag (SR-4)
  name: string;                        // "Sonnet 5.5"
  note: "mostCapable" | "fastCapable" | "fastest" | "allRound" | "carefulCoding";   // a word key
  isDefault: boolean;
};
```

Rules:
- `state` after a restart comes from detection, never from a stored `setUp`; an install never resumes by itself (FS-j01.E7).
- `problem.detail` is at most 200 characters and holds no path, no account name and no output of the agent's sign-in.
- The agent catalog (`packages/runner/src/agents/registry.ts`, new) is code: id, name, maker, binary, the install command as a program and its arguments (run without a shell), the sign-in and status commands, the risk label and note key, the account line key, the lowest supported version, and a model catalog per CLI version for agents that cannot list their models. It is never stored and never read from a flow, a page or an agent's output (FS-j01.A4).

### 3.21 Skill (V1)

V1 stores no skill table. `skills.list` scans, at most once a minute and on Scan again: Claude Code's user skills folder, the skills of any other ready agent that has them, and FlowDriven's own skills shipped with the app. A skill is `{id, name, about, origin, agentId?, hash, readable, problem?}`, where `id` is the existing skill ref form (`claude-code:<name>`, `flowdriven:<name>`), `hash` is the skill folder's content hash, and `problem` is a code (`hidden_characters`, `invalid_skill_file`, `too_large`).

- The skill pin of a flow is `confirmations.pins.skills` (as `consent_pins` today). A skill whose hash differs from the pin makes the flow `changed` (FS-j29.P8).
- "Used by" is derived from the skill requirements of live flows; "Last used" from the newest run with a step of that skill.
- V2 adds the `skills` and `skill_versions` tables for updates and roll back (3.22).

### 3.22 Later entities (V2 and V3)

They are designed here and created by later store versions: version 8 (V2) and version 9 (V3), each with its own backup, its own additive migration and its own fixture test, in the same way as section 5.

```ts
type MemoryItem = {                    // memory_items (V2); key id; columns scope, state
  id: string;
  scope: { kind: "global" } | { kind: "project"; name: string } | { kind: "flow"; flowId: FlowId };
  kind: "fact" | "decision" | "preference" | "lesson" | "goal" | "task";
  text: string;                        // at most 500 characters
  key?: string;                        // a newer item with the same key supersedes the older one
  source: { kind: "run" | "chat" | "person"; runId?: RunId; chatId?: ChatId; flowId?: FlowId; label: Line };
  outside: boolean;                    // kept items stay marked (FS-j26.P1)
  state: "proposed" | "active" | "superseded" | "retired";
  pinned: boolean;
  createdAt: IsoDateTime; decidedAt?: IsoDateTime;
  lapseAt?: IsoDateTime;               // a proposal is deleted 30 days after it was made (FS-j26.P2)
  supersededBy?: string;
};
type MemoryGrant = { memoryId: string; flowId: FlowId; at: IsoDateTime };   // memory_grants (V2): the person's per-item grant (FS-j26.P3)

type SkillRecord = {                   // skills (V2); key id
  id: SkillId; name: string; origin: "agent" | "flowdriven" | "library"; agentId?: AgentId;
  activeHash: ContentHash; updateHash?: ContentHash;  // "Update available" until approved or kept
  archivedAt?: IsoDateTime; lastUsedAt?: IsoDateTime;
};
type SkillVersion = { skillId: SkillId; hash: ContentHash; text: string; seenAt: IsoDateTime; approvedAt?: IsoDateTime };   // skill_versions (V2); key (skill_id, hash)

type PhoneLink = {                     // phone_links (V2); key id; columns kind, state
  id: string; kind: "telegram" | "discord";
  state: "off" | "pairing" | "paired";
  secretName: string;                  // the keychain item's name; the token itself is never in the store (SR-6)
  pairing?: { codeHash: string; expiresAt: IsoDateTime };   // the code is single use and valid for 10 minutes
  account?: { platformUserId: string; label: string };      // the one account that is obeyed
  pairedAt?: IsoDateTime; lastCommandAt?: IsoDateTime;
};

type MarketInstall = {                 // market_installs (V3); key flow_id
  flowId: FlowId; listingId: string; publisher: string; version: SemVer;
  signedHash: ContentHash; signature: string; installedAt: IsoDateTime;
  lastRevocationCheckAt?: IsoDateTime;
  revoked?: { at: IsoDateTime; reason: string };
  update?: { version: SemVer; hash: ContentHash };   // never applied silently (FS-j26.P8)
  forkedAt?: IsoDateTime;              // a local edit made it a local flow; updates stop
};
```

Memory, phone and marketplace entities follow the original spec's rules (S21, S22, S14) and FS-j26: only the runner writes memory, memory grants nothing, deleting a memory item uses secure deletion, a pairing code is stored only as a hash, and an installed flow arrives `new` with no standing rule and no schedule.

## 4. Store version 7 tables

All tables, with their key columns. Every `data` column holds the JSON of the entity named in the last column. Types are SQLite types; `null` means the column may be NULL.

| Table | Status | Key columns | Primary key | Indexes and constraints | `data` holds |
|---|---|---|---|---|---|
| `flows` | kept | `id` TEXT, `hash` TEXT | (`id`, `hash`) | - | Flow version (3.1) |
| `flow_heads` | new | `id` TEXT, `name` TEXT, `summary` TEXT, `deleted_at` TEXT null | `id` | unique `name COLLATE NOCASE` where `deleted_at` IS NULL | Flow (3.1) |
| `confirmations` | new | `flow_id` TEXT, `hash` TEXT | `flow_id` | - | Confirmation (3.2) |
| `standing_rules` | new | `id` TEXT, `flow_id` TEXT, `state` TEXT | `id` | (`flow_id`, `state`) | Standing rule (3.3) |
| `call_grants` | new | `run_id`, `step_id`, `item_key`, `tool`, `digest` (all TEXT) | (`run_id`, `step_id`, `item_key`, `tool`, `digest`) | - | One-time grant (3.4) |
| `schedules` | new | `flow_id` TEXT, `type` TEXT, `after_flow_id` TEXT null | `flow_id` | (`after_flow_id`) | Schedule (3.5) |
| `starts` | new | `id` TEXT, `flow_id` TEXT, `at` TEXT, `source` TEXT, `outcome` TEXT, `key` TEXT null | `id` | unique (`flow_id`, `key`) where `key` IS NOT NULL; (`flow_id`, `at`); (`outcome`, `at`) | Start request (3.7) |
| `chats` | new | `id` TEXT, `title` TEXT, `updated_at` TEXT | `id` | (`updated_at`) | Chat (3.8) |
| `messages` | new | `id` TEXT, `chat_id` TEXT, `seq` INTEGER, `at` TEXT, `kind` TEXT, `card_type` TEXT null, `card_state` TEXT null, `search_text` TEXT null | `id` | unique (`chat_id`, `seq`); (`card_type`, `card_state`) where `card_type` IS NOT NULL; `chat_id` references `chats(id)` on delete cascade | Message (3.9) |
| `drafts` | new | `id` TEXT, `chat_id` TEXT, `state` TEXT | `id` | (`chat_id`); `chat_id` references `chats(id)` on delete cascade | Draft (3.11) |
| `waiting_questions` | new | `id` TEXT, `flow_id` TEXT, `chat_id` TEXT, `kind` TEXT, `state` TEXT | `id` | unique (`flow_id`) where `state` = 'open'; (`chat_id`); `chat_id` references `chats(id)` on delete cascade | Waiting question (3.12) |
| `remembered` | new | `flow_id` TEXT, `kind` TEXT, `input_id` TEXT | (`flow_id`, `kind`, `input_id`) | - | Remembered answer (3.13) |
| `runs` | kept, indexed | `id`, `flow_id`, `state` | `id` | new (`flow_id`); new (`state`) | Run (3.14) |
| `steps` | kept | `run_id`, `step_id`, `item_key` | (`run_id`, `step_id`, `item_key`) | - | Step (3.14) |
| `items` | kept | `run_id`, `loop_id`, `key`, `position` | (`run_id`, `loop_id`, `position`) | - | Item |
| `seen` | kept | `flow_id`, `loop_id`, `key`, `at` | (`flow_id`, `loop_id`, `key`) | - | none (no `data` column) |
| `approvals` | kept, indexed | `id`, `run_id`, `state` | `id` | new (`run_id`); new (`state`) | Decision (3.15) |
| `grants` | frozen | `run_id`, `tool`, `item_key` | as today | - | none; read once by the migration, then never |
| `counters` | kept | `name`, `day`, `value` | (`name`, `day`) | - | none |
| `audit_log` | kept, indexed | `id` INTEGER, `at`, `kind`, `run_id` null, `detail` | `id` | new (`run_id`); triggers `audit_no_update` and `audit_no_delete` stay | detail JSON (3.16) |
| `harness_state` | kept | `id` | `id` | - | Agent (3.20) |
| `usage_events` | kept, new column, indexed | today's columns plus `billing` TEXT null | `id` | `usage_events_run` stays; new (`at`) | none (columns only) |
| `settings` | kept | `name` | `name` | - | the key's value (3.18) |
| `triggers` | kept | `flow_id`, `idx` | (`flow_id`, `idx`) | - | `TriggerRow` (3.6) |
| `fire_keys` | kept | `flow_id`, `idx`, `key`, `at` | (`flow_id`, `idx`, `key`) | - | none |
| `capability_consents` | frozen | `flow_id`, `hash`, `at` | `flow_id` | - | none; read once by the migration |
| `consent_pins` | frozen | `flow_id`, `pins` | `flow_id` | - | none; read once by the migration |

Notes:
- "Frozen" tables stay on disk, unchanged, so the migration only adds. Version 7 code reads them during the migration; the only writers are the retired operations that keep working until the step each leaves with (`runner-api.md`, section 7), and none writes them after the last of those steps. A later store version drops them, one release after V1.
- Foreign keys are used only from chat parts to `chats`, so deleting a chat removes its messages, drafts and questions in one statement. Other tables keep today's style without foreign keys, because runs, decisions and audit records outlive their flows and chats.
- New table and index names follow today's style: lowercase, the table name first (`runs_flow`, `runs_state`, `approvals_run`, `approvals_state`, `audit_log_run`, `usage_events_at`, `flow_heads_name`, `standing_rules_flow`, `schedules_after`, `starts_key`, `starts_flow_at`, `starts_outcome_at`, `chats_updated`, `messages_chat_seq`, `messages_card`, `drafts_chat`, `waiting_questions_open`, `waiting_questions_chat`).
- The new statements live in `packages/runner/src/schema.ts` next to today's, as a new `SCHEMA_V7` text; the steps live in `packages/runner/src/migrate.ts` (new).
- The retired version 1 operations stay in the contract for the unrouted builder-first screens, and B-01 only marks them retired in the table: each keeps working in the real runner until the step it leaves with and from then answers `unavailable` with reason `retired` (`runner-api.md`, section 7), so once they have all left nothing writes a frozen table.
- Search (AD-17) uses `LIKE` with `ESCAPE '\'` over `chats.title`, `messages.search_text`, `flow_heads.name` and `flow_heads.summary`, with a result limit. No full-text index in version 7.

## 5. Migration from version 6

### 5.1 When it runs

`openSqliteStore` holds the exclusive lock and reads `PRAGMA user_version`:

| Version found | What happens |
|---|---|
| greater than 7 | Refused before anything is read or written. Error reason `store_newer`; the runner exits with code 5 (new). Main does not restart it, and the window shows "This data was made by a newer FlowDriven. Update FlowDriven to open it." with "Quit". |
| 0 to 5 | Today's steps to version 6 run first, unchanged, then the steps below. |
| 6 | The steps below. |
| 7 | Nothing. |

A second runner on the same folder still fails at the lock with exit code 3, before any step.

### 5.2 Steps

1. **Back up.** Before any change, `VACUUM INTO` writes a full copy to `<data folder>/backups/flowdriven-v<found>-<UTC time as YYYYMMDDTHHMMSSZ>.sqlite`; the `backups` folder is made with mode 0700 and the copy gets mode 0600. The copy is then opened read-only and must report `integrity_check` `ok` and the version found. If any of this fails, the migration stops: nothing in the store changed; the runner exits with code 6 (new) and reason `backup_failed`.
2. **Begin** one transaction (`BEGIN IMMEDIATE`). Steps 3 to 10 are inside it.
3. **Create** the eleven new tables of section 4 with their indexes and foreign keys (plain `CREATE`, not `IF NOT EXISTS`: a table that already exists means a damaged store and fails the migration).
4. **Add** the column `usage_events.billing` (TEXT, NULL for every existing row).
5. **Index** the existing tables: `runs (flow_id)`, `runs (state)`, `approvals (run_id)`, `approvals (state)`, `audit_log (run_id)`, `usage_events (at)`.
6. **Fill `flow_heads`**: one row per distinct `flows.id`. The head is the row with the highest rowid (what `getFlow` returns today); `name` and `summary` come from its manifest; `createdAt` is the earliest `registeredAt` of that id; `origin` is `demo` for a flow registered with the demo hash, otherwise `import`. When two flows have the same name, the later one gets " 2" (then " 3") in `flow_heads.name`; its files are not changed, and the audit detail lists the renames.
7. **Fill `confirmations`** from `capability_consents` joined with `consent_pins`: `hash`, `at`, `pins` (skills and folders), `by: "migration"`, `onItsOwn: []`, `legacy: true`. The flow is `confirmed` after the migration exactly when it was allowed before: when the consent's hash equals the head.
8. **Fill `call_grants`** from `grants`, only for runs whose state is not `done` or `failed`. A tool text `<tool>#<digest>` gives `tool` and `digest`; a tool text without `#` is a pick grant (`digest: "*"`). `stepId` is the step of the `risky_action` decision of the same run whose `approves` list holds the grant's tool text; otherwise `"*"` (any step of that run, as version 6 allowed). `kind: "migrated"`. A call grant whose `grant-used:` counter is above 0 gets `usedAt` set to the migration time.
9. **Write** the audit record `store_migrated` with `{from, to: 7, backup, flows, confirmations, grants, skipped}`, where `skipped` counts the version 6 rows that today's decoders already treat as unreadable.
10. **Set** `PRAGMA user_version = 7`.
11. **Commit.**
12. **On every open** of a version 7 store: `PRAGMA secure_delete = ON` and `PRAGMA optimize`.

Left as it is, on purpose:
- No version 6 row is rewritten. Runs, steps, decisions, triggers and agent rows keep their JSON; the version 7 decoders fill the new fields (3.14, 3.15, 3.20).
- No setting is written; absent keys read as their defaults (3.18). In particular `agentPermission` stays `unset` although a version 6 store may hold Claude Code's consent: carrying it over would widen one agent's consent to every agent without the person's click (SR-2). The welcome screen then offers "Use Claude Code" for a ready agent, so one click gives the permission (FS-j01.P3). Until then nothing starts by itself.
- `grants`, `capability_consents` and `consent_pins` stay frozen (section 4).
- No schedule is made from a format 1.1 trigger; manifest triggers keep working through `triggers`.

### 5.3 What a failed migration leaves

| Failure | What is on disk | What the person sees | Next |
|---|---|---|---|
| The backup cannot be written or checked | The store, unchanged at its version | "FlowDriven could not back up its data, so it changed nothing." and "Quit" (exit code 6, reason `backup_failed`) | Free disk space and open again |
| An error inside the transaction (an SQL error, a constraint, a full disk) | Rolled back: the store is exactly the version found; the backup is kept | "FlowDriven could not update its data. Nothing was changed, and a copy is in the backups folder." and "Quit" (exit code 6, reason `migration_failed`) | The next launch tries again with a new backup |
| A crash or power loss during the transaction | SQLite's journal rolls the transaction back at the next open | Nothing special | The migration runs again at the next launch |
| An older FlowDriven opens the version 7 store | Nothing changes: the version 6 runner refuses a version above 6 ("Unsupported database version.") | That FlowDriven's error | With FlowDriven quit, the person may put the backup in place of `flowdriven.sqlite`; changes made since the migration are then lost. V1 offers no button for this. |

Main does not restart a runner that exited with code 3, 5 or 6 (`runner-api.md`, section 12.5).

### 5.4 How it is tested (tests first, B-03)

Fixture: `packages/runner/src/test-helpers/store-v6.ts` (new) exports `makeStoreV6(folder, options?)`. It writes a version 6 database from a frozen copy of the version 6 statements, kept inside the helper as text so that later edits of `schema.ts` cannot change the fixture, and fills it with synthetic rows written by hand, never a copy or a recording of a real store:
- two flows, one with two versions and one registered with the demo hash, and a third flow with the same name as the first;
- a capability consent with skill and folder pins for one flow, and a stale consent (older hash) for another;
- runs in every version 6 state, with steps, items and seen keys;
- decisions of kinds `ask`, `result_sign_off` and `risky_action`, in states `pending` and `approved`;
- grants with and without a digest, for one open run and one `done` run;
- a manifest schedule trigger with fire keys, usage rows, the settings `keeper`, `quota:claude-code` and `weekly:claude-code`, an agent row with consent `given`, and audit records.

All paths are inside the test's temporary folder; there is no secret and no real account.

Tests in `packages/runner/src/migrate.test.ts` (new), layer L3, real SQLite in a temporary data folder, injected clock:

| # | Given | When | Then |
|---|---|---|---|
| 1 | the version 6 fixture | the store opens | `user_version` is 7; every version 6 row reads through the version 7 `Store` with the same values; counts per table are unchanged |
| 2 | the version 6 fixture | the store opens | `backups/flowdriven-v6-<time>.sqlite` exists, mode 0600 or stricter in a 0700 folder, reports `integrity_check` `ok`, version 6, and the same row counts as before |
| 3 | a store with `user_version` 8 | the store opens | the error reason is `store_newer`; the file's bytes are unchanged; no backup is written |
| 4 | the fixture and an injected failure at each step 3 to 10 in turn | the store opens | the open fails with reason `migration_failed`; a version 6 store opens the file and reads the same rows; the backup exists |
| 5 | an injected failure in step 1 | the store opens | reason `backup_failed`; the store is unchanged |
| 6 | a migrated store | the store opens a second time | nothing changes and no second backup is written |
| 7 | the fixture | after the migration | `flow_heads` has one row per flow id; the head is the newest version; the same-name flow is "<name> 2" and the audit detail lists it; `createdAt` is the earliest `registeredAt` |
| 8 | the fixture | after the migration | `confirmations` copies hash, time and pins with `legacy: true`; the flow with the matching consent is `confirmed`, the one with the stale consent is `changed`, the others are `new` |
| 9 | the fixture | after the migration | the open run's grants are in `call_grants` with the right step and digest; the `done` run's grants are not; `grants` is unchanged |
| 10 | the fixture with consent `given` | after the migration | `settings.get` returns `agentPermission: "unset"`; no trigger fires until the permission is `on` |
| 11 | a migrated store | an UPDATE and a DELETE on `audit_log` | both abort; the `store_migrated` record is there |
| 12 | databases at versions 0 to 5 | the store opens | each reaches version 7 in one open, with a backup at its own version |
| 13 | a child process that is killed during step 6 (the pattern of `test-helpers/hold-lock-child.ts`) | the store opens again | the store is version 6, then migrates |
| 14 | a migrated store | the store opens | `PRAGMA secure_delete` reads 1 |
| 15 | a second runner on the same folder during the migration | it opens the store | it fails with the lock error (exit code 3) and changes nothing |

## 6. Retention

| Data | Kept | How |
|---|---|---|
| Runs and their steps, items, decisions, grants and usage rows | A run is kept when it ended within the last 90 days, or it is among the newest 50 runs of its flow, whichever keeps more (F-14.R12, NF-15). An open run, a run with a pending decision and a run named by an open waiting question are never removed. | The retention sweep deletes the run and its rows in `steps`, `items`, `approvals`, `call_grants` and `usage_events` |
| Start requests (including missed and skipped slots) | The same rule as runs, per flow | Sweep |
| Audit log | Forever. Nothing trims it (SR-7) | - |
| Chats, messages, drafts | Until the person deletes the chat | `chats.delete` |
| Waiting questions | Open: until answered, cancelled or closed. Answered, cancelled or closed: 30 days | Sweep |
| Standing rules | Active: until revoked. Revoked: 90 days (the audit log keeps the record) | Sweep |
| Flow versions | Every version of a live flow. A version of a deleted flow until no kept run uses it | Sweep |
| Flow heads | Forever, including tombstones, so an id is never reused | - |
| Remembered answers | Until the flow is deleted | `flows.delete` |
| Confirmations | One per flow; deleted with the flow | `flows.delete` |
| `seen` keys, `fire_keys` | 30 days, as today | as today |
| Backups | Kept until the person removes them; the app never deletes them in V1 (named in 7.3) | - |
| `control/`, `skill-copies/` | Per attempt, swept at start, as today | as today |
| Memory proposals (V2) | 30 days unanswered | Sweep |

The sweep (`packages/runner/src/retention.ts`, new) runs at start and then once a day on the existing 60-second timer, when `retention.lastSweepAt` is more than 24 hours old. It works in batches of 500 rows per transaction so the runner stays responsive. Deleted rows are overwritten on disk (`secure_delete`). A run card in a chat whose run was removed shows the run as no longer kept.

## 7. Deletion

### 7.1 Deleting a flow (`flows.delete`, after the dialog)

Refused while a run of the flow is `checking`, `running`, `retrying` or `waiting_approval` ("This flow is running. Stop it first.", FS-j21.P6). Otherwise one transaction:
- sets `flow_heads.deleted_at`; the name is free again and the id is never reused;
- deletes the confirmation, the schedule, the remembered answers;
- revokes the standing rules (`flow_deleted`);
- deletes every schedule with `after_flow_id` equal to the flow; those flows become "Only when I start it" (audit `schedule_changed`, `by: "target_deleted"`);
- closes its open waiting questions (`closed`, `flow_deleted`); their cards show "This flow was deleted.";
- stops its `queued`, `needs_login`, `blocked` and `interrupted` runs (state `stopped`, `stoppedBy: "flow_deleted"`) and expires their pending decisions;
- writes `flow_deleted` to the audit log.

Kept: past runs with their steps, decisions and report, the flow versions those runs use, and the audit log. Runs keep `flowName`, so Activity still shows the name, and "Run again" is not offered (FS-j25.A9). Cards that name the flow show "a deleted flow" and lose their buttons (FS-j20.E10). The skill's "Used by" no longer lists it.

### 7.2 Deleting a chat (`chats.delete`, after the dialog)

One transaction deletes the chat row; the foreign keys delete its messages, drafts and waiting questions. Then:
- An unsaved draft is gone with its chat (FS-j22.E8); a flow saved from it stays.
- A waiting question of the chat is gone; its pending start never runs (audit `question_closed`, `chat_deleted`).
- Runs started from the chat keep running. Their decisions stay in Activity; a later answer of a `chat` result goes to a new FlowDriven chat, as for a start outside a chat.
- Usage rows of the chat's turns stay (spending history); they hold no text. Audit records stay; they hold ids, codes and short titles, never message text, and a rule's records hold the place kind and the rule id, not the place value (3.16).
- A migration backup made before the deletion still holds the chat (7.3).
- `secure_delete` overwrites the deleted text on disk.

### 7.3 Leaving FlowDriven

Quitting and removing `<data folder>` removes everything the runner stored, including the backups. The limit to know: the migration backups hold a copy of everything at migration time, chats deleted later included, and the app never deletes them in V1; they stay until the person removes them. Main's `window.json` lives in Electron's user data folder. V2 keychain items are removed with Unpair.

## 8. Export

- **Copy report** (`runs.export`): parts built on request from the run and never stored; the renderer turns them into Markdown in the app language, with the answer lines in the run's language; no token numbers and no run id; hidden characters shown as visible marks; outside text keeps its tag; a secret is masked as "[hidden]" by a named pattern list: keys that start with `sk-`, tokens that start with `ghp_`, `Bearer` values and the value of every `secret_ref` input; the run page's text is masked by the same list (FS-j25.A12, FS-j25.E11). V1 does not prove more than that: a secret that matches no pattern, and a secret inside the person's own files that an agent reads, can still appear on the run page and reach the model maker as part of the agent's work. It leaves the app only by the person's click (NF-21).
- **Memory** (V2, `memory.export`): Markdown on request; memory never goes into a log, a bug report or a published package (spec R18).
- **No other export in V1.** There is no automatic export, no telemetry and no upload (NF-18). The store is a plain SQLite file in the person's data folder, and the backups are full copies of it.

## 9. What is never stored

- **Secrets.** Bot tokens, connector keys and API keys never enter the store, a log, a flow file, a chat, a report, an export or a test fixture. V2 keeps them in the system keychain and the store holds only the keychain item's name (SR-6, AD-19).
- **Agent sign-in data.** FlowDriven never reads an agent's own sign-in or credential files. From the agent's own status command it keeps only whether it is signed in and its billing method; never an account name, an address or a token. Passwords never pass through FlowDriven (FS-j01.A5).
- **Prompts and raw agent output.** Chat-turn prompts, step prompts and the agent's raw event stream are not stored; only parsed results, validated intents, checks, step outputs and usage numbers.
- **Process environment values.** The runner starts agents with a minimal environment and stores no value from it.
- **The color mode.** It is in main's `window.json`, not in the store. It is the only thing in that file.
- **FlowDriven's sentences as data.** Statuses, causes, rules and FlowDriven's lines are codes (AD-14); the only FlowDriven words a person reads from the store are chat lines, stored as codes with the language they were posted in.

## 10. Drafter's calls

- Four tables beyond AD-05: `flow_heads` (one row per flow: the current version, a unique name and a tombstone, because `flows` holds versions and a delete must keep the versions that past runs use), `call_grants` (AD-07 binds a grant to the step and the exact digest; today's `grants` key has no step), `schedules` (a schedule is the person's state and must not change the flow's hash), and `starts` (the record of missed and skipped slots, which V1 keeps for the audit and does not show in Activity, and the one key per slot and per request).
- The existing tables `flows`, `harness_state` and `approvals` keep their names although their entities are now called flow versions, agents and decisions, so the migration only adds.
- `grants`, `capability_consents` and `consent_pins` are frozen rather than dropped, so version 7 only adds; a later store version drops them.
- A version 6 consent is not carried into `agentPermission`: the one permission covers every agent, and widening one agent's consent without a click would break SR-2.
- Version 6 rows are not rewritten; the decoders fill the version 7 fields. Reason: a smaller migration with fewer ways to fail, and a version 6 run, decision or trigger reads the same before and after.
- `secure_delete` is turned on for the whole store, so deleting a chat (V1) and memory (V2) overwrites the text.
- Cards live inside their message and are addressed by the message id, as the owner's `chats.act {chatId, messageId, ...}` implies.
- Chat turns are recorded on the person's message, not in a table of their own; queued and running turns become `interrupted` at start, and nothing runs by itself.
- Chat-turn usage rows use the chat id as `run_id`, so the spending limit counts chat turns that cost money.
- Spending counts rows with `billing` `per_use` and unknown; only `plan` rows are left out (Q-03). Reason: when FlowDriven cannot tell how an agent bills, the person's limit should still hold (SR-9).
- The spending pause is one settings row (like today's weekly limit) rather than one decision per run, because it belongs to no run.
- `busyFallback` is off until the person turns it on; the prototype brief gives no default.
- A FlowDriven line keeps the language it was posted in (per message), so neither an app language change nor a chat language change rewrites old lines (FS-j30.S4).
- Pasted text is marked on the message and treated as outside text, because FS-j22.E7 lists "the person pasted an email" as outside text and only the composer can tell a paste.
- Deleting a flow stops its queued and paused runs (kept as `stopped`) instead of deleting them, so the history stays honest.
- A grant ends with its run.
- Unreadable version 6 rows are skipped and counted in `store_migrated`; an SQL error fails the migration.
- Later tables arrive in store version 8 (V2) and 9 (V3), each with a backup and a fixture test.
- Standing rules exist only for `local_write`, `run_command` and `change`, and "Always allow for this flow" only for a `change` at a fixed place (the prototype's behaviour); a risky kind always asks. Reason: a rule for send, post, pay, delete or merge has no amount or volume ceiling and would run after a step read a stranger's text.
- No automatic first run: turning a schedule on never starts a run, so a schedule row holds no first-run state.
- V1 has no `background` setting and no tray or login item; main keeps only the color mode.
- `RememberedAnswer.outside` stops a value that came from outside text from reaching later unattended runs through "Use my last answers".
- Backups are named as a limit in 7.3 instead of being swept, because the V1 migration backup predates chats; a sweep policy is a later product decision.
- Audit records of rules keep the place kind and the rule id, so the append-only log never holds an address or a home path.
- Name mappings (old name -> chosen name, file):
  - composer draft `drafts` -> `Chat.composerText` (`j27-flow-inputs.md`, E6); `drafts` keeps the meaning "flow drafts" of `j22-make-a-flow.md` and `j29-flow-from-skill.md`.
  - change card state `proposed` -> draft state `drafted` with `kind: "change"`; `cancelled` and `saved` kept; `stale` is derived (`j23-improve-a-flow.md`).
  - "last inputs" and `lastInputs` -> `remembered` rows with `kind: "last"` (`j21-run-from-flows.md`, `j27-flow-inputs.md`, `j28-proactive-schedule.md`).
  - `Grant` and "one-time grant" -> One-time grant in `call_grants` (`j20-run-from-chat.md`, `j24-decisions.md`).
  - Decision (product word) -> `approvals` rows and the contract's `Approval` (all flow specs).
  - `Card` (`j20-run-from-chat.md`, data) -> a card inside its message.
  - `Flow.schedule` (`j20-run-from-chat.md`, `j21-run-from-flows.md`, `j28-proactive-schedule.md`) -> the `schedules` row; the flow file's `schedule` is only a suggestion.
  - Activity rows "Missed", "Skipped", "Run late" (`j21-run-from-flows.md`, `j28-proactive-schedule.md`) -> `starts` rows with outcome `missed` or `skipped` and their reason; Activity does not show them in V1.
  - slot outcome `skipped` with "a run of the flow is still active" (`j28-proactive-schedule.md`) -> outcome `skipped`, reason `still_running`.
  - signed-out wait "then fails with a clear reason" (`prd.md`, F-14.R4) -> `needs_login` becomes `blocked` after 12 hours (`j25-history-and-problems.md`, A5), because the flow spec is the source for its journey.
  - bot link states `off`, pairing, `paired` (`j26-memory-phone-marketplace.md`) -> `phone_links.state` `off`, `pairing`, `paired`.
  - memory proposal "dropped" (`j26-memory-phone-marketplace.md`) -> the proposal row is deleted; `retired` and `superseded` are states.
  - prototype decision outcome `picked` -> state `approved` with `picks`.
