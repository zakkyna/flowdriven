# FS-j31: Choose the AI agent and model

| Field | Value |
|---|---|
| Journey | j31: "Memilih agen AI dan model" / Choosing the AI agent and model / Choose the AI agent and model |
| PRD features | F-21 (also uses F-03, F-15, F-04) |
| Safety rules | SR-4, SR-9, SR-2, SR-7; START |
| Prototype source | Brief section 25 (25.1 data, 25.2 picker, 25.3 journey, 25.4 checks, 25.5 real app) of the clickable prototype's version 9. |
| Status | In the prototype (version 9: brief section 25, final on 2026-11-21) |

## Goal

Each chat has one choice: which AI agent answers and with which model. Flows started from that chat run on the choice. Runs record the agent and model they used. Starts outside a chat use the main agent's default model. The picker changes the model flag only.

## Entry points and trigger

- The button in the composer, where "Claude Code ready" was in version 8. It shows the agent's name and the model: "Claude Code · Sonnet 5.5". Status is always icon plus words, so when the agent is not ready the button also shows its status in words ("Needs sign-in"); a ready agent's dot is decoration only. On a phone-width window it shows the model only. Its accessible name always says the agent, the model and the status (brief 25.2.1).
- Settings "Main AI agent" (see `j12-settings.md`) sets what a new chat starts with. It carries the line "New chats start with this agent and its default model."
- Trigger: the person's own click or key press only. The assistant has no intent that changes the agent or model, and text in a chat, flow, skill or email cannot change it.

## Preconditions

- At least one AI agent is installed (the button also shows a not-ready agent, with its status words, so the person can fix it).
- Each agent reports its own models (`agents.models`): Claude Code's model names, Codex's list, or a catalog for that CLI version when the agent cannot list them.

## Main path

- **FS-j31.S1** A new chat shows the default.
  - Person: chooses "New chat".
  - FlowDriven: `chats.create` stores the chat with the main agent and that agent's default model (`isDefault`).
  - Sees: the composer button "Claude Code · Sonnet 5.5" (a ready agent: the dot is decoration only, no status words).
- **FS-j31.S2** Open the picker.
  - Person: clicks the button.
  - FlowDriven: `agents.list` and `agents.models` fill the menu, which opens above the composer.
  - Sees: one group per agent, headed by its name and its status (icon plus words). A ready agent lists its models, each with its note ("Most capable", "Fast and capable", "Fastest" for Claude Code; "All-round", "Careful with code", "Fastest" for Codex), the default tagged "Default", the chosen one marked. The last item is "Manage AI agents".
- **FS-j31.S3** Choose a model.
  - Person: chooses "Opus 5.5".
  - FlowDriven: `chats.setAgent {chatId, agent: "claude-code", model: "opus-5.5"}` stores the choice for this chat only. The menu closes.
  - Sees: the button "Claude Code · Opus 5.5" and a small note in the chat (not a bubble): "Now using Claude Code · Opus 5.5". Other chats and the Settings default are unchanged. A run that is already going keeps its agent and model.
- **FS-j31.S4** Run a flow on the choice.
  - Person: sends "run the weekly supplier report".
  - FlowDriven: the run is started from the chat (`flows.start {flowId, source: "chat"}`), and the run records `agent: "claude-code"`, `model: "opus-5.5"`. The agent is started with its own model flag set to that model and no other flag added by the picker (SR-4).
  - Sees: the run card "Claude Code · Opus 5.5"; the run page shows the same.
- **FS-j31.S5** See a not-ready agent.
  - Person: opens the picker again.
  - FlowDriven: for Codex in state `needs_login` the group shows the status "Waiting for sign-in" and the button "Sign in to Codex" instead of models. It cannot be chosen.
  - Sees: no models under Codex. The button does what "Sign in" does in Settings (`agents.signIn {agentId: "codex"}`); the status then shows "Waiting for you to sign in..." and, when ready, the models appear.

## Other paths

