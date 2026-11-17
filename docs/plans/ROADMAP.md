# FlowDriven phase-1 roadmap

Spec: `docs/superpowers/specs/2026-11-10-flow-maker-design.md` (section 17 sets the phases and the build order).
Rule for every plan: it ends in something the owner can see or run. Plan 01 is detailed; every later plan is an **outline, detailed just in time**, written after the plan before it is done, so it can use what that plan taught.

## Order changed on 2026-11-11: the engine first

The owner set a new priority: build the engine that runs flows, with triggers, web access and computer access, through a harness or through the app itself (spec section 20). The first engine milestone, M1: the job-alert review flow runs end to end from the app on the owner's Mac, with Claude Code as the only harness, and nothing is sent. The order of the plans after 01 becomes:

| Plan | Content | Shows working |
|---|---|---|
| 02 | The SDK with format 1.1 (spec 20.4), the SQLite store, and the interpreter with `for_each`, `when`, `ask`, limits and the seen store, against a scripted fake harness, all as libraries (detailed: `2026-11-11-02-flow-format-and-engine-core.md`) | One command runs a sample looped flow with a condition and a choice twice and writes two run reports; the second run skips the items it has seen |
| 02b | The runner process, a link over its standard input and output, the contract for format 1.1, and the app reading the runner instead of sample data (detailed: `2026-11-11-02b-runner-process-and-app.md`) | The sample flow runs from the app; the pick appears in the Inbox |
| 03 | The Claude Code adapter only (detailed: `2026-11-11-03-claude-code-adapter.md`): detection and inventory, consent, the scoped call with the pre-tool hook answered through a file channel, the start proof and the tripwire, a fake `claude`, and blocked calls in the run | A real Claude Code step runs from the app on the owner's plan; an undeclared tool is denied and the Run screen shows it; stopping the runner blocks the call |
| 04 | The local socket (mode 0600) and the launch agent, so a runner that the app did not start can run, then the trigger service (`schedule`, `flow_done`, `file_change`), the limit keeper and notifications | The hourly trigger fires while the window is closed; a flood is capped |
| 05 | The capability router, web access through the user's own browser, skill calls, native connectors, readiness for these, and the install-preview rows | M1 on real data: attended first, then on the schedule |
| 06 | The agent core and the chat builder (was 03), one-time flows | The job-alert flow rebuilt by chat matches the hand-written one |
| 07 onward | The Codex and Antigravity adapters (the rest of the old 04), the gateway and the managed browser (the old 05), Documents and reports (the old 06), then the old 07 to 11 | As outlined below |

In plan 02b the app starts the runner as its child and talks to it over the runner's standard input and output, so only the app can reach it and no other process of the user can approve anything; the socket and the launch agent are needed only once a runner exists that the app did not start, which is plan 04.

The outlines below were written before this change. Until each is re-outlined just in time, this section wins where they differ. Plan 01b (the simple look, spec section 5) is applied alongside and does not change this order.

## Order changed again on 2026-11-11: efficiency, and the agent's memory and skills

The owner decided that the engine stays TypeScript and that its effort goes into efficiency and token saving without lower quality, and asked for good memory and skill management for the one agent. Spec section 21 says how; the owner approved it on 2026-11-11. It adds three plans and changes three. Where this section and the table above differ, this section wins.

| Plan | Content | Shows working |
|---|---|---|
| 03b (new, before 04) | Usage, the keeper and the queue (spec 21.2 to 21.4; detailed: `2026-11-11-03b-usage-keeper-queue.md`): token accounting from Claude Code's result event and its full rate-limit event (the fake `claude` learns both), `usage_events`, usage in the run report and on the run screen; the keeper's memory gate, quota gate and ceiling with their probes, waiting reasons and the queue on the Runs screen; the effort-to-model table for Claude Code; R19 | Two runs started together with the ceiling set to 1: one runs, the other waits and says why; the run report shows tokens per step |
| 04 | As above. Of the limit keeper it keeps overlap, per-day caps and floods (R7), inside the keeper that 03b built; triggered runs enter the keeper's third class | As above |
| 05 | As above, and: the skill copy drops front matter (R14); the install preview shows the cost of what a step loads | As above |
| 06 | As above, with the `projects`, `threads` and `messages` tables. Memory moves out to 06b | As above |
| 06b (new, after 06) | The agent's memory (spec 21.5, 21.7): `memory_items`, the search index over items and names, the always-loaded index and the "now" block, recall, proposals with Keep and Drop, correcting and deleting, grants, the Memory screen; R14 for memory, R15, R17, R18, R20 | In a new chat the agent uses a decision from an earlier one without being told again; a lesson that came from a job post waits as a proposal marked as outside text; the Memory screen shows the always-loaded text and its meter |
| 06c (new, after 06b) | History search and the skill library (spec 21.5, 21.6): chat turns and run reports join the search, for the agent and the owner; the library, `skill_ops`, proposals and approvals, R16, the Skills screen | Search finds an old chat turn and an old run report; a skill patch shows as a diff, approving it re-pins the flows that use it, and editing the skill's file by hand blocks them until re-consent |

