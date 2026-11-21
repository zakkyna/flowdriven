# FlowDriven product requirements (PRD)

Status: complete for the V1 build, 2026-11-21. This file owns the ids `F-01`.., `NF-01`.., `M-01`.. and the decisions `Q-01`..`Q-03` (decided for V1, revisable; section 10). Other files in `docs/design/` cite them. The safety rules `SR-1`..`SR-9` and the start rule `START` are owned by `docs/design/architecture.md`; this file restates them in plain words.

How to read the ids: `F-07.R3` is requirement 3 of feature F-07. A requirement is written so one test can show it true or false. A number marked "target" is the drafter's own proposal, decided for V1 (revisable) and measured during V1. Other numbers come from the original spec or from the code that exists today.

A feature is marked with one of three flags:
- "In the prototype (version 8)": the owner has tried it.
- "In the prototype (version 9)": it follows the final brief sections 24.9 to 24.11 and 25 of the clickable prototype (the language setting, one file per language, and the AI agent and model picker).
- "Not in the prototype yet": it must go into the prototype and be approved before it is built (AGENTS.md: prototype first).

## 1. Purpose

FlowDriven is an open-source app that turns your routine into a step-by-step AI workflow, runs it on the AI agent you choose, and checks every step. (This is the approved one-line description.)

FlowDriven is the foreman over the person's AI agents, not a new assistant. The person already has agents such as Claude Code and Codex. FlowDriven does not replace them. It does four jobs around them:
- It turns work the person repeats into a flow: named steps, what the flow needs, what it may touch, and where the result goes.
- It runs the flow on the agent the person already has, one step at a time.
- It decides what may happen without asking. The agent never decides that.
- It counts a step as done only when a check the agent does not control passes.

FlowDriven is not:
- a new AI model or a new chat assistant (the chat is a front door to the person's own agents);
- a hosted service (nothing runs in the cloud);
- a set of connectors of its own (it reaches accounts through what the agents have, and later through the FlowDriven gateway);
- a tool that passes sign-in or robot checks, or that reads an agent's own sign-in files.

## 2. Users and situations

### 2.1 Primary: people who are not technical and want to talk to the app

Situation. The person has some work they repeat: a weekly report, logging hours, sorting email. They do not want to learn what an agent, a step or a connector is. They want to write what they need in the chat and get the result.

| | |
|---|---|
| Goals | Make a flow once by describing it in plain words. Run it by hand from the chat or on a schedule. Never be surprised by something sent, posted, paid for, deleted or merged. |
| Pains | Technical words. Too many steps before the first result. AI that says "done" when it is not. Fear that an agent acts on their accounts alone. |
| Success | They install, set up one agent and run a first flow in one sitting. They use it on most working days. They approve or reject things in plain words and can always see what ran and why. |

### 2.2 First user: a freelancer who builds apps

Situation. The first user (and the first test of the product) does this work: builds mobile apps and delivers builds; logs work hours in a timesheet tool at the end of the day; reads job alerts and picks the jobs worth a proposal. Some of this is a chain ("build the APK and upload it, then fill my timesheet"). Some is a daily question (the 17:00 timesheet question).

| | |
|---|---|
| Goals | Run a chain of flows from one sentence. Answer one short question at 17:00 instead of opening a form. Review job posts without sending anything. Keep the agents' limits and bills under control. |
| Pains | Repeating the same details every day. Agents that stop at a sign-in and nobody notices. Fear of an email or a timesheet entry going out wrong. |
| Success | The 17:00 question takes under a minute. Flows with remembered answers start without questions. Nothing risky happens without a decision or a rule the person set and can see. |

### 2.3 Developers who make and share flows

Situation. They write flows as files (flow format 1.2) with the SDK, test them against fake agents, and later publish them to the marketplace.

| | |
|---|---|
| Goals | A stable, documented, open flow format. Tests that never need a real agent or account. An adapter port to add another agent. Language files they can add in one file. |
| Pains | Closed formats. Flows that behave differently on each agent. Unclear safety rules for what a flow may declare. |
| Success | A flow that passes the SDK checks runs the same way on every supported agent, or says plainly why it cannot. A new language is one new file plus one line. |

## 3. Goals and non-goals

### 3.1 Goals

- G1. A person who is not technical can make, improve, run and schedule flows by talking to the app.
- G2. Fewer steps: one Set up click per agent, one permission for all agents, one confirmation per flow.
- G3. Safe by one general rule (SR-1) that people can understand and developers can test.
- G4. Honest status and honest "done".
- G5. Everything stays on the person's Mac.
- G6. English by default with Bahasa Indonesia, and a one-file path for more languages.
- G7. Open source: AGPL-3.0 core, MIT SDK and flow format.

### 3.2 Non-goals

- Not a new AI model or assistant.
- No hosted runtime. Nothing runs on a FlowDriven server.
- No new integrations of its own beyond what the agents and the later FlowDriven gateway give.
- Mac first. Windows after the first release, Linux later.
- No paid flows yet.
- No WhatsApp.
- It never passes a sign-in or robot check. A run that meets one waits for the person (`needs_login`).
- It never reads an agent's own sign-in files.
- No raw "full access" or permission-bypass mode for any agent, ever, for any person.
- No telemetry.

## 4. Product principles

1. Chat first. The everyday way to use the app is to write what you want. Screens exist to see, check and change.
2. Plain words. No jargon on any screen ("AI agent", never "harness"; "Confirm", not "sign-off"). Status is always an icon plus words, never colour alone.
3. Ask only what is needed. The chat asks for what it does not know, once, with an example. A form is there for people who want one.
4. One permission for all agents. Given once at first launch, switchable in Settings (owner decision, 2026-11-18).
5. One general safety rule. SR-1 decides what runs by itself and what waits, for every agent, tool and flow. Special cases per connector are a refinement, never the base.
6. Honest status and honest "done". A step counts as done only when a check the agent does not control passes (spec 9.3). A report says only what really happened, including "You said no: X. It was not done."
7. Local and private. Chats, flows, memory and the audit log stay on the Mac. No telemetry.
8. Works with the agents you already have. FlowDriven adds no model of its own. The person's agent signs in through its own flow.
9. Prototype first. The owner tries each flow in the clickable prototype and approves it before it is built.

## 5. Features

Every feature has: what it is, what the person experiences, numbered requirements, the journeys and flow spec files (in `docs/design/flows/`), the release candidate (section 9) and a status flag. UI words are the prototype's English.

### F-01 First launch and agent set up

What it is. The welcome screen that gets the person from "installed" to "ready to chat" with one click per agent. The language options on this screen are the version 9 part.

What the person experiences. Heading "Welcome to FlowDriven". A card "Get started": "FlowDriven runs your flows on the AI agents on this Mac. Choose one to set up. This also gives FlowDriven permission to run your AI agents, now and later. You can change that in Settings." One card per agent with name, maker, an account line ("Sign in with your Claude account" or "Sign in with your ChatGPT account"), a badge ("Supported" or "Check the terms") and a button "Set up Claude Code" or "Set up Codex". While it works: "Installing" and "Waiting for you to sign in..." with no button. A ghost link "Install it yourself". A line "Already installed one? Scan again". When ready: "You're ready" and "Start chatting".

Requirements.
- F-01.R1. While the one permission is off or no agent is `ready`, the app shows the welcome screen first and the menu items do not lead anywhere else.
- F-01.R2. Each card shows the agent's name, maker, account line and a terms badge. The note "Some agents sign in with your own subscription, for example Claude Code. Check the maker's terms before you let flows run while you are away." is shown on the screen.
- F-01.R3. One click on "Set up <agent>" turns the one permission on, installs the agent if it is `not_installed`, and then waits for sign-in. No dialog and no second click.
- F-01.R4. The install command comes only from FlowDriven's own catalog, never from a flow or from text the app read. It is shown only inside the "Install it yourself" dialog.
- F-01.R5. Sign-in happens in the agent's own flow. FlowDriven finds out by polling the agent's own status command, never sees a password and never reads the agent's sign-in files (SR-6). When the agent reports signed in, its state becomes `ready` with no click.
- F-01.R6. Agent states are shown in words: `not_installed`, `installing`, `waiting_login` ("Waiting for you to sign in..."), `needs_login`, `ready`, `unknown`.
- F-01.R7. "Install it yourself" opens a dialog with the manual steps and the command. "Scan again" runs `agents.rescan` and says what it found, or "Nothing new found."
- F-01.R8. When the permission is on and one agent is `ready`, the cards give way to "You're ready". "Start chatting" opens a new empty chat.
- F-01.R9. If an install or a sign-in fails, the screen says in one plain sentence what happened and shows one button to try again. No apology text. (Not in the prototype yet: the prototype has no failure path.)
- F-01.R10. First launch ends only when the permission is on and at least one agent is `ready`. Setting up only Codex ends it; a flow that needs Claude Code then says so in plain words and offers "Set up Claude Code" (see F-04.R9).

Journeys and flow specs: j01, `flows/j01-first-launch.md`. Release: V1 (B-21, with B-07 and B-22). Status: In the prototype (version 8); the language options on this screen are in the prototype (version 9); R9 is Not in the prototype yet.

### F-02 App shell: sidebar, chat list, Search

What it is. The frame of the app: a sidebar like Claude's. The menu is fixed on top. Only the chat list below it scrolls.

What the person experiences. From top to bottom: the FlowDriven mark and name; the fixed menu "New chat", "Search", "Flows", "Activity" (with a count of things that need the person), "Skills", "Memory", "Marketplace", "Phone & bots"; the chat list in groups "Today", "Yesterday", "Earlier"; at the bottom "Settings" and the main agent's status line. Search opens with Cmd+K (Ctrl+K elsewhere).

Requirements.
- F-02.R1. The menu and the Settings row never scroll. Only the chat list scrolls, with a thin line between menu and list.
- F-02.R2. The chat list shows every chat (no limit of six), newest first inside each group, one line per chat showing its title with an ellipsis. Empty groups are left out. The open chat is marked as the current page for screen readers.
- F-02.R3. Sending a message moves that chat to the top of "Today".
- F-02.R4. The Activity count equals the number of decisions waiting plus the number of waiting scheduled questions (see F-14.R2).
- F-02.R5. Search opens with Cmd+K or Ctrl+K from any screen except while a dialog is open. With empty input it shows "Recent chats" (the five newest) and "Flows" (every flow). With text it shows "Chats" (title or any message) and "Flows" (name or summary). With no match it says `Nothing found for "<text>".` Enter opens the first result.
- F-02.R6. Search runs in the runner over chat titles, message text, flow names and summaries with a result limit, and never leaves the Mac.
- F-02.R7. On narrow screens the same parts sit in a drawer: a top bar with Menu, the title and Activity; every route change closes the drawer; a "Close menu" button and a scrim close it; below 400 px the menu shows icons only.
- F-02.R8. "New chat" reuses an empty chat if one exists, so empty chats do not pile up.
- F-02.R9. The prototype shows all eight menu items. In the real app a screen appears when its release ships (section 9, Q-01). No item says "Coming later".

Journeys and flow specs: j20 (`flows/j20-run-from-chat.md`) and j12 (`flows/j12-settings.md`). Release: V1 (B-16). Status: In the prototype (version 8).

### F-03 Chat

What it is. The main screen. The person writes; the agent understands; FlowDriven decides and shows cards. The agent answers in the language the person writes in (version 9).

What the person experiences. An empty chat shows "What should I do?" and "I can run your flows, make a new flow, or improve one." with starter chips such as "Make a new flow" and "What needs me?". The composer has a text box, a Send button and (version 9) the agent and model picker. Enter sends; Shift+Enter adds a line. Agent messages have no bubble; the person's messages are on the right. Cards sit inside messages. Suggestion chips sit under the last agent message.

Requirements.
- F-03.R1. Enter sends the message. Shift+Enter adds a new line. A draft is kept per chat until sent.
- F-03.R2. `chats.send` returns at once. The reply arrives through the `chats` topic. The person's message shows immediately and a working indicator shows while the agent answers.
- F-03.R3. Each turn is one agent call with no tools and a fixed answer shape (an intent plus reply text and its language). FlowDriven checks the intent against its own state and turns it into messages and cards. The agent never starts anything.
- F-03.R4. The context for a turn is compact: flows with names and inputs, remembered answers, what runs and what needs the person, and the last turns up to 12 turns or 24,000 characters.
- F-03.R5. Cards are real controls: buttons and form submits go through `chats.act`. A card that was answered shows its answer and its fields disabled. A card for a deleted flow says "a deleted flow" and loses its buttons.
- F-03.R6. Typing "yes" or "ok" while a card is open that needs a click gets "Use the buttons on the card above." and does nothing else.
- F-03.R7. A chat title is "New chat" until the first message sets it to that message cut to 40 characters. A chat that FlowDriven starts (for example the 17:00 question) is titled with the flow name.
- F-03.R8. Opening a chat scrolls to the bottom. A new message keeps the view at the bottom if the person was within 120 px of it.
- F-03.R9. Agent text and outside text are shown by a safe text renderer: no raw HTML, no remote images; links are shown and open only after the person clicks and the app checks them (SR-5).
- F-03.R10. A chat turn whose context holds outside text never starts a run by itself. It shows a card the person clicks (SR-5).
- F-03.R11. The agent answers in the language the person writes in and uses the app language when that is unclear. FlowDriven's own cards and buttons follow the app language. (In the prototype (version 9).)

Journeys and flow specs: j20 (`flows/j20-run-from-chat.md`), j27 (`flows/j27-flow-inputs.md`). Release: V1 (B-08, B-17). Status: In the prototype (version 8) with prepared answers; R11 is in the prototype (version 9); reading the person's sentences with the real agent is Not in the prototype yet (the prototype's wording is scripted, brief 23.9).

