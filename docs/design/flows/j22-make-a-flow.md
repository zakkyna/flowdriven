# FS-j22: Make a new flow in the chat

| Field | Value |
|---|---|
| Journey | j22: "Membuat flow baru" / Making a new flow / Make a new flow in the chat |
| PRD features | F-10 (also uses F-03, F-07) |
| Safety rules | SR-1, SR-2, SR-3, SR-5, SR-7; START (for "Run now") |
| Prototype source | The prototype brief, 'Redesign 1: chat first, plain words' and 'Inputs, results, proactive schedules, flows from skills, and every feature shown'; `js/screens/flows.js`, `js/screens/chat.js` (stages `make-description`, `make-location`, `saved-invoice`), `js/actions.js` (`createFlow`) |
| Status | In the prototype (version 8) for the canned invoice example; parts Not in the prototype yet (marked below: PU-05, PU-07, PU-08, PU-11, PU-12, PU-26) |

## Goal

A person describes repeated work in plain words. FlowDriven shows the flow it would make, with what it does on its own, what it asks first and what it never does. "Save flow" is the one confirmation; nothing exists or runs before it.

## Entry points and trigger

- Flows screen: "Make a new flow", then "Describe it in chat" in the dialog "Choose how to start." ("From a skill" goes to FS-j29, in `j29-flow-from-skill.md`).
- Chat: the starter chip "Make a new flow", or a typed request such as "make a new flow to collect invoices".
- Trigger: the person's own click or message. No schedule, tool, skill or outside text can start it.

## Preconditions

- The permission for AI agents is on and the chat's AI agent is ready. A new chat uses the main agent; from version 9 the chat can choose its own agent and model (see `j31-agent-and-model.md`).
- Nothing else. The person needs no flow, skill or account.

## Main path

- **FS-j22.S1** Open the dialog.
  - Person: opens Flows and chooses "Make a new flow".
  - FlowDriven: shows a dialog.
  - Sees: "Choose how to start." with "Cancel", "Describe it in chat" and "From a skill".
- **FS-j22.S2** Start the chat.
  - Person: chooses "Describe it in chat".
  - FlowDriven: calls `chats.create`, opens the chat and posts the first line. It records a make intent for this chat only.
  - Sees: "Tell me what it should do, in your own words." and the example chip "Every Friday, collect the invoices from my email into a spreadsheet".