The release path (the old plan 11) compiles TypeScript before packaging (spec 21.3). Putting several items of a `for_each` into one call is not scheduled until the numbers of plan 03b say it pays (spec 21.3). Plan 03b moves M1 back by one plan. Sizes are the chair's estimates: 14 to 18 tasks for 03b, 12 to 16 each for 06b and 06c.

## Order changed on 2026-11-12: plan 04 split

Chair's call (owner may override). Plan 04 is split in two so that the part the owner asked for ("the hourly trigger fires while the window is closed; a flood is capped") is built and shown first, and the part that needs an owner decision waits. Where this section and the earlier ones differ, this section wins. Plan 04 is detailed in `2026-11-12-04-triggers-limits-notifications.md`. The heading `### 04 Harness detection, adapters and the fake-harness kit` below is superseded by the table here: plan 04 is now the triggers, limits and notifications plan, and the adapters named there were plan 03 and come again from plan 07.

| Plan | Content | Shows working |
|---|---|---|
| 04 | The trigger service inside the runner for `schedule`, `flow_done` and `file_change` (spec 20.3): off until the owner enables each one, bound to the flow's content hash, `catch_up`, `overlap`, duplicate keys, the per-day cap and floods (R7), R4 again at enable and at run start; triggered runs enter the keeper's third class; a trigger that starts three blocked runs in a row is paused; notifications (spec 10.6, including the weekly-limit item of 21.2) through a runner notice and a macOS notification; the trigger switches on the flow's screen; the runner stays the app's child | The hourly trigger fires while the window is closed (the app stays open on macOS); a flood is capped at the daily limit with one notification |
| 04b (new, after 04) | The local socket (mode 0600), the launch agent, and the hook channel moving to the socket, so a runner that the app did not start can run | A runner that the app did not start fires the hourly trigger after the app is quit; the hook answers over the socket |

Why the split, from the 04 ledger:
1. Triggers do not depend on the socket. On macOS the app stays alive when its window closes (`apps/desktop/electron/main.ts:50`), so the runner child keeps running and the row "the hourly trigger fires while the window is closed" holds without a socket.
2. A socket raises a security question that spec 15.2 item 10 leaves open: any other process of the same user, including a harness the runner starts, could connect to a 0600 socket and call `approvals.resolve`. That needs the owner's decision before the socket exists.
3. A launch agent is a permanent change on the owner's Mac and needs the owner's yes.

Out of scope for 04 and not scheduled: `new_item`, `link` and `webhook` triggers, a tray icon, extra-folder grants for `file_change` (spec 9.4), R1 taint marks, and `LoopStep.parallel`. The coverage table above keeps its old rows: its row "Notifications" now reads plan 04, and "Schedules" moves from plan 05 to plan 04.

## Order changed on 2026-11-12: plan 05 before 04b, and plan 05 split

Chair's call (owner may override). Row 05 of spec 20.8 is too large for one plan, and nothing in it needs the socket or the launch agent (schedules already fire while the app is open), while 04b waits for two owner decisions that are still open (who may approve over the socket; the permanent launch agent). So plan 05 runs before 04b, and it is cut in three. Plan 05 is detailed in `2026-11-12-05-capability-router-and-own-browser.md`. Where this section and the earlier ones differ, this section wins: the row 05 of the two tables of 2026-11-11 and the heading `### 05 Readiness engine, gateway, approvals enforcement, notifications` below are superseded by the table here.

