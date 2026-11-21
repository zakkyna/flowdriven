# FS-j01: First launch and agent set up

| Item | Value |
|---|---|
| Journey | j01, "Mulai pertama kali", First launch and agent set up |
| PRD features | F-01 (also F-20 for the language options on the welcome screen) |
| Safety rules | SR-2, SR-4, SR-6, SR-7, SR-8 |
| Prototype source | The prototype brief, 'Redesign 1: chat first, plain words', 'Fix round 4: after the chat-first check' and 'English and Bahasa Indonesia'; `js/screens/agents.js`, `js/actions.js` (`setUpAgent`, `signInAgent`, `setAgentConsent`), `js/guide.js` (j01) |
| Status | In the prototype (version 8); the language options are in the prototype (version 9); failure paths (PU-01, PU-02, PU-03), a real scan and a real sign-in are Not in the prototype yet |

## Goal

A person who opens FlowDriven for the first time gets from the welcome screen to an empty chat with one working AI agent, with as few clicks as possible. One click on "Set up <agent>" gives the one permission for all agents, installs the agent when needed, and waits for the person to sign in.

## Entry points and trigger

- Trigger: the app opens and `agentPermission` is `unset` or `mainAgent` is not set (the person never clicked "Start chatting"). The router opens `#/welcome` instead of the chat.
- Later entry: the person never sees the welcome screen again after the first "Start chatting". If permission is later turned off, or no agent is ready, the chat opens as usual and the composer shows a line with the next-step button ("Turn on permission" when the permission is off, PU-07; FS-j12).
- Language options on the welcome screen are part of FS-j30.

## Preconditions