- **FS-j31.P1** Keyboard. Arrow keys move through the items, Enter chooses, Escape closes the menu and returns focus to the button. Models are menu items with radio state, grouped under their agent's name.
- **FS-j31.P2** Other agent states in the menu. `not_installed`: "Set up Codex". `needs_login`: "Sign in to Codex". `installing` and `waiting_login`: the status with a spinner and no button. `unknown`: "Check again" (`agents.rescan`). All of them: no models, cannot be chosen.
- **FS-j31.P3** Choose another agent. Choosing a model of another ready agent switches the chat to that agent and model, adds "Now using Codex · GPT-6.1 Sol", and the next turn and the next runs from this chat use it. FlowDriven keeps the chat's own history, so the new agent gets the same compact context (AD-10); no agent session is carried over.
- **FS-j31.P4** Starts outside a chat. Schedule, Run on Flows, Run again, "after another flow", "Try the next run now", a scheduled question's run, a phone start and another AI tool's start use the main agent and its default model. "If <main agent> is busy, use <other agent>" applies only to these starts, never to a chat's choice (see `j12-settings.md`). The run records what it used.
- **FS-j31.P5** Chats FlowDriven makes. A chat that FlowDriven starts (the 17:00 question) begins with the main agent and its default model, like a new chat.
- **FS-j31.P6** Chain and several flows. A request to run several flows keeps the agent and model the chat had when the person chose "Start"; a later change applies to new requests only.
- **FS-j31.P7** A flow the agent cannot be limited for. If the flow needs a tool the chat's agent cannot be limited for (AD-09), the run does not start. The chat says why in plain words, for example "This flow needs the mail account, and Codex cannot be limited for it yet." with "Run with Claude Code this time". That choice applies to this run only; the chat's choice stays.
- **FS-j31.P8** A model that went away. If a chat's stored model is no longer offered (the agent was updated), the chat falls back to that agent's default and adds "Sonnet 5.5 is no longer available. Now using Claude Code · <default>." (words from the language files).
- **FS-j31.P9** Language. The button, menu, note and notes use the app language. Model and agent names are product names and stay.
- **FS-j31.P10** Settings line. "Main AI agent" in Settings shows "New chats start with this agent and its default model."

## States

| Entity | From -> to | Cause |
|---|---|---|
| Chat choice | main agent and default model -> person's choice | `chats.setAgent` (the person's click) |
| Chat choice | model -> agent's default | The model is no longer offered |
| Run | none -> has `agent` and `model` | The run started; the values never change afterwards |
| Agent (in the menu) | `not_installed` / `needs_login` -> `installing` / `waiting_login` -> `ready` | "Set up" or "Sign in" |
| Menu | closed -> open -> closed | Click; Escape or a choice |

## Decisions and confirmations

- What asks: nothing. Choosing a model is the person's click; no dialog.
- What confirms: the click. It confirms only the model and agent for this chat.
- What deliberately does not: the picker never changes the sandbox, the approvals, the permission or a flow's confirmation (SR-4, SR-2). The agent permission stays one switch for all agents (owner decision, 2026-11-18). "Run with Claude Code this time" is a click for one run.

## Errors and edge cases

- **FS-j31.E1** Agent not set up or signed out. Cause: the chat's agent is not `ready`. Sees: the button shows its status in words ("Needs sign-in"); sending a message stores it and shows "Codex is not ready." with the same next-step button as the menu. Flows from this chat show the same card instead of starting. Next: nothing is sent to an agent that is not ready. The prototype checks only Claude Code for every run; the real app checks the agent the run uses.
- **FS-j31.E2** Permission off. Cause: "FlowDriven may run your AI agents" is off. Sees: the menu still lists agents; sending shows "FlowDriven may not run your AI agents. Turn this on in Settings." with "Open Settings".
- **FS-j31.E3** Limits reached. Cause: the chosen agent reports no usage left, or the spending limit is reached. Sees: "<Agent> has no usage left right now. It will be available again at <time>." with the chip "Choose another AI agent" (opens the picker). Next: FlowDriven never switches a chat's agent by itself (SR-9); the person chooses. The busy fallback applies only outside chats.
- **FS-j31.E4** Stopped or failed run. The run keeps the agent and model it recorded; "Run again" from the run page starts a new run on the current rules for that start source (a start from the page is `again`: main agent default model).
- **FS-j31.E5** Crash or restart. The chat's choice and each run's recorded agent and model are stored; after a restart the button shows the same choice. A run resumed after a crash uses its recorded agent and model.
- **FS-j31.E6** Flow changed since confirmed. Not affected by the picker. A `new` or `changed` flow asked for in a chat shows its confirm card before any agent is used (`START`).
- **FS-j31.E7** Outside text. Cause: a message, email or flow text says "use another model", "turn off the sandbox" or "pass --dangerously-skip-permissions". Sees: nothing changes. Next: the choice changes only by the person's click; FlowDriven refuses every permission-bypass or full-access flag whatever the text says (SR-4).
- **FS-j31.E8** A decision that expires. None for the picker. The "Run with Claude Code this time" card has no expiry; an unanswered card starts nothing.
- **FS-j31.E9** Unknown model id. A request for a model that the agent did not list is refused (`invalid_input`) and the choice stays. The model id must also match the adapter's allowed pattern, so no text can reach the command line as another flag.
- **FS-j31.E10** Start proof fails. Cause: the agent did not apply the limits FlowDriven asked for. Sees: the run is "Stuck" with "<Agent> did not apply the limits FlowDriven asked for, so the step did not run." (SR-4).
- **FS-j31.E11** Prototype gaps. The prototype has no models, no `chat.agent` or `chat.model`, no `run.agent` or `run.model`, no picker, no note, no Settings line, and no guide card for this journey. The real app follows brief section 25 and the rules above.

