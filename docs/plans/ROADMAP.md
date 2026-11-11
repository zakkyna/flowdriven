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
| 03b (new, before 04) | Usage, the keeper and the queue (spec 21.2 to 21.4): token accounting from Claude Code's result event and its full rate-limit event (the fake `claude` learns both), `usage_events`, usage in the run report and on the run screen; the keeper's memory gate, quota gate and ceiling with their probes, waiting reasons and the queue on the Runs screen; the effort-to-model table for Claude Code; R19 | Two runs started together with the ceiling set to 1: one runs, the other waits and says why; the run report shows tokens per step |
| 04 | As above. Of the limit keeper it keeps overlap, per-day caps and floods (R7), inside the keeper that 03b built; triggered runs enter the keeper's third class | As above |
| 05 | As above, and: the skill copy drops front matter (R14); the install preview shows the cost of what a step loads | As above |
| 06 | As above, with the `projects`, `threads` and `messages` tables. Memory moves out to 06b | As above |
| 06b (new, after 06) | The agent's memory (spec 21.5, 21.7): `memory_items`, the search index over items and names, the always-loaded index and the "now" block, recall, proposals with Keep and Drop, correcting and deleting, grants, the Memory screen; R14 for memory, R15, R17, R18, R20 | In a new chat the agent uses a decision from an earlier one without being told again; a lesson that came from a job post waits as a proposal marked as outside text; the Memory screen shows the always-loaded text and its meter |
| 06c (new, after 06b) | History search and the skill library (spec 21.5, 21.6): chat turns and run reports join the search, for the agent and the owner; the library, `skill_ops`, proposals and approvals, R16, the Skills screen | Search finds an old chat turn and an old run report; a skill patch shows as a diff, approving it re-pins the flows that use it, and editing the skill's file by hand blocks them until re-consent |

The release path (the old plan 11) compiles TypeScript before packaging (spec 21.3). Putting several items of a `for_each` into one call is not scheduled until the numbers of plan 03b say it pays (spec 21.3). Plan 03b moves M1 back by one plan. Sizes are the chair's estimates: 14 to 18 tasks for 03b, 12 to 16 each for 06b and 06c.

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

Phase 2 (marketplace, MCP-server mode, Sign in with ChatGPT, further adapters) gets its own roadmap after the phase-1 exit test.