- FlowDriven is installed and the runner has started. The app checked `contractVersion` with `runner.info` (see FS-j01.E8).
- Nothing else is needed. No agent has to be installed. Installing needs the network (the agent's own installer, which FlowDriven runs only after the person chooses Set up); detection does not.

## Main path

Steps S1 (language options) and S4 (the agent and model pill) depend on version 9.

1. **FS-j01.S1 Welcome.**
   - Person: opens FlowDriven.
   - FlowDriven: calls `runner.info`, `settings.get` and `agents.list`. `agents.list` detects every agent in FlowDriven's catalog without installing anything. It shows the welcome screen.
   - Sees: small language options above the heading ("English", "Bahasa Indonesia", version 9); "Welcome to FlowDriven"; "FlowDriven runs your repeated work on an AI agent you already have." plus " We did not find one on this Mac yet." when no agent is `ready`; a card "Get started" ("FlowDriven runs your flows on the AI agents on this Mac. Choose one to set up. This also gives FlowDriven permission to run your AI agents, now and later. You can change that in Settings.") and a note about subscription terms; one card per agent with name, maker, account line ("Sign in with your Claude account" or "Sign in with your ChatGPT account"), a risk badge ("Check the terms" or "Supported") and its note, a primary button "Set up Claude Code" or "Set up Codex" (the same label for an agent that is already ready; the click then only gives the permission), a link "Install it yourself", and a ghost button "Already installed one? Scan again".
2. **FS-j01.S2 Set up.**
   - Person: clicks "Set up Claude Code".
   - FlowDriven: calls `agents.setUp {agentId}`. In order: (a) sets `agentPermission` to `on` (the click is the permission; no dialog) and writes an audit record `permission_changed` with source `window`; (b) if the agent is `not_installed`, sets state `installing` and runs the agent's official installer, the install command from FlowDriven's own agent catalog, without a shell (the only network action FlowDriven starts, and only because the person chose Set up); (c) sets state `waiting_login`, starts the agent's own sign-in, and polls the agent's sign-in status command until it reports signed in. An agent that is already installed but `needs_login` skips (b).
   - Sees: the card shows "Installing..." and then "Waiting for you to sign in..." with a spinner. No button is shown while these run.
3. **FS-j01.S3 Sign in.**
   - Person: signs in with their own account in the agent's own window or browser tab.
   - FlowDriven: the poll sees "signed in", sets the agent `ready`, emits `changed` on topic `agents`. It never sees the password and never reads the agent's own sign-in files (SR-6).
   - Sees: the card badge "Ready". Because permission is `on` and an agent is `ready`, the cards give way to "You're ready" and a button "Start chatting".
4. **FS-j01.S4 Start chatting.**
   - Person: clicks "Start chatting".
   - FlowDriven: if `mainAgent` is not set, sets it to this agent with its default model (`settings.update`). Calls `chats.create`. Opens `#/chat/<chatId>`.
   - Sees: the empty chat: "What should I do?", "I can run your flows, make a new flow, or improve one.", the composer, and the agent pill (version 9: "Claude Code · Sonnet 5.5" with a status dot; version 8: "Claude Code ready"). FlowDriven opens this welcome screen only until this click.

## Other paths

- **FS-j01.P1 Install it yourself.** Person clicks "Install it yourself". FlowDriven shows a dialog with three steps (open Terminal, run this command, come back and scan) and the catalog command in a copyable box (for example `npm install -g @anthropic-ai/claude-code`). The command appears only here (the prototype brief, 'Fix round 4: after the chat-first check'). FlowDriven runs nothing. The exact command is fixed after the research step (B-21, B-22).
- **FS-j01.P2 Scan again.** Person clicks "Already installed one? Scan again". FlowDriven calls `agents.rescan`. If it finds an agent that was not found before, a message says "Found Claude Code. Choose Set up Claude Code to finish." (the button then goes straight to sign-in). If not, "Nothing new found." Outside the first run the message is "Scanned. 2 AI agents found." with the real count. Real detection replaces the prototype's canned result.
- **FS-j01.P3 An agent that is already ready.** If detection finds an agent installed and signed in, its card shows "Ready" and the button still reads "Set up Claude Code". The click gives the permission only and installs and signs in nothing. (Removed from V1: the special label "Use Claude Code" for a ready agent; it goes into the prototype first, later.)
- **FS-j01.P4 Codex first.** Person sets up Codex instead. The flow is the same. Codex becomes the main agent. Runs and chats use the agent of the chat, so nothing is blocked because Claude Code is missing (the prototype blocked the first run in this case).
- **FS-j01.P5 Both agents.** After the first agent is ready the person can set up the other later in Settings (FS-j12).
- **FS-j01.P6 Leave early.** Person quits during install or sign-in. On the next launch the state is recomputed by detection (see FS-j01.E7); the welcome screen shows again because `mainAgent` is still not set.

## States

| Entity | From -> to | Cause |
|---|---|---|
| `agentPermission` | `unset` -> `on` | Person clicks "Set up" |
| Agent | `not_installed` -> `installing` | `agents.setUp` starts the catalog install |
| Agent | `installing` -> `waiting_login` | Install command ended with success |
| Agent | `installing` -> `not_installed` | Install command failed (FS-j01.E1, PU-01) |
| Agent | `waiting_login` -> `ready` | The agent's status command reports signed in |
| Agent | `waiting_login` -> `needs_login` | No sign-in after 10 minutes (FS-j01.E2, PU-01) |
| Agent | `needs_login` -> `waiting_login` | Person clicks "Sign in" (`agents.signIn`) |
| Agent | any -> `unknown` | Status output cannot be read, or the version is too old (FS-j01.E3, PU-02) |
| `mainAgent` | unset -> agent and its default model | "Start chatting" |
| Chat | none -> new empty chat | "Start chatting" |

## Decisions and confirmations

- One click gives the permission for all agents. There is no consent dialog and no per-agent consent (owner decision, 2026-11-18). The card text and the Settings switch say so.
- The install is one click with no confirm dialog (owner decision, 2026-11-18). FlowDriven runs only the command from its own catalog; the screen text and agent output never supply a command.
- Nothing is confirmed twice. "Install it yourself" and "Scan again" ask nothing.
- FlowDriven sends nothing of its own over the network. The only network action it starts is the agent's official installer, and Set up runs that installer only after the person chooses Set up (NF-18, T-27). Nothing else starts it. No card line says this in V1: the README safety note does.
- (Removed from V1: the card sentence about the companies that make the AI agents and what they read; it goes into the README's short safety note. It goes into the prototype first, later.)
- Deliberately not asked: the sign-in itself (done in the agent's own window), a try run, naming the agent.

## Errors and edge cases

- **FS-j01.E1 Install fails** (no network, installer missing, no rights; PU-01). Cause: the catalog command ends with an error. Person sees: the card goes back to "Not installed" with one plain sentence ("The install did not finish: <short reason>.") and a button "Try again". Next: permission stays `on`; "Try again" runs Set up again; "Install it yourself" stays available. The prototype had no failure path.
- **FS-j01.E2 Sign-in not completed** (PU-01). Cause: the person does not sign in within 10 minutes. Person sees: one plain sentence ("The sign-in did not finish.") and a button "Try again"; the state is `needs_login`. Next: polling stops; "Try again" calls `agents.signIn` and polls again.
- **FS-j01.E3 Agent unreadable or too old** (PU-02). Cause: the status output is invalid, or the agent lacks flags FlowDriven needs to run it safely. Person sees: state `unknown` with the line "Update <agent> to use it with FlowDriven." Next: the agent cannot be chosen until a scan finds a supported version ("Scan again" is on this screen and in Settings).
- **FS-j01.E4 Agent not set up or signed out later.** Cause: after first launch an agent becomes `needs_login` or `not_installed`. Person sees: no welcome screen. The composer pill and Settings show the state and the one next-step button (same action as here). A run started on it shows "Waiting for sign-in" (FS-j25).
- **FS-j01.E5 Permission off.** Cause: the person turned it off in Settings. Person sees: no welcome screen; the composer says "FlowDriven may not run your AI agents." with the button "Turn on permission" (PU-07), which opens the "Before you start" dialog of Settings. Nothing is sent and no run is created. Next: FS-j12.
- **FS-j01.E6 Missing or invalid inputs.** The welcome screen has no input fields. The only invalid case is a catalog entry FlowDriven cannot run (missing command), which hides that agent's "Set up" button and shows "Install it yourself" only.
- **FS-j01.E7 Crash or restart during set up.** Cause: runner or app ends while `installing` or `waiting_login`. Next launch: `agents.list` runs detection again; a half-installed agent is `not_installed` or `ready` by what is found. FlowDriven never resumes an install by itself; the person clicks "Set up" again.
- **FS-j01.E8 Contract mismatch or runner will not start** (PU-03). Cause: `runner.info` returns a `contractVersion` the app does not support, or the runner exits (for example the data folder is in use). Person sees: a plain screen ("FlowDriven needs an update: the app and its engine do not match." or "FlowDriven is already open somewhere else.") with "Quit". Next: no other call is made.
- **FS-j01.E9 Not applicable at first launch.** Limits reached, a stopped or failed run, a flow changed since it was confirmed, a missed scheduled time, outside text trying to steer an agent, and a decision that expires cannot happen: no flow, run, schedule, chat or decision exists before the first chat, and the welcome screen reads no outside text. They are covered in FS-j12, FS-j20, FS-j21, FS-j24 and FS-j28.
- **FS-j01.E10 Prototype gap: Codex only.** The prototype cleared the first-run state when only Codex was set up but still blocked the first run, because the check looked only at Claude Code. The real app has no such check; see FS-j01.P4.
- **FS-j01.E11 Prototype gap: timers.** The prototype's install and sign-in were timers. The real app uses the real install command and the real status command; tests use the fake agents.
- **FS-j01.E12 Window closed during set up.** Cause: the person closes the window while `installing` or `waiting_login`. On macOS the app stays alive when its window closes (today's behaviour; V1 adds no menu-bar icon, FS-j12.P5), so the install and the sign-in poll continue; reopening the window shows the current card. Quitting the app is a crash or restart for this purpose (FS-j01.E7).

## Data read and written

- Reads: `Settings` (`agentPermission`, `mainAgent`, `language`), `Agent` (state, version, account label, risk badge and note, install command and pinned installer package from the catalog).
- Writes: `Settings.agentPermission`, `Settings.mainAgent`, `Agent` state, a new `Chat`, `AuditRecord` (`permission_changed`, `agent_setup`).

## Runner API used

`runner.info`, `settings.get`, `settings.update`, `agents.list`, `agents.setUp`, `agents.signIn`, `agents.rescan`, `agents.models`, `chats.create`. Topics: `agents`, `settings`, `chats`.

## Acceptance criteria

Criteria A1-A12 do not depend on version 9; A13 and A14 do.

- **FS-j01.A1** When `agentPermission` is `unset`, the app opens `#/welcome` and not the chat.
- **FS-j01.A2** The welcome screen shows one card per catalog agent with its state words, risk badge and one next-step button, and no per-agent consent dialog.
- **FS-j01.A3** One click on "Set up" sets `agentPermission` to `on`, installs when needed, and waits for sign-in with no further click, in that order.
- **FS-j01.A4** The install runs only the catalog command, without a shell, only after the person chose Set up, and never passes a permission-bypass or full-access flag (SR-4). FlowDriven starts no other network action (NF-18).
- **FS-j01.A5** Sign-in is detected only through the agent's own status command; FlowDriven never reads the agent's sign-in files and never receives a password (SR-6).
- **FS-j01.A6** When the agent is `ready` and permission is `on`, "You're ready" and "Start chatting" appear.
- **FS-j01.A7** "Start chatting" sets `mainAgent` to that agent and its default model when none is set, creates an empty chat, and opens it.
- **FS-j01.A8** "Install it yourself" shows the catalog command and starts nothing; "Scan again" reports "Found <name>..." or "Nothing new found." from real detection. A ready agent's card keeps the label "Set up <name>"; its click only gives the permission.
- **FS-j01.A9** A failed install leaves the agent `not_installed` with one plain sentence and a "Try again" button, keeps permission `on`, and lets Set up run again (PU-01).
- **FS-j01.A10** No sign-in within 10 minutes sets the agent `needs_login`, stops polling, and shows one plain sentence with "Try again" (PU-01).
- **FS-j01.A11** After a restart during set up, agent states come from detection, and no install restarts by itself.
- **FS-j01.A12** The permission change is in the audit log with source `window`. After "Start chatting" the app never opens the welcome screen at launch again; a `contractVersion` mismatch blocks the app before the welcome screen.
- **FS-j01.A13** (version 9) The welcome screen shows every registered language by its own name, and choosing one switches the words at once.
- **FS-j01.A14** (version 9) The agent pill in the new chat shows the main agent and its default model.

## Not in the prototype yet

- Still to be shown in the prototype before the build (AGENTS.md: prototype first): PU-01 (install failure and sign-in timeout: one plain sentence and "Try again"), PU-02 (an agent too old to run safely: "Update <agent> to use it with FlowDriven."), PU-03 (the version mismatch screen with "Quit"), PU-07 (the permission-off refusal with "Turn on permission"), and the one added line on the Set up card. Real detection and sign-in polling replace the prototype's timers.
- Removed from V1 (later, prototype first): the label "Use <agent>" for an agent that is already ready, and the card and dialog sentences about the companies that make the AI agents.

## Drafter's calls

- Route written as `#/welcome` and `#/chat/<id>` to match the existing `#/` hash style; the prototype used `#welcome`.
- `agentPermission` has three values (`unset`, `on`, `off`). The welcome screen is the launch screen while `agentPermission` is `unset` or `mainAgent` is not set. Reason: the prototype ended first run when permission was given and an agent was ready; `mainAgent` marks that the person finished.
- Sign-in polling stops after 10 minutes. Reason: a poll must end; the prototype only had a 2-second timer.
- A ready agent keeps the label "Set up <name>" (Decided for V1, revisable). Reason: the owner has not seen "Use <name>", so it is removed from V1; the click then only gives permission.
- Each catalog entry carries its install command and sign-in command; the exact commands and the pinned installer package names are confirmed in the research task B-21.T4 (a Chair step without network: it reads only the local `--help` and version output of the two installed command-line tools, never a web page, and records synthetic profiles with hand-typed values; nothing is recorded from a real session), before the Set up tasks of B-07; Codex's other details come from the Codex research, B-22.T1; until then tests use an injected agent profile and assert the exact value the profile gives.
- UI strings use ASCII "..." in this document; the real strings come from the language files.