### F-04 Run flows from the chat

What it is. The person writes which flow to run: one, several at the same time, or a chain. They can stop a run and ask what is going on. The chat never starts what was not asked. Run cards name the chat's agent and model (version 9).

What the person experiences. "Run Build APK and upload it, then fill my timesheet" gives a plan card "I'll run these one after the other:" with numbered names and "Start" and "Change". Two flows with no order word give "I'll run both at the same time." A run card shows the flow name, a status badge, a track of steps, "Step 2 of 4: Build the APK", and "Stop". When a chain ends: "Both flows finished." and the offer "Do this every time?" with "Yes, every time" and "Only this time".

Requirements.
- F-04.R1. Intents: `answer`, `run`, `run_together`, `run_chain`, `stop`, `status`, `schedule`, `unschedule`, `make_flow`, `make_flow_from_skill`, `improve_flow`, `fill_inputs`. An answer outside this list is shown as plain text and starts nothing.
- F-04.R2. A flow named without a run word, a question ("is Build APK done?"), a negation and a plain mention each give a card or a status answer, never a run. A flow named alone gives a card "Run <name> now?" with "Run" and "Not now".
- F-04.R3. Several flows in order become a plan card; the second and later items read "starts when <previous flow> finishes". "Start" starts the first; each next flow starts when the one before finishes `done` and goes through `START`.
- F-04.R4. Several flows without an order word run at the same time: "I'll run both at the same time." or "I'll run all <n> at the same time."
- F-04.R5. A first flow that fails, is stuck, stopped or waiting for sign-in never starts the rest of the chain. If the person stops it, the chat says "Stopped. <names> did not start."
- F-04.R6. A run card shows the current step by this rule: the first step that is running, waiting, starting, trying again or stopped; else the first not started; else the last. "Stop" ends the run at once with no confirmation (SR-8).
- F-04.R7. Status words in chat ("what needs me?") give a card: "<n> things need you:" with an "Open" link for each, then "Running now: <names>" or "Nothing is running." Stop words with nothing running give "Nothing is running right now."
- F-04.R8. A run queued behind a run of the same flow that needs the person says "The earlier run needs you first." with a link to that run.
- F-04.R9. A run that cannot start because the permission is off or the agent is not ready shows the plain reason and one button (for example "Set up Claude Code"). A flow that needs a tool the chosen agent cannot be limited for shows a plain reason and offers Claude Code.
- F-04.R10. After a chain finishes, the chat offers "Do this every time?" with "Yes, every time" and "Only this time". "Yes" sets the schedule `after`; "Only this time" changes nothing. Matching these answers uses whole words only (the prototype matched "Hanya" as "ya": a bug not to repeat).
- F-04.R11. Runs started from a chat run on that chat's agent and model, and the run card and run page name them, for example "Claude Code · Sonnet 5.5". (In the prototype (version 9).)
- F-04.R12. A flow runs at most once per request. Two flows set to run after each other stop after one round.

Journeys and flow specs: j20, `flows/j20-run-from-chat.md`. Release: V1 (B-10, with B-08). Status: In the prototype (version 8); R11 is in the prototype (version 9).

### F-05 Flow inputs

What it is. Some flows need details from the person (the timesheet needs date, start, duration, customer, project, activity and what was done). The chat asks only for what it does not know. A form is there for people who want one. Answers are remembered.

What the person experiences. "Fill timesheet: How long did you work, and what did you work on? For example: 2 hours, built the login page. Like last time, I'll use Project Example (Example Corp), Feature work." with the chips "2 hours, built the login page" and "Use a form". A form card has one field per input, filled with known values, "Required" in words, and a Start button.

Requirements.
- F-05.R1. Input types: `date`, `time`, `duration`, `text`, `longtext`, `number`, `choice` (alias of `enum`), `file`, each with optional `example`, `remember` and a default (a literal or the codes `today` and `now`).
- F-05.R2. FlowDriven validates every value with its own typed parser. The agent's reading of a sentence is a proposal only. Dates are resolved in the person's time zone. Times are `HH:MM`. Durations are in minutes with limits: zero or over 16 hours is asked again.
- F-05.R3. Values fill in this order: from the message, from remembered answers (never dates or times), from defaults. Only missing or invalid required inputs are asked.
- F-05.R4. The question is one short message with an example and a "Use a form" chip. With several flows it is one message grouped by flow name.
- F-05.R5. The form shows one field per input, known values filled in, native pickers for date and time, a choice list, a text area for long text. Start checks every field: an error per empty field in words, the first invalid field gets focus and `aria-invalid`. Cancel says "Okay, I won't start it." and starts nothing.
- F-05.R6. A `file` input opens the form at once.
- F-05.R7. Remembered answers are saved when a run starts. "Use my last answers" never reuses a date or a time.
- F-05.R8. Text that came from outside (an email, a web page) may fill typed inputs but never changes what a flow may touch (SR-5).
- F-05.R9. When nothing is missing the flow starts at once and the chat lists the values it used ("Starting Fill timesheet: today, next free time, 2h, ...").
- F-05.R10. The person can answer in plain words in either supported language ("2 jam, bikin halaman login").

Journeys and flow specs: j27, `flows/j27-flow-inputs.md`. Release: V1 (B-09, with B-02). Status: In the prototype (version 8) with prepared understanding; real parsing by the agent is Not in the prototype yet.

### F-06 Results

What it is. Each flow says where its result goes: as an answer in the chat, or as a report only. The report is honest about the person's decisions.

What the person experiences. A chat flow posts its answer lines in the chat ("Logged Thu 19 Nov, 13:00-15:00 (2h): Project Example (Example Corp), Feature work."). A report flow says "Done. The report is in Activity." with a link. Flow cards say "Answer in chat" or "Report".

Requirements.
- F-06.R1. `result` is `chat` or `report`. For `chat`, the answer lines (a template filled from inputs and outputs) are posted in the run's chat, or in a new chat for a start outside a chat. A line whose placeholder has no value is dropped.
- F-06.R2. For `report`, the report stays with the run in Activity and the chat gets "Done. The report is in Activity."
- F-06.R3. The runner writes the decision lines: "You approved: <title>.", "Done by your rule: <step title>." and "You said no: <title>. It was not done." Other outcomes add nothing the person did not decide.
- F-06.R4. A step shows as passed only with evidence from a check the agent does not control. A step the agent judged itself is labelled "Judged, not verified".
- F-06.R5. FlowDriven's own posted lines follow the chat's language: "Done. The report is in Activity.", "<flow> needs a few details.", "<flow> finished, so <next> is next." (In the prototype (version 9).)
- F-06.R6. A report has no token or usage numbers and no run ids. It starts with the flow name and when it started, then "Result".