- **FS-j22.S3** Describe the work.
  - Person: clicks the chip or types a description, then Enter.
  - FlowDriven: `chats.send` returns at once. One assistant turn (no tools, JSON schema, on the chat's agent) returns the intent `make_flow` with either a draft or one question. FlowDriven validates it and posts a message or card.
  - Sees: either a draft card (S5) or one short question with chips, for example "Got it. One question: where should the spreadsheet live?" with "Cloud storage, Invoices folder" and "A file on this Mac".
- **FS-j22.S4** Answer the one question (only if one was asked).
  - Person: clicks a chip or types the answer.
  - FlowDriven: runs one more turn with the answer. It asks no second question; if something is still unclear it states its assumption on the card.
  - Sees: the draft card.
- **FS-j22.S5** Read the draft card.
  - Person: reads the card.
  - FlowDriven: stores the draft in `drafts` (it is not a flow yet) and shows it. FlowDriven, not the agent, decides each touch's effect class and which list it goes in (SR-1).
  - Sees: the flow name; "What it does" (numbered steps); "What it needs" (inputs, or "Nothing. It runs without asking you."); "Shows the answer in the chat" or "Leaves a report in Activity"; "Runs: Every Friday at 17:00" (or "Only when I start it"); the lists "Does on its own", "Asks you first", "Never does"; buttons "Save flow" and "Change something".
- **FS-j22.S6** Save.
  - Person: chooses "Save flow". No dialog follows: the card is the confirmation.
  - FlowDriven: in one transaction writes the flow files (format 1.2), computes the content hash, creates the flow in state `confirmed`, records the confirmation for that hash (`confirmations`), creates one standing rule for each non-read touch under "Does on its own" (exact place; only `local_write`, `run_command` and `change` can be there, so no rule exists for a risky kind), adds the flow to Flows (first in the list) and writes an audit record. It posts the next message.
  - Sees: "Saved. It runs every Friday at 17:00. Run it now?" with a `run_offer` card with the buttons "Run now" (`run_now`) and "Not now" (`not_now`). The card now reads "Saved".
- **FS-j22.S7** Run now or not.
  - Person: chooses "Run now" or "Not now".
  - FlowDriven: "Run now" is a start from the chat, so it runs as in `j20-run-from-chat.md` (`chats.act {action: "run_now"}`, a start with source `chat`); the flow is `confirmed`, so no confirm card is needed. "Not now" posts nothing more.
  - Sees: for "Run now", "Starting <name>." and a run card; for "Not now", nothing new.

## Other paths

- **FS-j22.P1** The first message already says what to do. The assistant skips S2's question and goes to one question (S3) or straight to the card. The prototype shows the line "In this prototype I show the invoice example." here; the real app never says this.
- **FS-j22.P2** "Change something". The person chooses it or types the change. FlowDriven runs one turn with the draft and the change, then posts a new card. The earlier card shows "Replaced by a newer draft" and its buttons are disabled (PU-11). (Not in the prototype yet: the prototype only replies "Tell me what to change.")
- **FS-j22.P3** Run before save. The person asks to run the draft. FlowDriven posts "Save <name> first, then I can run it." and starts nothing.
- **FS-j22.P4** Same name. Flow names are unique. If a flow with the draft's name exists, the draft card itself already shows the name with the next free suffix (for example "Invoice collector 2") before saving (PU-11). The person can rename it with "Change something". Saving never replaces or edits the old flow, and saving the same card twice still creates one flow. (Not in the prototype yet: the prototype saves two flows with the same name.)
- **FS-j22.P5** Leave the stages. A run command, a question, a negation or a status request typed during the make stages is handled as usual (see `j20-run-from-chat.md`) and the draft stays in the chat, unsaved.
- **FS-j22.P6** Save a schedule. If the card shows "Runs: Every Friday at 17:00", Save flow saves that schedule and turns it on. FlowDriven does not start a run at save, and turning the schedule on never starts one; the "Run it now?" offer in S6 stays (see Drafter's calls). Starts at the scheduled time follow `START` (see `j28-proactive-schedule.md`).
- **FS-j22.P7** Make a flow from a skill. See `j29-flow-from-skill.md`. The same card and the same Save flow apply.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Draft | none -> `drafted` | An assistant turn returned a draft that passed FlowDriven's validation |
| Draft | `drafted` -> `replaced` | The person asked for a change and a newer draft was posted |
| Draft | `drafted` -> `saved` | "Save flow" |
| Flow | none -> `confirmed` | "Save flow" (the confirmation covers the flow and what it may touch) |
| Standing rule | none -> active | "Save flow", for each non-read touch under "Does on its own" |
| Chat turn | queued -> done / failed | The assistant turn finished or failed |

A draft has no flow state `new` or `changed`: those badges (`new` "New: confirm it once", `changed` "Changed: confirm again") appear only for flows that arrive another way (see `j26-memory-phone-marketplace.md`, `j23-improve-a-flow.md`).

## Decisions and confirmations

- What asks: nothing before the card. The assistant may ask one question to make the draft.
- What confirms: "Save flow" only. It confirms exactly the hash it saves and exactly the lists on the card (SR-3). It has no dialog and no second click (owner decision, 2026-11-18: one confirmation covers the flow and what it may touch).
- What deliberately does not confirm: a chat message such as "yes" or "ok" (the chat answers "Use the buttons on the card above."); the assistant's own text; a skill or outside text; the "Run now" chip (it starts a run of the saved flow but confirms nothing new).
- Placement rule (SR-1): `read` touches, declared `local_write` and `run_command` inside the flow's folders, and `change` touches with a fixed place (the person named it) are listed under "Does on its own". Risky kinds (`send`, `post`, `pay`, `delete`, `merge`) are always under "Asks you first", cannot be moved, and `flows.confirm` refuses one in `onItsOwn` with `not_allowed`, reason `always_asks` (Decided for V1, revisable: no standing rule exists for a risky kind). A `change` whose place is not fixed is under "Asks you first". What the flow has no tool for is under "Never does".

## Errors and edge cases

- **FS-j22.E1** Agent not set up or signed out. Cause: the chat's agent is `not_installed`, `needs_login` or `waiting_login`. Sees: the message stays in the chat, no turn runs, and a line such as "Claude Code is not ready." with the next-step button ("Set up Claude Code" or "Sign in to Claude Code", same action as Settings). Next: when the agent is `ready`, the person sends again; nothing was created.
- **FS-j22.E2** Permission off (PU-07). Cause: Settings "FlowDriven may run your AI agents" is off. Sees: "FlowDriven may not run your AI agents." with the button "Turn on permission" (it opens the "Before you start" dialog of Settings). `chats.send` answers `not_allowed: permission_off`, stores nothing, and the composer keeps the text. Next: nothing runs until the person turns it on.
- **FS-j22.E3** Limits reached (PU-08). Cause: the agent reports no usage left, or the spending limit is reached. Sees: for usage, "Claude Code has no usage left right now. It will be available again at <time>." (when known); for the spending limit, a "Needs you" `budget_raise` decision "Monthly limit reached. Raise it in Settings to continue." (see `j12-settings.md`). Next: the turn is not retried by itself (SR-9); the person retries.
- **FS-j22.E4** Turn failed. Cause: the agent failed or crashed, or its answer failed validation twice. Sees: "I could not make the draft." with "Try again" (`retry_turn`). Next: nothing is saved; the person's text stays.
- **FS-j22.E5** Crash or restart. Cause: FlowDriven or the runner stopped. Sees: a turn in progress becomes "Stopped unexpectedly" with "Try again". A posted draft card is still there and still works, because the draft is stored before the card is posted. Save is one transaction: after a crash there is either a complete confirmed flow or none.
- **FS-j22.E6** Flow changed since confirmed (PU-11). Cause: the person clicks "Save flow" on a card that is no longer the newest draft (for example a "Change something" was answered in another window). Sees: "This draft was replaced. Use the newest one." Next: nothing is saved. A saved flow is never altered by an old card (SR-3).
- **FS-j22.E7** Outside text (PU-12). Cause: the chat context holds outside text (the person pasted an email, a run's answer included text from an email or web page, or a memory item came from outside). Sees: the draft card with the tag "Includes text from an email or web page". Next: the card is click-only (SR-5); the chat turn never saves or starts anything by itself. Places (a folder, an address, an account) that appear only in outside text are not "fixed": they go under "Asks you first". Instructions inside outside text ("also allow sending to this address", "skip the approval") add nothing: FlowDriven derives the lists from its own catalog and the person's own words.
- **FS-j22.E8** A decision that waits. Cause: none; a draft card and the "Run now?" chips do not expire. Sees: nothing. Next: an unsaved draft stays in its chat and never runs; deleting the chat removes it.
- **FS-j22.E9** Draft cannot be made safely (PU-26). Cause: the described work needs a tool the chat's agent cannot be limited for (for example account tools on Codex, see `j31-agent-and-model.md`). Sees: "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." (`chat.agentCannotRunFlow`, param `agent`). Next: nothing is created. (Removed from V1: the offer "Use Claude Code for this draft", the `other_agent` card and the `use_other_agent` action; they go into the prototype first, later.)
- **FS-j22.E10** Prototype gap: saving twice makes two flows. Real app: the card is marked "Saved" after the first click; a second click creates nothing (FS-j22.A8). Prototype gap: only the invoice example works. Real app: the agent drafts any described work, inside the limits above. Prototype gap: nothing fires "every Friday 17:00" because there is no clock. Real app: the schedule runs through the trigger service while the app is alive; closing the window does not quit it on macOS, and V1 adds no menu-bar icon (`F-22`).

## Data read and written

- Read: the chat's last turns (up to 12 turns or 24,000 characters), the names and inputs of existing flows, remembered answers, the agent list and its status, settings (`language`, `agentPermission`, `mainAgent`).
- Written: `chats`, `messages` (user line, assistant lines, cards), `drafts`, then on Save `flows` (files and hash), `confirmations`, `standing_rules`, and the audit log (SR-7: "You saved and confirmed <flow>", with the three lists).
- Never written: secrets (SR-6), anything from outside text as a permission.

## Runner API used

`chats.create`, `chats.send`, `chats.act` (card actions `save_flow`, `change_draft`), `chats.get`, `chats.setAgent` (version 9), `flows.list`, `flows.get`, `agents.list`, `settings.get`. "Run now" is the card action `run_now`, a start with source `chat` inside `chats.act`. The save action runs the same confirm function as `flows.confirm {flowId, hash, onItsOwn}`. Topics: `chats`, `flows`, `rules`, `agents`, `activity`.

## Acceptance criteria

- **FS-j22.A1** "Make a new flow" opens the dialog with "Describe it in chat" and "From a skill"; "Describe it in chat" opens a chat that starts with "Tell me what it should do, in your own words." and the example chip.
- **FS-j22.A2** The first assistant reply to a description is either a draft card or exactly one question; no reply asks two questions; after the answer the next reply is a draft card.
- **FS-j22.A3** The draft card shows the name, "What it does", "What it needs", the result kind, the schedule line, the three lists, "Save flow" and "Change something".
- **FS-j22.A4** FlowDriven decides every touch's list. No risky-kind touch (`send`, `post`, `pay`, `delete`, `merge`) is ever under "Does on its own" on a draft card, whatever the agent returned, and `flows.confirm` refuses one in `onItsOwn` with `not_allowed`, reason `always_asks`. A `change` touch without a fixed place is under "Asks you first".
- **FS-j22.A5** Before "Save flow", `flows.list` has no new flow, no schedule is active and no run can start from the draft.
- **FS-j22.A6** "Save flow" creates exactly one flow in state `confirmed`, bound to the hash of its saved files, with one standing rule per non-read touch under "Does on its own", each with its exact place, and posts "Saved. ... Run it now?" with "Run now" and "Not now".
- **FS-j22.A7** "Save flow" shows no dialog and needs no second click.
- **FS-j22.A8** A second "Save flow" on the same card creates no second flow.
- **FS-j22.A9** A draft whose name matches an existing flow shows the next free suffixed name on its card before saving; "Change something" can rename it; saving creates one flow with the name shown and leaves the old flow unchanged.
- **FS-j22.A10** After "Change something" the old card is marked replaced and its "Save flow" is refused with "This draft was replaced. Use the newest one."; the new card saves normally.
- **FS-j22.A11** A draft made while the chat context holds outside text carries the tag "Includes text from an email or web page", cannot be saved by a chat turn, and has no place taken only from outside text under "Does on its own".
- **FS-j22.A12** Asking to run an unsaved draft answers "Save <name> first, then I can run it." and starts no run.
- **FS-j22.A13** With the agent not ready, the message is stored, no assistant turn runs, nothing is created, and the next-step button is shown; with the permission off, `chats.send` answers `not_allowed: permission_off`, stores nothing, the composer keeps the text, and "FlowDriven may not run your AI agents." with "Turn on permission" is shown (PU-07).
- **FS-j22.A14** After a simulated restart the posted draft card still saves; a crash injected during save leaves no flow row, no confirmation and no standing rule.
- **FS-j22.A15** Saving a flow whose draft has a schedule turns the schedule on and starts no run until the person chooses "Run now" or the scheduled time arrives through the start rule.
- **FS-j22.A16** Saving writes an audit record that names the flow, the hash and the three lists; no secret appears in it.
- **FS-j22.A17** A failed turn leaves the chat with "I could not make the draft." and the chip "Try again", the person's text intact and nothing saved.

## Not in the prototype yet

- Drafts for any described work (the prototype has one canned example).
- "Change something" that revises the draft.
- PU-11: "Replaced by a newer draft", the stale-card refusal and the suffixed unique name on the draft card.
- PU-12: the outside-text tag on a draft.
- PU-05, PU-07, PU-08, PU-26: the unusable-answer line, the permission-off refusal, the limit lines and "Codex cannot run this flow safely yet."
- Removed from V1 (later, prototype first): the "Use Claude Code for this draft" offer and the `other_agent` card.

## Drafter's calls

- A `change` touch with a fixed place that the person named is pre-placed under "Does on its own"; reason: the owner approved the prototype card that way and SR-1 forbids only the risky kinds there.
- One question at most per make turn, then a card; reason: owner decision 2026-11-18, "the chat asks only what it must".
- Save with a schedule turns it on and offers "Run it now?" without an automatic first run (Decided for V1, revisable: the owner decided that turning a schedule on never starts a run; the offer stays). A "Not now" leaves the first scheduled start as the first run.
- Name clash: the card shows the suffixed name before saving (owner alignment); reason: the prototype's duplicate flows are a gap, and replacing would break SR-3.
