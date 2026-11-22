# FS-j28: A schedule that asks first

| Item | Value |
|---|---|
| Journey | j28, "Jadwal yang bertanya duluan", A schedule that asks first |
| PRD features | F-09, F-16, F-22, F-08 (also F-03, F-05) |
| Safety rules | SR-1, SR-2, SR-3, SR-5, SR-7, SR-8, SR-9; START (rules 1, 2 and 3) |
| Prototype source | The prototype brief, 'Host rules', 'Redesign 1: chat first, plain words', 'Fix round 4: after the chat-first check', 'Inputs, results, proactive schedules, flows from skills, and every feature shown' and 'English and Bahasa Indonesia'; `js/actions.js` (`proactive`, `setSchedule`, `finish`, `startChain`), `js/screens/flow.js` (`scheduleSection`), `js/screens/activity.js`, `js/screens/chat.js` (card `inputs-ask`), `js/guide.js` (j28) |
| Status | In the prototype (version 9) for the 17:00 question, "Try the next run now" (tagged "Sample"), "Use my last answers", the one waiting question per flow, and "after another flow" asking in the same chat; Not in the prototype yet: a real clock and slots, recorded missed and skipped starts (no Activity rows in V1), system notifications with fixed text (PU-19), the confirm card then "Run it now?" (PU-25) and the app staying alive when its window closes (F-22). Removed from V1: the menu-bar icon and Open at login, the "Missed", "Skipped" and "Run late" rows with "Run it now" in Activity, and the first run when a schedule is turned on |

## Goal

A flow can run by itself at a set time or after another flow. When it needs details and it is time, FlowDriven asks first in a chat, for example the timesheet question at 17:00. The person answers in plain words and the flow runs. Nothing is lost when the Mac slept or the window is closed.

## Entry points and trigger

- The flow page, "Schedule" (FS-j21): "Only when I start it", "Every day", "Every weekday", "Every week", "After another flow finishes", and, for a flow with required inputs, "When it's time": "Ask me in the chat" or "Use my last answers".
- A time arrives (the trigger service ticks every 30 seconds), or another flow ends `done`.
- "Try the next run now" on the flow page (`flows.tryNextRun`, FS-j21.P11).
- Every one of these ends in `starts.request`, which implements `START`: 1) a flow that is `new` or `changed` does not start and gets a confirm card in a chat; 2) missing required inputs are asked in a chat; 3) otherwise it starts. Sources used here: `schedule`, `after`, `try_next`, `proactive`.

## Preconditions

- The flow is confirmed at its current content hash (SR-3, FS-j22).
- The permission for AI agents is `on` (FS-j12). With it off, nothing starts and slots are recorded as missed (E2).
- FlowDriven is alive: the window is open, or it was closed and the app stays alive (macOS; P10). After the person quits, nothing fires.
- To run after an answer, the agent of the run is `ready`. The question itself is posted without an agent call (E1).

## Main path

1. **FS-j28.S1 Set the schedule.**
   - Person: on the flow page of "Fill timesheet", under "Schedule", chooses "Every weekday", the time 17:00, and leaves "When it's time" on "Ask me in the chat".
   - FlowDriven: `flows.setSchedule {flowId, hash, schedule: {type: "weekdays", time: "17:00", whenItsTime: "ask"}}` with the confirmed hash. The checks of FS-j21.E3 run. FlowDriven saves the schedule, maps it onto the trigger service (P1) and writes an audit record. Turning a schedule on never starts a run (P11).
   - Sees: "Next: Thu 19 Nov at 17:00" in the person's time zone.
2. **FS-j28.S2 The time comes.**
   - Person: does nothing (the window may be closed, P10).
   - FlowDriven: the first tick at or after 17:00 finds the slot of the day, claims it once (one key per slot), and calls `starts.request(flowId, "schedule", {slotAt})`. `START` finds the flow confirmed (rule 1), the permission on, and the required inputs "Duration" and "What you did" without a value (customer, project and activity are remembered; date and start have defaults). It creates a chat from FlowDriven at the top of Today, titled "Fill timesheet", on the main agent and its default model (FS-j31). It saves a waiting question (`waiting_questions`, source `schedule`, the slot) and posts one message. It sends one notification with fixed text only (P8).
   - Sees: the new chat with "It's 17:00. Time for Fill timesheet. How long did you work, and what did you work on? For example: 2 hours, built the login page. Like last time, I'll use Project Example (Example Corp), Feature work." and the chips "2 hours, built the login page" and "Use a form" (as FS-j27.S4). In Activity, under "Needs you", the row "Fill timesheet is waiting for your answer" with "Answer in chat". The rail number for Activity counts it. A notification with the fixed title "FlowDriven has a question for you" and the body "Open the chat to answer." appears when no FlowDriven window is focused (PU-19); it never names the flow or any value.
