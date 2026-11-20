# FS-j27: A flow that needs details from you

| Item | Value |
|---|---|
| Journey | j27, "Flow yang butuh info dari Anda", Flows that need info from you |
| PRD features | F-05, F-03, F-06 |
| Safety rules | SR-1, SR-5, SR-7; START (rule 2, missing inputs) |
| Prototype source | Brief sections 16.5, 23 (intro), 23.1, 23.2, 23.4, 23.7-23.10; `js/screens/chat.js` (`parseInputs`, `collectInputs`, form card), `js/actions.js` (`inputsFor`, `startRun`, `resolvedInputs`), `js/guide.js` (j27) |
| Status | In the prototype (version 8); the chat language rules are Pending prototype version 9; the agent reading the sentences, the typed parsers in the runner, the form draft and the hidden-character check are Not in the prototype yet |

## Goal

When a flow needs details (the timesheet: date, start time, duration, customer, project, activity, what you did), the person writes them in plain words in the chat, or fills a form if they prefer. FlowDriven asks only for what is missing and remembers answers for next time. The result appears in the chat.

## Entry points and trigger

- The chat: a message that names a flow, or answers a question FlowDriven asked.
- The same ask also happens outside a chat: "Run" on the Flows list (FS-j21.P1), a schedule (FS-j28), "after another flow" and the next flow of a chain (FS-j20). All of them use `START` rule 2.
- Trigger: a start needs a required input that has no value after the three fill steps below.

## Preconditions

- The flow is confirmed (SR-3) and declares its inputs (format 1.2): types `text`, `longtext`, `number`, `bool`, `date`, `time`, `duration`, `choice` (alias `enum`), `url`, `file`, `folder`; each may have `required`, `default` (a value, or the codes `today` and `now`), `example` and `remember`.
- Permission is `on` and the chat's agent is `ready`, because reading a sentence is a chat turn (FS-j20).

## Main path

> Pending prototype version 9: this part follows brief sections 24, 24.9 and 25 on the prototype's lang-files branch and may change.

Language details in S2 (the chat answers in the language the person writes) depend on version 9.

1. **FS-j27.S1 New chat.**
   - Person: clicks "New chat".
   - FlowDriven: as FS-j20.S1.
   - Sees: the empty chat.
2. **FS-j27.S2 One sentence with everything.**
   - Person: types "isi timesheet hari ini 2 jam bikin halaman login" and presses Enter.
   - FlowDriven: one chat turn. The agent returns the intent `run`, the flow id and the raw values it found as text (date "hari ini", duration "2 jam", what you did "bikin halaman login") and the language `id`. FlowDriven parses and checks every value itself (FS-j27.A4). It fills the inputs in this order: values from the message; remembered answers (never for dates or times); defaults. Date "today" is resolved in the person's time zone. Nothing is missing, so it starts at once (source `chat`).
   - Sees: a line in the chat's language listing what was understood, in English "Starting Fill timesheet: today, next free time, 2h, Project Example (Example Corp), Feature work, "bikin halaman login"." (the Indonesian line comes from the language file), and a run card (FS-j20.S4). The answer later uses the run's language for dates, for example "Kam 19 Nov".
3. **FS-j27.S3 Approve and read the result.**
   - Person: clicks "Approve" on the decision "Submit this timesheet entry?" (FS-j20.S6).
   - FlowDriven: grant, run ends `done`, result `chat`: the answer lines are posted with `{inputId}` filled and the end time computed as start plus duration.
   - Sees: "Logged Thu 19 Nov, 13:00-15:00 (2h): Project Example (Example Corp), Feature work." and ""Bikin halaman login pada Project Example." Entry 4812." (date and joining word follow the run language; the entry number comes from the timesheet service).
