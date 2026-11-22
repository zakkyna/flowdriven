# FS-j12: Settings

| Item | Value |
|---|---|
| Journey | j12, "Pengaturan", Settings |
| PRD features | F-15, F-23 (also F-20 and F-21 for the Language section and the main agent line; F-22 for the app staying alive when its window closes) |
| Safety rules | SR-2, SR-4, SR-7, SR-8, SR-9 |
| Prototype source | The prototype brief, 'Redesign 1: chat first, plain words', 'Light and dark mode the owner can choose', 'English and Bahasa Indonesia' and 'Choosing the AI agent and model in the chat'; `js/screens/preferences.js`, `js/actions.js` (`setAgentConsent`, `setMainAgent`, `raiseCap`, `signInAgent`), `js/guide.js` (j12) |
| Status | In the prototype (version 8); the Language section and the main agent line are in the prototype (version 9); spending enforcement, the effect of the main agent, the "Could not save" line (PU-29) and the spending pause (PU-08) are Not in the prototype yet |

## Goal

The person sets the look, the AI agents FlowDriven may use, the permission to run them, the main agent, and the spending limit, in one screen, with one click for each change.

## Entry points and trigger

- The left menu: "Settings" at the bottom. Route `#/settings`.
- Links from elsewhere: the agent pill in the composer, a flow page row "AI agent" when permission is off, "Manage AI agents" in the agent picker (FS-j31), and the button "Turn on permission" next to a refusal (it opens the "Before you start" dialog).
- Trigger: the person clicks. No setting changes without the person's own action in the window (SR-2).

## Preconditions

- First launch is finished (FS-j01). Settings opens even if no agent is ready; then it is the place to fix that.

## Main path

The V1 sections are in this order: Appearance, Language (version 9), AI agents, Permission, Main AI agent, Spending limit, Notifications. One line at the end of the screen says other items appear when their release ships (Decided for V1, revisable). There is no Background section in V1 (FS-j12.P5). Step S5 and the line in S4 depend on version 9 only where marked.

1. **FS-j12.S1 Open Settings.**
   - Person: clicks "Settings".
   - FlowDriven: calls `settings.get` (with `spending`) and `agents.list`.
   - Sees: the sections above.
2. **FS-j12.S2 Appearance.**
   - Person: chooses "Light", then "Dark", then "Auto".
   - FlowDriven: the renderer calls the preload `window` API; main sets `nativeTheme.themeSource` to `light`, `dark` or `system` and saves the choice in its own small settings file so the next launch paints right. No runner call. Auto is the default.
   - Sees: three cards "Light", "Auto" (with "Matches your computer") and "Dark", each with a small picture and a radio; the whole window changes at once.
3. **FS-j12.S3 Sign in an agent.**
   - Person: in "AI agents" clicks "Sign in" on the Codex row.
   - FlowDriven: `agents.signIn {agentId: "codex"}` sets `waiting_login`, starts Codex's own sign-in, and polls its status command.
   - Sees: the row shows "Waiting for you to sign in..." and no button; when signed in the badge reads "Ready". Rows show a "Set up" button for `not_installed` (it also gives permission, as in FS-j01) and "Sign in" for `needs_login`; the button is hidden while `installing` or `waiting_login`.
4. **FS-j12.S4 Main AI agent.**
   - Person: chooses Codex under "Main AI agent".
   - FlowDriven: `settings.update {patch: {mainAgent: {agent: "codex", model: <its default>}}}`. A radio is disabled unless the agent is `ready` ("Set up or sign in first"). From now on new chats start with Codex and its default model (version 9), and every start outside a chat (schedule, Run on the Flows list, "after another flow") uses Codex with its default model. Chats already open and runs already going keep what they use.
   - Sees: a toast "Main AI agent: Codex"; the line "New chats start with this agent and its default model." (version 9); the toggle "If Claude Code is busy, use Codex" (the words name the main agent and the other ready agent; they are shown only when two agents are ready).
5. **FS-j12.S5 Raise the spending limit.**
   - Person: clicks "Raise limit".
   - FlowDriven: opens a dialog with the field "Monthly limit ($)" (minimum 1, default 25). The title line updates as the person types: "Raise the limit to $25?". "Raise" calls `settings.update {patch: {spendingLimit: 25}}`; "Cancel" closes. FlowDriven resolves every waiting limit decision (the one "Needs you" item for budget, PU-08) and lets those runs continue.
   - Sees: before: "Used $9.20 of $10.00 this month". After: a toast "Limit raised to $25." and "Used $9.20 of $25.00 this month". An amount that is not above the current limit shows "Enter an amount above $10." in the dialog and nothing is saved.

