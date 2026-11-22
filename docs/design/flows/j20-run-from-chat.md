# FS-j20: Run flows from the chat

| Item | Value |
|---|---|
| Journey | j20, "Menjalankan flow lewat chat", Running a flow from chat |
| PRD features | F-03, F-04, F-06 (also F-02 for the new-chat row and chat list, F-21 for the agent pill and run card) |
| Safety rules | SR-1, SR-3, SR-4, SR-5, SR-7, SR-8, SR-9; START for the next flow of a chain |
| Prototype source | The prototype brief, 'Redesign 1: chat first, plain words', 'Fix round 4: after the chat-first check', 'Rail like Claude's sidebar', 'Inputs, results, proactive schedules, flows from skills, and every feature shown' and 'Choosing the AI agent and model in the chat'; `js/screens/chat.js` (`respond`), `js/actions.js` (`startRun`, `startChain`, `startTogether`, `proactive`, `decide`, `alwaysAllow`, `stopRun`, `finish`), `js/guide.js` (j20) |
| Status | In the prototype (version 8); the agent pill and the agent on the run card are in the prototype (version 9); reading sentences with the agent, "Change" on a plan, the empty app (PU-04) and the failure lines (PU-05, PU-06, PU-07, PU-08, PU-09, PU-26) are Not in the prototype yet |

## Goal

The person types, in plain words, which flow to run. FlowDriven runs one flow, several together, or a chain in order, shows progress in the chat, asks only for what is missing, and puts every risky action in front of the person before it happens.

## Entry points and trigger

- "New chat" in the left menu, or any open chat. Starter chips on an empty chat. A suggestion chip under an assistant message.
- Trigger: the person sends a message (Enter sends, Shift+Enter adds a line) or clicks a card button. A start typed in the chat is source `chat`. The next flow of a chain goes through the start rule `START` with source `after`.
- Related: FS-j27 (inputs in plain words or a form), FS-j28 (schedules that ask first), FS-j24 (decisions), FS-j22 and FS-j23 (make and improve a flow, reached from the same chat).

## Preconditions

- Permission is `on` and the chat's agent is `ready` (FS-j01, FS-j12). Otherwise see FS-j20.E1 and E2.
- The flows named exist. A flow that is `new` or `changed` shows a confirm card first (SR-3).

## Main path

The agent pill in S1 and the agent line on the run card in S4 depend on version 9.

1. **FS-j20.S1 New chat.**
   - Person: clicks "New chat".
   - FlowDriven: `chats.create` reuses an empty chat if one exists (moved to the top of Today) or makes a chat titled "New chat". The chat starts with the main agent and its default model (version 9).
   - Sees: "What should I do?", "I can run your flows, make a new flow, or improve one.", the composer, the agent pill ("Claude Code · Sonnet 5.5" with a status dot in version 9; "Claude Code ready" in version 8), and starter chips: one for a flow of the person's own (for example "Run Build APK and upload it, then fill my timesheet"), "Run Weekly supplier report", "Make a new flow", "What needs me?". Starter chips are built from the person's own flows. With no flows yet the chips are "Make a new flow" and "What needs me?" only (FS-j20.P16; PU-04, Not in the prototype yet).
2. **FS-j20.S2 Ask for a chain.**
   - Person: clicks the chip "Run Build APK and upload it, then fill my timesheet" (or types it).
   - FlowDriven: `chats.send` stores the message at once and returns. The first user message becomes the chat title (cut to 40 characters) and the chat moves to the top of Today. One chat turn runs: one agent call with no tools and a JSON schema (AD-10), on the chat's agent and model, with a compact context (flows with names and inputs, remembered answers, what runs and what needs the person, the last 12 turns or 24,000 characters). It returns the intent `run_chain` with the two flow ids in order, the values it found, the reply text and the language. FlowDriven checks the answer against its own state (both flows exist, order, values) and fills inputs by AD-11. A chip is sent as the person's own message in the app language and never changes the chat language.
   - Sees: the user bubble, then one short question for what is missing: "Fill timesheet: How long did you work, and what did you work on? For example: 2 hours, built the login page. Like last time, I'll use Project Example (Example Corp), Feature work." with chips "2 hours, built the login page" and "Use a form". Input handling is FS-j27.