4. **FS-j27.S4 A sentence with a gap, then the form.**
   - Person: types "isi timesheet".
   - FlowDriven: required inputs "Duration" and "What you did" have no value (customer, project and activity are remembered; date and start have defaults). It posts one short message built from the inputs' questions and examples, and saves a waiting question (`waiting_questions`, kept across restarts).
   - Sees: "Fill timesheet: How long did you work, and what did you work on? For example: 2 hours, built the login page. Like last time, I'll use Project Example (Example Corp), Feature work." with chips "2 hours, built the login page" and "Use a form".
   - Person: clicks "Use a form".
   - FlowDriven: `chats.act {action: "use_form"}` builds a form from the flow's input list, filled with every value already known.
   - Sees: a card titled with the flow name and "Change anything, then Start."; a date picker, a time picker, text fields, a select for "Activity" (with "Choose"), a text area for "What you did"; optional fields end with " (optional)"; remembered and default values are filled in.
   - Person: fills it and clicks "Start".
   - FlowDriven: `chats.act {action: "submit_form", values}`. It validates each field with the same parsers (FS-j27.E3 lists the messages), then starts. The fields turn read-only. Remembered inputs are saved when the run starts.
   - Sees: the fields disabled and the run card.

## Other paths

> Pending prototype version 9: this part follows brief sections 24, 24.9 and 25 on the prototype's lang-files branch and may change.

P7 depends on version 9; the others do not.

- **FS-j27.P1 Answer a question in words.** The person answers "2 hours, release build" in a normal message. The turn returns `fill_inputs`; FlowDriven fills only what is still missing and asks again only for what is still missing or invalid. The card of the question is marked answered.
- **FS-j27.P2 Use my last answers.** In an open question the person types "use my last answers" (or clicks the option). FlowDriven applies the last run's values (`lastInputs`) except date and time inputs, which return to their defaults. If the last answers do not cover the required inputs, it asks for the rest. From a schedule the same rule is the field "When it's time" (FS-j28).
- **FS-j27.P3 Several flows with gaps.** For a chain or flows together, one message lists the missing inputs of each flow under its name ("Fill timesheet: ..."). Then the plan card shows (FS-j20.P2).
- **FS-j27.P4 A file or folder input.** The form opens at once ("Choose the file and fill in the details.") because a file cannot be typed.
- **FS-j27.P5 Cancel.** In an open question or form, cancel words or the form's "Cancel" give "Okay, I won't start it." and the waiting question closes. No run starts.
- **FS-j27.P6 Another request while a question is open.** A status request, "make a flow ..." or another flow plus a run word is handled; the question stays open unless the message carries values for it. A message that is not an answer and not a request ("why?", "?") gets "I need these details to start the flow."
- **FS-j27.P7 The question follows the chat's language.** The question, the line "Starting ..." and the chips "Use a form" come from FlowDriven's language file in the chat's language (pending version 9). The example text is the flow's own `example`, kept as the flow author wrote it.
- **FS-j27.P8 Text read from outside.** A value that the agent found in text from outside (a pasted email the person sent, a page) may fill a typed input, is shown to the person in the line "Starting ...", and still passes the same parsers. A turn whose context holds outside text never starts the run by itself: it shows a card "Run <flow> now?" that the person clicks (SR-5). Outside text is never taken as the person's own words, and it can never add a tool, a place or a permission.
- **FS-j27.P9 Typing while the form is open.** The reply is "Please fill in the form above, then choose Start." and nothing else happens.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Waiting question | none -> `open` | `START` rule 2 finds a required input missing |
| Waiting question | `open` -> `answered` | Enough valid values arrive, in words or by the form |
| Waiting question | `open` -> `cancelled` | Cancel words or "Cancel" |
| Waiting question | `open` -> `closed` | The flow is deleted |
| Form card | `open` -> `submitted` | "Start" with no error |
| Remembered answer | old value -> new value | A run starts with a changed `remember` input |
| Run | none -> `queued` or `checking` | `START` rule 3 |

## Decisions and confirmations