| Plan | Content | Shows working |
|---|---|---|
| 05 | Capability router; `web` with `mode: read` and `session: own` through Claude in Chrome inside Claude Code; URL templates; page rates; the post-tool check that withholds moved pages and challenges; the outside-text mark; capability consent and the "What this flow may touch" preview; readiness for this route | A real page is read through the owner's Chrome from the app; a click, an off-pattern address and the page over the cap are refused and shown |
| 05b (new) | Native connectors (`mcp_server` with `connect: native`: Gmail, the prototype host) in a scoped call; R10 wired into the hook (a pick releases only the named tools); holding a risky call for the owner | A real Gmail alert list is read through the connector; a publish for an unpicked item is held |
| 05c (new) | Skill calls (`do: skill`): the copy without front matter (R14), the hash at consent (R9), long steps, `cli_tool`, extra-folder grants (spec 9.4); then M1 end to end | M1 on real data, attended first, then on the schedule |
| 04b | As in the section "Order changed on 2026-11-12: plan 04 split". It waits for the owner's answer on the socket and the launch agent | As before |

Rules of spec 20.7 proved in plan 05: R1 (the mark and the denial test), R2, R3, R5, R6, R11 and the provider half of R4. Plan 05b adds R10; plan 05c adds R9 and R14. Out of scope for 05 and written into it: `web` with `session: none` or `managed`; `mode: act`; `desktop`; the `mcp_server`, `plugin`, `cli_tool`, `skill`, `account`, `gui_app` and `browser_session` providers; holding a call for the owner; extra-folder grants; the `new_item`, `link` and `webhook` triggers; the socket; other harnesses; real Upwork pages (the chair tests those later with the owner watching, at most 2).

## Plan 05b detailed on 2026-11-12

Chair's call (owner may override). Plan 05b is detailed in `2026-11-12-05b-native-connector-and-held-calls.md`, and it is cut smaller than the row above says. It covers one connector only: the Gmail connector of Claude Code (`mcp_server` with `ref: connector:gmail` and `connect: native`), with its six read tools running and its seven send and delete tools held until the owner approves them in the Inbox. A pick in an `ask` (`ask.approves`) releases only the named tools, for the picked items, in that run (R10). The prototype host, every other connector, plain writes (draft and label tools), `connect: gateway`, waiting inside the hook, editing a held payload and "approve all similar" move to plan 05c or later. The plan also closes two leftovers of plan 05: the worker may close its own tab before a withheld page stops the step, and the outside mark follows text built from outside text (loop item values, check patterns, the trigger payload, connector results, and the Inbox card of an ask or a held call). It needs three "Ask first" yeses from the owner before it is built: the approvals code, the sandbox limits, and the owner's Gmail in two tests.

## Plan 05c detailed on 2026-11-17