3. **FS-j28.S3 Open the question.**
   - Person: clicks the notification, or "Answer in chat" in Activity.
   - FlowDriven: opens the chat (`#/chat/<chatId>`). The notification is removed when the question is answered.
   - Sees: the question above.
4. **FS-j28.S4 Answer in plain words.**
   - Person: types "3 hours, meeting with the client" and presses Enter. (In Indonesian, "3 jam, rapat dengan klien", the posted lines follow the chat's language, FS-j27.P7.)
   - FlowDriven: one chat turn returns `fill_inputs` with the raw values. FlowDriven parses them with its own parsers (FS-j27.A4) and fills in order: values from the message, remembered answers, defaults. "Today" and "now" resolve to the slot of the question, not to the moment of the answer (FS-j27.E8). Nothing is missing, so `starts.request(flowId, "proactive", {slotAt})` starts the run on the chat's agent and model. The question becomes `answered`, its row leaves "Needs you", and its notification is removed. The remembered answers are saved at the start.
   - Sees: a line listing what was understood, for example "Starting Fill timesheet: today, next free time, 3h, Project Example (Example Corp), Meeting, "meeting with the client"." and a run card.
5. **FS-j28.S5 Approve and read the result.**
   - Person: clicks "Approve" on "Submit this timesheet entry?" (FS-j24).
   - FlowDriven: grant, run ends `done`, and the answer lines are posted in the same chat (FS-j27.S3).
   - Sees: "Logged Thu 19 Nov, 13:00-16:00 (3h): Project Example (Example Corp), Meeting."
6. **FS-j28.S6 Try the next run now.**
   - Person: on the flow page clicks "Try the next run now".
   - FlowDriven: `flows.tryNextRun {flowId}` calls `starts.request(flowId, "try_next", {slotAt: now})`. The same rules apply. If a question for this flow is already waiting, FlowDriven moves that chat to the top and makes no second chat and no second notification (P5). The person goes to the chat.
   - Sees: the question, with the lead "It's 14:32. Time for Fill timesheet." (the current time).

## Other paths

- **FS-j28.P1 Schedule types.** "Only when I start it" (`manual`): nothing fires and "When it's time" is hidden. "Every day at <time>" (`daily`): every day. "Every weekday at <time>" (`weekdays`): Monday to Friday. "Every <day> at <time>" (`weekly`): one day. "After <flow> finishes" (`after`). The time is `HH:MM` in the person's local time. FlowDriven maps `daily`, `weekdays` and `weekly` onto the existing `schedule` trigger (`at`, `days`, `catch_up: once`, `overlap: skip`) and `after` onto `flow_done` with status `done`. One flow has one schedule.
- **FS-j28.P2 Use my last answers.** With `whenItsTime: "last"`, `START` rule 2 takes the last run's values, except date and time inputs, which return to their defaults ("today" is the slot). If they cover the required inputs, there is no question: the flow starts at once (source `schedule`). For a `chat` result, FlowDriven makes a chat and posts "Starting Fill timesheet." with the run card. A risky action still waits for the person's decision (FS-j24) unless a standing rule for that exact place covers it (SR-1). If the last answers do not cover a required input (for example the flow gained a new required input), FlowDriven asks for the rest as in S2.
- **FS-j28.P3 Nothing is missing.** A flow with no required input without a value, such as "Weekly supplier report" (every Monday at 08:00) or "Email triage", starts at once with source `schedule`. A `report` flow makes no chat. A `chat` flow posts its answer in a new chat from FlowDriven. No notification is sent unless a decision or a problem comes up (F-16).
- **FS-j28.P4 After another flow.** When a run ends `done`, by any route, each flow scheduled "after" it goes through `starts.request(flowId, "after", {afterRunId, chatId?})` once. A first run that ends in any other state starts nothing. If the first run belongs to a chat, a missing input is asked in that same chat, with the lead "Build APK and upload it finished, so Fill timesheet is next." Otherwise FlowDriven makes a chat for it. If nothing is missing, the flow starts and the same chat shows "Started by itself after Build APK and upload it finished." with the run card. One request starts a flow at most once. No notification is sent for the start itself.
- **FS-j28.P5 One waiting question per flow.** A flow has at most one open waiting item (a question, or a confirm card). A new slot, "Try the next run now" or an "after" start for that flow reuses it: the chat moves to the top of Today, no second chat is made, and no second notification is sent. A slot that finds an older question still open is recorded as a `starts` row with outcome `skipped` and reason `question_open` (and in the audit log) and starts nothing; Activity shows no row for it in V1. For source `after` from another chat, the chat of the first run gets the line "Fill timesheet is already waiting for your answer." with "Answer in chat".
- **FS-j28.P6 Answer by form, last answers or cancel.** As FS-j27: "Use a form", "Use my last answers", and cancel words, which give "Okay, I won't start it." and close the question with no run. A cancel is not a refusal of any action: the next slot asks again.
- **FS-j28.P7 Missed starts.** The Mac slept, or FlowDriven was not running, at the time. At wake, or at the next launch, FlowDriven looks at the slots since its last tick. It considers only the latest. If that slot is at most 2 hours old, it is handled once now (question, run or confirm card). A slot handled within 2 minutes of its time (the existing `GRACE_MS`) is on time and its lead reads "It's 17:00. ..."; a later one reads "This was due at 17:00. Time for Fill timesheet." If it is older, nothing starts and the slot is recorded as a `starts` row with outcome `missed`, reason `too_old`, and in the audit log. Earlier due slots are each recorded the same way. Activity shows no "Missed" row and no "Run it now" in V1 (Removed from V1; they go into the prototype first, later). After a quit, slots of the last 7 days are looked at in the same way. A slot is never handled twice, whatever the number of wakes or restarts. If the clock moved back by more than a day, FlowDriven starts nothing and records the slot `missed` with the reason `clock_changed`.
- **FS-j28.P8 Notifications.** FlowDriven sends a system notification only for a decision, a problem, or a scheduled question (F-16). A new question sends exactly one: the runner sends the notice as codes (`Line` values with no params: `notice.questionTitle`, `notice.questionBody`), and Electron main draws the title "FlowDriven has a question for you" and the body "Open the chat to answer." in the app language. Neither holds a flow name, an input value or any text from the flow's inputs (PU-19). It is not sent while a FlowDriven window is focused, and it is removed when the question is answered or cancelled. Clicking it opens the chat. A reused question, a scheduled run with nothing missing, and an "after" start send none (Decided for V1, revisable: the prototype notified when an "after" flow started; V1 matches the Settings sentence, so F-16 says the same).
- **FS-j28.P9 Run it now.** (Removed from V1: the "Run it now" button on a "Missed" row, the "Run late" row, `flows.tryNextRun` with `missedStartId`, `ranLate`, `already_ran_late` and `canRunNow`; they go into the prototype first, later.) `flows.tryNextRun` takes `{flowId}` only and starts with the slot now. A missed slot stays recorded and is never run later. The separate offer "Run it now?" after Save flow (FS-j22) and after a confirm card (PU-25) stays.
- **FS-j28.P10 The app stays alive when its window closes (F-22).** (Decided for V1, revisable.) V1 adds no menu-bar icon, no "Open at login", no quit warning and no `background` setting. It keeps today's macOS behaviour (`apps/desktop/electron/main.ts`): the app stays alive when its window closes, so schedules keep running until the person quits. Quitting stops the runner and the schedules until the next launch. With the permission off, nothing starts (SR-8). One runner and one store serve the window. (Removed from V1: the menu-bar icon, Open at login, the quit warning and the Background section of Settings; they go into the prototype first, later.)
- **FS-j28.P11 No first run when a schedule is turned on.** (Decided for V1, revisable; the earlier idea of a first run is Removed from V1 and goes into the prototype first, later.) Turning a schedule on never starts a run: `flows.setSchedule` has no `firstRun`, `ScheduleView` has no `firstRunNote`, the `schedules` row has no `firstRun`, runs have no `firstScheduledRun`, and `schedule_changed.by` has no `first_run_blocked`. A schedule is never turned off because a first run was blocked. The "Run it now?" offer that follows Save flow (FS-j22) stays.
- **FS-j28.P12 Change or turn off while a question waits.** The open question stays open and can still be answered. Turning the schedule off, or changing its time, changes later slots only.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Waiting question | none -> `open` | `START` finds a required input missing (source `schedule`, `after`, `try_next`, `flows` or `again`), or a confirm card for a `new` or `changed` flow |
| Waiting question | `open` -> `answered` | Enough valid values arrive, in words, by the form or by "Use my last answers" |
| Waiting question | `open` -> `cancelled` | Cancel words or the form's "Cancel" |
| Waiting question | `open` -> `closed` | The flow is deleted |
| Slot | none -> `started` | `START` rule 3, nothing missing |
| Slot | none -> `asked` | `START` rule 2 |
| Slot | none -> `needs_confirmation` | `START` rule 1 |
| Slot | none -> `missed` | Permission off, daily limit, too old at wake, clock moved back (a `starts` row with the reason; no Activity row in V1) |
| Slot | none -> `skipped` | An earlier question is still open, or a run of the flow is still active |
| Schedule | any -> `manual` | The person turns it off, or the target flow is deleted |
| Run | none -> `queued`, `checking` | `START` rule 3 |

## Decisions and confirmations

- Asks: only for a required input that is missing or invalid (S2, one message), and "Confirm <flow> first?" for a `new` or `changed` flow (E7).
- Does not ask: a slot with nothing missing, "Use my last answers", "Try the next run now", changing a schedule, "Run now" on the offer card. None of them needs a dialog.
- An answer to a scheduled question is not a permission. A risky action of the run is a separate decision (FS-j24) and still asks. A schedule never pre-answers it (SR-1).
- Schedules change only by the person's own click in the window (SR-2). A flow file, skill, memory item, marketplace flow, agent output or outside text cannot set or turn on a schedule. The assistant can only show a card the person clicks (FS-j20.P9). Every schedule change and every start is written to the audit log (SR-7).
- A schedule starts only the exact version the person confirmed (SR-3).
- Turning the permission off stops every automatic start (SR-8).

## Errors and edge cases

- **FS-j28.E1 Agent not set up or signed out.** Cause: the main agent is `not_installed` or `needs_login`. Person sees: when details are missing, the question is still posted (it needs no agent call) with its notification; the "Use a form" chip works. Typing an answer shows "Claude Code needs you to sign in." with its button (FS-j20.E1). When nothing is missing, the run is created and shows "Waiting for sign-in" (or "Stuck" with "Set up Claude Code in Settings."), and one problem notice is sent (FS-j21.E1). Next: after sign-in the run goes on; the question can be answered.
- **FS-j28.E2 Permission off** (PU-07). Cause: the switch is off. Person sees: no question, no run and no chat turn. The slot is recorded as a `starts` row with outcome `missed` and reason `permission_off`, and in the audit log; Activity shows no row for it in V1. The slot is never run later when the permission is turned back on (FS-j12.E8). A question that was already open stays open; answering it is refused: `chats.send` answers `not_allowed: permission_off` and stores nothing, the composer keeps the text, and "FlowDriven may not run your AI agents." shows with "Turn on permission"; nothing starts.
- **FS-j28.E3 Missing or invalid answers.** Cause: a value in the answer cannot be used. Person sees: the messages of FS-j27.E3 in the same chat ("Which date?", "Tell me how long you worked, for example 2 hours.", "How long? Zero hours can't be logged.", "That's more than a working day. How long did you work?"). The question stays `open` and only the invalid part is asked again. A value for an input the flow does not declare is ignored.
- **FS-j28.E4 Limits reached.** Cause and result: the flow's daily limit (default 24 runs) records the slot as `missed` with reason `daily_limit` and starts no run (PU-09: the line "Weekly supplier report reached its limit of 2 runs today." is shown where the person asks, as in FS-j20.E4). The spending limit or an agent's usage limit pauses the run with a "Needs you" item (SR-9, FS-j12.E4). For a start by a schedule, the keeper's weekly-limit question ("keep running scheduled flows?") applies as built. Nothing continues silently.
- **FS-j28.E5 A stopped or failed run.** Cause: the run started after an answer ends `stopped` or `failed`. Person sees: the run state in the chat and Activity. The remembered answers and the last answers were saved at the start, so "Run again" and "Use my last answers" work. The next slot asks again. A flow scheduled "after" it does not start (P4).
- **FS-j28.E6 Crash or restart.** Cause: FlowDriven or the runner stopped. Person sees: the waiting question, its chat and its row in "Needs you" are still there. The slot key and the question are saved in one transaction, so after a crash there is both or neither (if neither, the slot is handled at the next tick, inside the 2 hour window). No second question is posted, no second notification is sent, and a restart never starts a flow that waits for details. A run that was going is `interrupted` and a step that may have half-happened is not repeated by itself (SR-8).
- **FS-j28.E7 A flow that is new or changed.** Cause: the flow was edited after the last confirmation, or arrived another way. Person sees: no question and no run. FlowDriven makes (or reuses) a chat with "Confirm Fill timesheet first?" and the confirm card, and a "Needs you" item, and sends one notification with fixed text only ("FlowDriven has a question for you", "Open the chat to answer."; `confirm_waiting`). The slot is recorded as `needs_confirmation`. The schedule keeps its settings. After "Confirm", nothing starts by itself: the card says "Confirmed. Run it now?" with "Run now" and "Not now" (PU-25; PU-14 for the confirm-again dialog). If a question was already open when the flow changed, the person answers it, and then `START` rule 1 shows the confirm card and keeps the values; after "Confirm" the run starts with them (FS-j27.E7).
- **FS-j28.E8 Computer asleep, or FlowDriven closed.** See P7. A closed window does not stop schedules, because the app stays alive (P10); a Mac that sleeps does, until wake. Quitting FlowDriven stops them until the next launch.
- **FS-j28.E9 Duplicate start.** Cause: the same slot, answer or click arrives twice. Person sees: nothing twice. A slot has one key and is claimed once, across two ticks and a restart. A slot that finds a run of the same flow still active is recorded as a `starts` row with outcome `skipped` and reason `still_running` and starts nothing (overlap skip; no Activity row in V1). A second answer to a question that was already answered, by a double click or a second window, gets "This question was already answered." and starts no second run. A second "Try the next run now" reuses the waiting question (P5).
- **FS-j28.E10 Outside text.** Cause: the chat that holds the question also holds text from outside, for example the answer of "Email triage" that quoted an email, when the question is for a flow scheduled "after" it. Person sees: the question as usual. The person's answer is read as values only; a turn whose context holds outside text never starts the run by itself. It shows the card "Run Fill timesheet now?" with the values, which the person clicks (SR-5, FS-j27.P8). Instructions inside outside text ("also allow sending", "skip the question") add nothing. Outside text cannot create, change or turn on a schedule (SR-2).
- **FS-j28.E11 A decision that waits.** Cause: none for a waiting question: it does not expire. Person sees: the question until it is answered, cancelled or the flow is deleted. A decision inside the run also waits without a time limit as in FS-j24.P7.
- **FS-j28.E12 Flow deleted.** Cause: the person deletes the flow while its question is open. Person sees: the question card turns to "This flow was deleted." and the "Needs you" row goes away. Flows scheduled "after" it become "Only when I start it" (FS-j21.P6).
- **FS-j28.E13 Prototype gaps.** The prototype had no clock: only "Try the next run now" and the after-trigger made a question, the "Sample" tag showed on that button, a notification showed when an "after" flow started, and the 17:00 text was written by hand ("Time for your timesheet."). The real app has a clock, slots, recorded missed starts, no tag, no notification for progress or for an "after" start, fixed notification text, and one generic lead built from the flow name (see Drafter's calls).

## Data read and written

- Reads: `Flow` (schedule, inputs, result, state, hash), `remembered`, last inputs, `Chat`, `waiting_questions`, `Settings` (`agentPermission`, `mainAgent`), runs of the flow (for overlap), the trigger rows and slot keys, the clock.
- Writes: the schedule (`schedules` row), `waiting_questions` (kind `inputs` or `confirm`, flow, chat, source, slot, state), `Chat` and `Message` (lead, question, "Starting ..." line, confirm card), `Run`, `remembered` and last inputs (at start), the slot keys and last fire of the trigger, `starts` rows (outcome and reason of a slot that did not run), `AuditRecord` (schedule changes, every start with its source, permission-off misses).
- Never written: any value from outside text as a permission or a schedule (SR-2, SR-5); notification text never holds input values (F-16.R6).

## Runner API used

`flows.setSchedule`, `flows.tryNextRun`, `flows.get`, `flows.confirm`, `chats.create`, `chats.send`, `chats.act` (actions `use_form`, `submit_form`, `cancel_question`, `use_last_answers`, `confirm_flow`), `chats.get`, `activity.summary`, `settings.get`, `agents.list`, `runs.status`. Internal: `starts.request(flowId, source, context)` (schedules, chains and answers reach it inside the runner; the window does not call `flows.start` for them). Topics: `chats`, `flows`, `runs`, `activity`, `settings`. Notices: new kind `question_waiting` with the target of a chat; its title and body are the fixed `Line` values `notice.questionTitle` and `notice.questionBody`.

## Acceptance criteria

- **FS-j28.A1** `manual`, `daily`, `weekdays`, `weekly` and `after` map onto triggers as P1 says: a time is `HH:MM` in the person's local time, `weekdays` is Monday to Friday, `after` is `flow_done` with status `done`, and a bad time or day is refused.
- **FS-j28.A2** A due slot is handled once, across two ticks and a restart.
- **FS-j28.A3** A start by a schedule or an "after" start goes through `starts.request` with source `schedule` or `after`, never straight to the engine.
- **FS-j28.A4** With "Ask me in the chat" and a required input missing, a slot posts one question in a new chat from FlowDriven at the top of Today, adds one "Needs you" row "<flow> is waiting for your answer" with "Answer in chat", counts in the Activity number, and starts no run.
- **FS-j28.A5** The question is the generic lead "It's <slot time>. Time for <flow>." (no per-flow phrase; F-09 says the same) followed by the input questions with an example, the remembered line, and the chips; the time is the slot's, in 24-hour form.
- **FS-j28.A6** A valid answer starts the run with source `proactive` on the chat's agent and model; "today" and "now" resolve to the slot, including `Asia/Bangkok` near midnight; remembered answers are saved at the start.
- **FS-j28.A7** A flow has at most one open waiting item. A second slot, "Try the next run now" or an "after" start reuses it (chat to the top, no second chat, no second notification); a later slot that finds it open is recorded as `skipped` (a `starts` row, no Activity row).
- **FS-j28.A8** "Use my last answers" asks nothing when the last answers cover the required inputs, never reuses date or time inputs, and asks for the rest when they do not cover.
- **FS-j28.A9** When nothing is missing, the slot starts the run at once with no question and no notification; a `chat` result goes into a new chat from FlowDriven and a `report` result makes no chat.
- **FS-j28.A10** A flow scheduled "after" another starts through `START` with source `after` only when that run ends `done`; it asks in the first run's chat when there is one, with the lead "<first> finished, so <next> is next."; it starts at most once per request.
- **FS-j28.A11** A `new` or `changed` flow never starts or asks from a slot, `after` start or "Try the next run now": a confirm card and a "Needs you" item appear, the slot is `needs_confirmation`, and nothing starts after "Confirm" until the person chooses "Run now".
- **FS-j28.A12** A new question sends exactly one notification with the fixed text "FlowDriven has a question for you" and "Open the chat to answer.", only when no window is focused, with no flow name and no input values, removed when the question is answered or cancelled; a reused question, a scheduled run with nothing missing and an "after" start send none (PU-19).
- **FS-j28.A13** A slot at most 2 hours old at wake is handled once with the lead "This was due at <time>."; an older one is recorded `missed` (reason `too_old`) and never runs; only the latest due slot is handled, earlier ones are recorded `missed`; Activity shows no "Missed" row and no "Run it now"; no slot is handled twice.
- **FS-j28.A14** With the permission off a slot is recorded `missed` with reason `permission_off`, nothing starts, and turning the permission on later does not run it (PU-07).
- **FS-j28.A15** The daily limit records the slot `missed` with reason `daily_limit` (PU-09); the spending and usage limits pause the run with one "Needs you" item (PU-08); nothing continues silently.
- **FS-j28.A16** An invalid or missing value in an answer gives the messages of FS-j27.E3, keeps the question open and asks only for the invalid part.
- **FS-j28.A17** A waiting question survives a restart; a restart posts no second question or notification and starts nothing.
- **FS-j28.A18** If the flow changed after the question was posted, the answer shows the confirm card first, keeps the values and starts with them after "Confirm".
- **FS-j28.A19** Cancel closes the question, starts no run, and the next slot asks again.
- **FS-j28.A20** A second answer to an answered question gets "This question was already answered." and starts no second run.
- **FS-j28.A21** A slot that finds a run of the same flow active is skipped and recorded as `skipped` (a `starts` row); no second run starts.
- **FS-j28.A22** (Removed from V1: the menu-bar icon, Open at login, the quit warning and the `background` setting.) Closing the last window does not quit the app on macOS (`apps/desktop/electron/main.ts`), so schedules keep firing until the person quits; V1 has no `background` setting, no `window.setBackground`, no `tray.ts`, no `login-item.ts` and no `starts.next`; with the permission off nothing starts.
- **FS-j28.A23** (Removed from V1: the first run when a schedule is turned on.) Turning on any schedule never starts a run and never turns the schedule off afterwards.
- **FS-j28.A24** "Try the next run now" goes through `START` with source `try_next` and the slot now, and reuses a waiting question.
- **FS-j28.A25** Only the person's click in the window sets, changes or turns on a schedule; the assistant's `schedule` intent only shows a card; every schedule change and start is in the audit log with its source.
- **FS-j28.A26** With the main agent not ready, the question is still posted, typing an answer shows the sign-in line, and a start with nothing missing waits as "Waiting for sign-in" with one problem notice.
- **FS-j28.A27** A chat whose context holds outside text never starts the run from the answer by itself; it shows the card "Run <flow> now?".
- **FS-j28.A28** Deleting the flow closes its open question, removes its "Needs you" row, and turns schedules that point at it to "Only when I start it".

## Not in the prototype yet

- Still to be shown in the prototype before the build: the clock, slots and the idempotency of a slot; recorded missed and skipped slots (no Activity rows); PU-19 (system notifications with fixed text only); the generic lead; PU-25 (the confirm card, then "Run it now?"); PU-16 (the "already answered" line); PU-07, PU-08, PU-09, PU-14.
- Removed from V1 (later, prototype first): the menu-bar icon, Open at login and the quit warning (the app stays alive when its window closes); the first run when a schedule is turned on; the "Missed", "Skipped" and "Run late" rows and "Run it now" in Activity; a notification for an "after" start.

## Drafter's calls

- The lead is generic, "It's <time>. Time for <flow name>.", instead of the prototype's hand-written "Time for your timesheet." (Decided for V1, revisable; F-09 says the same.) Reason: format 1.2 has no field for a flow's own phrase (AD-04). A per-flow phrase would be one optional field added to the schedule; it is left out of V1.
- A waiting question does not expire, and a later slot that finds it open is recorded as `skipped`. Reason: the brief says a scheduled start reuses the waiting chat and makes no second one; expiring it would lose an answer the person still owes.
- The question is posted even when the agent is not ready. Reason: it is FlowDriven's own line and costs no agent call; the form still works.
- With the permission off, a slot is recorded `missed` and never run later. Reason: FS-j12.P2 says so.
- A slot handled within 120 seconds of its time (the existing `GRACE_MS`) is on time; the lead "This was due at <time>." is used after that. Reason: the tick is every 30 seconds, and the lead must not say "It's 17:00" at 18:10.
- The grace window at wake is 2 hours (new constant `CATCH_UP_GRACE_MS`, replacing the use of `GRACE_MS`, 120 seconds, for schedule catch-up), as in FS-j21. Only the latest due slot is handled. Reason: one start per wake is what the person expects after a night of sleep.
- (Removed from V1: "Run it now" on a missed slot.) The slot rule of FS-j27.E8 still applies to a question posted for a late slot.
- The run started by an answer uses the chat's agent and model, and the busy fallback does not apply. Reason: the person is in a chat; the fallback is for starts outside a chat (FS-j12.P3).
- No system notification when a scheduled or "after" run starts (Decided for V1, revisable; F-16 says the same). Reason: the Settings sentence says FlowDriven never notifies about progress. The prototype showed one for "after" starts, so this is a difference to show the owner.
- A confirm card for a changed flow counts as the flow's one waiting item (kind `confirm`), uses the same notification, and offers "Run now" after "Confirm". Reason: the person still wants the run that was due.
- Overlap uses skip, not queue, for schedules. Reason: F-09.R10 says a schedule never starts the same flow twice at once.
- Times in lines and menus use the 24-hour form `HH:MM`, as in the prototype, in both languages (FS-j30).
- No extra notice when the window closes while the app stays alive. Reason: notifications are only for decisions, problems and questions.
- The `starts` outcomes `missed` and `skipped` with their reasons (`permission_off`, `daily_limit`, `too_old`, `clock_changed`, `question_open`, `still_running`) and the notice kind `question_waiting` are named here; `runner-api.md` and `data-model.md` must carry the same names.
