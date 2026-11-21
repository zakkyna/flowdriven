# FS-j21: Run from the Flows list

| Item | Value |
|---|---|
| Journey | j21, "Menjalankan dari daftar flow", Running from the flow list |
| PRD features | F-07, F-08, F-09 |
| Safety rules | SR-1, SR-2, SR-3, SR-7, SR-8, SR-9; START |
| Prototype source | Brief sections 14, 15, 16.2, 16.3.2-4, 16.3.7, 16.6, 23.1-23.2, 23.7, 23.10; `js/screens/flows.js`, `js/screens/flow.js` (flow page and `scheduleSection`), `js/actions.js` (`proactive`, `startFlow`, `setSchedule`, `confirmFlow`, `deleteFlow`, `finish`), `js/guide.js` (j21) |
| Status | In the prototype (version 8); the first run when a schedule is turned on, schedule checks, a real clock, "Duplicate" and a real "Try the next run now" are Not in the prototype yet |

## Goal

The person opens the list of flows, runs one with a click, reads what a flow needs and may touch, and sets when it runs by itself, including "after another flow finishes". Every start that is not typed in the chat follows one start rule.

## Entry points and trigger

- The left menu: "Flows" (`#/flows`) and a flow page (`#/flows/<flowId>`). A flow name link in the chat opens its page.
- Triggers: the person clicks "Run"; a schedule time arrives; another flow finishes (type "after"). The click calls `flows.start`; the scheduler, the end of a flow and "Try the next run now" reach `starts.request` inside the runner. All of them then follow `START`: 1) a flow that is `new` or `changed` does not start and gets a confirm card in a chat; 2) missing required inputs are asked in a chat; 3) otherwise it starts.
- Sources used here: `flows` (Run), `schedule`, `after`, `try_next`, `again`.

## Preconditions

- Permission is `on` and the main agent is `ready` (FS-j01, FS-j12). Runs from this screen use the main agent's default model (a start outside a chat).
- A flow has to be confirmed (FS-j22) before it runs or is scheduled.

## Main path

1. **FS-j21.S1 Open Flows.**
   - Person: clicks "Flows".
   - FlowDriven: `flows.list`.
   - Sees: the heading "Flows", "Tasks you set up once. Run them whenever you like, or on a schedule.", a button "Make a new flow", and one card per flow: a tile, the name (a link), the summary, a small step track, the schedule line ("Only when I start it", "Every weekday at 17:00", "Every Monday at 08:00", "After <flow> finishes"), the result line ("Answer in chat" or "Report"), "Asks you: Duration, What you did" when a required input has no default and no remembered answer, a state badge ("New: confirm it once", "Changed: confirm again", "Running now", "Needs you", or the last result with its time), and one button: "Run"; "Running..." (disabled) while a run is active; "See what's waiting" when the active run needs the person; "Confirm first" when the flow is `new` or `changed`.
2. **FS-j21.S2 Run a flow that needs nothing.**
   - Person: clicks "Run" on "Weekly supplier report".
   - FlowDriven: `flows.start {flowId, source: "flows"}` returns `{outcome: "started", ...}`. `START` finds it confirmed and its only input (days to look back, optional, default 7) filled, so it starts. The flow's result is `report`, so no chat is made.
   - Sees: a toast "Started Weekly supplier report. Follow it in Activity." The card button turns to "Running...". The run appears in Activity under "Running now". When it ends, the run page shows the report lines. If it needs a decision, the item shows under "Needs you" and as a notification when no window is focused.
3. **FS-j21.S3 Read a flow page.**
   - Person: opens "Fill timesheet".
   - FlowDriven: `flows.get {flowId}`, `rules.list {flowId}`, `readiness.check {flowId}`, `runs.list {flowId}`.
   - Sees: the header (tile, name, description, "Made from the skill <skill>" when set), "Run", "Improve with chat", a menu (Duplicate, Delete); a banner "Check this flow once, then confirm it." with "Confirm" when the flow is `new` or `changed`; "What it does" (the steps; a step that asks shows a hand and "Asks you first"); "What it needs", with one line per input: "Remembers your last answer: Example Corp", "Default: Today", "Asks you", "Optional", each with its example, or "Nothing. It runs without asking you."; the result line ("Shows the answer in the chat" or "Leaves a report in Activity"); three columns "Does on its own", "Asks you first" and "Never does" (a standing rule appears under "Does on its own" as "<sentence> (you allowed this)" with "Ask me again"); "Schedule"; "Needs you" (only rows that are not ok, for example "Sign in to the timesheet service"); "Recent activity" (the last five runs with state words and a link "View activity", or "No activity yet.").