## Other paths

P4 depends on version 9; the other paths do not.

- **FS-j12.P1 Turn the permission on.** The switch "FlowDriven may run your AI agents" (off -> on) opens a dialog "Before you start": "FlowDriven runs your flows on the AI agents on this Mac: Claude Code, Codex and any you add later. Give permission once for all of them. FlowDriven only does what each flow is allowed to do, and asks you before anything risky." Buttons "Give permission" and "Cancel". Giving it sets `agentPermission` to `on` and writes an audit record. The same dialog opens from the button "Turn on permission" next to a refusal (FS-j12.E2). (Removed from V1: the sentence about the companies that make the AI agents; it goes into the README's short safety note.)
- **FS-j12.P2 Turn the permission off.** The switch (on -> off) opens "Stop FlowDriven from running AI agents?" with "Flows stop until you turn this on again." and buttons "Turn off" (danger) and "Keep on". "Turn off" sets `agentPermission` to `off`, stops every active run (`runs.stop` for each; state `stopped`), expires their waiting decisions, and stops every automatic start (SR-8). A run already going when the permission is turned off becomes `stopped` ("Stopped because you turned off permission."). Starts that come due while it is off are recorded as `starts` rows with outcome `missed` and reason `permission_off` (and in the audit log) and are not run later; Activity shows no row for them in V1. No new chat turn is sent to an agent.
- **FS-j12.P3 Busy fallback.** The toggle "If Claude Code is busy, use Codex" applies only to starts outside a chat. "Busy" means the main agent reported its usage limit or has no free slot for this run. A start moves to the other agent only if that agent is `ready` and can run the flow with the limits FlowDriven needs; otherwise it waits on the main agent.
- **FS-j12.P4 Language.** Two radios, "English" and "Bahasa Indonesia", each in its own language, and the line "Chats and flows keep the words they were written in. FlowDriven answers in the language you write in." Details in FS-j30 (version 9).
- **FS-j12.P5 No Background section.** (Decided for V1, revisable.) V1 adds no menu-bar icon, no "Open at login" and no quit warning, and Settings has no Background section. It keeps today's macOS behaviour (`apps/desktop/electron/main.ts`): the app stays alive when its window closes, so schedules keep running until the person quits (FS-j28). (Removed from V1: the menu-bar icon, Open at login, the quit warning and the Background section; they go into the prototype first, later.)
- **FS-j12.P6 Notifications.** A fixed sentence: "FlowDriven only notifies you when it needs a decision or something went wrong. It never notifies you about progress or success." It also asks for no other notification (proactive questions are a decision to answer, FS-j28).

## States

| Entity | From -> to | Cause |
|---|---|---|
| `agentPermission` | `on` <-> `off` | Person confirms a dialog |
| Run | `queued`, `checking`, `running`, `waiting_approval`, `retrying` -> `stopped` | Permission turned off |
| Decision | `pending` -> `expired` | Permission turned off |
| Limit decision (`budget_raise`) | `pending` -> `approved` or `expired` | Limit raised (`resolvedVia` `window`), or the next local month begins (`resolvedVia` `expiry`); never a Reject, no 24-hour expiry |
| Agent | `needs_login` -> `waiting_login` -> `ready` | "Sign in" |
| `mainAgent` | agent A -> agent B | Person chooses a ready agent |
| `spendingLimit` | N -> larger N | "Raise" with an amount above N |
| Run | `waiting_approval` (budget) -> `running` | Limit raised |
| Color mode | any -> `light`, `dark` or `system` | Person picks |

## Decisions and confirmations

- Asks: turn the permission on ("Give permission"), turn it off ("Turn off"), raise the limit (the amount dialog with its live question).
- Does not ask: appearance, language, main agent, busy toggle, sign-in and set-up buttons. Stop and Reject elsewhere never ask (owner decision, 2026-11-18).
- Only the person changes these settings (SR-2). No flow, skill, memory item, agent output or other AI tool can call `settings.update`; the assistant can only show a card that opens this screen. `settings.update` is `mcp: no`.
- Raising the limit is never done for the person (SR-9): a limit decision in "Needs you" sends the person here; no button in a flow raises it.

## Errors and edge cases

- **FS-j12.E1 Agent not set up or signed out.** Cause: an agent row is `not_installed` or `needs_login`. Person sees: the badge and one button ("Set up" or "Sign in"); the agent's radio under "Main AI agent" is disabled with "Set up or sign in first". If the current main agent becomes signed out, `mainAgent` stays and its radio shows the state; new chats start with the first ready agent and show a note; with none ready the composer shows the next-step button.
- **FS-j12.E2 Permission off** (PU-07). Cause: switch off. Person sees: the switch off; in a chat, sending is refused with "FlowDriven may not run your AI agents." and a button "Turn on permission" (the text stays in the composer; `chats.send` answers `not_allowed: permission_off` and stores nothing); a Run on the Flows list shows the same line and button (`flows.start` returns `{outcome: "refused", reason: "permission_off"}`). "Turn on permission" opens the same "Before you start" dialog as P1; "Give permission" turns it on. No run is created. Chat turns count as agent calls, so they need the permission too. TC-j12-13 is the one runner-level owner of the `chats.send` rule.
- **FS-j12.E3 Missing or invalid input.** The limit field: empty disables "Raise"; a non-number, zero or a negative value shows "Enter an amount above $<limit>."; an amount not above the current limit shows the same line; more than two decimals is rounded to cents; above $10,000 shows "Enter an amount up to $10,000." Nothing is saved on error.
- **FS-j12.E4 Limits reached** (PU-08). Cause: spent amount reaches the limit, or an agent reports its usage limit. Person sees: "Used $10.00 of $10.00 this month" with "Limit reached"; new runs and running steps pause and a "Needs you" `budget_raise` decision says "Monthly limit reached. Raise it in Settings to continue." (SR-9); the runs are not `blocked`, and raising the limit resolves the decision (`resolvedVia` `window`) and they continue. The decision never counts as a Reject and has no 24-hour expiry; it also ends when the next local month begins (`spending-pause.expiresAt`, `resolvedVia` `expiry`) and the runs continue under the limit. Nothing continues silently. The spending limit counts money charged per use only; agents on a subscription are bound by their own usage limits (Decided for V1, revisable: the spending limit counts only money charged per use, Q-03). (Removed from V1: the usage rows per agent and the "plan limits apply" note.)
- **FS-j12.E5 Stopped or failed run.** Turning the permission off stops runs; each shows "Stopped by you" and its report says "Stopped because you turned off permission." A run that failed earlier is untouched. If `settings.update` fails (runner unavailable) a toast "Could not save. Try again." shows (PU-29) and the control returns to its old value.
- **FS-j12.E6 Crash or restart.** Settings are in the store (`settings` table) and survive. The color mode is in main's own file and survives. If that file cannot be read, Auto is used. After a restart with permission `off`, nothing starts.
- **FS-j12.E7 Flow changed since confirmed.** Not caused here: the main agent, the model and the limit are not part of a flow's content hash, so changing them never makes a flow "Changed: confirm again" (SR-3).
- **FS-j12.E8 Computer asleep or FlowDriven closed at a scheduled time.** With permission `off` the slot is recorded as a `starts` row with outcome `missed` and reason `permission_off` and is never run later; Activity shows no row for it in V1. With permission `on` the rules of FS-j28 apply. A slot can fire with the window closed while the app is alive (FS-j12.P5); after the person quits, nothing fires.
- **FS-j12.E9 Version 9 and what is new: main agent.** Version 9 already uses the main agent and its default model for new chats (the composer pill and the "New chats start with this agent and its default model." line). New in the real app: the main agent also decides the agent for starts outside a chat (S4), the models come from the real agent (`agents.models`), and the limits are real (the agents' own usage limits and the spending limit).
- **FS-j12.E10 Prototype gap: busy fallback.** The prototype saved the toggle and nothing read it. The real app applies it (P3).
- **FS-j12.E11 Prototype gap: spending.** "Spent" never changed in the prototype and no waiting limit decision was seeded. The real app counts per-use charges and enforces the limit (B-24).
- **FS-j12.E12 Not applicable: outside text and a decision that waits for an answer.** Settings reads no outside text and no agent output can change a setting (SR-2), so outside text cannot steer anything here. The only decisions this screen touches are expired by the person's own click (permission off) or resolved by raising the limit; the 24-hour expiry of FS-j24 applies to other decisions, and the limit decision never expires after 24 hours (E4).

## Data read and written

- Reads: `Settings` (`language`, `agentPermission`, `mainAgent`, `busyFallback`, `spendingLimit`), `Agent` (state, models), spent amount from usage records, `Decision` (budget kind).
- Writes: the same settings keys, `Agent` state, `Run` and `Decision` states (permission off, limit raised), `AuditRecord` (`permission_changed`, `setting_changed`, `limit_raised`). Color mode goes to main's own `window.json` (`{version: 1, colorMode}`), not the store.

## Runner API used

`settings.get`, `settings.update`, `agents.list`, `agents.setUp`, `agents.signIn`, `agents.rescan`, `agents.models`, `runs.stop`, `approvals.list`. Raising the limit resolves the `budget_raise` decision inside `settings.update`; `approvals.resolve` on it gives `raise_in_settings`. Preload `window` API: `getPrefs`, `setColorMode` (no background setting). Topics: `settings`, `agents`, `runs`, `approvals`, `activity`.

## Acceptance criteria

A9 and A10 depend on version 9; the others do not.

- **FS-j12.A1** Settings shows the sections in the order of the Main path, and each control saves with one click or one dialog.
- **FS-j12.A2** Light, Auto and Dark call the preload `window` API; main sets `nativeTheme.themeSource` to `light`, `system` or `dark` and stores the choice in its own file; Auto is the default; the runner is not called.
- **FS-j12.A3** Agent rows show state words, "Set up" for `not_installed` and "Sign in" for `needs_login`, and no button while `installing` or `waiting_login`.
- **FS-j12.A4** Turning the permission on needs "Give permission"; turning it off needs "Turn off"; both write an audit record with source `window`.
- **FS-j12.A5** Turning the permission off stops every active run (state `stopped`), expires their waiting decisions, blocks every automatic start (the slot is recorded `missed` with reason `permission_off`), and refuses chat turns and starts with "FlowDriven may not run your AI agents." and a "Turn on permission" button that opens the "Before you start" dialog; no run is created and the composer keeps the text (SR-8, PU-07).
- **FS-j12.A6** The main agent radio is disabled for an agent that is not `ready`; choosing a ready agent saves `mainAgent` with its default model.
- **FS-j12.A7** Starts outside a chat use the main agent's default model; the busy fallback applies only to those starts and only to a ready agent that can run the flow.
- **FS-j12.A8** The limit dialog rejects an amount not above the current limit with "Enter an amount above $<limit>." and saves nothing; a valid amount saves, resolves waiting limit decisions, and shows "Limit raised to $<amount>."
- **FS-j12.A9** (version 9) A new chat starts with the main agent and its default model; an open chat is not changed by the main agent setting.
- **FS-j12.A10** (version 9) The Language section lists every registered language by its own name and applies a choice at once (FS-j30).
- **FS-j12.A11** When the spent amount reaches the limit, runs pause with a "Needs you" item and none continues until the person raises the limit (SR-9).
- **FS-j12.A12** No operation other than the person's click in the window can change `agentPermission`, `mainAgent`, `busyFallback` or `spendingLimit`: the assistant cannot call `settings.update`, and the operation is not exposed over MCP (SR-2).
- **FS-j12.A13** Settings and the color mode survive a restart; an unreadable color mode file gives Auto.
- **FS-j12.A14** A change of main agent, model or limit never changes a flow's confirmed state.
- **FS-j12.A15** (Removed from V1: the Background switches; they go into the prototype first, later.) V1 Settings has no Background section, no `background` key and no `window.setBackground`; the app stays alive when its window closes (macOS) and schedules keep running until the person quits; `window.json` holds only `{version: 1, colorMode}`.

## Not in the prototype yet

- Still to be shown in the prototype before the build: the main agent that decides real runs, the busy fallback that works, PU-08 (the limit that counts and pauses as one "Needs you" item), PU-07 (the permission-off refusal with "Turn on permission"), PU-02 (an agent too old to run safely) and PU-29 ("Could not save. Try again.").
- Removed from V1 (later, prototype first): the Background section with the menu-bar icon, Open at login and the quit warning; the usage rows per agent and the "plan limits apply" note; the sentence about the companies that make the AI agents in the permission dialog.

## Drafter's calls

- Default spending limit $10.00 per month, as in the prototype. Lowering the limit is not offered (the prototype only raised it); this stays until the prototype shows it.
- Upper bound $10,000 on the limit field to stop typing mistakes.
- Turning the permission off sets the report line "Stopped because you turned off permission." and expires waiting decisions; the brief only says Turn off stops flows.
- "Busy" means usage limit reported or no free slot; the brief does not define it.
- Chat turns need the permission because each turn is an agent call (AD-10).
- No Background section in V1. Decided for V1 (revisable): the app keeps today's behaviour of staying alive when its window closes (Q-02). Reason: the owner has not seen a menu-bar icon or Open at login in the prototype.