3. **FS-j20.S3 Answer.**
   - Person: types "2 hours, release build".
   - FlowDriven: the turn returns `fill_inputs`; FlowDriven parses the duration (2h) and "What you did" with its own parsers. Nothing is missing, so it shows the plan card and starts nothing.
   - Sees: the question card marked answered, and a plan card: "I'll run these one after the other:" 1. "Build APK and upload it", 2. "Fill timesheet - starts when Build APK and upload it finishes". Buttons "Start" (`start`) and "Change" (`change_plan`).
4. **FS-j20.S4 Start.**
   - Person: clicks "Start".
   - FlowDriven: for each flow it checks the confirmed hash. A `new` or `changed` flow opens the confirm card first (FS-j20.P6). Then `chats.act {action: "start"}` starts the first flow (a start with source `chat`, inside the call; the window never calls `flows.start` for it) and writes the run on the chat's agent and model, with the start proof (SR-4). The second flow waits; when the first ends `done`, `starts.request(flowId, "after", ...)` applies `START`.
   - Sees: "Started. I'll tell you here if I need you." and a run card per flow: flow name, state badge ("Waiting to start", "Starting", "Running", "Needs you", "Finished"), a step track, "Step 2 of 4: Build the APK", and a "Stop" button while it is active. The card also says the agent: "Claude Code · Sonnet 5.5" (version 9). A queued run says "Waiting for the earlier run of this flow." and, if that run needs the person, "The earlier run needs you first." with the link "See what it needs".
5. **FS-j20.S5 The first flow ends.**
   - Person: waits, or does something else.
   - FlowDriven: Build APK and upload it is a `report` flow, so its card shows "Finished: <first report lines>" and no extra chat line is posted. `START` starts Fill timesheet in the same chat; its card says "Started by itself after Build APK and upload it finished."
   - Sees: the second card.