4. **FS-j21.S4 Schedule it after another flow.**
   - Person: under "Schedule" chooses "After another flow finishes", then "Build APK and upload it" in the field "After flow".
   - FlowDriven: `flows.setSchedule {flowId, hash, schedule: {type: "after", afterFlowId}}`. The call carries the hash of the confirmed version. FlowDriven checks the schedule (FS-j21.E3), saves it, and records it in the audit log. For a flow with required inputs it shows "When it's time" with "Ask me in the chat" and "Use my last answers".
   - Sees: "Next: After Build APK and upload it finishes". When Build APK and upload it ends `done`, by any route, FlowDriven calls `starts.request(timesheet, "after", ...)`: if inputs are missing it asks in the same chat as the build when there is one, otherwise in a new chat from FlowDriven, with "Build APK and upload it finished, so Fill timesheet is next."

## Other paths

- **FS-j21.P1 Run on a flow that needs details.** "Run" on "Fill timesheet" creates (or reuses) a chat from FlowDriven with "Fill timesheet needs a few details." and the question (FS-j27), and opens it (`flows.start` returns `{outcome: "asked", ...}`). No run is created and no toast shows.
- **FS-j21.P2 Run on a new or changed flow.** The button reads "Confirm first". A click opens the flow's confirm dialog "Confirm <flow>?" (the same one as FS-j22). Only after "Confirm" does "Run" appear. From a schedule, `START` shows the confirm card in a chat and a "Needs you" item instead (FS-j21.E7).
- **FS-j21.P3 Make a new flow.** The button "Make a new flow" opens a dialog "Choose how to start." with "Cancel", "Describe it in chat" (FS-j22) and "From a skill" (FS-j29).
- **FS-j21.P4 Improve with chat.** Opens a new chat for this flow (FS-j23).
- **FS-j21.P5 Duplicate.** `flows.duplicate` makes "<name> (copy)". The copy is `new`, has no schedule, and has no standing rules; the original is unchanged. (The prototype only showed a toast "Duplicated (sample)".)
- **FS-j21.P6 Delete.** A dialog "Delete <flow>?" says "This removes the flow from your list." with "Cancel" and "Delete". `flows.delete` is refused while the flow has an active run ("This flow is running. Stop it first."). Otherwise the flow, its standing rules and its queued runs are removed; flows scheduled "after" it become "Only when I start it"; past runs stay in Activity; the skill's "Used by" list is cleaned. Back to the Flows list.
- **FS-j21.P7 Ask me again.** The button next to a standing rule calls `rules.revoke {ruleId}`; the rule disappears at once, with no dialog, and the action asks again from the next run (SR-1).
- **FS-j21.P8 Other schedule types.** "Every day", "Every weekday", "Every week" with a time (and a day for weekly). The time is the person's local time. The line "Next: Mon 23 Nov at 17:00" shows the next time in the person's zone.
- **FS-j21.P9 Turn a schedule off.** Choose "Only when I start it". The flow stops starting by itself.
- **FS-j21.P10 First run when a schedule is turned on (owner decision, 2026-11-18).** When the person turns on a time schedule (every day, every weekday, every week) for a flow that has no finished run, FlowDriven says so under the field ("This flow has not run yet. Turning on the schedule runs it once now, so you can see it work.") and, after the click, calls `starts.request(flowId, "try_next", ...)`. It goes through `START`, so inputs are asked and decisions are still held. A schedule of type "after" does not run once now. There is no mandatory try run before a schedule can be turned on. Not in the prototype yet.
- **FS-j21.P11 Try the next run now.** On a flow with a schedule, the small button "Try the next run now" calls `flows.tryNextRun {flowId}`, which starts the flow the way the schedule would (FS-j28).
- **FS-j21.P12 Run again** from a run page uses source `again` and the same inputs (FS-j25).
- **FS-j21.P13 Readiness row.** A "Needs you" row ("Sign in to the timesheet service", "Install <tool>") runs the fix with `readiness.install` or opens the agent's sign-in. The AI agent row opens Settings when the permission is off.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Flow | `new` -> `confirmed` | "Confirm" in the dialog (`flows.confirm`) |
| Flow | `confirmed` -> `changed` | Its content hash differs from the confirmed one |
| Flow | `changed` -> `confirmed` | "Confirm" again |
| Schedule | manual -> daily, weekdays, weekly or after | `flows.setSchedule` |
| Schedule | any -> manual | "Only when I start it" or the target flow is deleted |
| Run | none -> `queued`, `checking`, `running` | `START` accepted the start |
| Run | `queued` -> `checking` | The earlier run of the same flow ended |
| Standing rule | active -> revoked | "Ask me again" |
| Flow list badge | "Running now", "Needs you" | An active run, a pending decision |