Journeys and flow specs: j20 and j27, `flows/j20-run-from-chat.md`, `flows/j27-flow-inputs.md`. Release: V1 (B-11). Status: In the prototype (version 8); R5 is in the prototype (version 9).

### F-07 Flows list and flow page

What it is. The library of flows. Each flow has a card and a page.

What the person experiences. The list: heading "Flows", "Tasks you set up once. Run them whenever you like, or on a schedule.", "Make a new flow" (with "Describe it in chat" and "From a skill"). Each card shows the name, a summary, a step track, the schedule line, "Answer in chat" or "Report", "Asks you: <labels>" when required inputs have no value, a status badge, and "Run". The page shows "What it does", "What it needs", three columns "Does on its own", "Asks you first" and "Never does", "Schedule", "Recent activity", and the actions "Run", "Improve with chat" and a menu with Duplicate and Delete.

Requirements.
- F-07.R1. Flow status badges are only: "New: confirm it once", "Changed: confirm again", "Running now", "Needs you". A confirmed flow with nothing happening has no badge.
- F-07.R2. The Run button reads "Run". It reads "Running..." (disabled) while a run is active, "Confirm first" when the flow is new or changed, and "See what's waiting" when its run needs the person.
- F-07.R3. Run on a flow that needs confirmation opens the confirm card in a chat. Run with missing required inputs opens a chat that asks. Otherwise it starts. All three go through `START` (F-08).
- F-07.R4. "What it needs" lists each input as "Remembers your last answer: <value>", "Default: <value>", "Asks you" or "Optional", or "Nothing. It runs without asking you."
- F-07.R5. "Does on its own", "Asks you first" and "Never does" are three lists derived from the flow's `touches` and the person's standing rules. Each standing rule shows "(you allowed this)" and an "Ask me again" button that revokes it at once with no dialog.
- F-07.R6. The "Needs you" line appears only when something the flow depends on is not ready, with one fix button (for example "Sign in to <name>").
- F-07.R7. "Recent activity" shows the last five runs with state words, when and a link, or "No activity yet."
- F-07.R8. Delete asks for confirmation ("Delete this flow? Past runs stay in Activity."). Schedules that pointed to a deleted flow become "Only when I start it". Duplicate makes a copy that is "New: confirm it once".
- F-07.R9. A flow made from a skill says "Made from the skill <name>" with a link to Skills.

Journeys and flow specs: j21, `flows/j21-run-from-flows.md`. Release: V1 (B-18, with B-04). Status: In the prototype (version 8).

### F-08 Starts outside the chat follow one start rule

What it is. One rule for every start that is not typed in the chat: Run on the Flows list or flow page, Run again, "after another flow", a schedule, "Try the next run now", an answer to a scheduled question, the phone, and other AI tools on this Mac.

What the person experiences. A flow that is not confirmed does not start; the chat shows the confirm card. A flow that lacks details asks in a chat. Otherwise it starts.

Requirements. (The text of `START` is in section 6.)
- F-08.R1. Every start that is not typed in the chat goes through `starts.request(flowId, source, context)`. The sources are `flows`, `again`, `schedule`, `after`, `try_next`, `proactive`, `phone`, `tool`. Typed starts use `chat`.
- F-08.R2. Step 1: a flow that is `new` or `changed` never starts. The person gets the confirm card in a chat, and a "Needs you" item when nobody is watching.
- F-08.R3. Step 2: if required inputs are missing, after remembered answers when the flow's "When it's time" is "Use my last answers", FlowDriven asks in a chat the proactive way (F-09).
- F-08.R4. Step 3: otherwise the run starts. The next flow of a chain goes through the same rule.
- F-08.R5. The start source is recorded on the run and in the audit log (SR-7).
- F-08.R6. No start of any source runs when the one permission is off (SR-8).

Journeys and flow specs: j21 and j28, `flows/j21-run-from-flows.md`, `flows/j28-proactive-schedule.md`. Release: V1 (B-12). Status: In the prototype (version 8).

### F-09 Schedules, "after another flow", proactive questions

What it is. A flow can run on a schedule or after another flow. When it is time and details are missing, the app asks first in a chat (the 17:00 timesheet question).

What the person experiences. On the flow page, "Schedule": "Only when I start it", "Every day at <time>", "Every weekday at <time>", "Every <day> at <time>", "After <flow> finishes", a line "Next: ...", and "When it's time" with "Ask me in the chat" or "Use my last answers". A small button "Try the next run now". At 17:00 a new chat appears: "It's 17:00. Time for your timesheet. How long did you work today, and on what? Like last time, I'll use Project Example (Example Corp), Feature work."

Requirements.
- F-09.R1. A person-facing schedule maps onto the runner's triggers: `manual`, `daily`, `weekdays`, `weekly`, `after`. It holds a time, a day, a flow for `after`, and `whenItsTime: ask|last`.
- F-09.R2. Setting a schedule is the person's action in the app window or a card they click (SR-2). A flow file, skill or marketplace flow cannot turn a schedule on.
- F-09.R3. A schedule only starts a flow that is confirmed at its current content hash (SR-3). A flow that is `new` or `changed` does not start; the person gets the confirm card in a chat and a "Needs you" item (`START` step 1).
- F-09.R4. Missing inputs with `whenItsTime: ask` create a new chat from FlowDriven with a lead line and the question, or reuse the one waiting question for that flow (moved to the top, no duplicate). "After another flow" asks in the same chat.
- F-09.R5. "Use my last answers" is selectable only when the last run's answers cover every required input. It never reuses date or time inputs.
- F-09.R6. A proactive chat counts in the Activity number and shows in "Needs you" as "<flow name> is waiting for your answer" with "Answer in chat". It sends one notification: "<flow name> needs your answer" (F-16).
- F-09.R7. A scheduled run that has everything starts without asking. If its result is `chat`, the answer goes into a new chat made by FlowDriven.
- F-09.R8. Turning on a schedule for a flow that has never run runs it once now ("Running it once now so you can see it work. The schedule starts after that."). If that run is stuck or blocked, the schedule is set back to off. (Not in the prototype yet. Owner decision, 2026-11-18: no mandatory try run, but this first run on turning a schedule on.)
- F-09.R9. "Try the next run now" goes through `START` with source `try_next`.
- F-09.R10. Schedule time is the person's local time. Missed starts (Mac asleep or app closed) run once at wake inside the grace window, else Activity shows "Missed" (F-22.R3). A schedule never starts the same flow twice at once (overlap skip).
- F-09.R11. Schedules are checked every 30 seconds while the app runs, and a flow that is set to start "after" another flow starts only when that run ends `done`.
- F-09.R12. A new FlowDriven chat starts in the app language. (In the prototype (version 9).)

Journeys and flow specs: j28 (`flows/j28-proactive-schedule.md`) and j21 (`flows/j21-run-from-flows.md`). Release: V1 (B-12; B-23 for waking and background). Status: In the prototype (version 8) except R8 and the "Missed" line, which are Not in the prototype yet; R12 is in the prototype (version 9).

### F-10 Make a new flow in the chat

What it is. The person describes the work in plain words. The agent asks at most the one question it needs, then shows the flow. "Save flow" is the confirmation.

What the person experiences. "Make a new flow" opens "Describe it in chat" or "From a skill". The chat says "Tell me what it should do, in your own words." After one question (for example where a spreadsheet should live) a flow card shows the name, "What it does" steps, "Runs: Every Friday at 17:00", and the lists "Does on its own", "Asks you first", "Never does", with "Save flow" and "Change something". After saving: "Saved. It runs every Friday at 17:00. Run it now?" with "Run now" and "Not now".

Requirements.
- F-10.R1. The chat asks no more than one question per round and none that it can answer from what the person already wrote.
- F-10.R2. The draft is a flow in format 1.2 with steps, inputs, `result`, `touches` (each with a sentence, an effect class and a rule) and a schedule. A draft does nothing until saved.
- F-10.R3. FlowDriven classifies each touch's effect (`read`, `local_write`, `run_command`, `change`, `send`, `post`, `pay`, `delete`, `merge`). The agent's text cannot change the class (SR-1).
- F-10.R4. Risky kinds (send, post, pay, delete, merge) are never pre-selected as "Does on its own". They appear under "Asks you first" until the person moves one (SR-1).
- F-10.R5. "Save flow" saves the flow and confirms its exact content hash, and creates standing rules for every non-read touch left under "Does on its own". The card shows the three lists, so the click is an informed confirmation (SR-3). No second dialog.
- F-10.R6. The confirm dialog (also used when "Confirm" is clicked on a new flow) is titled "Confirm <name>?", lists "What it does", "Does on its own", "Asks you first" and "Never does", and says "You can change it later with Improve with chat."
- F-10.R7. A run requested on an unsaved draft says "Save <name> first, then I can run it." Saving a draft twice does not make two flows with the same name.
- F-10.R8. A draft made while the context holds outside text is shown as a card the person clicks; it never saves itself (SR-5).

Journeys and flow specs: j22, `flows/j22-make-a-flow.md`. Release: V1 (B-13, with B-02). Status: In the prototype (version 8) with a prepared invoice example.

### F-11 Improve a flow with chat

What it is. A saved flow can be changed at any time by talking. The chat shows the change first; "Save change" confirms the new version.

What the person experiences. "Improve with chat" on the flow page opens a chat: "What should change in <name>?" with chips such as "Also email me a summary". A change card: "Change to <name>:" and "+ Email me a summary (asks you first before sending)" with "Save change" and "Cancel". After saving: "Saved. The change applies from the next run."

Requirements.
- F-11.R1. The change card shows exactly what is added, removed or changed, including any new touch and its rule.
- F-11.R2. "Save change" creates a new flow version and confirms it, because the person saw the change. The old version stays in the flow's history.
- F-11.R3. A change that adds a risky touch lists it under "Asks you first".
- F-11.R4. A change that already exists changes nothing and says "<item> is already part of <name>."
- F-11.R5. A standing rule survives a change only if a touch with the same id, effect and place still exists. The change card shows each rule it keeps or drops.
- F-11.R6. Changing the schedule by chat ("every weekday at 9") shows the "Set this schedule?" card with "Yes, set it" and "No" before it applies (SR-2).
- F-11.R7. Editing a flow by any path that is not this card (a file edit, an import) makes it "Changed: confirm again" (SR-3).