- Asks: only for a required input that is missing or invalid (one short message, or the form). Optional inputs are never asked.
- Does not ask: when every required input has a value from the message, a remembered answer or a default; "Start" on a form needs no second confirmation.
- A start that follows a question is not a new permission. The decision of a risky action is separate and still asks (FS-j24). Typed words never approve anything.
- Remembered answers are saved when the run starts, not when it ends, so a stopped or failed run keeps them.

## Errors and edge cases

- **FS-j27.E1 Agent not set up or signed out.** Cause: the chat's agent cannot take a chat turn. Person sees: "Claude Code needs you to sign in." and its button (FS-j20.E1). The form still opens from the flow page and the Run button; its run then shows "Waiting for sign-in".
- **FS-j27.E2 Permission off.** Cause: switch off. Person sees: the message stays in the composer with "FlowDriven may not run your AI agents. Turn this on in Settings."; a form "Start" shows the same line and starts nothing.
- **FS-j27.E3 Missing or invalid inputs.** Cause: a value cannot be used. Person sees, in the chat or under the form field (the first invalid field is focused and marked invalid):
  - date not understood: "Which date?"
  - duration not understood: "Tell me how long you worked, for example 2 hours."
  - duration zero: "How long? Zero hours can't be logged."
  - duration more than 16 hours: "That's more than a working day. How long did you work?"
  - number below its minimum or above its maximum: "Enter a number from <min> to <max>."
  - choice that is not one of the choices: the question lists the choices as chips
  - empty required text: "Fill in <label>." and, for what you did, "Tell me what you worked on."
  - empty file or folder: "Choose <label>."
  - text with hidden or format characters: "That text has characters FlowDriven cannot show. Please type it again."
  - longtext over 4,000 characters: "Keep it under 4,000 characters."
  A value for an input the flow does not declare is ignored. Next: only the invalid part is asked again.
- **FS-j27.E4 Limits reached.** Input limits are in E3. Run limits (spending, usage, daily) pause the run after the inputs are given, with a "Needs you" item (FS-j20.E4, SR-9).
- **FS-j27.E5 A stopped or failed run.** The remembered answers and the last answers were saved at start, so "Run again" and "Use my last answers" work (FS-j25).
- **FS-j27.E6 Crash or restart.** The waiting question and its card are in the store and still wait. The composer draft is kept (`drafts`). Values typed in a form but not yet submitted are view state and are lost. A restart never starts a run that was waiting for details.
- **FS-j27.E7 The flow changed since it was confirmed, with a question open.** Cause: the flow was improved before the person answered. Person sees: after the answer, `START` rule 1 shows "Confirm <flow> first?"; the values given are kept and used after "Confirm". If the flow's input list changed, values for removed inputs are dropped and new required inputs are asked again.
- **FS-j27.E8 Computer asleep, or FlowDriven closed, at a scheduled time.** A question that FlowDriven posts for a schedule (FS-j28) belongs to the slot's day. When the person answers later, "today" and "now" resolve to the slot's date and time, not to the time of the answer, so the entry lands on the right day. If the slot is missed (FS-j28.E8) no question is posted.
- **FS-j27.E9 Prototype gap: keyword parsing.** The prototype read sentences with word lists in English and Indonesian. In the real app the agent extracts values and FlowDriven validates them with its own parsers, so other phrasings and other languages work.
- **FS-j27.E10 Prototype gap: stubs.** "Next free time" was always 13:00 and the timesheet service conflict check was never shown. In the real app the start time may be left empty, and the flow's own step asks the timesheet service for the next free time; a conflict makes the step fail or ask, as the flow says.

## Data read and written