## Decisions and confirmations

- Asks: "Confirm" for a `new` or `changed` flow (the dialog lists "Does on its own", "Asks you first", "Never does"); "Delete" (a dialog); the permission-sensitive actions inside a run (decisions, FS-j24).
- Does not ask: "Run" on a confirmed flow, choosing or changing a schedule, "Duplicate", "Ask me again", "Try the next run now", "Make a new flow" (it only opens the choice).
- A schedule changes only by the person's own click in the window (SR-2). A flow file, skill, memory item or agent cannot turn a schedule on; the assistant can only show a card the person clicks (FS-j20.P9).
- The schedule is part of what the person saw and confirmed for a chat-made flow (FS-j22). Changing it later does not change the flow's content hash, so it does not make the flow "Changed: confirm again"; it still needs a confirmed flow.

## Errors and edge cases

- **FS-j21.E1 Agent not set up or signed out.** Cause: the main agent is not `ready`. Person sees: "Run" still starts the run, which shows "Waiting for sign-in" (signed out) or "Stuck" with "Set up Claude Code in Settings." (not installed) in Activity; the flow page shows a "Needs you" row with the one button ("Sign in to Claude Code"). A scheduled start does the same and sends a notification for the problem.
- **FS-j21.E2 Permission off.** Cause: the switch is off. Person sees: a toast "FlowDriven may not run your AI agents. Turn this on in Settings." with "Open Settings". No run is created. A scheduled slot is recorded as "Missed" (FS-j28).
- **FS-j21.E3 Missing or invalid input.** Missing run inputs: P1. A schedule is refused with an inline line and nothing is saved when: the flow is `new` or `changed` ("Confirm this flow first."); "After flow" is the flow itself or leaves no choice; the chain would loop ("Build APK and upload it already runs after Fill timesheet."); a time is not `HH:MM` ("Enter a time like 17:00"). The schedule fields are disabled for a flow that is not confirmed. "Use my last answers" is disabled with "Use my last answers works after the first run." while the last answers do not cover the required inputs.
- **FS-j21.E4 Limits reached.** Cause: the flow's daily run limit (default 24) or the spending or usage limit. Person sees: for the daily limit a toast "<flow> reached its limit of <n> runs today." and, for a scheduled slot, a "Missed" row with the reason; for the spending or usage limit a "Needs you" item (SR-9).
- **FS-j21.E5 A stopped or failed run.** The flow card shows the last result ("Stopped by you", "Failed"). A flow scheduled "after" another flow does not start when that flow ends `failed`, `blocked`, `stopped`, `needs_login` or `interrupted`; only `done` starts it. The chain length is limited to 3 flows, and one request starts a flow at most once.
- **FS-j21.E6 Crash or restart.** Schedules are stored. At start the scheduler recomputes the next times, keeps one idempotency key per slot so no slot starts twice, and runs that were active are `interrupted` (SR-8; FS-j20.E6).
- **FS-j21.E7 A flow changed since it was confirmed.** Cause: a change after the last "Confirm". Person sees: the badge "Changed: confirm again" and the button "Confirm first". A schedule, an "after" start or "Run again" does not run it (SR-3); FlowDriven shows "Confirm <flow> first?" in a chat and a "Needs you" item. The schedule keeps its settings.
- **FS-j21.E8 Computer asleep, or FlowDriven closed, at a scheduled time.** FlowDriven runs the slot once at wake if it is inside the grace window (2 hours); later than that it records "Missed" in Activity with "Run it now". If FlowDriven was quit, "Missed" is shown at the next launch for slots in the last 7 days. With "Keep FlowDriven running in the menu bar" on, a closed window does not stop schedules (Not in the prototype yet; FS-j12.P5).
- **FS-j21.E9 Flow not found.** An unknown id shows "Flow not found" and the button "Go to Flows".
- **FS-j21.E10 Prototype gaps.** The prototype had no clock (after-triggers fired only from `finish`), no schedule checks, no first-run rule in the UI, and tagged "Try the next run now" as "Sample". The real app has a clock, the checks above, P10, and no tag.

## Data read and written