6. **FS-j20.S6 A risky step asks.**
   - Person: sees the decision.
   - FlowDriven: step 3 of Fill timesheet creates a decision (state `pending`, "Needs you"): the effect class of "Create the timesheet entry in the timesheet service" is `change`, and the flow lists it under "Asks you first". The run is `waiting_approval`. FlowDriven shows the decision in this chat, in Activity under "Needs you", and as a system notification when no FlowDriven window is focused; the notification shows fixed text only, "FlowDriven needs a decision" and "Open FlowDriven to see what is waiting.", never the title or the payload (PU-19). The runner never answers it.
   - Sees: a card "Submit this timesheet entry?" with the summary "Thu 19 Nov, 13:00-15:00 (2h): Project Example (Example Corp), Feature work. "Release build for Project Example."" and the buttons "Approve", "Always allow for this flow", "Reject" and "Details" (opens the run in Activity). "Always allow for this flow" is shown only because the effect is `change` and the place (the person's timesheet account) is fixed in the flow (`canAlwaysAllow`, SR-1); a decision of a risky kind (`send`, `post`, `pay`, `delete`, `merge`) shows "Approve", "Reject" and "Details" only.
7. **FS-j20.S7 Approve.**
   - Person: clicks "Approve".
   - FlowDriven: `approvals.resolve {approvalId, decision: "approve"}`. FlowDriven writes a one-time grant bound to the run, the step, the tool and the exact input digest. The step runs; the run ends `done`. The audit log records the decision. The report gets "You approved: Submit this timesheet entry."
   - Sees: because "Fill timesheet" has the result `chat`, FlowDriven posts the answer lines filled from the inputs and outputs: "Logged Thu 19 Nov, 13:00-15:00 (2h): Project Example (Example Corp), Feature work." and ""Release build for Project Example." Entry 4812." (the entry number comes from the timesheet service in the real app).
8. **FS-j20.S8 Offer to repeat.**
   - Person: sees an offer.
   - FlowDriven: when both runs ended `done`, the person rejected nothing, and Fill timesheet is not already set to run after Build APK and upload it, FlowDriven posts "Both flows finished." with the first report line of each report flow, and a card "Do this every time? Fill timesheet can start by itself after Build APK and upload it finishes." with the buttons "Yes, every time" and "Only this time". These are card buttons, not words matched in the next message. "Yes, every time" (`every_time`) sets the schedule of Fill timesheet to type `after`; it replaces any schedule the flow had, and the card says what it replaces. "Only this time" closes the card.
   - Sees: after "Yes, every time": "Done. Next time Fill timesheet starts after Build APK and upload it. You can change it on the Fill timesheet page."

## Other paths

P11 depends on version 9; the others do not.

- **FS-j20.P1 One flow, nothing missing.** Typed "run weekly supplier report": intent `run`, and the run starts at once (source `chat`, inside the turn). The chat says "Starting Weekly supplier report." and shows its run card. A `report` flow ends with "Done. The report is in Activity."
- **FS-j20.P2 Several flows with no order word.** Intent `run_together`. Plan card "I'll run both at the same time." (or "I'll run all <n> at the same time.") with "Start" and "Change". One run per flow, in parallel. A flow that already has an active run queues its new run.
- **FS-j20.P3 A flow name alone.** Intent `answer` with a card "Run <flow> now?" and the buttons "Run" and "Not now". Nothing starts until "Run" is clicked. Questions ("is build apk done?"), negations ("don't run it") and plain mentions get an answer or a status card, never a run.
- **FS-j20.P4 Cancel or ask while a question is open.** Cancel words give "Okay, I won't start it." A question mark gives a short answer: "I need these details to start the flow." A different request leaves the question open and is handled, unless it carries values for it.
- **FS-j20.P5 Typed yes with a card open.** While a plan, schedule, confirm, run or stop card is open, "yes", "ok", "start" or "no" in any language gets "Use the buttons on the card above." Only a click on a button starts or changes anything.
- **FS-j20.P6 A new or changed flow.** (PU-14 for the changed case.) Instead of starting, the chat shows "Confirm <flow> first?" with a "Confirm" button. It opens a dialog "Confirm <flow>?" with the steps and three lists, "Does on its own", "Asks you first" and "Never does", the line "You can change it later with Improve with chat." and the buttons "Cancel" and "Confirm". "Confirm" confirms this exact version (`chats.act {action: "confirm_flow", values: {hash, onItsOwn}}`, the same function as `flows.confirm`) and the start continues. A risky kind (`send`, `post`, `pay`, `delete`, `merge`) is never under "Does on its own": it is under "Asks you first", cannot be moved, and `flows.confirm` refuses it in `onItsOwn` with `not_allowed`, reason `always_asks`. FS-j22 describes the dialog in full.
- **FS-j20.P7 Stop.** The "Stop" button on a run card stops at once with no question (`runs.stop`); the card shows "Stopped by you". A typed stop ("stop build apk") makes a card "Stop <flow>?" with "Stop" (`stop_runs`) and "Keep it running" (`keep_running`), because the sentence may be a question or a negation; with nothing running FlowDriven says "Nothing is running right now." Stopping a run in a chain posts "Stopped. <names> did not start."
- **FS-j20.P8 Turn off a schedule.** "Turn off timesheet automatically" gives a card "Stop running Fill timesheet by itself?" with "Yes, turn it off" (`turn_off_schedule`) and "No" (`keep_schedule`).
- **FS-j20.P9 Set a schedule from the chat.** (PU-13.) "Run timesheet every weekday at 17:00" gives a card "Set this schedule?" with "Yes, set it" (`set_schedule`) and "No" (`skip_schedule`). Two schedules in one sentence: "One schedule at a time, please. Which flow first?" See FS-j28.
- **FS-j20.P10 Status.** "What needs me?" or "what is running?" gives a status card: "<n> things need you:" with "Open" links, "Running now: <names>" or "Nothing is running.", the latest result of a named flow, and "Problems: <names>".
- **FS-j20.P11 Always allow.** (Decided for V1, revisable.) The button "Always allow for this flow" exists exactly as in the prototype: only for a repeatable `change` action at a fixed place (the timesheet entry, one cloud storage folder upload). It calls `approvals.resolve {decision: "always_allow"}`. The decision becomes `allowed_always`, the run goes on, and FlowDriven stores a standing rule for that flow, that action and that exact place (kind `account` or `folder`). The chat says "Okay. From now on Fill timesheet does this by itself. You can undo it on its page with Ask me again." Later runs show "Done by your rule: <step>." (without an outside tag). Never for `send`, `post`, `pay`, `delete` or `merge`: those always ask, there is no standing rule for them in V1, and `canAlwaysAllow` is false. Replies and other actions whose place comes from what the run read never get this button (SR-1). Standing rules are made only in the desktop window (SR-2). Rules for sends or posts, if ever allowed, are a later approvals change with its own review.
- **FS-j20.P12 Make or improve.** "make a flow ..." and "change flow ..." intents (`make_flow`, `improve_flow`) go on in FS-j22 and FS-j23.
- **FS-j20.P13 Outside text in the context.** If the context of a turn holds outside text (for example a report line that quotes an email), the turn never starts a run by itself: it shows a "Run <flow> now?" card the person clicks (SR-5).
- **FS-j20.P14 Two messages in a row.** One turn runs at a time per chat; a second message is stored at once and answered after the first. The composer stays usable.
- **FS-j20.P15 Pasted or dropped text.** Text the person pastes or drops into the composer is outside text (`chats.send {pasted: true}`): the turn that holds it never starts a run by itself and shows the card "Run <flow> now?" like P13 (SR-5). Decided for V1, revisable; Not in the prototype yet.
- **FS-j20.P16 The empty app.** (PU-04; Not in the prototype yet; it goes into the prototype first.) With no flows yet, the empty chat shows the heading and the composer and two starter chips, "Make a new flow" and "What needs me?", and no chip names a flow. "What needs me?" answers "Nothing is waiting for you." (`chat.nothingWaiting`). A typed request to run a flow that does not exist is answered with a short line and the chip "Make a new flow"; nothing starts. The Flows screen shows "No flows yet" with "Make a new flow" (FS-j21.P14).

- **FS-j20.P20 Notes during a run.** A message becomes `note_run` for the chat's running run, else its waiting run, newest within each; F-04.R13 lists the exceptions. The chat confirms "Noted. <flow> uses this from its next step." and the composer says "Add a note for <flow>". The next step gets the person's words with any outside mark intact; the run page lists waiting, used and unused notes. A note grants nothing and an undeclared action asks (FS-j24.P15); Stop and "What needs me?" keep working.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Chat | none -> new -> titled | `chats.create`; first message |
| Card (plan, run, ask, confirm) | open -> answered | Person clicks a button, or answers the question |
| Run | `queued` -> `checking` -> `running` | A start (`chats.act`, or `flows.start` from the window); the same flow has no active run |
| Run | `running` -> `waiting_approval` | A held action needs the person |
| Run | `waiting_approval` -> `running` | `approve`, `edit` or `reject` (reject skips the action) |
| Run | `running` -> `done` | All steps ended |
| Run | active -> `stopped` | "Stop" |
| Run | `running` -> `needs_login` | The agent is signed out (FS-j25) |
| Run | `running` -> `interrupted` | App or runner ended (FS-j20.E6) |
| Run | `running` -> `failed` or `blocked` | A step failed, or a check cannot pass |
| Decision | `pending` -> `approved`, `approved_edited`, `rejected`, `expired`, `allowed_always` | Person, or Stop, permission off or flow deletion |
| Standing rule | none -> active | "Always allow for this flow" (only a `change` at a fixed place) |
| Schedule (Fill timesheet) | weekdays 17:00 -> `after` Build APK | "Yes, every time" |

## Decisions and confirmations

- Asks: a plan card needs a click on "Start"; a flow named alone needs "Run"; a `new` or `changed` flow needs "Confirm"; every risky action (`change`, `send`, `post`, `pay`, `delete`, `merge`) needs "Approve" unless the confirmation covers that exact action and place, or, for a `change` at a fixed place only, a standing rule does (SR-1); "Yes, every time" needs a click; a typed stop needs "Stop".
- Does not ask: the "Stop" button, "Reject", "Always allow for this flow" (a click, no dialog), reads and writes inside the flow's declared folders (the confirmation covered them), and the chat turn itself.
- Typed words never confirm a card (FS-j20.P5). The agent never starts anything and never answers a decision (AD-10, SR-2).
- A rejected action is skipped, the run goes on, and the report says "You said no: <action>. It was not done." A rejection never stops a chain.

## Errors and edge cases

E11 depends on version 9; the others do not. E15 and E16 say why some template items do not apply.

- **FS-j20.E1 Agent not set up or signed out.** Cause: the chat's agent is `not_installed` or `needs_login`. Person sees: the message is stored, and FlowDriven answers with its own line "Claude Code needs you to sign in." and one button ("Sign in to Claude Code" or "Set up Claude Code", the same action as in Settings). No agent call is made. A run that finds the agent signed out shows "Waiting for sign-in" with "Sign in and continue" (FS-j25).
- **FS-j20.E2 Permission off** (PU-07). Cause: Settings switch is off. Person sees: the message is not sent; it stays in the composer with "FlowDriven may not run your AI agents." and a button "Turn on permission", which opens the "Before you start" dialog of Settings ("Give permission" turns it on there). `chats.send` answers `not_allowed: permission_off` and stores nothing; a start from a card or the Flows list returns `{outcome: "refused", reason: "permission_off"}`. No run is created. TC-j12-13 is the one runner-level owner of the `chats.send` rule.
- **FS-j20.E3 Missing or invalid inputs.** Cause: a required input is empty or invalid. Person sees: one short question for what is missing, with an example and "Use a form"; "Which date?"; "That's more than a working day. How long did you work?"; "How long? Zero hours can't be logged." Details in FS-j27. A flow with a file input opens its form at once.
- **FS-j20.E4 Limits reached** (PU-08, PU-09). Cause: the spending limit or an agent's usage limit is reached, or a flow's daily run limit (default 24). Person sees: the run card says "Needs you" with the decision "Monthly limit reached. Raise it in Settings to continue." (a `budget_raise` decision, SR-9); for the daily limit the chat says "<flow> reached its limit of <n> runs today." Next: nothing continues silently; after the limit is raised the run continues.
- **FS-j20.E5 A stopped or failed run** (PU-06). Cause: "Stop", a failed step, or a blocked check. Person sees: the card's state ("Stopped by you", "Failed", "Stuck") and the plain reason with "Details". In a chain, the rest does not start. After a stop FlowDriven says "Stopped. <names> did not start." After a failure it says "<flow> failed. <names> did not start." (the prototype stayed silent). A decision still waiting on a stopped run becomes `expired`.
- **FS-j20.E6 Crash or restart.** Cause: the app, the runner or the computer ends during a chain. Next launch: runs that were active become `interrupted` ("Stopped unexpectedly"). A run resumes by itself only when every interrupted step is marked idempotent; a step that may have half happened (the timesheet submit) is never repeated by itself (SR-8). The chain does not start the next flow while a run is `interrupted`. Chats, cards and waiting decisions are kept; a waiting decision still says "Needs you".
- **FS-j20.E7 A flow changed since it was confirmed.** Cause: the flow was improved, or its files changed, between the plan and the start, or while an earlier flow of the chain was running. Person sees: when the turn of that flow comes, `START` refuses and the chat shows "Confirm <flow> first?" and a "Needs you" item; the chain waits (SR-3).
- **FS-j20.E8 Computer asleep, or FlowDriven closed, at a scheduled time.** A chat start has no clock time. After "Yes, every time" the new schedule follows FS-j28 (catch up once within the grace window, else the slot is recorded as missed; Activity shows no row for it in V1). A run that was going while the computer slept continues after wake, or is `interrupted` as in E6.
- **FS-j20.E9 The assistant answer is not usable** (PU-05). Cause: invalid JSON, an unknown flow id, an unknown intent, a timeout, or no quota. Person sees: "I did not understand that. Try again, or pick one of these." with starter chips; for no quota the agent's own limit is named. Nothing starts and the audit log records the failed turn (Not in the prototype yet).
- **FS-j20.E10 Old cards after a flow is deleted.** The card says "a deleted flow" and loses its buttons.
- **FS-j20.E11 The agent cannot be limited for this flow** (PU-26). Cause: the chat's agent is Codex and the flow needs a tool Codex cannot be limited for (AD-09). Person sees: "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." (`chat.agentCannotRunFlow`, param `agent`); nothing is started. (Removed from V1: the offer "Run with Claude Code this time", the `other_agent` card and the `use_other_agent` action; they go into the prototype first, later.)
- **FS-j20.E12 Prototype gap: "Change" on a plan.** The prototype only replied "Tell me what to change." The real app lets the person say the change in the next message; the assistant returns a new plan card (reorder, drop a flow, change an input).
- **FS-j20.E13 Prototype gap: Indonesian "Hanya kali ini".** The prototype matched the chip text "Hanya kali ini" as "yes" because "Hanya" contains "ya". The real app uses card buttons with action ids, never text matching (FS-j30).
- **FS-j20.E14 Prototype gap: stubs.** Build APK always succeeded, and the timesheet service check "if the time is taken, take the free time the timesheet service suggests" was never shown. In the real app a failing step makes the run `failed` or `blocked`; the check is part of the flow's steps.
- **FS-j20.E15 A decision still waits the next day.** It remains under Needs you and the run page says the run waits for you (FS-j24.P7). Later scheduled slots for the busy flow are recorded as `skipped`.
- **FS-j20.E16 Outside text trying to steer the agent.** Covered by P13 and P15 (a context with outside text, or pasted or dropped text, never starts a run by itself) and by SR-5; text inside a flow's results is data and never a command.

## Data read and written

- Reads: `Flow` (name, inputs, result, touches, confirmed hash, schedule), `remembered`, `Settings` (`mainAgent`, `agentPermission`), `Run` list, `Decision` list, `StandingRule`.
- Writes: `Chat`, `Message` (with its card), `Run`, `Step`, `Decision`, one-time grant, `StandingRule`, `remembered` (when a run starts), the flow's schedule ("Yes, every time"), `AuditRecord` for every turn that failed, every start, every decision and every permission change.

## Runner API used

`chats.setAgent` depends on version 9; the others do not.

`chats.create`, `chats.get`, `chats.list`, `chats.send`, `chats.act` (it starts flows with source `chat` and runs the `flows.confirm` and `flows.setSchedule` functions), `chats.setAgent` (version 9), `flows.list`, `flows.get`, `runs.status`, `runs.stop`, `approvals.list`, `approvals.resolve`, `approvals.answer`, `rules.list`, `activity.summary`. Topics: `chats`, `runs`, `approvals`, `rules`, `flows`, `activity`.

## Acceptance criteria

A21 and A22 depend on version 9; the others do not.

- **FS-j20.A1** "New chat" reuses an empty chat (moved to the top of Today) or creates one titled "New chat"; the first user message sets the title to its first 40 characters and moves the chat to the top of Today.
- **FS-j20.A2** Enter sends; Shift+Enter adds a line; an empty or blank message is not sent.
- **FS-j20.A3** A chat turn is exactly one agent call with no tools and a JSON schema, on the chat's agent and model, with a context of at most 12 turns or 24,000 characters.
- **FS-j20.A4** FlowDriven checks every intent against its own state; an unknown flow id or intent starts nothing and shows FS-j20.E9.
- **FS-j20.A5** A question, a negation, a plain mention or a flow name alone never starts a run; it gives an answer, a status card, or a "Run <flow> now?" card.
- **FS-j20.A6** A turn whose context holds outside text never starts a run by itself; it shows a card the person clicks (SR-5).
- **FS-j20.A7** A chain shows a plan card with the order and starts only after "Start"; the first flow starts with source `chat`, the next with source `after` through `START`.
- **FS-j20.A8** A flow that is `new` or `changed` never starts from the chat; the confirm card comes first, and a flow that changes while a chain runs stops the chain at that flow (SR-3).
- **FS-j20.A9** Several flows without an order word run in parallel, one run per flow; a second run of a flow that is active is `queued`.
- **FS-j20.A10** The run card shows the flow name, state badge with words, track, current step, "Stop", and (version 9) the agent and model; a queued run behind a run that needs the person shows "The earlier run needs you first."
- **FS-j20.A11** "Stop" ends the agent's process group at once with no dialog and sets run and step `stopped` and waiting decisions `expired` (SR-8).
- **FS-j20.A12** If the first run of a chain ends `failed`, `blocked`, `stopped`, `needs_login` or `interrupted`, the rest does not start, and FlowDriven says which flows did not start; a rejected action does not stop the chain.
- **FS-j20.A13** A risky action shows a decision in the chat with "Approve", "Reject", "Details" and, only when its effect is `change` and its place is fixed in the flow, "Always allow for this flow"; the decision also shows in Activity and as a notification with fixed text only when no window is focused (PU-19).
- **FS-j20.A14** "Approve" writes a one-time grant bound to run, step, tool and exact input digest; the same action with other input is held again (SR-1).
- **FS-j20.A15** "Always allow for this flow" stores a standing rule for that flow, action and exact place, only for a `change` at a fixed place; the next run shows "Done by your rule: <step>." A decision of kind `send`, `post`, `pay`, `delete` or `merge` never offers it and never gets a standing rule (SR-1, SR-2).
- **FS-j20.A16** A flow with the result `chat` posts its answer lines in the run's chat, with `{inputId}` filled and lines with an unfilled placeholder dropped; a flow with the result `report` posts "Done. The report is in Activity." or, inside a chain, nothing extra.
- **FS-j20.A17** After a rejection, the chat shows "You said no: <action>. It was not done." in place of the answer line, and no "Both flows finished." offer appears.
- **FS-j20.A18** The repeat offer appears only when both runs ended `done`, nothing was rejected, and the schedule is not already `after`; "Yes, every time" and "Only this time" are card buttons, and no sentence, in any language, accepts the offer.
- **FS-j20.A19** While a card is open, typed "yes", "ok", "start" or "no" starts or changes nothing and answers "Use the buttons on the card above."
- **FS-j20.A20** With permission off, `chats.send` answers `not_allowed: permission_off`, stores nothing, makes no agent call, the composer keeps the text and shows "FlowDriven may not run your AI agents." with "Turn on permission", and no run is created; with the agent signed out, no agent call is made and the chat shows the next-step button (PU-07).
- **FS-j20.A21** (version 9) A run started from a chat records the chat's agent and model and passes the choice only through the agent's model flag (SR-4).
- **FS-j20.A22** (version 9) A chat with a not-ready agent never calls it; a flow that the chat's agent cannot be limited for shows "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." and starts nothing (PU-26).
- **FS-j20.A23** After a restart, runs that were active are `interrupted`, a step not marked idempotent is not repeated by itself, and the chain does not continue (SR-8).
- **FS-j20.A24** Every turn that failed, every start, every decision and every permission change is in the audit log and shown in plain words on the run page (SR-7).
- **FS-j20.A25** When the spending or usage limit is reached, the run pauses with one "Needs you" item and does not continue until the person acts (SR-9, PU-08).
- **FS-j20.A26** With no flows yet, the empty chat offers only the chips "Make a new flow" and "What needs me?", and "What needs me?" answers "Nothing is waiting for you." (PU-04).

## Not in the prototype yet

- Still to be shown in the prototype before the build: the agent reading the person's sentences (the prototype used keyword rules), "Change" that revises a plan, starter chips from the person's own flows, PU-04 (the empty app), PU-05 (the unusable-answer line), PU-06 ("<flow> failed. <names> did not start."), PU-07 (the permission-off refusal), PU-08 and PU-09 (the limit pause and the daily run limit line), PU-13 ("Set this schedule?"), PU-14 (the confirm-again dialog), PU-19 (system notifications with fixed text only) and PU-26 (Codex cannot run this flow safely yet).
- Removed from V1 (later, prototype first): the offer "Run with Claude Code this time" and the `other_agent` card; the outside tag on "Done by your rule" lines; standing rules for `send`, `post`, `pay`, `delete` and `merge`.

## Drafter's calls

- A typed stop still shows a card "Stop <flow>?" (as in the prototype). The "Stop" button on a run card never asks. Reason: a typed sentence can be a question or a negation.
- Inside a chain a report flow posts no extra "Done." line, so the run card is the one place that shows its result (as in the prototype).
- The "Both flows finished." line is written by FlowDriven from the runs' first report lines; the prototype's sentence about the APK path was canned sample text.
- A failed first flow now posts a line; the prototype stayed silent.
- The repeat offer's schedule change replaces the flow's old schedule and says so, because a flow has one schedule.
- Always allow stays as in the prototype but only for a `change` at a fixed place; risky kinds always ask (Decided for V1, revisable). Reason: a standing rule for a send or post needs destination-level places and a step-level rule about outside text, which is a later approvals change with its own review.
