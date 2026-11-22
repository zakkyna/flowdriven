# FlowDriven architecture

Status: design for the V1 build, 2026-11-21, following version 9 of the clickable prototype. This file owns the safety rules `SR-1`..`SR-9`, the start rule `START` (section 9, "Starts") and the architecture decisions `AD-01`..`AD-23`. `prd.md` section 6 restates the safety rules in plain words; if the two differ, this file wins.

Related documents in `docs/design/`: `prd.md`, `flows/`, `data-model.md` (entities, tables, audit kinds, migration from store version 6), `runner-api.md` (runner API contract version 2: operations, outcomes, card actions), `threat-model.md`, `test-plan.md`, `test-cases/`, `build-order.md`. Names of operations, outcomes and card actions follow `runner-api.md`; tables and audit kinds follow `data-model.md`.

Conventions:
- Names in backticks exist in the code today unless marked "(new)" or listed as new (the "New" status in section 5, "new" in a decision's Code line). Runner paths are relative to `packages/runner/src/`, Electron paths to `apps/desktop/electron/`, renderer paths to `apps/desktop/src/`.
- The register in `prd.md` (PU-01 to PU-29) lists every V1 behaviour the owner has not seen in the clickable prototype. Each goes into the prototype first, for the owner's approval, before the build step that builds it (AGENTS.md: prototype first). A line here cites its PU id.
- Type sketches show shapes only; `runner-api.md` owns the operations and `data-model.md` the tables.
- `<data folder>` is the runner's data folder (`FLOWDRIVEN_DATA_DIR` overrides it).

## 1. Context and quality goals

FlowDriven turns a person's repeated work into flows, runs them on the agents the person already has (Claude Code, Codex), decides what may happen without asking, and counts a step as done only when a check the agent does not control passes. A large engine exists (store, step engine, Claude Code adapter with its hook channel, held calls, router, keeper, triggers, notices; about 1,950 tests). The approved clickable prototype is chat first. This design keeps the engine and builds the chat-first product on it.

### 1.1 Quality goals

| Goal | What it means | Main mechanisms |
|---|---|---|
| Safety | Nothing risky happens without the person's yes or a rule they can see | SR-1 to SR-9, AD-06, fail-closed hooks, start proof, audit log |
| Simplicity for people who are not technical | Plain words, one permission, one confirmation, chat first | AD-10, AD-11, AD-13, AD-22 |
| Reliability | No record lost; a half-done step never repeats by itself | Single-writer store, recovery, catch-up, one open run per flow |
| Privacy | Everything stays on the Mac; no telemetry; FlowDriven sends nothing of its own in V1 (the one network action it starts is the agent's official installer, which Set up runs only after the person chooses Set up) | Private data folder, minimal child environment, AD-19 |
| Extensibility for agents and languages | An agent is one adapter; a language is one file plus one line | AD-08, AD-14 |
| Testability | Everything testable without network, real agents or accounts | Injected clock, ids, zone and spawners; fakes |
| Ease of contributing | Hand coders and AI agents find rules, plan and gate fast | AD-21, `pnpm check` |

When goals conflict: safety, privacy, reliability, simplicity, then the rest.

### 1.2 Constraints

- AGENTS.md for the app: no permission-bypass or full-access flag for any agent; no send, post, pay, delete or merge on a person's accounts without an approval in the app or a standing rule the person can see and revoke (the agent permission is not such an approval); Electron keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and loads no remote content; the renderer talks only to `RunnerClient` and holds view state only; plain CSS modules with `tokens.css`; status is icon plus words; one general safety rule over special cases.
- AGENTS.md for the build: tests first; no test talks to the network, a real agent or a real account; Ask-first changes (section 13.5).
- Only packages in `tools/checks/allowlist.json`; Decided for V1 (revisable): no new dependency, workspace package or CI change in V1; `node:sqlite`; no i18n library, router, state library, icon package or CSS framework.
- macOS first, OS-specific code behind small interfaces; Node 24.14.0 or later, pnpm 10.9.0, strict TypeScript; AGPL-3.0 app, MIT SDK and flow format.

### 1.3 Scope

Decided for V1 (revisable), 2026-11-21 (`prd.md` Q-01): V1 is B-00 (the shared test harness) and B-01 to B-24 plus B-31 (contributor guides). V2 is B-25 to B-27, V3 is B-28 and B-29, and B-30 (packaging) comes before any public download. What this file says about V2 and V3 sets direction and seams only. Signing, notarization, tags and releases are never agent steps (AGENTS.md): they are the owner's own steps in B-30.

## 2. System context and trust boundaries

```
                                Person
                                |  B1
+-------------------------------|------------------------------------------------+
| FlowDriven on the Mac         v                                                |
|  +----------------------------------------------+                              |
|  | Renderer: React, sandboxed, CSP, view state  |                              |
|  +----------------------+-----------------------+                              |
|                         | B2: runner.call, runner.subscribe, window API        |
|  +----------------------v-----------------------+                              |
|  | Preload: frozen bridge                       |                              |
|  +----------------------+-----------------------+                              |
|                         | B3: IPC, sender checked                              |
|  +----------------------v-----------------------+                              |
|  | Electron main: window, theme,                +--> macOS services            |
|  | notifications, link checks                   |                              |
|  +----------------------+-----------------------+                              |
|                         | B4: JSON-RPC 2.0 over stdio                          |
|  +----------------------v-----------------------+  B10  +-----------------+    |
|  | Runner: store writer, safety core, assistant,+-------+ Other AI tools  |    |
|  | starts, rules, keeper, triggers              |       | on this Mac (V2)|    |
|  +-------+--------------------------+-----+-----+       +-----------------+    |
|          | B6: argv, env, stdin,    |     | B5                                 |
|          | hook files               |     v                                    |
|  +-------v----------------------+   |   <data folder>: store, control and      |
|  | Agent CLIs: Claude Code,     |   |   skill-copy folders, flow folders       |
|  | Codex (own sign-in, sandbox) |   |                                          |
|  +-------+--------------+-------+   |                                          |
+----------|--------------|-----------|------------------------------------------+
           | B7           | B8        | B9 (V2, V3)
           v              v           v
  +--------------+ +--------------+  +-----------------------------------+
  | Makers'      | | Person's     |  | Phone bots: Telegram, Discord     |
  | model        | | accounts by  |  | (V2); marketplace server (V3)     |
  | services     | | connector or |  |                                   |
  |              | | gateway (V3) |  |                                   |
  +--------------+ +--------------+  +-----------------------------------+
```

| Boundary | What crosses | Checks |
|---|---|---|
| B1 person and window | Clicks, typed text (the person's own words), screens, notifications | Only the person's click (or one phone decision, V2) changes a permission |
| B2 renderer and preload | `runner.call`, `runner.subscribe`, the `window` API | Frozen objects; `IpcRunnerClient` validates with the contract |
| B3 preload and main | IPC `runner:call`, `runner:event`, `window:*` (new) | Sender is the app's main frame (`isOwnMainFrame`); method pattern |
| B4 main and runner | JSON-RPC requests, results, `event` and `notice` | 1 MiB frames; zod both ways; `parseNotice`; contract version |
| B5 runner and disk | Store, control folders, skill copies, flow folders | A folder owned by the user, closed to others; exclusive lock |
| B6 runner and agent CLIs | argv (never a refused flag), only `HOME`, `USER`, `PATH`, `TMPDIR`, `LANG`, prompt on stdin, stream JSON, hook files | Start proof, tripwire, a decision before each call, the tier |
| B7 agents and the makers' model services | Prompts, text the agent reads, tool results | The maker's terms; FlowDriven limits what the agent may read |
| B8 agents and the person's accounts | Tool calls through the agent's connectors; in V3 the gateway | Each call decided before it runs; risky calls held |
| B9 runner and outside servers (V2, V3) | Fixed-text notices and paired commands; listings, signatures, revocations | Outbound only; keychain tokens; fixed text only, never a decision title, flow name or payload; pinned key |
| B10 runner and other AI tools (V2) | List and start flows, list decisions (flow id, step id and state only) | Only `mcp: yes` or `restricted` operations |

Trust: the person and FlowDriven's code are trusted; agent CLIs are trusted to keep the limits they prove at start (SR-4), their model output is not; text the person did not type or approve is outside text (SR-5).

## 3. Safety rules

These rules bind every document and build step; others cite them by id. Each gives its binding text, its enforcement and its remaining gap.

### SR-1 The one rule

**SR-1 The one rule.** An action runs by itself only when it only reads and sends nothing out, or when the person has already allowed that kind of action, to that exact place, for this flow: by confirming the flow with that action under "Does on its own", or, for a repeatable `change` at a fixed place, with "Always allow for this flow". Everything else waits for the person's yes in FlowDriven. FlowDriven decides which kind an action is; the agent never does.
- Reads include reading local files in the flow's folders, reading an account through a declared read tool, and reading web pages that match the flow's declared addresses.
- Writing files inside the flow's declared folders and running the flow's declared commands inside the agent's sandbox count as allowed by the confirmation, because the confirm dialog lists them under "Does on its own".
- Risky kinds (send, post, pay, delete, merge) always ask in V1. A draft lists them under "Asks you first"; the person cannot move one to "Does on its own"; `flows.confirm` refuses it there with `not_allowed`, reason `always_asks`; no standing rule can exist for one. Standing rules exist only for `local_write`, `run_command` and `change`.
- "Always allow for this flow" is offered only for a repeatable `change` whose place is fixed in the flow (the person's timesheet account, one cloud storage folder), only in the desktop window, and never for one whose place comes from what the run read (for example a reply to whoever wrote). A standing rule matches only its exact place. Decided for V1 (revisable): this is exactly what the prototype has. Rules for send or post would need destination-level places (every recipient, a channel) and a step-level rule that ignores standing rules after the step read outside-marked results; that is a later approvals change with its own security review.

Enforced by: `decide` in `claude/decide.ts`, made agent neutral, the one decision point (section 6.1), with the effect catalog `rules/effects.ts` (new), the policy from `buildPolicy`, and grants and standing rules (`rules/standing.ts` (new)) read at each call. Enforcement points: the Claude Code `PreToolUse` hook (`claude/hook-script.ts`, `claude/channel.ts`, fail closed), start proof and tripwire (`claude/stream.ts`), Codex per tier (AD-09), later the gateway. `proposeLists` never pre-selects a risky kind; `flows.confirm` refuses a risky kind in `onItsOwn` (`not_allowed`, `always_asks`) and an on-its-own touch that needs an exact place and has none; `canAlwaysAllow` is true only for a pending `risky_action` decision whose effect is `change` with a fixed place, from the window (section 6.4).

Still a gap: commands run with the person's rights and no OS sandbox until the sandbox spike (section 16, item 1); meanwhile a command's effect is its touch's, raised by `classifyCommand`, the refuse lists of `router/commands-route.ts` stay, and a command labelled local that reaches the network is not caught. The catalog knows only Gmail. Codex's read scope is unknown until its research and spike 2 (sections 8.3 and 16): a Codex step may read more than the flow's folders, so the declared-folders read limit holds for Claude Code only. A rule-covered `change` at a fixed place can still run in a step that read outside text; its place is fixed and the run page shows what it did.

### SR-2 Only the person changes permissions

**SR-2 Only the person changes permissions.** Confirmations, decisions, standing rules, schedules, the agent permission and limits change only through the person's own action in FlowDriven's window, or, from V2 and only if the person turns it on for a flow, a paired phone for one decision at a time. No agent output, flow file, skill, memory item, marketplace flow, bot message or other AI tool can create, widen or revive them. The assistant can only propose them as cards the person clicks. Standing rules are made only in the desktop window.

Enforced by: these operations are `mcp: no` (other AI tools may at most list decisions) and reach the runner only through `runner:call` from the app's main frame (`runner-ipc.ts` `isOwnMainFrame`); in V1 the runner speaks only to main. No intent changes a permission (`assistant/intents.ts` (new)): they become cards, whose clicks arrive as `chats.act` and are checked against the card (AD-22). Flow files hold no rules or active schedule (AD-04). A phone link (V2) may approve or reject one decision; `always_allow` from it is refused (`rules/decisions.ts` (new)).

Still a gap: a compromised renderer could click for the person; it is sandboxed, loads only `app://flowdriven` and draws agent text through the safe text renderer.

### SR-3 What you confirmed is what runs

**SR-3 What you confirmed is what runs.** A flow runs only as the exact version the person confirmed (its content hash). Any change makes it "Changed: confirm again", and no start outside the chat runs it until the person confirms again.

Enforced by: `contentHash` keys each version (`flows(id, hash)`); a confirmation holds `(flowId, hash, onItsOwn)` (`confirmations` (new)), the pinned skill text (`consent_pins`) included. `starts.request` starts only a confirmed hash; the run records `flowHash` and loads that version; queued runs keep theirs; schedules carry the confirmed hash.

Still a gap: no signatures until V3 (AD-18); the hash skips `.git`, `node_modules` and `.DS_Store`.

### SR-4 Agents keep their limits

**SR-4 Agents keep their limits.** FlowDriven never passes a permission-bypass or full-access flag (the refused list of `claude/args.ts`, Codex's `danger-full-access` sandbox and its bypass flag). Codex always gets `-s workspace-write` (or `read-only`) explicitly. The model picker changes only the agent's model flag. Each run proves the limits took effect (the start proof) or the step stops.

Enforced by: `claude/args.ts` `assertSafeArgs` (`REFUSED_FLAGS`), again in `claude/child.ts` `startChild`; `codex/args.ts` (new) refuses the bypass flags, `danger-full-access`, the full-auto shortcut and overrides of sandbox, approvals or network, and writes `-s` itself. Models are checked against the agent's list and `^[a-z][a-z0-9.-]{0,63}$`; the conformance suite asserts two models change only the model flag; the start proof (`checkFirstEvent`) gains a model check. The model choice is passed with the agent's own model flag and no other flag; it never changes the sandbox, the tools or the approvals.

Still a gap: Codex's start proof and Claude Code's OS sandbox wait for their spikes (section 16).

### SR-5 Outside text is data

**SR-5 Outside text is data.** Text from emails, web pages, files, skills, marketplace flows, bot messages and other AI tools is marked outside. It may fill typed inputs and be shown to the person, but it never adds tools, places or permissions, never chooses the place of a standing rule, and never counts as the person's own words, except text the person approved as their own (`own_text`). A chat turn whose context holds outside text never starts a run by itself: it shows a card the person clicks. A remembered answer keeps the outside mark of its value (`RememberedAnswer.outside`); "Use my last answers" and `whenItsTime: "last"` are not offered when a needed value came from outside text, unless the person typed or confirmed that value, which clears the mark.

Enforced by: in runs, `exec/outside.ts`, `exec/own-text.ts`, R1 typed captures, the data sentences of `claude/prompt.ts`, judge markers, post-tool replacement of page and connector results; in chats, a taint mark per message (R15) and the chat-context rule (`assistant/context.ts`, `assistant/turn.ts` (new), section 6.8). Pasted composer text counts as outside (`chats.send {pasted}`, section 15). Places come only from a confirmed version (section 6.4); inputs pass `inputs/parse.ts` (new) and keep their mark in `inputs/remember.ts` (new); skill text is read as data; the safe text renderer shows hidden characters.

Still a gap: prompt injection has no complete fix; a steered turn can still make a misleading card, and the click is the last line. Outside text reaches the makers' model services (B7).

### SR-6 Secrets stay sealed

**SR-6 Secrets stay sealed.** Secrets (bot tokens, connector keys) live in the system keychain and are referred to by name. FlowDriven never puts one into prompts, logs, flow files, chats, reports, exports or test fixtures, and never reads an agent's own sign-in files. V1 holds no secret, so its promise about reports is the narrower one below.

Enforced by: V1 holds no secret; agents get only `HOME`, `USER`, `PATH`, `TMPDIR`, `LANG` (`claude/env.ts`; the same for Codex); sign-in is learned only from the agents' status commands (section 8.5); from V2 secrets sit behind main (AD-19). Decided for V1 (revisable): the runner masks secret-looking text by a named pattern list (`sk-` keys, `ghp_` tokens, `Bearer` values and the values of `secret_ref` inputs) as "[hidden]" in the parts of "Copy report" (`runs.export`) and in the run page's text. There is no other redactor.

Still a gap: run output, chat answers and step evidence are stored as the agent wrote them. A secret in the person's own files that an agent reads may appear on the run page and reaches the model maker (B7), and a secret that matches no named pattern is not masked. A flow that declares a `secret_ref` input cannot be confirmed in V1: `flows.confirm` and `chats.act` `save_flow` answer `not_allowed` with reason `needs_keychain` and save nothing (the keychain comes in V2).

### SR-7 Everything is on the record

**SR-7 Everything is on the record.** Every tool call the agent tried, every decision (by rule, by the person, refused), every permission change and every start is written to the append-only audit log and shown in plain words on the run page.

Enforced by: SQL triggers keep `audit_log` append-only (`schema.ts`); each change and its audit row share a transaction, with the kinds of `data-model.md` section 3.16 (section 6.7); `results/report-lines.ts` (new) builds the run page lines from the same records.

Still a gap: allowed file reads and writes are counted per attempt (`tool_calls`), not listed one by one; the log is not hash-chained.

### SR-8 You can always stop

**SR-8 You can always stop.** Stop ends the agent's process group at once and needs no confirmation. Turning off the agent permission stops every run (it becomes `stopped`: "Stopped because you turned off permission.") and refuses every start. After a crash, a step that may have half-happened (not marked idempotent) is never repeated by itself.

Enforced by: `runs.stop` aborts the run's signal and the adapter ends the process group (`claude/child.ts`); pending decisions expire. `agentPermission: "off"` stops every run and makes the keeper and `starts.request` refuse. `exec/recovery.ts` resumes only runs whose interrupted steps are all idempotent, and a step that can send, post, pay, delete or merge never resumes by itself (section 15).

Still a gap: a process that leaves its process group is not reached; Codex's process tree is a research item.

### SR-9 Your limits hold

**SR-9 Your limits hold.** The spending limit and usage limits belong to the person. Nothing in a flow, a skill, memory or outside text raises them. Reaching a limit pauses runs with a "Needs you" item; it never continues silently.

Enforced by: `keeper/gate.ts` `admit` (ceiling, memory reserve, usage lines) plus a money gate (section 8.6); limits change only through `settings.update` from the window; a flow's own `limits` only lower what it does; reaching the spending limit creates a `budget_raise` decision and the run waits.

Still a gap: subscription usage is known only from the agents' reports; Codex's usage and cost are research items.

### START The start rule

**The start rule** (product rule, owned by `architecture.md` section "Starts", cited as `START`): every start that is not typed in the chat goes through one function. 1) A flow that is new or changed does not start: the person gets the confirm card in a chat (and a "Needs you" item when nobody is watching). 2) If required inputs are missing (after remembered answers when the flow's "When it's time" is "Use my last answers"), FlowDriven asks in a chat the proactive way. 3) Otherwise it starts. The next flow of a chain goes through the same rule.

Enforced by `starts.request` in `starts/start-rule.ts` (new), the only caller of `engine.beginStart` (pinned in `source-rules.test.ts`). It returns a `StartOutcome` and writes one `starts` row (`runner-api.md` section 6.6); typed chat starts use it too, with source `chat`. Design: section 9.

## 4. Architecture decisions

Each decision gives context, decision, alternatives, consequences and the code it changes. AD-01 to AD-20 are the owner's and stand; AD-21 to AD-23 are added here. Fixes for flaws found while drafting are in section 15.

### AD-01 Keep the engine, add an assistant layer, rebuild the renderer

- Context. The engine works end to end (about 1,950 tests, many pinning security-review findings); the approved product is chat first.
- Decision. Keep the runner and add `assistant/` (chat turns, intents, cards), `inputs/`, `results/`, `starts/` (start rule, schedules, proactive questions), `rules/` (effects, standing rules, decisions), `agents/` (registry, models, set up, conformance), `codex/` and `search/`. Rebuild the renderer chat first. Decided for V1 (revisable): Builder, Inbox, Runs, Readiness and Harnesses are unrouted in B-16.T2, not deleted: their routes still parse, nothing links to them and there are no redirects; their code and tests stay in a frozen island and keep passing (section 13.3).
- Alternatives. A new engine loses the tested safety core; keeping the builder screens beside a chat means two products and jargon.
- Consequences. New modules use `Engine` and `Store`; the engine changes only for Reject skips, `stopped`, `needs_login` and one model per run. The M1 flow keeps running.
- Code. Section 5.3; the five old screen folders are unrouted in B-16.T2 and kept with `packages/contracts/src/v1/` and `packages/fixtures/src/v1/` (new).

### AD-02 Process model unchanged; the app stays alive when its window closes

- Context. Main spawns the runner (`runner-link.ts`, `ELECTRON_RUN_AS_NODE=1`, JSON-RPC over stdio); schedules need it running, but it starts on the first call.
- Decision. Keep the model. Main stays a relay plus window, theme and notification services; preload exposes only frozen `runner.call`, `runner.subscribe` and a small `window` API (`getPrefs`, `setColorMode`, `openLink`, `quit`); main starts the runner at launch. Decided for V1 (revisable, `prd.md` Q-02 as changed on 2026-11-21): V1 adds no menu-bar icon and no Open at login. It keeps today's macOS behaviour (`apps/desktop/electron/main.ts`): closing the window does not quit the app, so schedules keep running until the person quits. The menu bar, Open at login and a quit warning go into the prototype first, later. The launch agent of plan 04b stays deferred; a packaged app needs the runner bundled to JavaScript (AD-20).
- Alternatives. A launch agent needs a socket and a review; a runner in main stalls the window; a menu-bar icon and a login item were never shown to the owner, so they wait for the prototype.
- Consequences. Quitting stops schedules. A test pins that closing the last window does not quit the app on macOS (B-23).
- Code. `main.ts`, `runner-link.ts`, `preload.ts`, `runner-ipc.ts`; new `window-api.ts`. There is no `tray.ts` and no `login-item.ts` in V1.

### AD-03 Runner API contract version 2

- Context. `CONTRACT_VERSION = 1` is returned by `runner.info` and never compared.
- Decision. Version 2 in `packages/contracts`: new operations and read models; run states add `stopped` and `needs_login`; step states add `stopped`; decision states add `approved_edited` and `allowed_always`; events stay `changed` with topics, adding `chats`, `rules`, `activity`, `agents`, `skills`, `memory`, `phone`, `market`. The app checks `contractVersion` at start and refuses a mismatch. A contract change is its own build step (B-01). Decisions, rules, settings and permissions are never `mcp: yes`. `runner-api.md` owns the operations.
- Alternatives. Data in events adds a second path; no check lets a stale part misread data.
- Consequences. `FixtureRunnerClient` implements version 2 first. Contract version 2 has 45 live operations plus 12 retired entries. Retired operations (`flows.build`, `flows.update`, `flows.run {description}`, `flows.capabilities`, `flows.allowCapabilities`, `flows.withdrawCapabilities`, `harnesses.*`, `queue.*`, `usage.summary`) stay in the table as retired entries (`retired: true`, `mcp: "no"`, `phone: "no"`). B-01 only marks them retired in the table; each keeps working in the real runner until the step it leaves with (`runner-api.md`, section 7), from which it answers `unavailable` with reason `retired`, so once they have left no operation writes the frozen consent tables. The runner and contracts carry codes and `Line` values, never words (AD-14). While V1 is built, `createDispatcher` takes the version 2 handler map (partial until V1 is complete) and a legacy map typed over `@flowdriven/contracts/v1`; an operation leaves the legacy map in the task that builds its version 2 handler, and a retired one at its leave step (`runner-api.md` section 7). While V1 is built, `createDispatcher` takes the version 2 handler map (partial until V1 is complete) and a legacy map typed over `@flowdriven/contracts/v1`; an operation leaves the legacy map in the task that builds its version 2 handler, and a retired one at its leave step (`runner-api.md` section 7).
- Code. `version.ts`, `run.ts`, `approval.ts`, `flow.ts`, `settings.ts`, `operations.ts`, `client.ts`, `notice.ts`; new `chat.ts`, `card.ts`, `rules.ts`, `agents.ts`, `activity.ts`, `search.ts`, `skills.ts`, `line-keys.ts`, `window.ts`, and the frozen copy `src/v1/`; `runner/create-client.ts`.

### AD-04 Flow format 1.2, additive

- Context. Format 1.1 has no touches, result kind or plain schedule.
- Decision. `flowdriven-flow/1.2`, with 1.1 still loading: input types `time`, `duration`, `longtext`, `choice` (alias of `enum`); input `example` and `remember`; defaults as literals or the codes `today` and `now`; `result {kind: chat | report, answer?}`; `touches[] {id, sentence, effect, place?, rule, covers}` checked against the requirements (each declared tool or command covered by exactly one touch; a touch's effect never lower than FlowDriven's class); a person-facing `schedule {type: manual | daily | weekdays | weekly | after, time?, day?, afterFlow?, whenItsTime: ask | last}` mapping onto the existing `schedule` and `flow_done` triggers. Standing rules, and the active schedule, are never stored in a flow file; they are the person's state in the store.
- Alternatives. A format 2 breaks the M1 flow; rules in a file break SR-2.
- Consequences. A 1.1 flow keeps a `legacy` confirmation with no touches and no rules (`data-model.md` 3.2), its flow page lists drawn from `capabilitySentence`; `rule` is a proposal (section 6.3); the active schedule never changes the hash; drafts keep each "Asks you first" action in its own step.
- Code. `vocab.ts`, `format/manifest.ts`, `format/requirements.ts`, `validate/validate.ts`; new `format/inputs.ts`, `format/result.ts`, `format/touches.ts`, `format/schedule.ts`; `service/map-flow.ts`.

### AD-05 Store version 7

- Context. One `node:sqlite` file, JSON `data` columns, `user_version` 6, one writer.
- Decision. Version 7 by an additive migration from 6, tested on a version-6 fixture, after a backup copy. New tables `chats`, `messages`, `drafts`, `confirmations` (generalizes `capability_consents`), `standing_rules`, `remembered`, `waiting_questions`; settings keys `language`, `agentPermission`, `mainAgent`, `busyFallback`, `spendingLimit`. Later: `memory_items`, `skills`, `skill_versions`, `market_installs`, `phone_links`. `data-model.md` adds `flow_heads`, `call_grants`, `schedules` and `starts`, and owns the columns.
- Alternatives. A migration framework or second database adds parts for no gain.
- Consequences. A store newer than 7 is refused; a failed migration leaves version 6 usable (NF-12); message text sits in a plain column for search.
- Code. `schema.ts`, `storage.ts`, `sqlite-store.ts`, `service/events.ts`.

### AD-06 One decision function for SR-1

- Context. `decide(policy, call)` already decides every Claude Code tool call; command patterns are refused by growing lists. The owner prefers one general rule.
- Decision. `decide` grows into the single decision point; its policy is compiled from the confirmed flow version (requirements, touches and their placement), active standing rules and one-time grants. Order: refuse what is not declared -> classify the effect with FlowDriven's catalog (unknown tools count as `change`) -> run `read` -> run declared `local_write` and `run_command` -> run an exact one-time grant -> run an exact standing rule -> otherwise hold (section 6.1). Enforcement points: the Claude Code pre-tool hook (as built, fails closed); Codex per tier (AD-09); later the FlowDriven gateway (a local MCP server) for proxied account tools; the agent's own OS sandbox for commands, replacing the refuse lists over time (they stay as a refinement). Gmail's "label to Trash or Spam is a delete" stays as the kind of special case the general rule cannot see.
- Alternatives. Agent-declared effects trust steerable output; asking for every write is too many questions.
- Consequences. One effect table to review; "Ask me again" applies at once. Decided for V1 (revisable): this change follows the clickable prototype the owner approved; each task that makes it is a safety-core change with one independent security review before its pull request leaves draft.
- Code. `claude/decide.ts` (agent-neutral `ToolCall`; hook shape checks move to `claude/channel.ts`), `claude/policy.ts`, `connectors/catalog.ts`; new `rules/effects.ts`, `rules/standing.ts`.

### AD-07 Decisions and standing rules

- Context. Rejecting fails the step and run today. Owner decisions: "Always allow for this flow" (2026-11-19; V1 keeps it exactly as the prototype has it, for a repeatable `change` at a fixed place only, 2026-11-21); Reject and Stop need no dialog (2026-11-18).
- Decision. A held call becomes a decision shown in its chat (when started from one), in Activity "Needs you", as a notification with fixed text, and on a paired phone (V2). Approve writes a one-time grant bound to run, step, item, tool and exact input digest; Edit (text only) approves the edited text as `approved_edited`, its grant bound to the edited digest; Always allow (offered only for a repeatable `change` at a fixed place) also writes a standing rule `{flow, touch, effect, place}`. Reject skips that action and the run goes on ("You said no: X. It was not done."), a change from today's engine that follows the approved clickable prototype, with one independent security review. A run decision waits without a time limit; Stop, permission off or flow deletion ends it as `expired` (PU-15, PU-16). Confirm creates rules for every non-read touch left under "Does on its own"; only `local_write`, `run_command` and `change` can be there. "Ask me again" revokes at once. A changed flow keeps a rule only if a touch with the same id, effect and place exists. "Approve all similar" covers one group of `send` or `post` decisions in one run, after a dialog that lists every item in full (every recipient, the subject and the whole text) before anything is approved (PU-18). After a Reject no standing rule applies for the rest of that run; the held call shows the normal decision card. Rules are made only in the desktop window.
- Alternatives. Rules per tool name are too wide; failing the run punishes saying no; standing rules for send, post, pay, delete and merge (not in V1: they need destination-level places and a step-level rule for outside text, with their own review).
- Consequences. Canonical places (6.4), an engine skip path (6.5); two answers count once; no standing rule exists for a risky kind.
- Code. `engine.ts` (`beginDecide`), `exec/held.ts`, `exec/ask.ts`, `connectors/grants.ts`; new `rules/decisions.ts`, `rules/standing.ts`; `service/handlers.ts`.

### AD-08 Agents behind one AgentAdapter port

- Context. `HarnessAdapter` covers steps and judge; detection, sign-in, consent and models sit in `service/claude-harness.ts`, `claude/scan.ts` and `modelFor`.
- Decision. One `AgentAdapter` port (section 8.1): `detect`, `signInStatus`, `setUp` (install from FlowDriven's own catalog command, then wait for sign-in by polling the agent's status command; FlowDriven never sees the password), `models`, `runStep`, `chat` (no tools, a JSON schema), `judge`, `stop`, `capabilities`. A shared conformance suite runs every adapter against its fake CLI. Each agent reports its own models (Claude Code aliases, Codex's list, else a catalog per CLI version). A run uses one model for every call: the chat's choice for runs started from a chat, else the main agent's default model; "If <main agent> is busy, use <other agent>" only for starts outside a chat. The effort-to-model table becomes an internal default. The model choice is passed with the agent's own model flag and no other flag; it never changes the sandbox, the tools or the approvals. Codex is offered as a chat agent only if it has a tool-free mode (AD-09). A chat FlowDriven starts (the 17:00 question, an "after" question) gets the main agent and its default model, so the picker always shows what a run will use.
- Alternatives. Separate services per concern; a generic protocol not shown to deny calls (spec 22.4).
- Consequences. The one permission replaces per-agent consent (owner decision, 2026-11-18); runs record `agent` and `model`.
- Code. `harness.ts`, `claude/adapter.ts`, `claude/scan.ts`, `claude/prompt.ts`, `service/claude-harness.ts`, `keeper/kept-harness.ts`; new `agents/registry.ts`, `agents/models.ts`, `agents/setup.ts`, `agents/conformance.ts`.

### AD-09 Codex adapter

- Context. No Codex code exists; its behavior is unrecorded.
- Decision. A research task comes first (B-22.T1; Chair step, no network). It reads only the local `--help` and version output of the installed Codex command-line tool, never a web page, and records a synthetic agent profile with hand-typed values; nothing is recorded from a real agent, and a real run, if the owner watches one, stays in `.workflow/scratch/` and is never committed. The fake codex's scripts are written by hand from the profile's shapes; a Vitest test scans fixtures and test helpers for absolute local paths, `@` addresses and long tokens. Until the research is done, cases use an injected agent profile and assert the exact value the profile gives. Always `-s workspace-write` or `-s read-only` explicitly, the model flag, JSON events, the prompt on stdin, its own sign-in status command. If FlowDriven can answer Codex's approval requests, the same `decide` applies (`enforced`); if not, Codex runs only steps that read and write the flow's folders and run declared commands in its sandbox (`folder_limited`), and account tools reach it only through the gateway (V3). A flow needing a tool Codex cannot be limited for starts nothing: the chat says "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." (`chat.agentCannotRunFlow`, PU-26). No card offers a one-time switch of agent. Codex is offered as a chat agent only if it has a tool-free mode.
- Alternatives. Assuming a protocol before the research; leaving Codex out of V1; committing a real recording (it could carry a home path, account ids or an address). The Codex sandbox is a safety-core change: one independent security review.
- Consequences. V1 Codex runs local steps unless the research shows per-call approvals (section 8.3; one fix in section 17). Codex's read scope is part of the research and of section 16, item 2; until then the declared-folders read limit is claimed for Claude Code only.
- Code. New `codex/adapter.ts`, `codex/args.ts`, `codex/stream.ts`, `codex/fixtures/` (hand-written), `test-helpers/fake-codex.ts`.

### AD-10 The assistant: the agent understands, FlowDriven decides

- Context. The prototype matched keywords; the real app reads sentences with the agent (the prototype brief, "Inputs, results, proactive schedules, flows from skills, and every feature shown").
- Decision. Each chat turn is one agent call with no tools and a JSON schema (`--json-schema` exists), on the chat's agent and model, with a compact context: flows with names and inputs, remembered answers (with their outside marks), what runs and what needs the person, the last turns up to 12 turns or 24,000 characters. The answer is an intent (`answer`, `run`, `run_together`, `run_chain`, `stop`, `status`, `schedule`, `unschedule`, `make_flow`, `make_flow_from_skill`, `improve_flow`, `fill_inputs`) plus the reply text and its language, which FlowDriven validates against its own state and turns into messages and cards. The agent never starts anything; FlowDriven never starts a run the person did not ask for (questions, negations and plain mentions give a card). SR-5 applies to the context.
- Alternatives. Keyword rules are brittle; a chat agent with tools could act.
- Consequences. A direct start needs an explicit run of one flow, a clean context, a confirmed flow and valid inputs; else a card (6.8). If the chat's agent cannot be limited for the flow, nothing starts and the reply is `chat.agentCannotRunFlow` (PU-26).
- Code. New `assistant/turn.ts`, `assistant/intents.ts`, `assistant/cards.ts`, `assistant/context.ts`, `test-helpers/fake-brain.ts`; `claude/adapter.ts`, `claude/prompt.ts`.

### AD-11 Inputs

- Context. An agent's reading of "yesterday" or "2 jam" can be wrong, and a wrong date logs the wrong day.
- Decision. FlowDriven validates every value with its own typed parsers (dates in the person's time zone, times `HH:MM`, durations in minutes with limits, numbers in bounds, choices from the list, long text up to 4,000 characters with no hidden characters) and fills in order: the message, remembered answers (never dates or times, and never a value that came from outside text unless the person typed or confirmed it), defaults. It asks in one short message only for missing or invalid required inputs, with an example and a "Use a form" chip; the form is built from the input list. Remembered answers are saved when a run starts, with their outside mark (`RememberedAnswer.outside`).
- Alternatives. Trusting the agent's values; always a form.
- Consequences. `fill_inputs` carries raw text; `today` and `now` resolve at the request's slot (AD-23).
- Code. New `inputs/parse.ts`, `inputs/fill.ts`, `inputs/remember.ts`; `format/inputs.ts`; `engine.ts` `beginStart`.

### AD-12 Results

- Context. `report.ts` `reportLines` says nothing about decisions.
- Decision. `chat`: the answer lines (template filled from inputs and outputs) are posted in the run's chat, or a new chat for starts outside a chat. `report`: the report stays with the run in Activity and the chat gets "Done. The report is in Activity." The runner writes the honest decision lines ("You approved: X.", "Done by your rule: X.", "You said no: X. It was not done.").
- Alternatives. An agent-written closing message could claim what did not happen.
- Consequences. A chat result stores the flow's answer lines with their `{inputId}` placeholders and the run's typed values; the renderer fills them in the run's language and drops a line whose placeholder has no value. Decision lines are `Line` values. "Copy report" is built by the renderer from `runs.export`'s structured parts, in which the runner has masked secret-looking text by a named pattern list as "[hidden]" (SR-6) and marked hidden characters. Answers from outside outputs are outside text.
- Code. New `results/answer.ts`, `results/report-lines.ts`; `report.ts`, `service/map-run.ts`.

### AD-13 Starts and schedules

- Context. Many start sources must apply the same checks; the trigger service already ticks, catches up and dedupes.
- Decision. One `starts.request(flowId, source, context)` implements `START`. Schedules map to the existing trigger service (30-second tick, catch up once, overlap skip). Proactive questions create or reuse a chat from FlowDriven (one waiting question per flow; "after another flow" asks in the same chat). Notifications only for decisions, problems and proactive questions, with fixed text; an `after` start sends none of its own. Missed starts while the Mac slept or FlowDriven was closed run once at wake within the grace window; other missed slots are recorded as `starts` rows with outcome `missed` and a reason. Activity's read model has only run rows in V1: no Missed, Skipped or Run late rows.
- Alternatives. Checks per caller drift apart (the prototype brief, "Fixes after the independent review" under "Inputs, results, proactive schedules, flows from skills, and every feature shown", merged them); a new scheduler loses the fire keys.
- Consequences. Only `starts/start-rule.ts` calls `engine.beginStart`; trigger fires go through it (`TriggerDeps.begin`); every request returns a `StartOutcome` and writes one `starts` row. Section 9.
- Code. New `starts/start-rule.ts`, `starts/schedules.ts`, `starts/proactive.ts`; `triggers/service.ts`, `service/trigger-wiring.ts`, `notify/policy.ts`, `service/handlers.ts`.

### AD-14 Words and languages

- Context. Owner decision, 2026-11-21: English by default with Bahasa Indonesia, one file per language. The runner writes words too. The prototype brief, "English and Bahasa Indonesia" (its "Fixes after the independent review"), fixes chips, cards, durations and numbers.
- Decision. Decided for V1 (revisable): one words file per language in `apps/desktop/src/i18n/`, as the prototype brief "English and Bahasa Indonesia" says (its "Real app" part), with no new workspace package. `en.ts` is the source and its type gives the keys; other languages are partial copies typed against it; one list imports them; `{name}` placeholders; plural forms with `Intl.PluralRules`; dates with `Intl.DateTimeFormat`; numbers with `Intl.NumberFormat` in the app language; durations and clock times through one helper using the `time` group, while data keeps codes and short forms (`2h`, `17:00`). A Vitest test, `apps/desktop/src/i18n/i18n.test.ts`, run by `pnpm test` inside `pnpm check`, enforces the rules of that brief ("One file per language", "Fixes after the re-check"; section 10); `tools/checks/` stays unchanged. One general rule: no words in `packages/*`. The runner and contracts carry codes, `Line` values (a key and raw params; a moment is an `IsoDateTime` the renderer formats) and typed values; everything a person reads is drawn in `apps/desktop`, by the renderer or by Electron main (system notifications). The runner never builds a sentence: it emits a message code with values (a `Line`), and runner tests assert codes and params, never sentences; a sentence quoted in a runner case is only the English drawing of its `Line`. A sentence is one key with placeholders, never glued from fragment keys. Every card, the inputs form and its example placeholders included, and every button and chip follow the app language when shown; chips are matched by a code, so either language works. FlowDriven's own posted lines (the 17:00 question, "<flow> needs a few details.", "<flow> finished, so <next> is next.", "Done. The report is in Activity.") follow the chat's language. The agent answers in the language the person writes in. Translations live only in the language files; they are approved by the owner's request for English, Bahasa Indonesia and easy added languages, so they are not an Ask-first item.
- Alternatives. An i18n library is not allowlisted; a shared words package would add a workspace folder, and words in the runner would break the one rule.
- Consequences. Main passes the registered language codes at spawn (`--languages=en,id`); the runner refuses other codes for the app language and ignores them for a chat's language. Notices carry `title` and `body` as `Line` values with no params, plus the app language, and main draws them: fixed text only, never a decision title, a flow name, a payload or an input value. Switching rewrites nothing. V2 bot messages need words outside the window; that is decided when V2 is planned. Section 10.
- Code. New `apps/desktop/src/i18n/` (`en.ts`, `id.ts`, `languages.ts`, `t.ts`, `plural.ts`, `when.ts`, `check.ts`, `test-helpers/tree.ts`, `i18n.test.ts`) and `packages/contracts/src/line-keys.ts`; the prototype's English and Indonesian word files are copied by a Chair step (B-06.T10) into `.workflow/scratch/prototype-words/` (git-ignored, never committed) before B-06.T3 builds `en.ts` and `id.ts`, and B-06.T3 reads them from there; `service/args.ts` (`--languages`), `notify/policy.ts`, `results/report-lines.ts`, `assistant/cards.ts` emit `Line` values; `notifier.ts` draws them.

### AD-15 Appearance

- Context. Owner decision, 2026-11-20: the "live current" look with Light, Auto and Dark, Auto by default; today `?theme=` (`theme.ts`) overrides the system for capture.
- Decision. Light, Auto and Dark map to Electron `nativeTheme.themeSource` `light`, `system`, `dark`, set by main when the renderer asks through the preload `window` API; main keeps the choice in its own small settings file so it applies before the first paint; CSS keeps only the media query.
- Alternatives. A renderer-set attribute flashes wrong colors at start and leaves native parts behind.
- Consequences. The browser preview follows the system; capture sets `themeSource` per shot. Section 11.
- Code. New `appearance.ts`, `window-api.ts`, `packages/contracts/src/window.ts`; `window.ts`, `window-colors.ts`, `capture.ts`; the new shell stops using `theme.ts`, which stays with the frozen island; `styles/tokens.css`.

### AD-16 Renderer

- Context. The current renderer has the right base but builder-first screens.
- Decision. React 19, the existing hash router (`nav/route.ts`), `RunnerClient` only, view state only, plain CSS modules with `tokens.css` (the live current tokens, both color modes), status always icon plus words, a safe text renderer for agent and outside text: no raw HTML, no remote images, links shown but opened only after the person clicks and main checks them.
- Alternatives. A router or state library: not allowlisted, not needed.
- Consequences. Decided for V1 (revisable): the system font stack, with no font files; the clickable prototype's font is a later Ask-first item. `prd.md` F-25 holds the look-and-feel checks. Routes in section 5.4; the old screens stay unrouted.
- Code. New `shell/`, `screens/*` (section 5.4), `text/`; `nav/route.ts`, `ui/`, `styles/`.

### AD-17 Search

- Context. NF-04: 150 ms with 1,000 chats and 200 flows.
- Decision. Plain `LIKE` queries over chat titles, message text, flow names and summaries in the runner, limited results; full-text search later.
- Alternatives. Full-text search depends on the SQLite build in Node (section 16, item 3); an index in the renderer breaks "view state only".
- Consequences. `%` and `_` escaped, case folded; the limits are those of `SearchResult` in `runner-api.md` (section 4; `search.query` is in 6.11): at most 20 chats (5 when the text is empty) and at most 50 flows (every flow, at most 200, when the text is empty); outside tags kept.
- Code. New `search/query.ts`, contracts `search.ts`.

### AD-18 Memory, Skills, Marketplace, Phone & bots

- Context. The prototype shows them all; spec S21, S14, S22 and R9, R14 to R20 bind them.
- Decision. They keep the original spec's rules in plain words; the release order decides when they ship (V1: the Skills list and Make a flow from a skill; V2: Memory, Phone & bots, skill updates; V3: Marketplace). Marketplace flows install as drafts that do nothing until confirmed, with signature and revocation checks against a pinned public key. Phone approvals are a V2 product decision with its own security review when V2 is planned: by default only fixed text reaches a bot and risky kinds are decided in the app; if the person enables phone approval for a flow, one decision at a time, two taps for risky kinds, only the paired account, commands older than 10 minutes ignored, no standing rules from the phone. Other AI tools on this Mac may list and start flows; their starts go through `START` and their decisions still open in FlowDriven.
- Alternatives. Everything in V1 delays first use (Q-01).
- Consequences. A changed skill makes its flows "Changed: confirm again"; installed flows get only reads on their own.
- Code. V1: `skills/skill-folder.ts`, contracts `skills.ts`, `screens/skills/`.

### AD-19 Secrets

- Context. V1 has no secret; bot tokens (V2) and gateway keys (V3) will.
- Decision. The system keychain through Electron `safeStorage` in main or the macOS keychain, referenced by name; the runner asks for a secret only at the moment of use for a declared purpose. Not needed before Phone & bots and the gateway.
- Alternatives. Encrypted secrets in the store need a key on disk; secrets in the agent's environment reach its tools.
- Consequences. In V2 main holds them (`secrets.ts` (new)) and answers a new runner-to-main request `shell.secret {name, purpose}` only for the purpose recorded when the secret was saved.

### AD-20 Packaging and updates

- Context. The runner starts from TypeScript source inside the checkout (`runner-paths.ts` `runnerEntry`).
- Decision. Signing, notarization, tags and releases are never agent steps (AGENTS.md): the owner does them personally, with no secret in any session (B-30, "Owner step"). Agents may prepare packaging configuration that holds no secret. The update channel is release setup (Ask first), outside this design's build steps except where the runner bundle is needed to start a packaged app (B-30).
- Alternatives. Packaging in V1 needs keys and a reviewed release path first (spec 17.5).
- Consequences. Decided for V1 (revisable): packaging and the runner bundle stay out of V1; V1 runs from a checkout (`pnpm start`). The bundle's root script is a later Ask-first item (the gate pins root scripts).
- Code. `runner-paths.ts`; root `package.json`.

### AD-21 Contributor guides

- Context. The repository will be public, for hand coders and AI agents. AGENTS.md is pinned by `tools/checks/test/agent-rules.test.mjs`. Decided for V1 (revisable): build step B-31, planned in `contributing-plan.md`.
- Decision. A `README.md` quickstart (new) with a short safety note (what the agents' makers receive, what FlowDriven cannot catch, that commands use the person's rights); `CONTRIBUTING.md` (new) for people who code by hand (prototype first, the TDD loop, the main rules, one line each for the AI-agent rules that matter most with a link to AGENTS.md, safety areas that need a security review, commits and pull requests); AGENTS.md stays the AI-agent rule set and is not edited in V1; `docs/translating.md` (new) adds a language in at most ten steps, starting from `apps/desktop/src/i18n/en.ts`.
- Alternatives. One guide serves neither reader; rewriting AGENTS.md breaks its pinned layout.
- Consequences. Both paths meet at the design set, the plans and the gate. `tools/checks/` stays unchanged in V1, so the guides' script names and links are checked in TypeScript: `apps/desktop/src/docs-check.ts` (new, `checkDocs(root)`) and its Vitest test `apps/desktop/src/docs.test.ts`, owned by the first B-31 task, with the guides after it; a test that needs a script of `tools/checks/` (the hidden-character check) runs it as a child process and asserts its exit code and output, and never imports it; moving that check into `tools/checks/`, AGENTS.md's "Design:" pointer and its sentence about the language files are later Ask-first changes.
- Code. New `apps/desktop/src/docs-check.ts`, `apps/desktop/src/docs.test.ts`, `README.md`, `CONTRIBUTING.md`, `docs/translating.md`.

### AD-22 Cards and suggested replies are data

- Context. Card buttons change state ("Confirm", "Save flow", "Start", "Yes, set it"); the prototype brief "English and Bahasa Indonesia" ("Fixes after the independent review") says cards follow the app language and chips are matched by a code.
- Decision. There is no `other_agent` card and no `use_other_agent` action in V1 (PU-26 replaces them). A card is a typed record in a message: `type`, ids, values, a base (the flow hash, run state or decision state it was made for) and a state (`open`, `answered`, `replaced`, `cancelled`, `stale`, `flow_deleted`), with no FlowDriven sentence; the renderer draws it in the app language. Each button and chip has a code; a click is `chats.act {chatId, messageId, action, values?}`, which the runner accepts only if the card offers the action, is open and still has its base, else `conflict` (`card_answered`, `card_stale`). Decision and run cards call `approvals.resolve` and `runs.stop` directly, so a decision is answered in one place. Typed text never presses a button ("Use the buttons on the card above."). A suggestion chip is sent by its index (`suggestion`); the runner, which keeps the chip's label (a `Line`, or the agent's own text), posts that label as the person's message without changing the chat's language. Starter chips are sent by index too (`chats.send {chatId, starter}`) and act by their code without a brain call (`runner-api.md` 8.3).
- Alternatives. Re-reading chip labels as text depends on language.
- Consequences. A click is the person's act (SR-2); cards survive a language switch.
- Code. New `packages/contracts/src/card.ts`, `assistant/cards.ts`, the `chats.act` handler, `screens/chat/` cards.

### AD-23 Time and the person's clock

- Context. Schedules run in local time and the 17:00 question must log the day it asked about; tests run with `TZ=UTC` yet must also cover another zone.
- Decision. Modules that read time get `now()` and the zone injected (default: the system zone, read again each tick). Instants are ISO UTC, dates `YYYY-MM-DD`, clock times `HH:MM`, durations short forms; local-day math takes the zone, and product code receives an IANA zone and uses `Intl` with `timeZone`, never the process `TZ` (tests switch zone with `withTimeZone(zone, fn)`, `test-plan.md`); `today` and `now` resolve at the slot time of the start request.
- Alternatives. The process zone cannot test two zones in one run.
- Consequences. Tests pass `timeZone: "Asia/Bangkok"`; a question answered next morning logs the day it asked about.
- Code. `triggers/schedule.ts`, `inputs/parse.ts`, `starts/*`, `service/service.ts`.

## 5. Process model and module map

### 5.1 Processes

| Process | Started by | How many | Owns |
|---|---|---|---|
| Electron main | The person | One (single-instance lock) | Window, theme, notifications, link checks, its small settings file, the runner link |
| Renderer | Main | One window | View state only |
| Runner (`ELECTRON_RUN_AS_NODE`) | Main, at launch | One (exclusive store lock; at most 3 restarts in 60 s) | The store, every timer, every agent child, the safety core |
| Agent CLIs | The runner, through the keeper | Up to the ceiling (4 by default), each in its own process group | One step attempt, judge call or chat turn |
| `hook.sh` | The agent CLI | One per tool call | Nothing: it hands the call to the runner through the control folder |
| Check commands, `caffeinate`, probes | The runner | Short lived | - |

Bots (V2) and the gateway (V3) run inside the runner process. Start: main takes the lock, registers the `app` scheme, reads its settings file and sets `nativeTheme.themeSource`, starts the runner and opens the window. The renderer checks `runner.info`, reads `settings.get` and routes to `#/welcome` or a chat. Closing the window does not quit the app (AD-02); "Quit" ends the runner's stdin; the runner stops triggers, engine and agents; main kills it after 3 s; open runs show `interrupted` at the next start.

### 5.2 Packages

| Package | V1 change |
|---|---|
| `packages/contracts` | Version 2 (AD-03): new `chat.ts`, `card.ts`, `rules.ts`, `agents.ts`, `activity.ts`, `search.ts`, `skills.ts`, `line-keys.ts`, `window.ts`; the frozen copy of version 1 in `src/v1/` |
| `packages/sdk` (MIT) | Format 1.2 (AD-04): new `format/inputs.ts`, `format/result.ts`, `format/touches.ts`, `format/schedule.ts` |
| `packages/runner` | New modules (section 5.3) |
| `packages/fixtures` | Chat-first sample `story-v2/` (new); `FixtureRunnerClient` on version 2; the version 1 sample and client frozen in `src/v1/` |
| `apps/desktop` | Rebuilt renderer with the words in `src/i18n/` (AD-14, AD-16); main additions (section 5.5) |
| `tools/checks` | Unchanged in V1 |

Dependencies point one way: `apps/desktop` -> `contracts`, `fixtures`; `runner` -> `sdk`, `contracts` (types, `line-keys.ts`); `fixtures` -> `contracts`; `sdk` imports no workspace package. No package under `packages/` holds words (AD-14).

### 5.3 Runner modules

| Module | Status | Responsibility |
|---|---|---|
| `engine.ts`, `states.ts`, `exec/*`, `checks/*`, `report.ts`, store files | Kept, changed | Walk, holds, checks, recovery; adds the skip path, `stopped`, `needs_login`, one model per run; store version 7 |
| `claude/*`, `connectors/*`, `router/*`, `folders/extra.ts`, `skills/skill-folder.ts` | Kept, changed | The port, agent-neutral `decide.ts`, compiled touches, `chat`; catalog with effects |
| `keeper/*`, `triggers/*`, `notify/policy.ts`, `service/*` | Kept, changed | Money gate, chat turns first; fires through `START`; version 2 notices and handlers |
| `assistant/` (`turn.ts`, `intents.ts`, `cards.ts`, `context.ts`) | New | Chat turns, intents, cards, context and taint |
| `inputs/` (`parse.ts`, `fill.ts`, `remember.ts`), `results/` (`answer.ts`, `report-lines.ts`) | New | Typed parsers and fill order; answer and decision lines as codes |
| `starts/` (`start-rule.ts`, `schedules.ts`, `proactive.ts`), `rules/` (`effects.ts`, `standing.ts`, `decisions.ts`) | New | `START`, schedules, questions; effects, standing rules, decisions |
| `agents/` (`registry.ts`, `models.ts`, `setup.ts`, `conformance.ts`), `codex/` (`adapter.ts`, `args.ts`, `stream.ts`), `search/query.ts` | New | Registry, models, set up, the shared suite; Codex; search |
| `test-helpers/fake-codex.ts`, `test-helpers/fake-brain.ts` | New | Fakes (section 12.6) |

### 5.4 Renderer structure

| Folder | Holds |
|---|---|
| `shell/` (new) | The rail (fixed menu, chat list in Today, Yesterday, Earlier, Settings and the agent line at the bottom), the narrow-screen drawer, the Search dialog |
| `screens/welcome/`, `screens/chat/`, `screens/flows/`, `screens/activity/`, `screens/settings/`, `screens/skills/` (new) | V1 screens; `screens/chat/` has the composer, the picker and one component per card type |
| `screens/memory/`, `screens/phone/`, `screens/marketplace/` (new) | V2 and V3, not shown in V1 |
| `text/` (new) | Safe text renderer: paragraphs, lists, emphasis and code from plain text; no HTML or images; hidden characters shown ("[U+200B hidden character]"); links as buttons that ask main |
| `i18n/` (new) | The words files and helpers (AD-14, section 10), also used by Electron main for notifications |
| `screens/builder/`, `screens/inbox/`, `screens/runs/`, `screens/readiness/`, `screens/harnesses/` | Unrouted in V1, kept with their tests on the frozen version 1 contract (section 13.3) |
| `nav/`, `runner/`, `ui/`, `styles/`, `test/` | Kept |

Routes: `#/welcome`, `#/chat`, `#/chat/<chatId>`, `#/flows`, `#/flows/<flowId>`, `#/activity`, `#/activity/<runId>`, `#/skills`, `#/settings`; later `#/memory`, `#/phone`, `#/marketplace`, `#/marketplace/<listingId>`. The old routes (`#/builder`, `#/inbox`, `#/runs`, `#/runs/<runId>`, `#/readiness/<flowId>`, `#/harnesses`) still parse and show their old screens from B-16.T2, but no menu item, button or link leads to them; there are no redirects.

The V1 menu is New chat, Search, Flows, Activity, Skills and Settings; other items appear when their release ships. V1 Settings has Appearance, Language, AI agents, Permission, Main AI agent, Spending limit and Notifications.

### 5.5 Electron main additions

- `window-api.ts` (new): the preload `window` API of `runner-api.md` section 12 (`getPrefs`, `setColorMode`, `openLink`, `quit`), with the sender check of `runner:call`; `openLink` takes only `https:` addresses without user name or password, then `shell.openExternal`. Its schemas are in `packages/contracts/src/window.ts` (new). `WindowPrefs` is `{colorMode, platform}`.
- `appearance.ts` (new): `nativeTheme.themeSource` and `window.json` (new) in Electron's user data folder, which holds only `{version: 1, colorMode}` (`data-model.md` 3.19).
- V1 has no `tray.ts` and no `login-item.ts` (owner decision, 2026-11-21, section 9.5).
- Changed: `notifier.ts` (draws a notice's fixed-text `Line` title and body in its language with `src/i18n/`; targets `run`, `chat`, `flow`, `activity`, `settings`; the `notice_clear` frame), `main.ts`, `runner-link.ts` (runner at launch with `--languages`; the version check), `preload.ts`, `runner-ipc.ts`, `window.ts` (colors from `nativeTheme`).

## 6. The safety core

### 6.1 The decision order

`decide(policy, call, books)` answers every tool call before it runs; `books` reads grants and standing rules from the store at that moment. The first matching row decides.

| Order | Test | Result | Audit |
|---|---|---|---|
| 0 | Shape, session id or structured-output check fails (as built) | Deny | `tool_denied` |
| 1 | Tool, folder, address or command not declared for the step, or the call matches a "Never does" touch | Deny with "This step does not declare the tool X."; the agent goes on | `tool_denied` |
| 2 | Classify effect and place with FlowDriven's catalog (6.2); unknown tools are `change` with an unknown place | - | - |
| 3 | `read` inside the declared scope | Allow | counted in `tool_calls`; `page_read`, `connector_call` |
| 4 | `local_write` in a declared writable folder or `run_command` matching a declared line, whose touch is under "Does on its own" (its confirmation rule is active) | Allow | counted in `tool_calls`; `command_run` |
| 5 | One-time grant for this run, step, item, tool and exact input digest | Store its use, then allow once | `grant_used` |
| 6 | Active standing rule for this flow, touch, effect and exact place; not after a Reject in this run, never in a run another AI tool started (section 15) | Allow | `rule_used`, the step's `ruleUses` |
| 7 | Anything else | Hold: deny with "FlowDriven is holding this call until the person approves it", stop the step, create a decision | `call_held` |

The hook fails closed (no answer in time, NF-13; unreadable request; reused `tool_use_id`; any error). The start proof and the tripwire stay as built.

### 6.2 Effect classification

| Call | Effect | Place |
|---|---|---|
| `Read`, `Glob`, `Grep` in declared folders | `read` | The folder |
| `Write`, `Edit` in declared writable folders (never `.git`, `.claude`, `.mcp.json`) | `local_write` | The declared folder |
| `Bash` with a declared command line | The covering touch's effect, never lower than `classifyCommand`'s class; `run_command` when local | The declared pattern |
| Own-browser `tabs_context_mcp`, `tabs_create_mcp`, `navigate` to a declared template, `get_page_text`, `tabs_close_mcp` | `read` | The address template |
| Gmail read tools | `read` | The account |
| Gmail `create_draft` and label tools | `change`; a label to Trash or Spam is `delete` (`throwsMailAway`) | The account |
| Gmail `send_message`, `reply`, `forward` | `send` | The recipients |
| Gmail trash, delete and spam tools | `delete` | The items |
| Declared tools of a server the catalog does not know | `change` | Unknown |
| Codex commands, patches and tool calls (tier `enforced`) | As the rows above, after the research step | As above |

Canonical places are `Place` values (`runner-api.md` section 3): `folder` (the resolved path), `command` (the declared pattern), `account` (the catalog ref), `address` (the sorted, lower-case recipients in to, cc and bcc), `site` (the address template), `repo` (repository and target branch). A place FlowDriven cannot read from the input, or with no `Place` kind (deleted items, payments in V1), is unknown, and an unknown place is never fixed. For V1 rules, `change` uses `account` or `folder`, `local_write` uses `folder` and `run_command` uses `command`; `address`, `site` and `repo` places are shown on cards but never carry a rule in V1.

### 6.3 Compiling confirmations, rules and grants into the policy

```ts
type Effect = "read" | "local_write" | "run_command" | "change" | "send" | "post" | "pay" | "delete" | "merge";
type CompiledTouch = {
  touchId: string; effect: Effect;
  matcher: "folder" | "command" | "exact";   // how a call's place is compared
  place?: Place; fixedPlace: boolean;        // fixed only for a literal of the confirmed version
  list: "on_its_own" | "asks_first" | "never";
  covers: string[];                           // tools or command patterns
};
type StepPolicy = Policy & { flowId: string; hash: ContentHash; touches: CompiledTouch[] };
interface RuleBook { match(run: RunId, flowId: FlowId, touchId: TouchId, effect: Effect, place: Place): StandingRule | undefined }
```

`buildPolicy` compiles the step's part of the confirmed version per attempt; `GrantBook` and `RuleBook` are read per call, so a grant is used once and "Ask me again" applies to the next call. Default lists (`proposeLists`):

| Touch | Default | Movable |
|---|---|---|
| `read` | "Does on its own" | No: reads always run |
| `local_write`, `run_command` | "Does on its own" | To "Asks you first" (later; the V1 dialog does not move touches) |
| `change` with a fixed place the person named in a clean chat | "Does on its own" | Yes |
| `change` with an unknown or unfixed place | "Asks you first" | No: a rule needs an exact place |
| `send`, `post`, `pay`, `delete`, `merge` | "Asks you first", never pre-selected | No: always asks; `flows.confirm` refuses it in `onItsOwn` with `not_allowed`, reason `always_asks` |
| Touches of an installed or imported flow | Reads only on its own | As above |
| What the flow has no tool for | "Never does" | No |

`flows.confirm {flowId, hash, onItsOwn}` stores the confirmation and, in the same transaction, one standing rule per non-read touch in `onItsOwn` (`createdBy: "confirm"`; only `local_write`, `run_command` and `change` can be there, and a risky kind is refused with `not_allowed`, reason `always_asks`); a flow change carries a rule over only if a touch with the same id, effect and place remains. The V1 confirm dialog shows the default lists and does not move touches. A format 1.1 flow's `legacy` confirmation has no touches: `decide` uses its declared requirements as version 6 did, and every risky call asks.

### 6.4 The fixed place rule for "Always allow"

A decision gets `fixedPlace: true` only when its touch declares a place literal in the confirmed version and the call's canonical place equals it. The confirm card shows each place in plain words, so a place becomes the person's when they confirm the version that names it; a place that entered a draft from outside text carries the outside tag there. Run data never becomes a place, so a reply to whoever wrote gets no "Always allow". A place with letters outside ASCII is also shown in ASCII (a domain in its `xn--` form), against look-alike places (PU-24). "Always allow" is offered (`canAlwaysAllow`) only for a pending `risky_action` decision whose effect is `change` with a fixed place, only in the desktop window, and writes `allowed_always` plus the rule `{flowId, touchId, effect, place, createdBy: "always_allow"}` in one transaction. For `send`, `post`, `pay`, `delete` and `merge` it is never offered, and `approvals.resolve {always_allow}` for one is refused (`not_allowed`). If rules for send or post are ever allowed, they need destination-level places (every recipient, a channel) and a step-level rule that ignores standing rules after the step read outside-marked results; that is a later approvals change with its own security review.

### 6.5 Reject skips an action

When the call was held, the agent's process already ended, so the agent is told nothing and is not asked to work around the refusal. On Reject the decision becomes `rejected` with no grant (audit `decision_made`); the step or loop item that held ends `skipped` (`because: "rejected"`) with "You said no: <step title>. It was not done."; other loop items go on; a later step whose instructions, `when` or checks refer to the skipped outputs (found with the expression `references`, as `exec/outside.ts` does) is skipped (`needs_skipped_result`); no standing rule applies for the rest of the run, and the held call shows the normal decision card (section 15); the run returns to `running`. A rejection never stops a chain. A rejected result sign-off skips its step or item the same way. This path in `engine.ts` `beginDecide` follows the approved clickable prototype and gets one independent security review (AD-07).

### 6.6 Decisions wait for an answer

A run decision waits without a deadline, including an `ask` decision. Flow format 1.2 keeps `expires` and `on_expiry` on `ask` steps, because flows already carry them, but the runner ignores both: nothing ends without the person (owner decision, 2026-11-22). While it waits the run remains active and a later scheduled slot of the same flow is recorded as `skipped` with reason `still_running` for the busy flow. Stop, permission off or flow deletion ends the decision as `expired` (audit `decision_expired`); opening one shows "This decision expired" (PU-16). The spending pause (`budget_raise`) has no 24-hour expiry: it ends when the person raises the limit or the next local month begins, and the paused runs continue (`data-model.md` 3.15). Stop or permission off expires a run's pending decisions at once.

### 6.7 Audit records

A change and its audit row share one transaction. The kinds are those of `data-model.md` section 3.16; details hold ids, codes, hashes and short titles, never message text, payloads, prompts or secrets. Rule records (`rule_created`, `rule_used`) hold the rule id and the place kind, not the place value.

| Kind | Written when |
|---|---|
| `tool_calls`, `tool_denied`, `tool_unchecked`, `command_run`, `connector_call`, `page_read`, `page_withheld`, `call_held`, `grant_used`, `limits_not_applied` | The decided calls of each attempt (kept kinds): counts of allowed and refused calls, the first 50 denied calls, every command, connector call, page, hold and grant use |
| `rule_created`, `rule_revoked`, `rule_used` | Confirm or Always allow; Ask me again or a flow change; each call a rule allowed |
| `decision_made`, `decision_expired`, `decisions_batch` | Approve, Edit, Reject, Always allow, a choice; Stop, permission off, flow deletion; Approve all similar |
| `flow_saved`, `flow_changed`, `flow_confirmed`, `schedule_changed`, `start_requested` | Save flow; Save change; a confirmation; a schedule set or removed; every `START` request with its source and outcome, a missed or skipped slot included, with its reason |
| `permission_changed`, `setting_changed`, `limit_raised`, `agent_setup`, `agent_sign_in` | The agent permission; other settings; the spending limit; each set-up phase; Sign in |
| `chat_agent_changed`, `chat_turn_failed`, `question_asked`, `question_closed` | The picker; a failed or interrupted turn; a waiting question opened or closed |
| `run_stopped`, `run_resumed`, `run_interrupted`, `store_migrated` | Stop; Try again or Sign in and continue; recovery; the version 7 migration |

A chat turn itself is recorded on the person's message (`ChatTurn`, with `outsideInContext`) and in `usage_events`, not in the audit log.

### 6.8 Outside text

In runs, as built: a step that reads a page or calls a connector is `outside`; a step referring to an outside output takes outside text (`takesOutsideText`) and gets no commands unless it reads only approved `own_text`; outside values fill typed captures and pick among declared items, never adding requirements, addresses, tools, params or limits (R1). Previews say "Includes text from an email or web page" and reveal hidden characters. Remembered answers keep their outside mark (SR-5).

In chats (R15) a message is clean (typed text, clicks, FlowDriven's lines from clean data) or outside (pasted text, answers from outside outputs, skill text read for a draft, marketplace text, bot messages other than the paired person's typed commands, other AI tools, and any reply made while the context held outside text). `assistant/context.ts` wraps outside messages in marker lines with a random token and calls them data. The chat-context rule of SR-5: while the context window holds an outside message, no turn starts, schedules, stops, saves or changes anything; a run intent becomes "Run <name> now?" with "Run" and "Not now", and drafts carry the outside tag. The window clears when the message leaves the last 12 turns or 24,000 characters, or in a new chat.

## 7. Key sequences

### 7.1 First launch and Set up

1. Main starts the runner and opens `#/welcome`; the renderer checks `contractVersion` (a mismatch shows a screen with "Quit", PU-03); `settings.get` shows `agentPermission: "unset"`; `agents.list` runs each adapter's `detect` and `signInStatus`.
2. "Set up Claude Code": `agents.setUp {agentId: "claude-code"}` sets `agentPermission: "on"` (audit `permission_changed`); for an agent that is already ready it only gives the permission.
3. If `not_installed`: state `installing`; the runner runs the catalog's install command (an argument list, no shell, the minimal environment, a 10-minute limit; the package name is pinned in the catalog); no screen text or flow supplies a command. This is the only network action FlowDriven starts, and it runs only after the person chooses Set up (NF-18).
4. On success: `detect` again; the catalog's sign-in step opens the agent's own sign-in; state `waiting_login`.
5. `signInStatus` every 2 seconds up to 10 minutes: `ready`, or `needs_login` with "Sign in" on timeout; a failed install or a sign-in timeout gives one plain sentence and "Try again" (PU-01); an agent too old to run safely shows "Update <agent> to use it with FlowDriven." (PU-02). Each phase writes `agent_setup`.
6. "Start chatting": `settings.update {mainAgent}` with the default model, `chats.create`, `#/chat/<chatId>`.

### 7.2 One chat turn

1. Enter: `chats.send {chatId, text, pasted?}`. With the permission off it stores nothing (`not_allowed: permission_off`), the composer keeps the text, and the window shows "FlowDriven may not run your AI agents." (`chat.permissionOff`) with "Turn on permission" (PU-07). Otherwise it stores the message (outside when `pasted`) and returns at once; `chats` is emitted.
2. With the chat's agent not `ready`, an `agent_needed` card is posted and no turn runs; with an open form, "Please fill in the form above, then choose Start."
3. Otherwise the chat's queue takes the turn, one at a time; `assistant/context.ts` builds the context and its taint mark.
4. The keeper admits the call ahead of runs; the adapter's `chat` runs (Claude Code: `--tools ""`, `--json-schema`, the chat's `--model`, an empty folder, start proof).
5. `assistant/intents.ts` parses the answer; an invalid one is asked for once more, and a second failure posts a `turn_failed` card (audit `chat_turn_failed`) with "I did not understand that. Try again, or pick one of these." (PU-05).
6. FlowDriven checks the intent against its state and the direct-start conditions (AD-10).
7. `assistant/cards.ts` stores the reply and cards, or starts the run through `starts.request(flowId, "chat", {chatId, inputs})`; the chat's language follows a registered reply language; the turn is recorded on the message (`ChatTurn`) and in `usage_events`.

### 7.3 A held call answered with "Always allow"

1. Fill timesheet reaches "Create the timesheet entry"; its touch is `change` with a fixed place (the person's timesheet account), under "Asks you first".
2. The agent runs the command; `decide` finds no grant or rule: hold; the step stops with `StepResult.hold`.
3. The engine creates the decision (`risky_action`, `effect: "change"`, `approves = [tool#digest]`, the touch id, `fixedPlace: true`); the run is `waiting_approval`; the card shows in the chat and Activity, with "Always allow for this flow" because `canAlwaysAllow` is true; `approval_waiting` goes out if no window is focused.
4. "Always allow for this flow": `approvals.resolve {approvalId, decision: "always_allow"}`; one transaction writes `allowed_always`, the standing rule, a one-time grant, `decision_made` and `rule_created`; `notice_clear` closes the notification; the chat says "Okay. From now on Fill timesheet does this by itself. You can undo it on its page with Ask me again."
5. The step runs again; row 5 stores the grant's use, then allows the call once; the report says "You approved: Create the timesheet entry."
6. Next run: row 6 allows it (`rule_used`); the step shows "Allowed by your rule"; the report says "Done by your rule: Create the timesheet entry."

The same decision for a `send`, `post`, `pay`, `delete` or `merge` offers no "Always allow".

### 7.4 A chain, then "after another flow"

1. "Build the APK and upload it, then fill my timesheet": `run_chain`; missing timesheet inputs are asked in one message grouped by flow; then the `plan` card "I'll run these one after the other:" with "Start".
2. "Start" (`start`) records the chat's agent and model for every run of the plan and starts the first flow with source `chat`.
3. It ends `done`: "Build APK and upload it finished, so Fill timesheet is next."; the next flow goes through `START` with source `after` and the key `chain:<id>:1`.
4. Both done: "Both flows finished." and a `repeat_offer` card, "Do this every time?", with "Yes, every time" (`every_time`) and "Only this time" (`only_this_time`).
5. `every_time` sets Fill timesheet's schedule to `after` Build APK (`schedule_changed`).
6. Later, when Build APK ends `done`, the next tick calls `starts.request(timesheet, "after", {afterRunId})` with the key `after:<run id>`. A first flow that fails, sticks, stops or waits for sign-in starts nothing after it ("<flow> failed. <names> did not start.", PU-06; a stop reads "Stopped. <names> did not start.").

### 7.5 A scheduled start with a proactive question

1. Weekdays 17:00: the tick calls `starts.request(timesheet, "schedule", {slotAt})` with the key `slot:<time>`.
2. The flow is confirmed; `today` resolves at the slot; customer, project and activity are remembered; duration and "What you did" are missing.
3. `starts/proactive.ts` creates the flow's chat from FlowDriven (title: the flow name; the app language; the main agent and its default model), posts the generic lead line ("It's 17:00. Time for <flow>."), the question and the remembered values with the chips, and records the waiting question (`question_asked`); Activity counts it; `question_waiting` shows the fixed text "FlowDriven has a question for you".
4. "2 hours, built the login page": `fill_inputs`; the parsers accept it; the start goes on with the key `answer:<question id>` and the question closes (`question_closed`).
5. The entry asks first unless a rule covers it (7.3); the answer lines are posted in this chat.

### 7.6 Improving a flow and confirming again

1. "Improve with chat", "Also email me a summary": `improve_flow`.
2. FlowDriven builds the new version from confirmed hash H1 (files, touches, classes, hash H2); the `change` card shows "+ Email me a summary (asks you first before sending)".
3. "Save change" (`save_change`): the head must still be H1, else `conflict: card_stale`; H2 is stored and confirmed with the carried-over rules (`flow_changed`); "Saved. The change applies from the next run."; a queued run keeps H1.
4. A file edit or import makes H3 unconfirmed: "Changed: confirm again"; the next scheduled start gets `needs_confirmation`: a `confirm` card in FlowDriven's chat, a Needs-you item and `confirm_waiting`; "Confirm" (`confirm_flow`) confirms H3 and offers "Run it now?" (PU-25); the dialog of a changed flow lists what changed, including "The skill <name> changed" (PU-14).

### 7.7 A Codex run under each capability tier

At run start the registry compares each step's compiled policy with `capabilities().tier`:
- `enforced` (only if the research shows FlowDriven can answer Codex's approval requests): every command, file change and tool call goes through `decide`, holds included.
- `folder_limited`: every step must be local (reads and writes in the flow's folders, declared commands), on its own, and free of outside text. Codex runs `codex exec -s workspace-write` in the flow's folder with network off, the model flag, JSON events and the prompt on stdin; an undeclared command or a write outside the folders in the event stream stops the step, like the tripwire.
- `label_only`: nothing runs.

A step that does not fit is refused before any agent runs (`refused`, `agent_cannot_be_limited`) and nothing starts. The chat shows "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." (`chat.agentCannotRunFlow` with the param `agent`, PU-26). No card offers to run once with another agent: the `other_agent` card and `use_other_agent` are not in V1.

### 7.8 Stop

1. "Stop": `runs.stop {runId}`, no dialog.
2. The engine aborts the run's signal; the adapter sends SIGTERM to the group and SIGKILL after the grace time; pending decisions expire (`resolvedVia: "stop"`, `decision_expired`, `notice_clear`); step and run are `stopped`; audit `run_stopped`.
3. A chain stops there ("Stopped. <names> did not start."). Permission off does this for every run ("Stopped because you turned off permission.") and refuses every start.

### 7.9 Crash and recovery

1. The runner dies: `RunnerLink` rejects pending calls, emits an all-topics `changed` event and restarts it (at most 3 times in 60 s, then "The engine stopped and cannot be restarted. Restart FlowDriven.").
2. The new runner checks the data folder, takes the store lock and sweeps old control folders.
3. `engine.beginRecover()` marks open runs `interrupted` (`run_interrupted`). It resumes only those whose interrupted steps are all idempotent and none can send, post, pay, delete or merge; others show "Stopped unexpectedly" with "Try again", and a risky step adds "This step may have sent: <title>. Check before you choose Try again." (PU-22) `waiting_approval` runs keep their decisions.
4. Turns that were `queued` or `running` become `interrupted` with a `turn_failed` card and "Try again"; nothing runs by itself. Waiting questions stay; the `starts` keys stop a slot from starting twice; missed slots follow section 9.6.

### 7.10 Language switch

1. Settings, "Bahasa Indonesia": `settings.update {language: "id"}` (`setting_changed`).
2. The renderer sets `document.documentElement.lang` and draws FlowDriven's words, cards, chips, forms, dates, times, durations and numbers in Indonesian.
3. Messages keep their words; FlowDriven's posted lines keep their language; new chats are in Indonesian, main draws the next notifications in Indonesian from their fixed-text `Line` keys (no params), and the renderer builds "Copy report" in the app language.

### 7.11 Changing the agent and model in a chat

1. The picker opens from `agents.list` and `agents.models`; an agent that is not ready shows its next step ("Sign in to Codex"); Codex is listed for chats only if it has a tool-free mode.
2. "GPT-6.1 Sol": `chats.setAgent {chatId, agent: "codex", model}`; the runner checks the agent is `ready` and lists the model, stores the choice, posts the note "Now using Codex · GPT-6.1 Sol" (in the app language) and audits `chat_agent_changed`.
3. Later turns and runs from this chat use Codex with that model, passed with its model flag and no other flag; a run already going keeps its own.

## 8. Agents

### 8.1 The AgentAdapter port

```ts
type AgentState = "not_installed" | "installing" | "waiting_login" | "needs_login" | "ready" | "unknown";
type Tier = "enforced" | "folder_limited" | "label_only";
type ModelInfo = { id: string; name: string; note: string; isDefault: boolean };   // note: a words code
type SignIn = { state: "signed_in" | "signed_out" | "unknown"; billing: "per_use" | "plan" | "unknown" };
type AgentCapabilities = { tier: Tier; osSandbox: boolean; connectors: string[]; ownBrowser: boolean;
  toolFreeChat: boolean; usage: "cost" | "tokens" | "none" };
type CatalogEntry = { install: string[]; signIn: string[]; status: string[]; models: ModelInfo[] };
interface AgentAdapter {
  readonly id: string; readonly name: string; readonly maker: string;
  readonly catalog: CatalogEntry;                      // shipped with FlowDriven, never from a flow
  detect(signal: AbortSignal): Promise<{ found: boolean; version?: string; usable: boolean; reason?: string }>;
  signInStatus(signal: AbortSignal): Promise<SignIn>;
  setUp(step: "install" | "sign_in", signal: AbortSignal): Promise<{ ok: boolean; sentence?: string }>;
  models(): Promise<ModelInfo[]>;
  capabilities(): AgentCapabilities;
  runStep(req: StepRequest & { model: string }): Promise<StepResult>;
  chat(req: { model: string; prompt: string; schema: object; signal: AbortSignal }): Promise<ChatResult>;
  judge(req: JudgeRequest & { model: string }): Promise<JudgeResult>;
  replan?(req: ReplanRequest): Promise<{ instructions: string } | undefined>;
  probe?(req: ProbeRequest): Promise<ProbeResult>;
  stop(): void;
}
type ChatResult = { exit: ExitClass; value?: unknown; call?: CallInfo };   // value: the intent JSON
```

`StepRequest`, `StepResult`, `HeldCall`, `CallInfo` and `JudgeRequest` keep their `harness.ts` shapes; `effort` no longer picks the model. `agents/registry.ts` holds the adapters and the agent catalog (code, never read from a flow, a page or an agent's output; `data-model.md` 3.20), builds the agent cards, tracks set-up progress and picks the agent and model of each start (sections 8.6 and 9.1). An agent whose `capabilities().toolFreeChat` is false is not offered for chats. The package name of each install command is pinned in the catalog.

### 8.2 Claude Code adapter

Kept as built: `buildClaudeArgs`, the prompt on stdin, refused flags, the hook channel, start proof, tripwire, held calls, the connector scan, `claude auth status --json`, `rate_limit_event` and `result` usage. Changes:
- One model per run for `runStep`, `judge` and `replan`; `modelFor(effort)` and `settings.keeper.effortModels` remain only for housekeeping calls (the connector scan) and runs from before store version 7.
- `chat`: `--tools ""` with `--json-schema <intent schema>`, an empty folder, no MCP server, `--no-chrome`; the start proof expects exactly `StructuredOutput`.
- The start proof checks that `system/init` reports a model of the chosen alias (the catalog holds each alias's id prefix).
- An `auth` outcome makes the run `needs_login`, not `blocked`.
- The catalog adds install, sign-in and status commands, settled by a research task first (B-21.T4, a Chair step without network: the local `--help` and version output of the installed tools, recorded as a synthetic profile with hand-typed values); until then cases use an injected agent profile and assert the exact value the profile gives.

### 8.3 Codex adapter plan

Research task first (B-22.T1; Chair step, no network): read only the local `--help` and version output of the installed Codex command-line tool, never a web page, and write a synthetic agent profile with hand-typed values and hand-written fake scripts for the help and version, sign-in status both ways, a non-interactive JSON run (read, file change, command, refused command, failure, usage limit), a structured answer, and Stop; `test-helpers/fake-codex.ts` replays them. Nothing is recorded from a real agent (owner decision, 2026-11-21); a real run, if the owner watches one, stays in `.workflow/scratch/`, never in the repository, and a test scans fixtures and test helpers for absolute local paths, `@` addresses and long tokens. Expected, to confirm: `codex exec --json`, `-s read-only` or `-s workspace-write`, `-m <model>`, `-C <folder>`, the prompt on stdin, an output schema option, a sign-in status subcommand.

| Unknown | Decides | If no |
|---|---|---|
| Can FlowDriven answer each command, patch and tool approval before it runs? | Tier `enforced` | Tier `folder_limited` |
| Can a chat turn run with no tools? | Codex as a chat agent (AD-10, SR-5) | Codex is not offered for chats |
| Does `workspace-write` limit reads? | SR-1's read scope, and whether the declared-folders read limit holds for Codex | Folder-limited steps take no outside text (section 17); the limit is claimed for Claude Code only |
| Is network off and can a run turn it on? | Local steps stay local | `codex/args.ts` refuses every override that turns it on |
| Can the person's own MCP servers be off for one run without editing their config? | Only declared tools | Steps refuse to start while servers are configured |
| Model list, usage and cost events, process tree on stop, event names per version | Picker, keeper, SR-8, SR-9 | Catalog per CLI version; quota known only from errors |

### 8.4 Conformance suite

`agents/conformance.ts` is one Vitest suite every adapter runs against its fake CLI: no refused flag ever; two models change only the model flag; prompt on stdin; minimal environment; chat calls use no tool; a failed start proof blocks; an unchecked tool result trips; a held call returns `hold`; sign-in states map to agent states; limit and sign-in failures map to `quota` and `auth`; Stop ends the group within the grace time; output limits hold. A third adapter must pass it.

### 8.5 Models, the picker and sign-in

- `agents.models {agentId}` returns the agent's list: Claude Code's aliases from the catalog (Opus 5.5 `mostCapable`, Sonnet 5.5 `fastCapable` and default, Haiku 5.5 `fastest`); Codex's own list if the CLI gives one, else the catalog (GPT-6.1 Sol `allRound` and default, GPT-6.1 Terra `carefulCoding`, GPT-6 Luna `fastest`).
- The composer button shows agent and model ("Claude Code · Sonnet 5.5"). Status is always icon plus words, so a chat agent that is not ready also shows its status ("Needs sign-in"). On a phone it shows the model only. Its accessible name says agent, model and status. The menu has one group per agent with its status; ready agents list models as radio menu items with note and "Default" tag; others show their next step; the last item, "Manage AI agents", opens Settings. An agent in state `unknown` shows its status; there is no "Check again" in the picker (Scan again is in Settings). Arrow keys, Enter and Escape work as the prototype brief says ('The picker', under 'Choosing the AI agent and model in the chat').
- The choice is stored per chat; new chats start with `settings.mainAgent` and its default model, and so does a chat FlowDriven starts (the 17:00 question, an "after" question), so the picker always shows what a run will use; a vanished model falls back to the default with a note (PU-27); runs record and show their `agent` and `model`.
- The choice is passed with the agent's own model flag and no other flag; it never changes the sandbox, the tools or the approvals (SR-4).
- Sign-in: FlowDriven never sees a password or reads an agent's files; it asks the agent (`claude auth status --json`; Codex's status subcommand). `authMethod` also gives the billing kind. Checks run at launch, on "Scan again", during set up (every 2 seconds, up to 10 minutes) and in `checking` before a run. A run that meets a sign-out, or a site's sign-in or robot check, becomes `needs_login` with "Sign in and continue", waits up to 12 hours, then becomes `blocked` and shows as "Stuck" (PU-20); Try again that meets the same problem shows "Still stuck: <reason>." (PU-21).

### 8.6 Quota, the busy fallback and the spending limit

- Usage limits come from the agent (Claude Code `rate_limit_event`; Codex research): above the five-hour line one process at a time; above the seven-day line triggered runs wait and the person gets "Keep running triggered flows?" (`weekly_limit`); a rejection backs off 15, 30, 60 minutes; waiting runs show the reason (PU-08).
- Busy fallback: for a start from any source but `chat`, if `busyFallback` is on and the main agent is busy (the keeper would wait for its usage limit, or it was rate limited), the run uses the other agent with its default model, only if that agent is `ready` and can run every step (section 7.7). Decided once per run and recorded; never mid-run.
- Spending limit (Decided for V1, revisable, Q-03): counts only money charged per use. The month's spending is the sum of `cost_usd` of `usage_events` rows billed `per_use` or unknown (`data-model.md` 3.17); `plan` rows are bound by the agent's own limits. When it reaches `spendingLimit`, the runner writes the `spending-pause` setting and one `budget_raise` decision with no run, shown as one "Needs you" item (PU-08); runs whose next call bills per use or unknown wait, a chat turn on such an agent fails with `spending_limit`, and the pause ends when the person raises the limit in Settings (`limit_raised`) or the next local month begins; then the paused runs continue. A per-use call that reports no cost (Codex, until its research) is refused while a limit is set.

## 9. Starts

### 9.1 The start rule in code

```ts
type StartSource = "chat" | "flows" | "again" | "schedule" | "after" | "try_next" | "proactive" | "phone" | "tool";
type StartOutcome =                                   // runner-api.md section 3
  | { outcome: "started"; startId: StartId; runId: RunId; chatId?: ChatId }
  | { outcome: "asked"; startId: StartId; chatId: ChatId; questionId: QuestionId; reused: boolean }
  | { outcome: "needs_confirmation"; startId: StartId; chatId: ChatId; questionId: QuestionId; reused: boolean }
  | { outcome: "refused"; startId: StartId; reason: "permission_off" | "daily_limit" | "flow_deleted" | "agent_cannot_be_limited" };
function request(flowId: FlowId, source: StartSource, context: StartContext): StartOutcome;   // starts/start-rule.ts (new)
```

`starts.request` (the text of `START` is in section 3) writes one `starts` row in the same transaction as what it creates (`data-model.md` 3.7); a request with a key it has seen (`slot:<time>`, `after:<run id>`, `chain:<id>:<n>`, `answer:<question id>`) returns the first row and creates nothing. A `daily_limit` refusal shows the daily run limit line (PU-09). Its order:
1. Permission off: `refused` (`permission_off`), for every source, and no run is created. The window shows "FlowDriven may not run your AI agents." with "Turn on permission", which opens the same "Before you start" dialog as Settings (PU-07); a slot that cannot run is recorded `missed` with reason `permission_off` (SR-8).
2. No confirmation for the current hash: `needs_confirmation` with a `confirm` card (`START` step 1).
3. `fillInputs` with the source's rules (remembered answers for `whenItsTime: last`, never dates or times); missing or invalid required inputs: `asked` (step 2).
4. Agent and model: the chat's choice for starts in a chat (a plan records it at "Start"), else the main agent and its default model, or the busy fallback; the capability check of section 7.7 may give `refused` (`agent_cannot_be_limited`).
5. `started` (step 3): `engine.beginStart` with the inputs, source, agent, model and ids; remembered answers saved; audit `start_requested`.

| Source | Where the confirm card or question goes |
|---|---|
| `chat` (typed, a card click, a plan's first flow) | The same chat |
| `flows`, `again`, `try_next` | A FlowDriven chat the window opens |
| `schedule`, `proactive` | The flow's chat from FlowDriven, plus a Needs-you item and `question_waiting` or `confirm_waiting` |
| `after` (a chain's next flow, or "after another flow") | The chat of the run it follows, else the flow's chat from FlowDriven, plus a Needs-you item |
| `phone`, `tool` (V2) | The flow's chat from FlowDriven, plus a Needs-you item |

One open waiting item per flow (a question or a confirm card): another request reuses it (`reused: true`) and moves its chat to the top; a slot that finds it open is recorded `skipped` (`question_open`).

### 9.2 Schedules

| Person-facing schedule | Trigger (`catch_up: once`, `overlap: skip`) |
|---|---|
| `manual` ("Only when I start it") | None (no `schedules` row) |
| `daily`, `weekdays`, `weekly` | `schedule {at: time, days: every day, Monday to Friday, or the one day}` |
| `after` | `flow_done {flow: afterFlowId, status: done}` |

The active schedule is a `schedules` row (`data-model.md` 3.5): the person's state, set through `flows.setSchedule {flowId, hash, schedule}` on a confirmed flow, never changing its hash (`schedule_changed`). A flow file's `schedule` only fills the draft card; "Save flow" copies it once because the person saw it. The daily cap stays (`limits.max_runs_per_day`, default 24). Deleting a flow sets schedules that pointed to it to "Only when I start it". Schedule checks refuse a flow after itself, a loop and a missing flow (PU-10); a schedule typed in a chat becomes a "Set this schedule?" card, not a direct change (PU-13).

### 9.3 Proactive questions

A start from `schedule` or `after` that lacks required inputs, for a flow set to "Ask me in the chat", posts in a chat from FlowDriven, which gets the app language and the main agent with its default model: the lead line (words file, the chat's language), the flow's own questions and examples, "Like last time, I'll use ..." for remembered values, and the chips (example answer, "Use a form"). The waiting question keeps the slot, the values found and the pending start; Activity shows "<flow name> is waiting for your answer" with "Answer in chat"; one notification with fixed text goes out (none for an `after` start); it closes when the run starts, the person cancels, or the flow is deleted, and it never expires.

### 9.4 No first run when a schedule is turned on

Turning a schedule on never starts a run (owner decision, 2026-11-21). `flows.setSchedule {flowId, hash, schedule}` has no `firstRun`, `ScheduleView` has no first-run note, a `schedules` row has no first-run field, a run has no `firstScheduledRun`, and `schedule_changed.by` has no `first_run_blocked`. "Save flow" in the chat still offers "Run it now?" (FS-j22), and a new or changed flow started outside the chat gets the confirm card and then "Run it now?" (PU-25). A first run on schedule-on goes into the prototype first, later.

### 9.5 The app stays alive when its window closes

On macOS, closing the window does not quit FlowDriven (`apps/desktop/electron/main.ts`, as today), so the runner and the triggers keep ticking until the person quits; it does not wake a sleeping Mac. "Quit" stops schedules. V1 adds no menu-bar icon, no Open at login, no quit warning and no `starts.next`, and Settings has no Background section (owner decision, 2026-11-21); they go into the prototype first, later. A test pins that closing the last window does not quit the app.

### 9.6 Missed starts

After sleep or a closed app, the next tick looks back at most 7 days. The latest missed slot of each schedule runs once if it is under 2 hours old (the grace window); other missed slots are `starts` rows with outcome `missed` and a reason, and appear in the audit log. Activity's read model has only run rows in V1: no Missed, Skipped or Run late rows and no "Run it now" row; `flows.tryNextRun` takes `{flowId}` only. A slot key is claimed once, so a slot never runs twice.

## 10. Words and languages

```ts
export const en = { code: "en", name: "English", words: {
  common: { cancel: "Cancel" }, time: { today: "Today", hours: { one: "{n}h", other: "{n}h" } },
  flows: { run: "Run" } } } as const;                                   // en.ts, the source
export type Key = KeyPath<typeof en.words>;                             // "flows.run" | ...
export const id: PartialLanguage<typeof en.words> = { code: "id", name: "Bahasa Indonesia", words: {} };
export const LANGUAGES = [en, id];                                       // languages.ts, English first
export function t(key: Key, values?: Record<string, string | number>, lang?: string): string;
```

- Groups follow the prototype brief "English and Bahasa Indonesia" ("One file per language") (`common`, `time`, `status`, `banner`, `rail`, `search`, `welcome`, `settings`, `agents`, `chat`, `flows`, `schedule`, `activity`, `skills`, `memory`, `marketplace`, `phone`, `notify`); keys are short camelCase names. The files live in `apps/desktop/src/i18n/`: `en.ts`, `id.ts`, `languages.ts` (the one list), `t.ts`, `plural.ts` and `when.ts`. `t` looks in the chosen language, then English. `when.ts` renders dates, relative days, durations and clock times ("2h", "17:00"; "2 jam", "jam 17:00"); number values use `Intl.NumberFormat` ("1,240"; "1.240").
- A sentence is one key with placeholders, never glued from fragment keys. Chips act by code, so they work in any language.
- Data keeps codes and short forms: statuses, touch rules, result kinds, input defaults, schedules, model notes, report lines and posted lines (a `Line`: a key and values, with the language it was posted in), cards (AD-22); values such as `2h`, `17:00`, `2026-11-19`.
- No words in `packages/*`: the runner and contracts carry codes, `Line` values (a key and raw params; a moment is an `IsoDateTime` the renderer formats) and typed values. `packages/contracts/src/line-keys.ts` (new) lists every `Line` key the runner may emit, and `en.ts` must have each. A notice carries `title` and `body` as `Line` values with no params, plus the app language; main draws them. The notice keys are fixed text: `notice.decisionTitle` ("FlowDriven needs a decision") and `notice.decisionBody` ("Open FlowDriven to see what is waiting.") for `approval_waiting`; `notice.questionTitle` ("FlowDriven has a question for you") and `notice.questionBody` ("Open the chat to answer.") for `question_waiting` and `confirm_waiting`; `notice.problemTitle` ("A flow needs your attention") and `notice.problemBody` ("Open Activity to see what happened.") for `run_blocked`; `notice.limitTitle` ("FlowDriven paused a flow") and `notice.limitBody` ("Open Activity to see why.") for `weekly_limit`, `flood_cap` and `trigger_paused`. Over the tool server (V2) `approvals.list` gives flow id, step id and state only. Other new keys: `chat.permissionOff`, `chat.agentCannotRunFlow` (param `agent`), `flows.empty`, `chat.nothingWaiting`. Runner tests (L3) assert codes and params; renderer and main tests assert words. Main passes the registered codes at spawn (`--languages=en,id`); the runner refuses another code for the app language and ignores one for a chat. A chat result keeps the flow's answer lines with their `{inputId}` placeholders and the run's typed values, filled by the renderer in the run's language; "Copy report" is built by the renderer from `runs.export`'s structured parts.
- Which language: FlowDriven's words, cards (the inputs form and its example placeholders too), chips, notes, toasts, notifications and "Copy report" use the app language when shown; FlowDriven's posted lines use the chat's language; answer lines and resolved inputs use the run's language (the chat's at start); agent replies are the agent's own words.
- A new chat, and one FlowDriven starts, takes the app language; a turn's `lang` changes it only to a registered language; a chip never changes it. The agents' standing instruction: answer in the language the person writes in, else the app language.
- The language check is a Vitest test, `apps/desktop/src/i18n/i18n.test.ts`, run by `pnpm test` inside `pnpm check`; `tools/checks/` and its allowlist stay unchanged. Indonesian must be complete. For another language, missing keys are listed as "not translated yet, shown in English" without failing. It fails, with the file, the key and the fix in one line, on: a key used with `t` in `apps/desktop/src` or `apps/desktop/electron`, or listed in `line-keys.ts`, that English lacks, or an English key never used (keys built from codes come from an exported key list, for example `STATUS_KEYS`, that the scanner reads); an extra key; a placeholder mismatch; a missing `other` plural form; a plural form that is not one of the language's `Intl.PluralRules` categories; a code that is not a valid language tag; a code another file already uses; a file missing from `languages.ts`; markup, a web address or an unknown placeholder in a value; and, with an explicit allowlist, a forbidden word of the plain-words principle, a run id or a version number in an English or Indonesian value (`prd.md` NF-54, `test-cases/platform.md` TC-I18N-35). `other` is required and is the fallback. A test language added at test time with two words appears by its name and falls back to English.
- Safety words (decision, permission and confirm texts) need a second reader of that language before a translation merges. Translations need no Ask-first approval: the owner asked for English, Bahasa Indonesia and easy added languages. V2 bot messages need words outside the window; that is decided when V2 is planned. Indonesian follows the prototype brief "English and Bahasa Indonesia" ("Words", "Fixes after the independent review") ("Anda", "proses", "jam 17:00", "Menunggu Anda").

## 11. Appearance

- Light, Auto ("Matches your computer") and Dark; Auto by default.
- The renderer calls `window.setColorMode("light" | "system" | "dark")`; main sets `nativeTheme.themeSource` and writes `window.json` (`{version: 1, colorMode}` only), read at launch before the window exists, so the first paint is right; a missing or unreadable file gives `system`. The window background follows `nativeTheme.shouldUseDarkColors`.
- `tokens.css` holds the live current tokens, the dark set under `@media (prefers-color-scheme: dark)`; no `data-theme`; contrast 4.5:1 or more; reduced motion stops the animation.
- The color mode lives in main and is not a permission, so it is not in the runner's store or audit log.

## 12. Cross-cutting

### 12.1 Errors and failure handling

Contract errors are `not_found`, `invalid_input`, `not_allowed`, `unavailable` and, new, `conflict` (it changed since the caller looked), each with a reason code (`runner-api.md` section 11); `createDispatcher` validates input and output and audits any other error as `internal_error`. The person sees one plain sentence and one action, with no apology and no stack trace. Failure lines that are new are in the register (PU-01 to PU-29); their words are set in the flow specs and the language files.

| Failure | What happens |
|---|---|
| Agent missing, too old or unreadable | Agent `unknown` with the reason; starts get a fix card |
| Sign-out during a run, or a site's sign-in or robot check | `needs_login` up to 12 hours, then `blocked` shown as "Stuck" (PU-20); one notification with fixed text |
| Usage or spending limit | The run waits with the reason, or the spending pause (section 8.6) |
| Start proof fails | Step blocked with cause `limits_not_applied`, no retry |
| Hook gets no answer | Deny (fail closed) |
| Invalid chat answer twice; a card whose base changed | A `turn_failed` card; `conflict: card_stale`; nothing starts |
| Store write fails (a full disk) | `unavailable`, "Could not save. Free some space on the Mac and try again."; the run blocks after the attempt; in Settings "Could not save. Try again." (PU-29) |
| Runner or renderer crash | Section 7.9; main reloads the window (it holds only view state) |
| Start or chat message with the permission off | `refused` or `not_allowed: permission_off`; "FlowDriven may not run your AI agents." with "Turn on permission" (PU-07) |

### 12.2 Concurrency

- Only the runner writes the store, in transactions with savepoints.
- One open run per flow (`exec/chain.ts` `createChain`): a later start waits ("Waiting for the earlier run of this flow"); flows run in parallel.
- The keeper admits every agent call up to the ceiling: chat turns first, then runs the person started, then automatic runs.
- One chat turn at a time per chat; a message sent meanwhile is answered next with both in context.
- Resolving a decision checks `pending` in the transaction, so two answers count once (F-13.R14).
- `starts` keys claim a slot or request once; `overlap: skip` drops a slot while the flow runs; a reused `tool_use_id` is denied.

### 12.3 Performance budgets

| `prd.md` section 7 | How it is met |
|---|---|
| NF-01 first screen within 2 s | Local bundle over `app://`; the runner starts in parallel; only `runner.info` and `settings.get` come first |
| NF-02, NF-03 | The sent text shows as view state; `chats.send` and `flows.start` return at once |
| NF-04, NF-05 | `LIKE` on plain columns, at most 20 chats and 50 flows per search (`search.query`); titles-only chat list; paged "Earlier" |
| NF-06 decision within 2 s, notification within 5 s | Written when the held step stops; the notice goes in the same tick |
| NF-07 Stop within 2 s | SIGKILL after a 1-second grace (section 17) |
| NF-08 | 30-second tick |
| NF-41 to NF-44 | Keeper as built; idle work is only the tick and the 60-second sweep; 12 turns or 24,000 characters per turn |

### 12.4 Observability

- The audit log (section 6.7) is the record; the run page and report come from it; `audit.list` is app-only.
- The runner writes stderr only through one helper taking a fixed message and ids, never prompts, payloads, outside text, file contents or secrets; main prefixes `[runner]` as built.
- No telemetry (NF-18): FlowDriven sends nothing of its own; the only network action it starts is the agent's official installer, which Set up runs only after the person chooses Set up. Success measures are computed on the Mac; "Copy report" is the only export. A bug-report copy of versions and log lines is not in V1. The parts of "Copy report" and the run page's text are masked by the named pattern list of SR-6.

### 12.5 Configuration

| Setting | Lives in | Changed by |
|---|---|---|
| `language`, `agentPermission` (`unset`, `on`, `off`), `mainAgent {agent, model}`, `busyFallback` (off by default), `spendingLimit` | Runner store, `settings` (`data-model.md` 3.18); no `background` key in V1 | `settings.update` from the window, audited |
| `spending-pause`, `keeper`, `quota:<agent>`, `weekly:<agent>` | Runner store | The runner and the keeper; the person for the ceiling |
| Color mode | `window.json` in Electron's user data folder (main), `{version: 1, colorMode}` | `window.setColorMode` (`runner-api.md` 12.7) |
| A chat's `agent`, `model`, `language` | Runner store, `chats` | `chats.setAgent`; the turn's language |
| Confirmations, standing rules, schedules, remembered answers, waiting questions | Runner store | The person's actions (SR-2) |
| Inputs, result, touches, suggested schedule, steps, requirements | The flow's hashed files | Making or improving a flow, then confirming |
| Agent, effect and connector catalogs | The runner's code | FlowDriven releases only |
| `FLOWDRIVEN_DATA_DIR`, `FLOWDRIVEN_DEMO` | Environment | Developers and tests |

### 12.6 Testing seams

- `now()`, the zone (AD-23) and ids are injected through the shared test harness (B-00, `test-plan.md` section 4); date cases run in UTC and `Asia/Bangkok`.
- Agent paths (`claudePath`, `codexPath` (new)), `startChild`, `runCapture`, `caffeinate` and the probes are injected. Fakes: the fake claude (runs the real hook script), the fake codex (`test-helpers/fake-codex.ts` (new), replays hand-written scripts built from the synthetic agent profile), the fake brain (`test-helpers/fake-brain.ts` (new), a scripted `chat` returning intents); the scripted harness stays for engine tests.
- Real SQLite in a temporary data folder; a version-6 fixture for the migration; `renderApp` with `FixtureRunnerClient` (`story-v2/`) under happy-dom. Layers are in `test-plan.md`.

## 13. Migration from the current code

### 13.1 Kept

The engine and checks, the store, the Claude Code adapter with hook channel, start proof, tripwire and held calls, the router, granted folders, own text, the Gmail catalog, the skill reader, the keeper, triggers, notices, the wire, `RunnerLink`, the Electron security setup, the preload bridge, `IpcRunnerClient`, `useRunnerQuery`, the UI kit and `renderApp`.

### 13.2 Changed

| Area | Change |
|---|---|
| Contracts, SDK, store | Version 2; format 1.2 with touch checks; version 7 |
| `claude/decide.ts`, `claude/policy.ts` | Agent-neutral decision, compiled touches, books read per call |
| `engine.ts`, `exec/recovery.ts` | Reject skips, `stopped`, `needs_login`, one model per run, `beginStart` only from `starts/start-rule.ts`; risky steps never resume by themselves |
| `harness.ts`, `claude/adapter.ts`, `service/claude-harness.ts` | The port and `chat`; the gate moves to `agents/registry.ts`; `agentPermission` replaces per-agent consent |
| `triggers/service.ts`, `service/trigger-wiring.ts` | Fires through `starts.request`; reads `schedules`; zone injected |
| `notify/policy.ts`, `notifier.ts`, `report.ts`, `service/handlers.ts`, `service/args.ts` | Notices as `Line` values that main draws, `notice_clear`; report lines and export parts as codes; version 2 handlers; `--languages` |
| Renderer, Electron main | Rebuilt chat first; runner at launch, color mode, the `window` API |

### 13.3 Unrouted and frozen

Decided for V1 (revisable): nothing of the builder-first app is deleted in V1, and tests of the unrouted screens keep passing (AGENTS.md forbids skipping tests). A test of behaviour that V1 deliberately changes is moved to the new behaviour in the same task, with an equally strict assertion that cites the flow spec (`build-order.md` lists them). For retired screens the route stays parseable but unlinked (from B-16.T2; there are no redirects), and fixture operations stay until their tests are retired.

| What | V1 treatment |
|---|---|
| `screens/builder/`, `screens/inbox/`, `screens/runs/`, `screens/readiness/`, `screens/harnesses/` | Unrouted in B-16.T2 (the routes still parse, nothing links to them, no redirects); their code and tests stay in a frozen island: `packages/contracts/src/v1/` keeps a read-only copy of contract version 1 and `packages/fixtures/src/v1/` the version 1 sample and fixture client, used only by these screens and their tests |
| `flows.build`, `flows.update`, `flows.run {description}`, `flows.capabilities`, `flows.allowCapabilities`, `flows.withdrawCapabilities`, `harnesses.*`, `queue.*`, `usage.summary` | Retired entries in the operation table (`retired: true`, `mcp: "no"`, `phone: "no"`), marked by B-01. Each keeps working in the real runner until the step it leaves with (`runner-api.md`, section 7) and from then answers `unavailable` with reason `retired`, so once they have left no operation writes the frozen consent tables |
| `theme.ts` and the `data-theme` override; the effort-to-model choice for runs | No longer used by the new shell (B-20) or for runs (B-07); the code stays |

Removing the island is a later Ask-first item.

### 13.4 Compatibility

- Format 1.1 flows load. A version-6 capability consent becomes a `legacy` confirmation of that hash: no touches and no standing rules, covering the declared requirements as version 6 did, with every risky call held (`data-model.md` 3.2). The M1 flow package in `packages/fixtures/flows/` keeps its tests passing.
- Store version 6 is backed up, then migrated (`store_migrated`). A version-6 agent consent is not carried over: `agentPermission` starts `unset`, because one click covers every agent. Triggers, approvals, runs and the audit log stay; older runs show Claude Code without a model.
- The walk scripts follow the contract and stay Chair steps.

### 13.5 Ask-first items

None in V1: the translations come from the owner's request, the approval and sandbox changes follow the approved clickable prototype (each with one independent security review), and V1 adds no workspace package, font file, dependency, CI change or edit to `tools/checks/` or AGENTS.md. Behaviour the owner has not seen in the prototype is in the register of `prd.md` (PU-01 to PU-29) and goes into the prototype first. Signing, notarization, tags and releases are not Ask-first items an agent can lift: they are the owner's own steps (AGENTS.md). Later Ask-first items: removing the frozen island; the prototype's font files; AGENTS.md's "Design:" pointer and its sentence about the language files; moving the contributor guides' check into `tools/checks/`; packaging and the runner bundle with its root script (B-30). Later prototype-first items (decisions of 2026-11-21): the menu-bar icon, Open at login and the quit warning; a first run when a schedule is turned on; Duplicate; Missed, Skipped and Run late rows; one-time use of another agent; a bug-report copy; standing rules for send and post.

## 14. Build order overview

The task-by-task plan, with the tests that fail first for each task, is [build-order.md](build-order.md). Decided for V1 (revisable, Q-01): V1 is B-00 to B-24 plus B-31; V2 is B-25 to B-27; V3 is B-28 and B-29; B-30 comes before any public download. B-00 is the first V1 step: no other step starts before it. Every step's dependencies come first and no case's Given relies on a case of a later step. A step builds a PU behaviour only after the owner approved it in the prototype.

The Needs column gives the main dependencies; the full lists, per task, and the build order table are in `build-order.md` section 3.

| Step | What | Needs |
|---|---|---|
| B-00 | Shared test harness (Harness H, `test-plan.md` section 4): temporary data folder and store opener, injected clock with an IANA zone, counting ids, fake notice sink, call-recording seam, fake brain, injected agent profiles, fixture scan | - |
| B-01 | Contract version 2 | B-00 |
| B-02 | Flow format 1.2 | B-00 (the format code imports neither contract) |
| B-03 | Store version 7 and migration | B-01, B-02 |
| B-04 | Safety core: the one decision, places, Reject skips | B-02, B-03 |
| B-05 | Decisions and standing rules service | B-04 |
| B-06 | Words files in `apps/desktop/src/i18n/`, `line-keys.ts`, the language check | B-01 |
| B-07 | Agent registry, models, the model flag | B-01, B-03, B-21.T4 (the install and sign-in research, before Set up and sign-in) |
| B-08 | Assistant core: chat turns, intents, cards | B-06, B-07 |
| B-09 | Inputs | B-02, B-08 |
| B-10 | Runs from the chat (`starts.request` for source `chat`) | B-05, B-09 |
| B-11 | Results and decision lines | B-10 |
| B-12 | Start rule for every source, schedules, proactive questions | B-10 |
| B-13 | Make a flow, Save flow | B-04, B-08 |
| B-14 | Improve a flow | B-13 |
| B-15 | Flows from skills | B-13 |
| B-16 | Renderer shell; the old screens are unrouted in B-16.T2 | B-01, B-06 |
| B-17 | Chat screen and picker | B-08, B-16 |
| B-18 | Flows screen and flow page | B-12, B-16 |
| B-19 | Activity and run page | B-05, B-11, B-16 |
| B-20 | Settings, color mode | B-06, B-07, B-16 |
| B-21 | First launch and the pinned agent catalog; its research task B-21.T4 (Chair step, no network: the local `--help` and version output of the installed tools, recorded as a synthetic profile with hand-typed values) is done before B-07 | B-07, B-20 |
| B-22 | Codex adapter (a research task first, B-22.T1, Chair step without network; it reads only the local `--help` and version output of the installed tool and records a synthetic profile with hand-typed values; nothing is recorded from a real agent) | B-07 (T4 also B-10 and B-19.T2; T6 also B-21.T5; T7 also B-13, B-14, B-15; T1 none) |
| B-23 | Keep the app alive when the window closes (as today), missed starts at wake | B-12 |
| B-24 | Spending limit and busy fallback | B-07, B-12 |
| B-25, B-26, B-27 | Memory; Phone & bots and other AI tools; skill updates (V2) | V1 |
| B-28, B-29 | Marketplace; the FlowDriven gateway (V3) | V2 |
| B-30 | Packaging and the runner bundle; signing, notarization, tags and releases are owner steps (Ask first for the rest) | Before any public download |
| B-31 | Contributor guides (V1) | B-06 |

## 15. Decided for V1 (revisable)

Decisions built into V1 and revisable later. A PU id (the register in `prd.md`) marks a behaviour the person will see that the owner has not yet seen in the prototype.

### 15.1 From the threat model


| Decision | Where it is enforced | Threat |
|---|---|---|
| Pasted composer text is outside text: `chats.send {pasted}` marks the message, so its turn only posts cards | `assistant/context.ts`, `assistant/turn.ts` | T-03 |
| After a Reject, no standing rule applies for the rest of that run; every later `change`, `send`, `post`, `pay`, `delete` or `merge` asks, and the held call shows the normal decision card | `rules/decisions.ts` marks the run; `decide` row 6 | T-06 |
| A run started by another AI tool uses no standing rule (from B-26) | `starts.request` source `tool`; `decide` row 6 | T-16 |
| A step that can send, post, pay, delete or merge never resumes by itself after a crash, even when marked idempotent; the run page says "This step may have sent: <title>. Check before you choose Try again." (PU-22) | `exec/recovery.ts`, the run page | T-24 |
| A grant's use is stored before the hook gets its allow answer, so a crash cannot let the call run twice | `connectors/grants.ts`, `call_grants.usedAt` | T-24 |
| Standing rules exist only for `local_write`, `run_command` and `change`; "Always allow" only for a repeatable `change` at a fixed place; a risky kind always asks, and `flows.confirm` refuses it in `onItsOwn` (`not_allowed`, `always_asks`) | `rules/standing.ts`, `flows.confirm`, `proposeLists` | T-02, T-07, T-22 |
| A place with letters outside ASCII is also shown in ASCII, against look-alike places (PU-24) | Decision cards, the confirm dialog, the flow page | T-05 |
| A flow file can only lower caps: its run and item caps never raise the defaults | `engine.ts` `beginStart`, the trigger service | T-22 |
| The words check refuses markup, web addresses and unknown placeholders in values, and plain-words slips (NF-54); safety words need a second reader of that language | `apps/desktop/src/i18n/i18n.test.ts`, review | T-28 |
| The README safety note says what agents read goes to the companies that make them, what FlowDriven cannot catch and that commands use the person's rights; there is no such sentence on the welcome card, in the permission dialog or in the confirm dialog | `README.md` (B-31) | T-27 |
| Notices, the tool server (V2) and phone messages show fixed text only: never a decision title, flow name, payload or input value (PU-19) | `notify/policy.ts`, `notifier.ts` | T-05, T-17, T-27 |
| "Approve all similar" lists every item in full (every recipient, the subject and the whole text) before anything is approved; only `send` and `post`, one run (PU-18) | The batch dialog, `rules/decisions.ts` | T-05, T-25 |
| A remembered answer keeps an outside mark; "Use my last answers" is not offered when a needed value came from outside text, unless the person typed or confirmed it | `inputs/remember.ts` | T-03, T-07 |
| V1 masks secret-looking text by a named pattern list in "Copy report" parts and the run page's text; secrets in the person's own files may still appear on the run page and reach the model maker | `runs.export`, `results/report-lines.ts` | T-20 |

### 15.2 Owner decisions, 2026-11-21

| Decision | Where |
|---|---|
| The language files are approved by the owner's request for English, Bahasa Indonesia and easy added languages; they are not an Ask-first item | AD-14 |
| No new workspace package: the words live in `apps/desktop/src/i18n/`, checked by `apps/desktop/src/i18n/i18n.test.ts` in `pnpm test`; no words in `packages/*`, which carry codes, `Line` values and typed values; `line-keys.ts` lists the runner's keys; main draws notices and passes `--languages=en,id`; the renderer builds "Copy report" and fills chat results | AD-14, section 10 |
| No font files in V1: the system font stack; the prototype's font is a later Ask-first item | AD-16 |
| The builder-first screens are unrouted, not deleted; a frozen island keeps contract version 1 and its fixtures for them and their tests; retired operations are marked in the table by B-01 and answer `unavailable` with reason `retired` from the step each leaves with | AD-01, AD-03, section 13.3 |
| Packaging and the runner bundle stay out of V1 (B-30); V1 runs from a checkout | AD-20 |
| No CI change and no new dependency in V1 | Section 1.2 |
| Approval and sandbox changes (AD-06, AD-07, Reject skipping, the Codex sandbox) follow the approved clickable prototype; each task that makes one is a safety-core change with one independent security review before its pull request leaves draft | AD-06, AD-07, AD-09 |
| AGENTS.md is not edited in V1; its "Design:" pointer and a sentence about the language files are a later Ask-first change | AD-21 |
| "Always allow for this flow" exists exactly as in the prototype: only for a repeatable `change` at a fixed place; send, post, pay, delete and merge always ask and cannot be under "Does on its own" (`always_asks`) | SR-1, AD-07, section 6.4 |
| A start with the permission off is refused with "Turn on permission"; no run is created; a run going when it is turned off becomes `stopped` | Sections 7.2, 9.1 |
| No menu-bar icon, no Open at login, no first run on schedule-on, no Duplicate, no Missed, Skipped or Run late rows, no one-time use of another agent: all go into the prototype first, later | AD-02, sections 9.4 to 9.6 |
| The runner never builds sentences; notices are fixed text with no params | AD-14, section 10 |
| Research first (B-21.T4, B-22.T1) from the local `--help` and version output of the installed tools, no network; fixtures and fake scripts are synthetic and hand-written, never a real recording; Codex is not offered for chats without a tool-free mode | AD-09, section 8.3 |
| The shared test harness is the first V1 step (B-00) | Section 14 |
| Signing, notarization, tags and releases are the owner's own steps; agents prepare configuration with no secret | AD-20 |
| The review gates read AGENTS.md broadly (`threat-model.md` sections 8 and 11) | `threat-model.md` |
| Decisions are called the owner's; the prototype brief is cited by title only | All documents |

## 16. Open technical questions

Each is settled by a spike before the step that needs it; a spike with a real agent is a Chair step.

1. Claude Code's own sandbox (B-04): which `--settings` key turns on its OS sandbox for `Bash` under `--restricted`; whether it limits writes to declared folders and network to named hosts; which event proves it for the start proof; how it treats `dangerouslyDisableSandbox`.
2. Codex (B-22): the unknowns of section 8.3, including whether `workspace-write` limits reads (Codex's read scope).
3. `node:sqlite` in Electron 45's Node (B-03): a backup call, JSON functions, full-text search, `secure_delete`, rollback of `user_version` on a failed migration.
4. The runner bundle (B-30): one JavaScript file built with allowlisted tools, how `runnerEntry` finds it, the `runAsNode` fuse or a shipped Node.
5. Removed from V1 with Open at login and the menu bar (owner decision, 2026-11-21); it returns with them, prototype first.
6. The catalogs' install and sign-in commands and package names (the research task B-21.T4 for both agents; B-22.T1 for the rest of Codex), read first from the local `--help` and version output of the installed tools, and whether sign-in needs a Terminal window.
7. The model id prefix each Claude Code alias reports in `system/init`.

## 17. Drafter's calls

- Added AD-21 (contributor guides), AD-22 (cards and chips as data, per the prototype brief "English and Bahasa Indonesia", "Fixes after the independent review" and "Fixes after the re-check") and AD-23 (time and zone).
- AD-09 flaw: Codex's `workspace-write` is expected to allow reads outside the flow's folders, so the folder-limited tier cannot keep SR-1's read scope. Fix: on that tier Codex runs only steps that take no outside text; the research and spike 2 check for a read limit, and the declared-folders read limit is claimed for Claude Code only.
- AD-10 flaw: Codex may have no tool-free mode for chat turns. Fix: Codex answers chats only if the research finds one; otherwise it is not offered for chats.
- AD-02: V1 adds no menu-bar icon and no Open at login; the app keeps today's macOS behaviour of staying alive when its window closes. This removes the old flaw that Open at login cannot work from a checkout.
- Added `rules/effects.ts` to the design's module map for the effect catalog, and a `covers` field on touches so each declared tool or command maps to exactly one touch. `data-model.md` 3.1 carries it.
- Starter chips act by code like every other chip (the prototype brief "English and Bahasa Indonesia", "Fixes after the re-check"): `chats.send {chatId, starter}` (`runner-api.md` 8.3).
- The contributor guides' script names and links are checked by `checkDocs(root)` in `apps/desktop/src/docs-check.ts` and the Vitest test `apps/desktop/src/docs.test.ts` (both new, owned by the first B-31 task), because `tools/checks/` stays unchanged in V1 and a TypeScript test never imports its `.mjs` scripts; moving that check into `tools/checks/` is a later Ask-first change.
- "Copy report" is drawn by the renderer in the app language (the prototype brief "English and Bahasa Indonesia", "The chat") from structured parts, so `runs.export` in `runner-api.md` 6.7 returns parts, not Markdown in the run's language.
- One `starts.request` serves typed chat starts too; a chain's next flow uses source `after` with the key `chain:<id>:<n>` and the plan's agent and model (`runner-api.md` 8.2).
- A place becomes the person's when they confirm the version that names it; run data never does. This enforces SR-5's rule on rule places while a flow drafted from a skill can still get "Always allow".
- A tool whose place FlowDriven cannot read always asks. Risky kinds always ask in V1 and no standing rule exists for them, so no stricter per-kind rule is needed (owner decision, 2026-11-21).
- Reject skips the step or item that held and the later steps that need its outputs; the agent is not asked to work around it; drafts keep each "Asks you first" action in its own step. 
- Every non-read touch left under "Does on its own" gets a rule at confirmation, local writes and commands included, so each has "Ask me again"; decision row 4 applies those rules to folders and command patterns and counts the calls rather than writing `rule_used` for each.
- Moving touches between lists in the confirm dialog is not in V1; V1 uses the default lists and "Always allow" for a repeatable `change`.
- Stop uses a 1-second grace before SIGKILL (today 2 seconds) to meet NF-07 and M-10.
- The color mode follows `runner-api.md` 12.7 and `data-model.md` 3.19: `window.json` in Electron's user data folder holds `{version: 1, colorMode}`.
- The desktop window's minimum size is 480 by 600 (down from 1100 by 720); the narrow layout (drawer) applies below 768 px; widths from 320 to 479 px apply only to the browser preview and to layout tests.
- The port and conformance suite stay in the AGPL runner in V1 (runner types); an MIT adapter kit (spec 22.4, NF-45) is a later Ask-first split.
- Missed starts: a 2-hour grace and a 7-day look-back (FS-j21); a missed slot is a `starts` row, not an Activity row. A per-use call that reports no cost is refused while a spending limit is set (SR-9). Bots and the gateway run inside the runner. Contract version 2 has 45 live operations plus 12 retired entries; notices are fixed text with no params.