- Reads: `Flow` (state, inputs, result, touches, schedule, remembered, last inputs), `StandingRule`, `Run`, readiness items, `Settings`.
- Writes: the schedule (`schedules` row), `Flow` state (`flows.confirm`, `flows.delete`, `flows.duplicate`), `StandingRule` (revoked), `Run`, `Chat` and `Message` (questions, confirm cards), `AuditRecord` (schedule changes, starts, confirmations).

## Runner API used

`flows.list`, `flows.get`, `flows.start`, `flows.confirm`, `flows.setSchedule`, `flows.tryNextRun`, `flows.duplicate`, `flows.delete`, `rules.list`, `rules.revoke`, `runs.list`, `readiness.check`, `readiness.install`, `chats.create`, `chats.act`, `activity.summary`. Topics: `flows`, `runs`, `rules`, `chats`, `activity`, `readiness`.

## Acceptance criteria

- **FS-j21.A1** The Flows list shows, per flow, name, summary, schedule line, result line, "Asks you: <labels>" when required inputs have no value, a state badge with words, and exactly one of "Run", "Running...", "See what's waiting" or "Confirm first".
- **FS-j21.A2** "Run" on a confirmed flow with nothing missing starts it through `START` with source `flows` and shows "Started <flow>. Follow it in Activity." for a report flow; no chat is created.
- **FS-j21.A3** "Run" on a flow with missing required inputs creates no run and opens a chat from FlowDriven with the question.
- **FS-j21.A4** A flow that is `new` or `changed` never starts from "Run", a schedule, "after", "Run again" or "Try the next run now"; a confirm card and a "Needs you" item appear instead (SR-3, START).
- **FS-j21.A5** The flow page shows the sections of S3 in order, with the input lines "Remembers your last answer: <value>", "Default: <value>", "Asks you", "Optional", or "Nothing. It runs without asking you."
- **FS-j21.A6** `flows.setSchedule` requires the confirmed hash and is refused for a flow that is not confirmed.
- **FS-j21.A7** A schedule that points at the flow itself, at a missing flow, or that makes a loop is refused with an inline line and nothing is saved.
- **FS-j21.A8** "When it's time" shows only for a non-manual flow with required inputs; "Use my last answers" is disabled until the last answers cover the required inputs.
- **FS-j21.A9** Turning on a time schedule for a flow with no finished run starts one run now through `START` with source `try_next`; a schedule of type "after" and a flow that already ran do not.
- **FS-j21.A10** When a flow ends `done`, each flow scheduled "after" it starts once through `START` with source `after`; when it ends in any other state, none starts.
- **FS-j21.A11** "Next: ..." and schedule times use the person's time zone, including a zone with an offset such as `Asia/Jakarta` and a date near midnight.
- **FS-j21.A12** "Delete" needs the dialog, is refused for a flow with an active run, removes its standing rules, turns schedules pointing at it to manual, and keeps past runs.
- **FS-j21.A13** "Ask me again" revokes a standing rule at once; the next matching action asks.
- **FS-j21.A14** Every schedule change, start and confirmation is written to the audit log (SR-7); a schedule can be changed only by the person's action in the window (SR-2).
- **FS-j21.A15** With permission off, "Run" and every automatic start are refused and the slots are recorded as "Missed".
- **FS-j21.A16** A slot missed because the computer slept runs once at wake inside the grace window; outside it, it shows "Missed" with "Run it now"; a restart never starts a slot twice.
- **FS-j21.A17** "Duplicate" makes a `new` copy with no schedule and no standing rules and leaves the original unchanged.

## Not in the prototype yet

- P10 (first run on schedule), the schedule checks in E3, a clock and wake catch-up, a real "Try the next run now" and "Duplicate", the daily-limit line, and "Missed" rows with "Run it now".

## Drafter's calls

- The first-run rule applies to time schedules only, not to type "after"; an "after" flow runs when the other finishes.
- The first run uses source `try_next`; the owner's list of sources has no separate one for it.
- A schedule needs a confirmed flow and the call carries the confirmed hash. Reason: SR-3 says nothing outside the chat runs a `new` or `changed` flow.
- Grace window 2 hours for catch-up at wake, and "Missed" for slots of the last 7 days at the next launch. Reason: the trigger service has a catch-up setting and a window of up to 8 days; the brief gives no number.
- Delete is refused while a run is active, instead of stopping it, so no running work is lost by a delete click.
- "Run" on a flow with the agent signed out still creates a run that shows "Waiting for sign-in" (the existing engine behavior), but a permission-off start is refused and creates no run.