Chair's call (owner may override). Plan 05c is detailed in `2026-11-17-05c-skill-calls-and-m1.md`. It covers skill calls (`do: skill`) with a copy that drops the front matter (R14) and a hash pinned when the owner allows the flow (R9); long steps (no second try after a limit over 30 minutes, and the Mac stays awake meanwhile); command-line tools through the FlowDriven hook, never in a step that reads outside text; folders outside the project that the owner grants at the allow (spec 9.4); Gmail's draft and label tools as their own class, with a label move to Trash or Spam held as a delete (the owner's answer of 2026-11-13); the pick keys of a loop over a choice that declares no `key`; the prototype host connector; and then M1 on real data, attended first and then on the schedule. On 2026-11-17 the owner said yes to the runner, approvals, sandbox, hashing and test items of its "Ask first" block and to four probes with the owner watching, and, after correcting a mispressed answer, yes to the attended M1 run on real data and to its schedule. The probes showed that the owner's prototype skill runs commands while it reads the job's text, which the plan keeps out of such a step, so the M1 tasks (20 and 22 to 25) wait for a safe way to run those commands and for the owner's decision; Tasks 1 to 19 and 21 are built first. Left for later and written into it: a call grant bound to the held step, input defaults for manual runs, an enforced attended first run, a stall check for long steps, and an OS sandbox for commands (research).

Built on 2026-11-17: Tasks 1 to 19 and 21 of plan 05c, and Task 0 except the probe H1. Five fixes to the command and folder rules came from a security review by a fresh opus reviewer and the checks after it, and the owner said yes to each. The plan's closing gate, one full `pnpm check`, was green end to end on 15778d4. The prototype host (Task 20) and M1 (Tasks 22 to 25) move to a later plan, and they wait for two things:
- the owner reconnects the host connector in claude.ai (H1);
- the owner's chosen way to run the skill's commands safely is built (O5). The owner approves a short build plan, written without commands, and the step that runs the commands then works from that plan only.

## Order changed on 2026-11-17: everyday users, chat from a phone, two agents

The owner decided the points of spec section 22 on 2026-11-17: people who do not write code are users of the first release; with no AI agent installed, the app offers Install buttons; flows run by chat from the app, from other agents through MCP-server mode, and from a phone through Telegram and Discord bots; the first release ships the Claude Code and Codex adapters with an adapter kit; the phone app, Windows and further adapters follow the first release. Where this section and the earlier ones differ, this section wins. Order is a position, not a plan number: plans without a number get one when they are detailed, and their names here are working titles. Chair's calls (owner may override): the place of rows 2, 6 and 8, and the details in rows 5, 7 and 8 (the 10-minute rule, summaries only for `sensitive` runs, the capability tiers, the layperson test); spec 22.6 marks which is which.

| Order | Plan | Content | Shows working |
|---|---|---|---|
| 1 | 05c | As in the section "Order changed on 2026-11-12: plan 05 before 04b, and plan 05 split" | M1 on real data, attended first, then on the schedule |
| 2 | 04b | As before, once the owner answers its two questions. Rows 3 and 4 may run before it; it must come before row 5 | As before |
| 3 | 06 | As in the section "Order changed again on 2026-11-11" | As before |
| 4 | 06b | As before | As before |
| 5 | MCP and bots (new) | MCP-server mode (spec 8.7, 20.6 way 2, 20.9 D1) and the Telegram and Discord bots (spec 22.3): pairing, the 10-minute rule, phone approvals with a second tap, summaries only for `sensitive` runs | A flow starts from a Claude Code session and from a Telegram message on the owner's phone; a held send is approved on the phone; a message from another account is dropped |
| 6 | 06c | As before | As before |
| 7 | Codex and the adapter kit (new) | The Codex adapter as brain and worker, and the kit of spec 22.4: one interface, a fake agent, the conformance suite, a template, a guide, capability tiers, usage reports | A Codex step runs from the app; the Claude Code and Codex adapters both pass the conformance suite |
| 8 | Getting an agent (new) | The first-run path and Install buttons for Claude Code and Codex through the vendors' installers, everyday words on screen (spec 22.1, 22.2) | On a Mac with no AI agent, the app installs one and runs a first flow made by chat; the layperson test runs once with the owner watching |
| 9 onward | The rest of phase 1 | The gateway and the managed browser, Documents and reports, the other example flows (old 07 to 09), the GitHub half of stage (0) (old 10), the release path and the exit test (old 11) | As outlined below |

Until the coverage table below is rewritten: its row "Adapters for Codex, Claude Code and Antigravity" reads Claude Code (03) and Codex (order 7 above), and Antigravity, OpenCode, Hermes and OpenClaw move after the first release. It gains three rows: MCP-server mode and the bots (order 5), the adapter kit (order 7), and the first-run path with Install buttons (order 8). The exit test (old 11) gains the layperson test of spec 22.1.

## Plans

### 01 Foundation and screens on sample data (detailed: `2026-11-10-01-foundation-and-screens.md`)
- Goal: the app opens and shows every phase-1 screen on sample data, in a repository that already enforces the local half of the agent rules.
- Owner sees: the Builder, Inbox, Runs, Readiness, Harnesses and Settings screens in a browser and in the Electron window, light and dark, plus 16 screenshots (eight screens, two themes) to correct the design.
- Spec: 8.2, 8.7 (contract v0), 9, 10.1 to 10.4, 10.7, 11.1, 11.2, 11.5, 12.2, 12.3, 13.1 to 13.5, 16 (as sample data), 17.4 to 17.6 (local half), 18.4.
- Depends on: the owner approving the starting dependency allowlist.

### 01b The simple look (detailed: `2026-11-11-01b-simple-look.md`)
- Goal: every screen of plan 01 gets the approved simple look: a sidebar with the flows, the conversation in the centre, the work pane on the right, hairlines, an ink primary button, the system font, a light and a dark theme. "New flow" is the only new behaviour.
- Owner sees: the 16 screenshots again in the new look, and the app in its window.
- Spec: 5 and 18.4 (the look), 8.2, 12, 13.2, 13.3.
- Depends on: 01. Changes no contract and not the plan order (see "Order changed").

### 02 Flow format SDK, storage and runner core (outline, detailed just in time)
- Goal: a real background runner that stores flows and runs, executes steps against a fake harness and grades them with real checks, and the app reading it instead of sample data.
- Owner sees: a sample flow run end to end in the app against the fake harness, with real check results, history and a Markdown run export (spec 13.4; plan 01 has the flow, project and state filters).
- Spec: 9 (MIT SDK: parser, validator, hasher, packer; content hash 9.6), 8.3 (runner process, local socket, JSON-RPC, launch agent), 8.4 (SQLite through Node's built-in `node:sqlite`, if it proves stable enough), 8.7 (contract over the socket), 10.2 (edits validated by the SDK, in-place editing), 13.1, 13.2, 13.4, 13.5 (resume after a crash).
- Depends on: 01 (contracts, `RunnerClient`, screens).

### 03 Agent core and brain providers (outline, detailed just in time)
- Goal: the one agent: clarifying chat to a flow, one-time flows from chat, memory and the API-key budget, with one real API-key brain and a fake brain for tests.
- Owner sees: with the scripted fake brain, describing work in chat produces a flow in the step list; a one-off request runs as a one-time flow and offers "Save this as a flow?"; the budget stops spending at the cap. The only real brain in this plan is an API key, which stays off at a budget of 0 (spec 10.4), so the first real brain the owner sees is the official Codex adapter of plan 04.
- Spec: 10.1 to 10.7, 13.7, 3.3 (anti-goals 1 to 4), `BrainProvider` (10.3).
- Depends on: 02.

### 04 Harness detection, adapters and the fake-harness kit (outline, detailed just in time)
- Goal: detect installed harnesses and their inventory, and run Codex, Claude Code and Antigravity as brain and worker through per-run scoped configs.
- Owner sees: the Harnesses screen showing the owner's real harnesses, consent screens, and a step done by real Codex.
- Spec: 6.1, 10.3 (harness backends and fallback), 11.1 to 11.6, 11.7 (scoped config), 17.1 (fake harness CLIs), 18.3 (scoped-config research, needed before stage a ends).
- Depends on: 02; 03 for brain fallback.

### 05 Readiness engine, gateway, approvals enforcement, notifications (outline, detailed just in time)

*Superseded on 2026-11-12 by the section "Order changed on 2026-11-12: plan 05 before 04b, and plan 05 split".*
- Goal: requirement checks with fixes from a signed catalog, the MCP gateway that holds risky calls, approval hooks that fail closed, macOS notifications, schedules and Keychain secrets.
- Owner sees: a live checklist with "Install for me", a risky send held in the Inbox, a notification only when a decision is needed.
- Spec: 8.5, 10.6, 11.7, 12 (all), 13.3, 13.6, 15.2, audit log (8.4).
- Depends on: 02, 04.

### 06 First flow end to end: Documents and reports, and the stage (a) check (outline, detailed just in time)
- Goal: ship the Documents and reports flow on the real engine and pass stage (a).
- Owner sees: three real runs on the owner's own files with every step check passing, and one-time flows from chat (the ten-run count of the exit test starts here).
- Spec: 16.2, requirement catalog first entries (18.4), 17 stage (a).
- Depends on: 02 to 05.

### 07 Stage (b): Figma to Flutter (outline, detailed just in time)
- Goal: the Figma flow through a catalogued harness's native connector, in a git worktree.
- Owner sees: Flutter screens on a `flowdriven/...` branch from a real Figma file, analyze and tests passing.
- Spec: 16.1, 9.8, 6.2 (Figma), 11.4 (worktrees), 11.7 (native route).
- Depends on: 06.

### 08 Stage (c): Gmail and spreadsheets, Email triage, Lead follow-up (outline, detailed just in time)
- Goal: mail and sheet routes per phase-1 harness, then both flows with drafts by default and sends held for approval.
- Owner sees: drafts in the mailbox, sends approved one by one or as a batch, leads scored from a sheet.
- Spec: 16.3, 16.4, 6.2, 18.3 (Gmail and sheet research first).
- Depends on: 06; research in 18.3.

### 09 Stage (d): social draft routes, One source into many social posts (outline, detailed just in time)
- Goal: draft or schedule routes for YouTube, Instagram, WordPress and TikTok draft, managed browser profiles, then the social flow.
- Owner sees: one source turned into platform drafts, each publish held for approval.
- Spec: 16.5, 12.6, 6.2, 18.3.
- Depends on: 08.

### 10 Stage (0), GitHub half: repository rules on GitHub (outline, detailed just in time)
- Goal: everything of 17.2 to 17.6 that needs GitHub or acts on contributors, applied before the first push.
- Contents: licence files (AGPL-3.0 core, MIT SDK), README with the approved one-line description, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, pull-request template, issue forms, `CODEOWNERS`, CI workflows (aggregate test job, hidden-character scan of the diff, workflow lint, dependency gate against the base branch, single-purpose check, secret scanning), rulesets, the machine account and narrow token, Claude Code hooks and deny rules for the "Never do" list, the local pre-push check (spec 17.5 lists it with the local half; plan 01 decision 23 moves it here, and the owner does not push before then), and the stage (0) done test of 17.5.
- Owner sees: a GitHub repository where a direct push, an unlisted dependency and a hidden character are each refused.
- Spec: 14.9 (description), 17.2 to 17.6, 18.2 items 5 to 7, 18.3 (GitHub and harness-control research).
- Depends on: the owner's tasks in 18.2 items 6 and 7. It can move earlier at any time; it must land before the first push.

### 11 Stage (e): release path, docs site and the phase-1 exit test (outline, detailed just in time)
- Goal: a signed and notarized pre-release built from a tag through the protected release path, the docs site with llms.txt and llms-full.txt, and the recorded exit test.
- Owner sees: an installable signed build, the docs site, and `docs/release-readiness.md` with the exit-test results.
- Spec: 14.9 (phase-1 discoverability), 17 (exit test), 17.5 (release path and stage e checks), 18.2 item 8.
- Depends on: 07 to 10; the Apple developer account.

## Coverage of phase 1 (spec 17 phase table and build order)

| Phase-1 scope item | Plan |
|---|---|
| Stage (0) local half: instruction files, local checks, dependency allowlist | 01 |
| Stage (0) GitHub half: settings, rulesets, accounts, CI workflows, CODEOWNERS, people files | 10 (before the first push) |
| Desktop app | 01 (screens), 01b (look), 02 (wired to the runner) |
| Runner | 02 |
| Chat plus step-list builder | 01 (UI), 02 (SDK-validated edits), 03 (chat agent) |
| One-time flows with "save as flow" | 03 (arrives with stage a) |
| SDK: format, validator, hasher | 02 |
| Harness detection and inventory | 04 |
| Adapters for Codex, Claude Code and Antigravity (brain, worker, scoped config, approval hooks) | 04 (hooks enforced in 05) |
| Brain picker with fallback | 01 (UI), 03 (logic), 04 (harness backends) |
| Budget | 01 (UI), 03 |
| Readiness engine with catalog | 05; catalog entries in 06 to 09 |
| Gateway | 05 |
| Runner checks, retries, approval inbox, history, resume | 02 (core), 05 (risky-action enforcement) |
| Memory | 03 in the old numbering; in the new order 06b (spec 21.5) |
| Token accounting, the keeper for harness processes and the queue (spec 21.2 to 21.4) | 03b |
| History search and the skill library (spec 21.5, 21.6) | 06c |
| Notifications | 05 |
| Fake-harness test kit | 02 (minimal fake), 04 (full kit) |
| Signed and notarized Mac build through the protected release path | 11 |
| Discoverability basics: one-line description on repo, README, SDK package | 10 |
| Discoverability basics: docs site with llms.txt and llms-full.txt | 11 |
| Readiness work: Figma native route | 07 |
| Readiness work: Gmail, spreadsheets | 08 |
| Readiness work: social draft routes (YouTube, Instagram, WordPress, TikTok draft) | 09 |
| Flow: Documents and reports | 06 |
| Flow: Figma to Flutter | 07 |
| Flows: Email triage and replies; Lead follow-up | 08 |
| Flow: One source into many social posts | 09 |
| Exit test (three runs per flow, ten one-time flows, fake-harness suite, stage 0 and stage e checks) | 11 records it; runs accumulate from 06 |

| Build-order stage (spec 17) | Plans |
|---|---|
| (0) repository groundwork | 01 (local half), 10 (GitHub half) |
| (a) core engine with Documents and reports, one-time flows | 01 to 06 |
| (b) Figma to Flutter | 07 |
| (c) Gmail and spreadsheet readiness, Email triage, Lead follow-up | 08 |
| (d) social draft routes, One source into many social posts | 09 |
| (e) release | 11 |

Phase 2 (marketplace, the phone app with its relay, Windows, Sign in with ChatGPT, further adapters) gets its own roadmap after the phase-1 exit test. MCP-server mode moved into phase 1 on 2026-11-17 (spec 22.3).