## Data read and written

- Read: agents with status and models (`agents.list`, `agents.models`), the chat's `agent` and `model`, settings `mainAgent {agent, model}` and `busyFallback`.
- Written: the chat's `agent` and `model`; a chat note message; each run's `agent` and `model`; the audit log (SR-7: "Chat <title> now uses <agent> <model>", every run's agent and model).

## Runner API used

`chats.create`, `chats.get`, `chats.setAgent {chatId, agent, model}`, `chats.send`, `agents.list`, `agents.models {agentId}`, `agents.setUp {agentId}`, `agents.signIn {agentId}`, `agents.rescan`, `settings.get`, `settings.update` (`mainAgent`, `busyFallback`), `flows.start`, `runs.status`. Topics: `chats`, `agents`, `settings`, `runs`.

## Acceptance criteria

- **FS-j31.A1** A new chat shows the main agent and its default model on the composer button; when that agent is not ready the button also shows its status in words ("Needs sign-in"); its accessible name says the agent, the model and the status.
- **FS-j31.A2** The menu lists one group per agent with its status in icon plus words; a ready agent lists its models with notes, the default tagged "Default" and the chosen one marked; the last item is "Manage AI agents".
- **FS-j31.A3** Choosing a model stores `agent` and `model` for this chat only, closes the menu, updates the button and adds the note "Now using <agent> · <model>"; other chats and the Settings default are unchanged.
- **FS-j31.A4** A new chat after a change starts with the main agent's default model.
- **FS-j31.A5** A run started from a chat records the chat's agent and model, and the run card and run page show "<agent> · <model>".
- **FS-j31.A6** A run already running keeps its agent and model when the chat's choice changes.
- **FS-j31.A7** A scheduled run, a run from Flows, "Run again", "after another flow", "Try the next run now", a phone start and a tool start record the main agent and its default model.
- **FS-j31.A8** The busy fallback applies only to starts outside a chat; a chat's choice is never switched by it.
- **FS-j31.A9** An agent that is not ready shows its next-step button ("Sign in to Codex", "Set up Codex", "Check again") and no models, cannot be chosen, and the button runs the same action as in Settings.
- **FS-j31.A10** The agent is started with its own model flag for the chosen model and no other flag from the picker; the arguments contain no permission-bypass or full-access flag; Codex gets its sandbox flag explicitly.
- **FS-j31.A11** A model id the agent did not list, or one that does not match the allowed pattern, is refused and the choice stays.
- **FS-j31.A12** The assistant has no intent that changes the agent or model, and outside text in a message, email, skill or flow changes nothing.
- **FS-j31.A13** A flow that needs a tool the chat's agent cannot be limited for does not start; the chat shows the reason and "Run with Claude Code this time"; the chat's choice stays.
- **FS-j31.A14** With the chat's agent not ready or the permission off, no turn and no run starts, and the card with the next step shows.
- **FS-j31.A15** A stored model that is no longer offered falls back to the agent's default with a note in the chat.
- **FS-j31.A16** Arrow keys, Enter and Escape work as described; menu items have radio state grouped by agent; Escape returns focus to the button; the accessible name of the button says agent and model.
- **FS-j31.A17** The button, menu and notes read correctly in English and Bahasa Indonesia; names of agents and models do not change.
- **FS-j31.A18** A chain started with "Start" keeps the agent and model chosen at that moment for all its flows.
- **FS-j31.A19** After a restart, the chat's choice and each run's recorded agent and model are unchanged.
- **FS-j31.A20** A reached usage or spending limit never switches a chat's agent by itself; the chat offers "Choose another AI agent".
- **FS-j31.A21** The start proof failing makes the run "Stuck" with the limits message and no step runs.

## Not in the prototype yet

- The whole journey: models, picker, note, run card line, Settings line, guide card.
- "Run with Claude Code this time", the fallback for a vanished model, "Check again", the chain rule and the limit message (this design adds them).

## Drafter's calls

- A chain keeps the agent and model chosen at "Start"; reason: one request, one choice.
- "Run with Claude Code this time" applies to one run and does not change the chat; reason: the person did not ask to switch the chat.
- A usage limit offers "Choose another AI agent" instead of switching; reason: SR-9 says limits are never worked around silently, and the busy fallback is for starts outside a chat.
- Note words for models (`mostCapable` "Most capable", `fastCapable` "Fast and capable", `fastest` "Fastest", `allRound` "All-round", `carefulCoding` "Careful with code") are my English wording; they live in `packages/i18n`.
- A "Run again" from the run page is a start outside a chat, so it uses the main agent's default model, not the old run's model.