- Reads: `Flow` (input declarations, result, answer template), `remembered`, last inputs, `Chat`, `waiting_questions`, `Settings` (the person's time zone from the operating system).
- Writes: `waiting_questions`, `Message` and `Card` (questions, forms, the "Starting ..." line), `remembered` and last inputs (at run start), `Run` (resolved inputs), `AuditRecord` (start, source `chat` or `proactive`).

## Runner API used

`chats.send`, `chats.act` (actions `use_form`, `submit_form`, `cancel_question`, `use_last_answers`), `chats.get`, `flows.get`, `flows.start`, `runs.status`. Topics: `chats`, `runs`, `flows`.

## Acceptance criteria

> Pending prototype version 9: this part follows brief sections 24, 24.9 and 25 on the prototype's lang-files branch and may change.

A13 depends on version 9; the others do not.

- **FS-j27.A1** Inputs are filled in this order: values from the message, remembered answers, defaults; remembered answers are never used for date or time inputs.
- **FS-j27.A2** FlowDriven asks, in one short message with an example and a "Use a form" chip, only for required inputs that are missing or invalid; optional inputs are never asked.
- **FS-j27.A3** When nothing is missing, the flow starts at once and the chat shows a line listing the resolved values.
- **FS-j27.A4** Every value is parsed and checked by FlowDriven's own parsers, whatever the agent returned; an invalid or undeclared value is never passed to the run.
- **FS-j27.A5** Dates (today, yesterday, a weekday name, a day and month) resolve in the person's time zone, including `Asia/Jakarta` near midnight, and a date that cannot be read gives "Which date?".
- **FS-j27.A6** Durations accept hours, minutes and words in both languages, refuse zero, and ask again above 16 hours with the stated messages.
- **FS-j27.A7** A choice input accepts only a declared choice; anything else asks with the choices as chips.
- **FS-j27.A8** The form has one field per input of the right kind, is filled with known values, marks optional fields, validates on "Start" with the stated messages, focuses the first invalid field, and turns read-only after a valid "Start".
- **FS-j27.A9** While the form is open, typed text gets "Please fill in the form above, then choose Start." and starts nothing; "Cancel" gives "Okay, I won't start it." and closes the question.
- **FS-j27.A10** Remembered answers are saved when the run starts, only for inputs that declare `remember`, and "What you did", dates and times are not saved as remembered answers.
- **FS-j27.A11** "Use my last answers" applies the last values except date and time; it is refused with a question for the rest when they do not cover the required inputs.
- **FS-j27.A12** For several flows, one message groups the missing inputs by flow name; a file input opens the form at once.
- **FS-j27.A13** (pending version 9) The question and the "Starting ..." line follow the chat's language; the agent answers in the language the person writes; chips and buttons never change the chat's language.
- **FS-j27.A14** The answer lines of a `chat` result are filled from the run's inputs and outputs, lines with an unfilled placeholder are dropped, and dates follow the run's language.
- **FS-j27.A15** A value that came from outside text may fill an input but the turn never starts the run by itself (SR-5).
- **FS-j27.A16** Text with hidden or format characters is refused in typed inputs and forms.
- **FS-j27.A17** A waiting question survives a restart and still waits; a restart starts nothing.
- **FS-j27.A18** If the flow changed since it was confirmed, the start after the answer shows the confirm card first and keeps the given values; changed input declarations are re-checked.
- **FS-j27.A19** For a scheduled question, "today" and "now" resolve to the slot, not to the moment of the answer.

## Not in the prototype yet

- The agent reading sentences, the typed parsers in the runner, FS-j27.E3 messages for number, choice and hidden characters, the 4,000 character limit, the slot rule in E8, and the restart rules in E6 and E7.

## Drafter's calls

- A weekday name means the most recent such day up to today; "last <weekday>" means the one before. The prototype used the current week.
- The remembered-answer rule keeps the prototype's list: customer, project and activity are remembered; date, start and what you did are not.
- Cancel is a field on `fill_inputs` (`cancel: true`), not a new intent, so the intent list stays as in AD-10.
- The start input of the timesheet is optional and empty means "next free time"; the flow's step asks the timesheet service. The format has no code for it (AD-04 has only `today` and `now`).
- 4,000 characters for longtext matches the limit the engine already uses for own text.