Journeys and flow specs: j23, `flows/j23-improve-a-flow.md`. Release: V1 (B-14). Status: In the prototype (version 8); the prototype supports only the email summary and schedule changes.

### F-12 Skills screen and Make a flow from a skill

What it is. The skills the person's agents already have, plus FlowDriven's own. Any skill can become a flow.

What the person experiences. The Skills screen: "Skills your AI agents already have, plus FlowDriven's own. Make a flow from any of them." Each row has the name, an about line, where it comes from, which flows use it, and "Make a flow". The button opens a new chat: "Make a flow from the <name> skill". The agent says "Reading <skill>...", then shows a draft card with name, steps, "What it needs", where the result goes and what it may touch, and "Save flow". After saving: "<name> is ready. Run it now, or put it on a schedule."

Requirements.
- F-12.R1. The skill list comes from the agents' own skill folders and FlowDriven's own skills. Rows show name, about line, origin ("Comes with FlowDriven", the agent's name or "More skills"), used-by flows.
- F-12.R2. The skill's text is read as data to draft a flow. It grants nothing: no tool, place or permission comes from a skill (SR-5, SR-2). A skill's `allowed-tools` and hooks are ignored.
- F-12.R3. The draft is not a flow until the person saves it. "Save flow" is the confirmation, with the same three lists as F-10.
- F-12.R4. Flow names are unique. When a draft's name is taken, the draft card already shows the next free name ("Check timesheet 2") before saving, and the person can rename it with "Change something". Saving the same card twice creates one flow (F-10.R7).
- F-12.R5. A skill that needs a file input opens a form at once.
- F-12.R6. Each skill is pinned by the hash of its folder when a flow uses it. A change in the skill is shown as a change (F-24).
- F-12.R7. The skills screen works with the keyboard: each row can be expanded and collapsed, with the name "Expand <skill>".

Journeys and flow specs: j29 (`flows/j29-flow-from-skill.md`); the Skills screen basics are in j26 (`flows/j26-memory-phone-marketplace.md`). Release: V1 (B-15). Status: In the prototype (version 8).

### F-13 Decisions

What it is. When something risky or a real choice comes up, the run waits and the person decides, in the chat, in Activity, in a notification or on a paired phone. Routine decisions can become a standing rule.

What the person experiences. A decision card with a title, the flow, a summary and a preview (an email shows To, Subject and body), a badge "Needs you", and the buttons "Approve", "Edit" (emails and other text), "Reject", "Approve all similar (N)" and "Always allow for this flow" (only when it is allowed). Choice items show checkboxes with "Send choice" and "Pick none". Outside text is tagged "Includes text from an email or web page", with hidden characters shown.

Requirements.
- F-13.R1. A held call becomes a decision with state `pending` ("Needs you"). It shows in its chat (when the run started from a chat), in Activity under "Needs you", as a notification, and on a paired phone.
- F-13.R2. "Approve" writes a one-time grant bound to the run, the step, the tool and the exact input. The same call with different input is held again (SR-1).
- F-13.R3. "Edit" is offered for text payloads only. "Save and approve" gives `approved_edited` and runs the edited text.
- F-13.R4. "Reject" needs no confirmation. It skips that action, the run goes on, and the report says "You said no: <title>. It was not done." Nothing is sent. (Owner decision, 2026-11-18. This changes today's engine, where a rejection fails the run: Ask first, product decision, security review.)
- F-13.R5. A decision that nobody answers within 24 hours expires, counts as Reject, and shows "Expired". (Not in the prototype yet: the prototype shows no expiry.)
- F-13.R6. "Approve all similar (N)" is offered when N is above 1, the items are `send` or `post` decisions of the same group in the same run, and never for pay, delete, merge, choices or sign-offs. It opens a dialog "Approves these N emails in this run only. This is logged." listing every item, with "Approve all N" and "Cancel". It never covers another run.
- F-13.R7. Choice items accept only picks from the listed options and enforce the maximum ("Pick up to 2.").
- F-13.R8. "Always allow for this flow" is offered only when the action's place is fixed in the flow (the person's timesheet account, one cloud storage folder, the person's own address). It is never offered for a place that came from what the run read, for example a reply to whoever wrote (SR-1).
- F-13.R9. "Always allow for this flow" writes a standing rule `{flow, touch, effect, place}` and approves this action (state `allowed_always`, "Always allowed"). The chat says "Okay. From now on <flow name> does this by itself. You can undo it on its page with Ask me again."
- F-13.R10. A standing rule matches only its exact place. It is made only in the desktop window, never from the phone, a bot, a skill, a flow file or another AI tool (SR-2).
- F-13.R11. "Ask me again" revokes a rule at once. The next matching action waits for the person.
- F-13.R12. A step that passes by a rule says "Allowed by your rule", and the report says "Done by your rule: <step title>."
- F-13.R13. Text from outside shows "Includes text from an email or web page" and reveals hidden characters (for example "[U+200B hidden character]") in the preview (SR-5).
- F-13.R14. Deciding twice, from two places, counts once: the second answer finds the item already decided and says so.

Journeys and flow specs: j24, `flows/j24-decisions.md`. Release: V1 (B-04, B-05, B-19). Status: In the prototype (version 8); R5 is Not in the prototype yet.

### F-14 Activity and the run page

What it is. The place to see what needs the person, what is running, and everything that ever ran.

What the person experiences. Heading "Activity" with three sections. "Needs you" (empty: "Nothing needs you right now."). "Running now" with live cards and "Stop" (empty: "Nothing is running."). "Earlier" with filters "All", "Finished", "Problems". A row opens the run page: name, state line, a track, report lines, steps with icons and words and plain evidence, "Run again" and "Copy report". A stuck run shows the plain reason and one button: "Sign in and continue" (`needs_login`) or "Try again" (`blocked`, `interrupted`).

Requirements.
- F-14.R1. Run states and their words: `queued` "Waiting to start", `checking` "Starting", `running` "Running", `waiting_approval` "Needs you", `needs_login` "Waiting for sign-in", `retrying` "Trying again", `blocked` "Stuck", `interrupted` "Stopped unexpectedly", `stopped` "Stopped by you", `done` "Finished", `failed` "Failed".
- F-14.R2. "Needs you" lists waiting decisions and waiting scheduled questions, newest first. A waiting question shows first as "<flow name> is waiting for your answer" with "Answer in chat".
- F-14.R3. "Earlier" shows every past run with flow name, state words with icon, and when. "Finished" shows `done`. "Problems" shows `failed`, `blocked`, `interrupted` and `needs_login`.
- F-14.R4. A `needs_login` run says in plain words who asked for sign-in and that FlowDriven never passes a sign-in or robot check; it waits up to 12 hours, then it is stuck (`blocked`) with the reason in plain words. "Sign in and continue" resumes it.
- F-14.R5. `blocked` and `interrupted` runs offer "Try again". A `failed` or `stopped` run offers only "Run again" and "Copy report".
- F-14.R6. A run page shows every step with its state, evidence in plain words and every decision line. The agent's own words are shown as text, never as HTML.
- F-14.R7. "Run again" is shown only while the flow exists. It goes through `START` with source `again` and the same inputs.
- F-14.R8. "Copy report" opens a dialog with the report as Markdown and a copy button. Nothing is exported without this click.
- F-14.R9. An unknown run id says "This activity does not exist." with "Go to Activity".
- F-14.R10. The run page names the agent and model the run used, for example "Claude Code · Sonnet 5.5". (In the prototype (version 9).)
- F-14.R11. A run that was running when the app crashed shows `interrupted`. A step that may have half happened (not marked idempotent) is never repeated by itself (SR-8).
- F-14.R12. Retention: runs are kept for 90 days or the last 50 per flow, whichever is larger. The audit log is not trimmed by this.

Journeys and flow specs: j25, `flows/j25-history-and-problems.md`. Release: V1 (B-19). Status: In the prototype (version 8); R10 is in the prototype (version 9); the "Missed" row is in F-22.

### F-15 Settings

What it is. One screen for how the app looks, which language, which agents, the one permission, the main agent, a fallback, the spending limit and notifications.

What the person experiences. In this order (the order is inferred from the prototype): Appearance (Light, Auto, Dark; Auto "Matches your computer"), Language ("English", "Bahasa Indonesia" and the line "Chats and flows keep the words they were written in. FlowDriven answers in the language you write in."), AI agents (one row per agent with state words and "Set up" or "Sign in"), Permission (a switch "FlowDriven may run your AI agents"), Main AI agent (radio, with "New chats start with this agent and its default model."), a switch "If Claude Code is busy, use Codex", Spending limit ("Used $9.20 of $10.00 this month", "Raise limit"), Notifications ("FlowDriven only notifies you when it needs a decision or something went wrong. It never notifies you about progress or success.").

Requirements.
- F-15.R1. Appearance maps to Electron `nativeTheme.themeSource` (`light`, `system`, `dark`), set by main when the renderer asks, and kept in main's own settings file so it applies before the first paint. Auto is the default.
- F-15.R2. Turning the permission off opens "Stop FlowDriven from running AI agents?" with "Flows stop until you turn this on again." and buttons "Turn off" and "Keep on". It stops every run and every automatic start (SR-8). Turning it on shows the permission text and "Give permission" and "Cancel".
- F-15.R3. An agent that is not `ready` is disabled as main agent and says "Set up or sign in first". Choosing one shows "Main AI agent: <name>".
- F-15.R4. The main agent's default model is used for every start outside a chat. The switch "If Claude Code is busy, use Codex" applies only to starts outside a chat, and only when the other agent is `ready`.
- F-15.R5. The spending limit is the person's (see F-23). Raising it opens a dialog with the field "Monthly limit ($)" and the line "Raise the limit to $<n>?"; an amount not above the current one shows "Enter an amount above $10." (the number is the current limit).
- F-15.R6. Settings changes apply at once and are recorded in the audit log (SR-7). They change only through the person's action in the window (SR-2).
- F-15.R7. The language change applies at once, with the window's `lang` following it (F-20).
- F-15.R8. The AI agents rows use the same "Set up" and "Sign in" actions as the welcome screen and the picker (F-01, F-21).

Journeys and flow specs: j12, `flows/j12-settings.md`. Release: V1 (B-20, with B-07, B-06 and B-24). Status: In the prototype (version 8); the Language section and the main agent's default model line are in the prototype (version 9).

### F-16 Notifications

What it is. The app tells the person only when it needs them or something went wrong.

What the person experiences. A system notification (and an in-window card) for: a decision waiting, a run that is stuck or failed, a scheduled question ("<flow name> needs your answer" with "Open"), and a flow started by itself after another ("<name> started"). Nothing for progress or success.

Requirements.
- F-16.R1. Notifications are sent only for a decision waiting, a problem (a stuck or failed run, a limit reached, a revoked flow) and a scheduled question.
- F-16.R2. A report-only flow started after another flow does not notify.
- F-16.R3. A notification is not sent while the app window is focused, and is removed when its item is decided.
- F-16.R4. Clicking a notification opens the right screen: the decision, the chat or the run.
- F-16.R5. At most one notification per run every 10 minutes unless a decision is waiting.
- F-16.R6. Notification text is fixed templates plus the flow name. It never contains the text of an email, a payload marked sensitive, or a secret.

Journeys and flow specs: j24 and j28, `flows/j24-decisions.md`, `flows/j28-proactive-schedule.md`. Release: V1 (B-12, B-05). Status: In the prototype (version 8) as in-window cards; system notifications are Not in the prototype yet.

### F-17 Memory

What it is. What the app remembers about the person, visible and in the person's control.

What the person experiences. Heading "Memory". "Always used" with meters (You, Goals, Kept, Projects and flows, Skills). "Proposed" memories with the source, a tag "Includes text from an email or web page" where it applies, and "Keep" and "Drop". "Everything it remembers" with search, "Applies to" filter, "Kept" badge, and a menu with Edit, Pin or Unpin, and Delete ("Delete this memory? The agent forgets it.").

Requirements.
- F-17.R1. Memory stays on the Mac and is never published, exported, logged or put in a bug report.
- F-17.R2. Only the app writes memory. An agent can propose; a proposal waits for "Keep" or "Drop". Nothing is kept without the person.
- F-17.R3. A proposal made from outside text is tagged and always waits for the person, with hidden characters shown.
- F-17.R4. Memory grants nothing. No tool, place or permission comes from a memory item (SR-2, SR-5).
- F-17.R5. The person can search, filter, edit, pin and delete any item. Delete asks for confirmation and removes the text for good.
- F-17.R6. Memory reaches a flow only by its own scope. Sources are in plain words ("From Weekly supplier report"), with no run ids.

Journeys and flow specs: j26, `flows/j26-memory-phone-marketplace.md`. Release: V2 (B-25). Status: In the prototype (version 8) as a demo.

### F-18 Phone & bots, other AI tools on this Mac

What it is. Answer decisions and start flows from a phone through Telegram or Discord, and let other AI tools on this Mac list and start flows.

What the person experiences. Cards for Telegram and Discord with "Set up Telegram" and "Set up Discord". A short line: "Connect a Telegram bot so you can answer from your phone." Steps behind "Show the steps": create a bot, paste its access code (saved in the Keychain), send the pairing code, "Check pairing". Then "Paired with your account" and "Only your account can give it commands. Commands older than 10 minutes are ignored." A card "Other AI tools on this Mac" with "Let other AI tools on this Mac start your flows. They still ask you before anything is sent."

Requirements.
- F-18.R1. A bot token is stored in the system keychain and referred to by name. It is never shown again, never in a log, a chat, a flow or a fixture (SR-6).
- F-18.R2. Only the paired account can give commands. Commands older than 10 minutes are ignored. A forwarded message, a file and a link are outside text.
- F-18.R3. A phone shows one decision at a time. A risky kind needs two taps ("Tap again to confirm", then "Approved from your phone.").
- F-18.R4. A payload marked sensitive is never sent to a bot message.
- F-18.R5. Standing rules cannot be made from the phone (SR-2).
- F-18.R6. A start from the phone or another AI tool goes through `START` with source `phone` or `tool` (SR-1, SR-3).
- F-18.R7. Other AI tools may list and start flows. Their decisions still open in FlowDriven and they can never create or widen a permission, a rule or a limit (SR-2).
- F-18.R8. The switch for other AI tools is off by default and the person turns it on.

Journeys and flow specs: j26, `flows/j26-memory-phone-marketplace.md`. Release: V2 (B-26). Status: In the prototype (version 8) as a demo.

### F-19 Marketplace

What it is. A store of flows from other people. The person sees what a flow reads, changes and sends before installing.

What the person experiences. Heading "Marketplace" with "Browse" and "Publish". A card shows the name, the publisher, "people use it" and a scan badge ("No issues found" or "Warning"). A listing page shows what it does, the steps, "Will read", "Will change", "Will send or post (asks you first)", "Needs these accounts", and "Scanning reduces risk. It does not prove a flow is safe." Buttons "Install" and "Report". Install opens "Install <name>? It arrives as a draft. Nothing runs until you approve it."

Requirements.
- F-19.R1. An installed flow arrives as a draft with the badge "New: confirm it once". It does nothing until the person confirms it (SR-3).
- F-19.R2. The listing's declared touches become the draft's touches. Only reads are placed under "Does on its own"; everything else, and every send, post, payment, delete and merge, is under "Asks you first" until the person moves it (SR-1). A listing whose "Will read / change / send" list does not match the flow's real touches is not installed.
- F-19.R3. Before install and before each run, FlowDriven checks the flow's signature and the revocation list against a public key pinned in the app. A revoked or unsigned flow does not run (SR-3).
- F-19.R4. Marketplace text (name, summary, steps) is outside text (SR-5).
- F-19.R5. "Report" opens a dialog with a text field and "Send report". Sending it is the person's click.
- F-19.R6. "Publish" needs a flow that is valid, scanned clean and free of private data, a visibility choice (Only me, People I invite, Team, Public) and the person's own click. Publishing is public content: it never happens by itself.
- F-19.R7. Memory, chats, run history and secrets are never part of a published flow.

Journeys and flow specs: j26, `flows/j26-memory-phone-marketplace.md`. Release: V3 (B-28). Status: In the prototype (version 8) as a demo. The marketplace server is closed source and arrives in a later phase.

### F-20 Languages

What it is. English by default with Bahasa Indonesia as an option, and one file per language so contributors can add more. (Owner decision, 2026-11-21.)

What the person experiences. In Settings, "Language" lists every language by its own name. The menu, buttons, labels, statuses, dialogs, cards and settings follow the choice at once. Chats, flows and reports keep the words they were written in.

Requirements.
- F-20.R1. English is the default. Nothing picks another language by itself.
- F-20.R2. There is one words file per language in `apps/desktop/src/i18n/` (no new package, Q-04). `en.ts` is the source; its type gives the keys. Other languages are partial copies checked against it. One list imports them. Missing words show in English.
- F-20.R3. A check that is part of `pnpm check` (the test `apps/desktop/src/i18n/i18n.test.ts`; nothing in `tools/checks/` changes) fails, naming the file, the key and the fix in one line, on: a key used in code but missing in English, an English key never used, a language with a key English lacks, a changed `{placeholder}`, a missing `other` plural form, a plural form that is not one of the language's `Intl.PluralRules` categories, a code that is not a valid language tag, a code another file already uses, and a language file not in the list. Indonesian must be complete. For another language the check lists the missing keys as "not translated yet, shown in English" and passes.
- F-20.R4. Placeholders are `{name}`. A sentence is one key with placeholders, never glued from fragment keys. Counts use plural forms picked with `Intl.PluralRules`; `other` is required and is the fallback. Dates and times use `Intl.DateTimeFormat` in the chosen language.
- F-20.R5. Data keeps codes, never FlowDriven sentences. Statuses, touch rules and result kinds are codes shown through the words files.
- F-20.R6. Changing the language never rewrites a chat, a flow, a report or a memory item.
- F-20.R7. FlowDriven's own posted lines follow the chat's language; cards and buttons follow the app language (F-06.R5).
- F-20.R8. `docs/translating.md` says in about ten lines how to add a language.
- F-20.R9. Indonesian follows the fixed words of brief 24.6 ("Anda", everyday words, loanwords such as flow, chat, skill, timesheet).

Journeys and flow specs: j30, `flows/j30-app-language.md`. Release: V1 (B-06). Status: In the prototype (version 9).

### F-21 AI agent and model per chat

What it is. Each chat chooses which AI agent answers and with which model. (Owner decision, 2026-11-21.)

What the person experiences. A button in the composer with the agent's name and model: "Claude Code · Sonnet 5.5". When the agent is not ready, the button also shows its status in words ("Needs sign-in"). It opens a menu above the composer: one group per agent, headed by its name and status. A ready agent lists its models with a note and the tag "Default". An agent that is not ready shows its next step ("Sign in to Codex", "Set up Codex"). The last item is "Manage AI agents". Changing the choice adds a small note: "Now using Codex · GPT-6.1 Sol".

Requirements.
- F-21.R1. A new chat starts with the main agent and its default model from Settings. Changing the choice changes only that chat.
- F-21.R2. Each agent reports its own models: Claude Code's aliases and Codex's list, or a catalog per CLI version.
- F-21.R3. The choice is passed with the agent's own model flag and no other flag. The picker never changes the sandbox or the approvals (SR-4).
- F-21.R4. A run started from the chat uses the chat's agent and model. A run already going keeps its own.
- F-21.R5. A run keeps the agent and model it ran on and the run card and run page name them (F-04.R11, F-14.R10).
- F-21.R6. An agent that is not ready cannot be chosen. The menu shows its next step and does what the same button does in Settings.
- F-21.R7. The menu works with the keyboard: Arrow keys move, Enter chooses, Escape closes and returns focus to the button. Models are menu items with radio state, grouped under each agent's name. The button's accessible name always says the agent, the model and the status; on a phone-width screen the button shows the model only.
- F-21.R8. The change note appears in the app language and is not a bubble.
- F-21.R9. The chat's agent answers the chat turns too (F-03.R3) with no tools.
- F-21.R10. The menu stays open across updates (a new message, a status change) until the person chooses or closes it. Focus stays where the person put it. Opening it never clears an empty chat's start screen. It stays inside the window at every width from 320 to 1440 px. The chosen model shows a check icon and its name; "Default" is a small tag.
- F-21.R11. A chat FlowDriven starts (the 17:00 question, an "after" question) begins with the main agent and its default model, like a new chat, so the button always shows what a run will use.

Journeys and flow specs: j31, `flows/j31-agent-and-model.md`. Release: V1 (B-07, B-17, B-22 for Codex). Status: In the prototype (version 9).

### F-22 Background running in the menu bar

What it is. FlowDriven keeps running in the menu bar when the window closes, so schedules and the 17:00 question still happen. An "Open at login" setting starts it with the Mac.

What the person experiences. Closing the window leaves a menu bar icon. A setting "Open at login". Missed starts show as "Missed" in Activity. (Decided for V1, revisable: Q-02.)

Requirements.
- F-22.R1. When the last window closes, the app keeps running in the menu bar, and the menu offers "Open FlowDriven" and "Quit".
- F-22.R2. "Keep running in the menu bar" and "Open at login" are settings, both on by default (Q-02, decided for V1). "Open at login" works only in the installed app: while V1 runs from a checkout (Q-04), the switch is off and says it works in the installed app.
- F-22.R3. A start missed while the Mac slept or the app was closed runs once at wake if it is inside the grace window. Otherwise Activity shows "Missed" for it. Missed starts never run twice.
- F-22.R4. Quitting the app stops the schedules. The menu says so before quitting if a schedule is due within 24 hours (target).
- F-22.R5. The menu bar part and the window use the same runner and store. There is one runner process.
- F-22.R6. Turning off the one permission also stops everything that runs in the menu bar (SR-8).

Journeys and flow specs: j28, `flows/j28-proactive-schedule.md`. Release: V1 (B-23). Status: Not in the prototype yet (it goes into the prototype before it is built).

### F-23 Spending and usage limits

What it is. The person's limits hold. A monthly spending limit and the agents' own usage limits stop runs from costing more than the person allowed.

What the person experiences. In Settings: "Used $9.20 of $10.00 this month" and "Raise limit". When a limit is reached, the run pauses with a "Needs you" item.

Requirements.
- F-23.R1. The spending limit counts only money charged per use, such as API keys or paid credits. Subscription plans are bound by the agent's own usage limits (Q-03, decided for V1).
- F-23.R2. Reaching the limit pauses runs with a "Needs you" item. It never continues silently (SR-9).
- F-23.R3. Raising the limit is the person's confirmed action in the window and is recorded in the audit log. Nothing in a flow, a skill, memory or outside text raises it (SR-2, SR-9).
- F-23.R4. When an agent reports its own usage limit, runs wait with the reason shown ("Waiting to start" and why). Triggered runs wait when the weekly window is nearly used (utilization at or above 0.9) and the person gets one question: keep running triggered flows?
- F-23.R5. The limit and the amount used are shown without run ids or token counts.
- F-23.R6. The busy fallback (F-15.R4) never moves work to an agent that is not ready and never changes a flow's limits.
- F-23.R7. A call billed per use whose agent reports no cost is refused, because the limit could not hold; the run is stuck and says why (decided for V1, revisable).

Journeys and flow specs: j12 and j25, `flows/j12-settings.md`, `flows/j25-history-and-problems.md`. Release: V1 (B-24). Status: In the prototype (version 8) as a fixed sample; enforcement is the real work.

### F-24 Skill updates as changes, with roll back

What it is. When a skill that a flow uses changes, the person sees the change and decides. An earlier version can be restored.

What the person experiences. On a skill row, a tag "Update available" and "Expand". The expanded row shows the history, the update as lines with + and -, and "Approve update" and "Keep current version". Older versions have "Roll back" (dialog: "Roll back <name> to an earlier version? Flows that use it switch to that version."). An unused skill shows "Not used for 97 days. Archive it?" with "Archive".

Requirements.
- F-24.R1. A changed skill is never loaded for a flow until the person approves the change (SR-2, spec R9).
- F-24.R2. The update shows as a diff of lines added and removed. The diff text is outside text (SR-5).
- F-24.R3. "Roll back" restores an earlier version after the dialog's confirmation; flows that use it switch to it.
- F-24.R4. The person's current version stays in use until they approve or roll back.
- F-24.R5. "Archive" moves an unused skill out of the list; it can be restored.

Journeys and flow specs: j26, `flows/j26-memory-phone-marketplace.md`. Release: V2 (B-27). Status: In the prototype (version 8) as a demo. The plain-words pass (brief 17.5) shows no version numbers; whether diff and roll back keep that look is a prototype question.

## 6. Safety promises

These are the safety rules in plain words. The binding text is in `docs/design/architecture.md`, section "Safety rules". If the two ever differ, the architecture text wins and this section is fixed.

### SR-1 The one rule

An action runs by itself only when it only reads and sends nothing out, or when you have already allowed that kind of action, to that exact place, for this flow. You allow it by confirming the flow with that action under "Does on its own", or with "Always allow for this flow". Everything else waits for your yes in FlowDriven. FlowDriven decides which kind an action is. The agent never does. Send, post, pay, delete and merge are never pre-selected as "Does on its own".

### SR-2 Only you change permissions

Confirmations, decisions, standing rules, schedules, the agent permission and your limits change only when you act in FlowDriven's window, or on a paired phone for one decision at a time. No agent output, flow file, skill, memory item, marketplace flow, bot message or other AI tool can create, widen or revive them. The assistant can only propose them as cards you click. Standing rules are made only in the desktop window.

### SR-3 What you confirmed is what runs

A flow runs only as the exact version you confirmed. Any change makes it "Changed: confirm again", and nothing outside the chat runs it until you confirm again.

### SR-4 Agents keep their limits

FlowDriven never turns on a permission-bypass or full-access mode of an agent. Codex always runs in its workspace-write sandbox (or read-only), set explicitly. Choosing a model (the version 9 picker) changes only the model. Each run proves the limits took effect, or the step stops.

### SR-5 Outside text is data

Text from emails, web pages, files, skills, marketplace flows, bot messages and other AI tools is marked as outside. It may fill typed inputs and be shown to you. It never adds tools, places or permissions, and never counts as your own words, unless you approved the text as your own. A chat turn that has outside text in its context never starts a run by itself. It shows a card you click.

### SR-6 Secrets stay sealed

Bot tokens and connector keys live in the system keychain and are referred to by name. They never appear in prompts, logs, flow files, chats, reports, exports or test fixtures. FlowDriven never reads an agent's own sign-in files, and never sees your password.

### SR-7 Everything is on the record

Every tool call an agent tried, every decision (by rule, by you, or refused), every permission change and every start is written to an append-only audit log and shown in plain words on the run page.

### SR-8 You can always stop

Stop ends the agent's process group at once and needs no confirmation. Turning off the permission stops every run and every automatic start. After a crash, a step that may have half happened is never repeated by itself.

### SR-9 Your limits hold

The spending limit and usage limits belong to you. Nothing in a flow, a skill, memory or outside text raises them. Reaching a limit pauses runs with a "Needs you" item. It never continues silently.

### START The start rule

Every start that is not typed in the chat goes through one function. First, a flow that is new or changed does not start: you get the confirm card in a chat (and a "Needs you" item when nobody is watching). Second, if required details are missing, FlowDriven asks in a chat. Third, otherwise it starts. The next flow of a chain goes through the same rule.

## 7. Non-functional requirements

Numbers marked "target" are the drafter's proposals. Other numbers come from the spec or from existing code.

### 7.1 Performance

| Id | Requirement | Source |
|---|---|---|
| NF-01 | The first screen shows within 2 s of launching on a Mac less than five years old. | target |
| NF-02 | The person's message shows within 100 ms of Enter, and a working indicator within 200 ms. | target |
| NF-03 | The window never blocks on an agent. `chats.send` returns at once. | AD-10 |
| NF-04 | Search answers within 150 ms with 1,000 chats and 200 flows. | target |
| NF-05 | The chat list and "Earlier" show 1,000 rows with no delay over 200 ms. | target |
| NF-06 | A held call shows as a decision within 2 s and as a notification within 5 s. | target |
| NF-07 | Stop ends the agent's process group within 2 s. | target |
| NF-08 | A scheduled start happens within 60 s of its time while the Mac is awake (30 s tick). | code |

### 7.2 Reliability and recovery

| Id | Requirement | Source |
|---|---|---|
| NF-09 | A change to a run, decision, rule or schedule is written to the store before the screen shows it as done. The runner is the only writer. No record is lost after a crash or a force quit. | AD-02 |
| NF-10 | After a crash, runs that were running show `interrupted`. A step not marked idempotent is not repeated by itself. | SR-8 |
| NF-11 | If the runner ends unexpectedly, the window says so in plain words and restarts it once (target). | target |
| NF-12 | The store version 6 to 7 migration only adds. A backup is taken first; a failed migration leaves the old store usable. | AD-05, target |
| NF-13 | The pre-tool hook fails closed: no answer from FlowDriven within 5 s means the call is denied. | spec R12 |
| NF-14 | A decision expires after 24 hours and counts as Reject. A sign-in wait lasts up to 12 hours. A step is retried twice by default. | spec |
| NF-15 | Runs are kept 90 days or the last 50 per flow, whichever is larger. The audit log is append-only and is never trimmed by this. | spec |
| NF-16 | A long step keeps the Mac awake while it runs. | code |

### 7.3 Privacy

| Id | Requirement | Source |
|---|---|---|
| NF-17 | Chats, flows, memory, rules and the audit log are stored on the Mac in the app's data folder, which only the person's user can open. | code |
| NF-18 | No telemetry, no analytics, no crash upload. The app opens no network connection of its own. What the person's agents send to their makers is under the makers' terms. Later phases (marketplace, gateway, bots) add connections that are named in their own release notes. | owner |
| NF-19 | Memory is never published, exported, logged or put in a bug report. | spec R18 |
| NF-20 | Secrets live in the keychain and are used only at the moment of use for a declared purpose. | SR-6 |
| NF-21 | A report leaves the app only when the person clicks "Copy report". | F-14 |
| NF-22 | Success measures (section 8) are computed on the Mac from local records and never leave it. | owner |

### 7.4 Security

| Id | Requirement | Source |
|---|---|---|
| NF-23 | Electron keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, loads no remote content, and keeps its content security policy and the session lockdown that blocks every request outside `app://flowdriven`. | AGENTS.md |
| NF-24 | Preload exposes only a frozen `runner.call`, `runner.subscribe` and a small `window` API. IPC checks the sender and the method name. | AD-02 |
| NF-25 | The renderer talks only to `RunnerClient` and holds view state only. | AGENTS.md |
| NF-26 | Agent and outside text is drawn by a safe text renderer: no raw HTML, no remote images; links open only after a click and a check in main. | AD-16 |
| NF-27 | The runner starts agents with a minimal environment (`HOME`, `USER`, `PATH`, `TMPDIR`, `LANG`) and never passes `ANTHROPIC_*` or `CLAUDE_*` variables. | code |
| NF-28 | The app checks `contractVersion` at start and refuses a mismatch. | AD-03 |
| NF-29 | A hidden-character scan runs over every file in the repository. | `pnpm check:hidden` |

### 7.5 Accessibility

| Id | Requirement | Source |
|---|---|---|
| NF-30 | Status is always an icon plus words, never colour alone. | AGENTS.md |
| NF-31 | Everything can be done with the keyboard. Enter sends, Shift+Enter adds a line, Cmd/Ctrl+K opens Search, Escape closes a dialog or menu and returns focus to where it came from. The focus ring is 2 px and always visible. | brief 21 |
| NF-32 | Text and icons have a contrast of at least 4.5:1 in Light and Dark. | brief 21 |
| NF-33 | With reduced motion on, no animation runs. | brief 21 |
| NF-34 | Menus, radios and dialogs use the right roles and names (for example `aria-current` for the open chat, `aria-expanded` on rows, a polite live region for short messages, the name "Make a flow from <skill name>"). | brief 23 |
| NF-35 | The layout works down to 360 px wide with no sideways scroll, and no button, tag or tab breaks inside a word in either language. | brief 2, 24.4 |

### 7.6 Languages

| Id | Requirement | Source |
|---|---|---|
| NF-36 | English is the default. Bahasa Indonesia is complete. Adding a language is one new file plus one line (F-20). | owner |
| NF-37 | The window's `lang` follows the language. Dates and times use `Intl.DateTimeFormat`. Date tests also run in a zone other than UTC, for example `Asia/Jakarta`. | AD-14 |
| NF-38 | Translations live only in the language files. | AD-14 |

### 7.7 Platform

| Id | Requirement | Source |
|---|---|---|
| NF-39 | macOS first. Code that is OS specific (secret store, background start, sandbox, file watching, app detection) sits behind interfaces so Windows can follow right after the first release and Linux later. | spec 6.4 |
| NF-40 | The supported macOS versions and chip types are set in release setup (B-30) and are not decided here. | AD-20 |

### 7.8 Resource use

| Id | Requirement | Source |
|---|---|---|
| NF-41 | The keeper limits agent processes: a ceiling of 4 at once (the person can change it), a memory reserve of 15 percent of installed memory with a minimum of 1 GB, a wait when macOS memory pressure is at level 4 or more, a second process only below 0.9 of the five-hour usage window. | code |
| NF-42 | No idle agent process and no warm pool. Nothing is killed to make room. | spec |
| NF-43 | With no run, the app in the menu bar uses under 1 percent CPU on average and under 200 MB of memory (target). | target |
| NF-44 | A chat turn uses a compact context: at most 12 turns or 24,000 characters. | AD-10 |

### 7.9 Openness

| Id | Requirement | Source |
|---|---|---|
| NF-45 | The core is AGPL-3.0. The SDK, the flow format, the adapter interface and the test kit are MIT. The marketplace server is closed. | spec S1 |
| NF-46 | Only packages on `tools/checks/allowlist.json` are used. | AGENTS.md |
| NF-47 | Flows are plain files the person can read. Reports export as Markdown. | spec |
| NF-53 | Contributing is easy both by hand and with AI agents: a README quickstart, `CONTRIBUTING.md` for people who code by hand, `AGENTS.md` as the rule set for AI agents, and `docs/translating.md` for languages (B-31, `contributing-plan.md`). | owner |

### 7.10 Maintainability

| Id | Requirement | Source |
|---|---|---|
| NF-48 | Contracts first: a contract change is its own build step, and the runner API has a version that both sides check. | AD-03 |
| NF-49 | Tests first: the failing test is written and run before the code. | AGENTS.md |
| NF-50 | No test talks to the network, a real agent or a real account. Time comes from an injected clock. | AGENTS.md |
| NF-51 | Every agent adapter passes one shared conformance suite against its fake CLI. | AD-08 |
| NF-52 | `pnpm check` passes before any work is reported done. The existing tests (about 1,950) keep passing, except those of screens that retire (deleting them is Ask first). | AGENTS.md |

## 8. Success measures

All measures are computed on the person's Mac from the audit log and the run history. Nothing leaves the Mac. Numbers marked "target" are the drafter's proposals.

### 8.1 Measures

| Id | Measure | How it is measured | Target |
|---|---|---|---|
| M-01 | Time from first launch to the first finished run | Audit log: first launch event to first run in state `done` | Median 10 minutes or less, including the agent's own sign-in |
| M-02 | Daily use after four weeks | Days in a week with at least one start, in week 4 and later | 5 of 7 days on average |
| M-03 | Risky actions without a decision or a standing rule | Audit log: any `send`, `post`, `pay`, `delete` or `merge` action with no matching decision record | 0 |
| M-04 | Questions per start for flows with remembered answers | Number of chat questions before a start, for flows with `remember` inputs | Median 1 or less; 0 with "Use my last answers" |
| M-05 | Scheduled starts on time while the Mac is awake | Start time against schedule time | 99 percent within 60 seconds |
| M-06 | Lost run records after a crash | Crash tests and the Chair walk: runs in the store before and after | 0 |
| M-07 | Unrequested starts from the chat | Starts with source `chat` that have no matching request by the person | 0 |
| M-08 | Honest "done" | Runs in state `done` where every step has a passed check by something other than the agent | 100 percent |
| M-09 | Decisions that expire | Decisions in state `expired` against all decisions | 5 percent or less |
| M-10 | Stop time | Time from "Stop" to the end of the process group | 95 percent within 2 seconds |
| M-11 | Flows that run after being made | Flows with at least one run within 7 days of "Save flow" | 70 percent or more |
| M-12 | Decisions answered in one place | Decisions with a second, conflicting answer | 0 |

### 8.2 Language coverage

| Id | Measure | How it is measured | Target |
|---|---|---|---|
| M-13 | Missing Indonesian words | The language check in `pnpm check`: keys in English that Indonesian lacks | 0 |

## 9. V1 scope

Decided for V1 (revisable), 2026-11-21. The owner asked for no questions before V1 is done, so the chair decided the scope (Q-01). The whole V1 build is test-first: each build step's test cases are written and seen failing before its code (see `test-plan.md` and `build-order.md`).

| Version | Build steps | Features | Journeys |
|---|---|---|---|
| V1: chat-first core | B-01 to B-24, B-31 | F-01 to F-16, F-20 to F-23 | j01, j12, j20 to j25, j27 to j31 |
| V2: memory, phone, skill updates | B-25, B-26, B-27 | F-17, F-18, F-24 | j26 (Memory, Phone & bots, skill updates) |
| V3: marketplace and gateway | B-28, B-29 | F-19, more connectors for every agent | j26 (Marketplace) |
| Before any public download | B-30 | packaging, signing, notarization, update channel | none |

What V1 is, in one line each:
- In V1: first launch and Set up for Claude Code and Codex; the sidebar, chat list and Search; the chat that runs one flow, several or a chain; flow inputs in plain words or a form with remembered answers; results in the chat or as a report; the Flows list and flow page; the start rule; schedules, "after another flow" and the proactive question; making and improving flows in the chat; flows from skills; decisions with Always allow and Ask me again; Activity and the run page; Settings; notifications; English and Bahasa Indonesia; the agent and model picker; running in the menu bar; the spending limit and usage limits; the contributor guides (B-31, see `contributing-plan.md`).
- Not in V1: Memory (V2), Phone & bots and other AI tools on this Mac (V2), skill updates with roll back (V2), the Marketplace (V3), the FlowDriven gateway for more connectors (V3), and the packaged, signed download (before any public download). Their screens do not appear in V1.
- V1 is used from a checkout (`pnpm start`) until B-30 makes a download.

V1 includes the Skills screen and Make a flow from a skill (F-12). V1 also includes the language files, the model picker and the menu bar (F-20, F-21, F-22); the first two follow version 9 of the clickable prototype, and the menu bar part goes into the clickable prototype first.

## 10. Decisions for V1

Each decision below is decided for V1 and can be revised later. The reasoning is kept so a later change knows what was weighed.

### Q-01 Scope of V1

Decided for V1 (revisable): three versions, as in section 9.

The problem. The clickable prototype shows every feature, but building everything before the first real use delays it.

What was weighed. How soon the owner can run real flows. The size and risk of each part: Memory, phone and the marketplace are separate large pieces with their own security work. The marketplace needs a server and signing. A screen that is shown but not built looks broken.

Options that were considered. Three versions (chosen); two versions (the core, then everything else); one version with everything (slowest to first use, the highest risk).

### Q-02 Background running

Decided for V1 (revisable): FlowDriven keeps running in the menu bar when the window closes, and "Open at login" is on by default. Both are switches in Settings.

The problem. Schedules and the 17:00 question only happen while FlowDriven runs. If the window closes and the app stops, a person can miss them without knowing.

What was weighed. A scheduled flow is useless if the app is not running. A menu bar app is familiar and easy to quit. A separate helper that runs even after quitting is more parts, more security work and more to explain. Running quietly uses some memory.

Options that were considered. The menu bar with Open at login (chosen); running only while the window is open (schedules stop when it closes); a separate helper that runs even after quitting (deferred: more parts).

### Q-03 What the spending limit counts

Decided for V1 (revisable): the limit counts only money charged per use (API keys, paid credits). Subscription plans are bound by the agent's own usage limits (F-23.R4).

The problem. The person's agents are paid in different ways. An API key charges money per use. A subscription plan charges nothing per run but has usage limits.

What was weighed. A limit in dollars is honest for API keys and paid credits. On a subscription the agent gives no price, and an estimate can be wrong. Showing a dollar number that is only an estimate may mislead.

Options that were considered. Only money charged per use (chosen); the agents' cost estimates even on a subscription (one number for everything, but an estimate that can be wrong).

### Q-04 How V1 is built without a question to the owner

Decided for V1 (revisable), by the chair, 2026-11-21, so that the V1 build needs no question to the owner:

1. Translations. The owner asked for English and Bahasa Indonesia and for languages that contributors can add easily, so the language files are approved by that request. They are not an Ask-first item.
2. No new workspace package. The words files live in `apps/desktop/src/i18n/`, and the language check is a test there (F-20). `tools/checks/` and its allowlist stay unchanged.
3. No font files in V1. The app uses the system font stack. Bundling the clickable prototype's font is a later Ask-first item.
4. The builder-first screens are unrouted in V1, not deleted. Their code and tests stay and keep passing. Removing them is a later Ask-first item.
5. Packaging and the runner bundle stay out of V1 (B-30, before any public download). During V1 the app runs from a checkout (`pnpm start`).
6. No CI change and no new dependency in V1: only packages already in `tools/checks/allowlist.json`.
7. Changes to approvals and the sandbox (AD-06, AD-07, Reject skipping an action instead of failing the run, the Codex sandbox) follow the clickable prototype, which the owner approved. The build plan marks each task that makes such a change as a safety-core change, and each gets one independent security review before its pull request leaves draft.
8. AGENTS.md is not edited in V1.

The problem. AGENTS.md makes some changes Ask-first, and the owner wants no question before V1 is done.

What was weighed. Each Ask-first item either follows from what the owner already asked or approved (translations, the prototype's behavior), or can wait without hurting V1 (fonts, deleting old screens, CI, packaging, new packages).

Options that were considered. Keep the items for one bundled question (rejected: the owner asked for no questions); drop them from V1 (chosen); decide them for the owner (rejected: AGENTS.md says the owner decides them).

### Ask-first items after V1

Each stays Ask-first under AGENTS.md and is asked when its work is planned:
- bundling the clickable prototype's font files;
- removing the unrouted builder-first screens, their frozen contract copy and their tests;
- moving the doc checks into `tools/checks/`;
- pointing AGENTS.md's "Design:" line to `docs/design/` and saying there that the language files are the one place for other languages;
- the runner bundle, packaging, signing and updates (B-30);
- a shared words package, if V2's bot messages need words outside the app.

## 11. Assumptions and dependencies

- Agent CLIs. FlowDriven drives Claude Code and Codex through their command lines. Their flags, output and sign-in commands can change. The shared conformance suite and fake CLIs catch drift in tests; a real-CLI research step for Codex is a Chair step.
- The makers' terms. Some agents sign in with the person's own subscription. The person must check the maker's terms for running flows while away. FlowDriven shows the note and does not decide for the person.
- Sign-in through the agents' own flows. FlowDriven never sees a password and never reads the agents' sign-in files.
- The macOS keychain stores bot tokens and connector keys.
- Telegram and Discord (V2) have their own terms and limits. Their bots send messages through the makers' servers. This is the only place where FlowDriven data goes through a third party, and the payload rules in F-18 apply.
- The marketplace server (V3) is a later, closed-source phase. Signature and revocation checks need a pinned public key.
- The FlowDriven gateway (V3) is a local server for proxied account tools.
- Node 24.14.0 or later and pnpm 10.9.0 for building. The runner is bundled to JavaScript for a packaged app (release setup, Ask first).
- The prototype stays the reference. Parts marked "Not in the prototype yet" need the owner's approval in the prototype first.
- The existing engine, store, Claude Code adapter, hook channel, held calls, router, keeper, triggers and notices stay (about 1,950 tests).

## 12. Traceability

Test files are `docs/design/test-cases/journeys.md` (cases `TC-jNN-..`), `safety.md` (`TC-SRn-..`) and `platform.md` (`TC-CON-..` and the other component codes). Flow spec files are in `docs/design/flows/`. The build steps are in `docs/design/build-order.md`.

| Feature | Journeys | Flow spec file | Test files | Build steps |
|---|---|---|---|---|
| F-01 | j01 | `j01-first-launch.md` | journeys (j01); safety (SR-2, SR-6); platform (AGT, IPC, UI) | B-21, B-07, B-22 |
| F-02 | j20, j12 | `j20-run-from-chat.md`, `j12-settings.md` | journeys (j20, j12); platform (UI, SRCH) | B-16 |
| F-03 | j20, j27 | `j20-run-from-chat.md`, `j27-flow-inputs.md` | journeys (j20, j27); safety (SR-5); platform (AST, UI) | B-08, B-17 |
| F-04 | j20 | `j20-run-from-chat.md` | journeys (j20); safety (SR-5, SR-8); platform (AST, STR, AGT) | B-10, B-08 |
| F-05 | j27 | `j27-flow-inputs.md` | journeys (j27); safety (SR-5); platform (INP, SDK) | B-09, B-02 |
| F-06 | j20, j27 | `j20-run-from-chat.md`, `j27-flow-inputs.md` | journeys (j20, j27); safety (SR-7); platform (RES, I18N) | B-11 |
| F-07 | j21 | `j21-run-from-flows.md` | journeys (j21); safety (SR-1, SR-3); platform (UI, RUL, STR) | B-18, B-04 |
| F-08 | j21, j28 | `j21-run-from-flows.md`, `j28-proactive-schedule.md` | journeys (j21, j28); safety (START, SR-3, SR-8); platform (STR) | B-12 |
| F-09 | j28, j21 | `j28-proactive-schedule.md`, `j21-run-from-flows.md` | journeys (j28, j21); safety (SR-2, SR-3); platform (STR, SDK, STO) | B-12, B-23 |
| F-10 | j22 | `j22-make-a-flow.md` | journeys (j22); safety (SR-1, SR-3, SR-5); platform (AST, SDK, RUL) | B-13, B-02 |
| F-11 | j23 | `j23-improve-a-flow.md` | journeys (j23); safety (SR-2, SR-3); platform (AST, RUL) | B-14 |
| F-12 | j29, j26 | `j29-flow-from-skill.md`, `j26-memory-phone-marketplace.md` | journeys (j29, j26); safety (SR-2, SR-5); platform (SKL, AST) | B-15 |
| F-13 | j24 | `j24-decisions.md` | journeys (j24); safety (SR-1, SR-2, SR-5, SR-7); platform (RUL, UI, ENG) | B-04, B-05, B-19 |
| F-14 | j25 | `j25-history-and-problems.md` | journeys (j25); safety (SR-7, SR-8); platform (UI, ENG, RES) | B-19 |
| F-15 | j12 | `j12-settings.md` | journeys (j12); safety (SR-2, SR-8, SR-9); platform (ELE, IPC, I18N, AGT, UI) | B-20, B-07, B-06, B-24 |
| F-16 | j24, j28 | `j24-decisions.md`, `j28-proactive-schedule.md` | journeys (j24, j28); safety (SR-6); platform (ELE, STR) | B-12, B-05 |
| F-17 | j26 | `j26-memory-phone-marketplace.md` | journeys (j26); safety (SR-2, SR-5, SR-6); platform (MEM) | B-25 |
| F-18 | j26 | `j26-memory-phone-marketplace.md` | journeys (j26); safety (SR-2, SR-5, SR-6); platform (PHN) | B-26 |
| F-19 | j26 | `j26-memory-phone-marketplace.md` | journeys (j26); safety (SR-3, SR-5); platform (MKT) | B-28 |
| F-20 | j30 | `j30-app-language.md` | journeys (j30); platform (I18N, UI) | B-06 |
| F-21 | j31 | `j31-agent-and-model.md` | journeys (j31); safety (SR-4); platform (AGT, UI) | B-07, B-17, B-22 |
| F-22 | j28 | `j28-proactive-schedule.md` | journeys (j28); safety (SR-8); platform (ELE, STR) | B-23 |
| F-23 | j12, j25 | `j12-settings.md`, `j25-history-and-problems.md` | journeys (j12, j25); safety (SR-9); platform (ENG, STO) | B-24 |
| F-24 | j26 | `j26-memory-phone-marketplace.md` | journeys (j26); safety (SR-2, SR-5); platform (SKL) | B-27 |

Other build steps and where they fit: B-01 contract version 2 (all features, component code CON), B-03 store version 7 (all features, STO), B-29 gateway (F-19 and more connectors), B-30 packaging (none).

## 13. Drafter's calls

- The agent and model are joined by a middle dot, as in the app ("Claude Code · Sonnet 5.5"); it is the one non-ASCII character this set allows.
- Narrow screens (down to 360 px) are kept from the prototype (NF-35). The window's minimum size today is 1100 by 720; the architecture decides the final minimum.
- Settings order is inferred from the prototype (Appearance, Language, AI agents, Permission, Main AI agent, busy fallback, Spending limit, Notifications), because the brief does not list it.
- F-09.R8 (first run when a schedule is turned on) follows the owner decision of 2026-11-18 but is Not in the prototype yet, so it must go into the prototype first.
- Expiry of decisions after 24 hours, the "Missed" row, system notifications and install or sign-in failure paths are marked Not in the prototype yet, because the prototype does not show them.
- The skill archive hint went into F-24 (V2), not F-12, to keep V1 small.
- Success measure targets (M-01, M-02, M-04, M-05, M-09, M-10, M-11) and performance numbers marked "target" are the drafter's proposals, not sourced; they are decided for V1 (revisable).
- The defaults follow the decisions for V1: Open at login on (Q-02); the spending limit counts per-use charges only (Q-03). The limit's starting amount ($10.00 a month, as in the clickable prototype) is a target.
- V1 includes F-20, F-21 and F-22 as the chair proposed; all three wait for prototype approval, and F-20 and F-21 follow the final version 9 sections of the brief.
- The "Other AI tools" switch is off by default (F-18.R8): a safe default the brief does not state.
- F-12.R6 (skill pinned by hash) and F-24.R1 come from the original spec rules R9 and R16, which stay binding.
- A decision answered from two places counts once (F-13.R14) and M-12 measures it: my addition to keep the audit record clean.
