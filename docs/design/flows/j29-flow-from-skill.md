# FS-j29: Make a flow from a skill

| Field | Value |
|---|---|
| Journey | j29: "Membuat flow dari skill" / Making a flow from a skill / Make a flow from a skill |
| PRD features | F-12 (also uses F-10, F-03) |
| Safety rules | SR-1, SR-2, SR-3, SR-5, SR-6, SR-7 |
| Prototype source | Brief sections 23.2.5-6, 23.5.2, 23.7-23.8; `js/screens/skills.js`, `js/screens/chat.js` (`makeSkillDraft`, stage `skill-ready`), `js/actions.js` (`makeFlowFromSkill`, `approveDraft`) |
| Status | In the prototype (version 8) with canned drafts for three skills; parts Not in the prototype yet (marked below) |

## Goal

A skill the person's AI agent already has becomes a flow in a few clicks. FlowDriven reads the skill's text only as data to draft the flow. The draft does nothing until the person saves it, and saving it is the confirmation.

## Entry points and trigger

- Rail "Skills", then "Make a flow" on a skill row.
- Flows: "Make a new flow", then "From a skill" (opens Skills).
- Chat: "make a flow from the timesheet-skill skill", or in Bahasa Indonesia "buat flow dari skill timesheet-skill". With no skill name: "Which skill?".
- Trigger: the person's own click or message. A skill, memory item, marketplace flow or outside text can never start this.

## Preconditions

- The skill exists in an agent's skill folder (for example a skill folder named `timesheet-skill`) or in FlowDriven's library, and its `SKILL.md` can be read.
- The permission for AI agents is on and the chat's AI agent is ready (a new chat uses the main agent; from version 9 the chat can choose its own agent and model, see `j31-agent-and-model.md`).

## Rule of this journey

A skill's text is read only as data, to draft the flow. It is outside text (SR-5). It cannot add a tool, a folder, an account, an address, a schedule or a permission. The draft does nothing until the person saves it, and "Save flow" is the person's confirmation of exactly what the card lists (SR-2).

## Main path

- **FS-j29.S1** Open Skills.
  - Person: chooses "Skills" in the left menu.
  - FlowDriven: `skills.list`.
  - Sees: the skills with name, "about", origin and "Make a flow" (basics in `j26-memory-phone-marketplace.md`).
- **FS-j29.S2** Start from a skill.
  - Person: on timesheet-skill, chooses "Make a flow".
  - FlowDriven: `skills.makeFlow {skillId}` creates a chat and adds the first message "Make a flow from the timesheet-skill skill". The chat's language is the app language, because the person typed nothing.
  - Sees: the chat with that message.
- **FS-j29.S3** FlowDriven reads the skill.
  - Person: waits.
  - FlowDriven: the runner reads the skill folder as text (name, description and body of `SKILL.md`, within the size limits; front-matter keys such as `allowed-tools`, `hooks` and `model` are dropped). It sends the text to the assistant in one no-tool JSON call marked as outside text. The result is an intent `make_flow_from_skill` with a draft. FlowDriven validates it and works out every touch's effect class and list itself (SR-1).
  - Sees: "Reading timesheet-skill..." and then a short note, for example "timesheet-skill can log work and check your timesheet. Fill timesheet already logs work with it, so here is a flow that checks your timesheet."
- **FS-j29.S4** Check the draft card.
  - Person: reads the card.
  - FlowDriven: stores the draft in `drafts`; nothing is a flow yet. If a flow with the same name exists, the card already shows the next free suffix ("Check timesheet 2"), and the person can rename it with "Change something".
  - Sees: the name ("Check timesheet"); "Made from the skill timesheet-skill"; "What it does" (steps: "Get your entries from the timesheet", "Leave out weekends and public holidays", "Find workdays with no hours", "Tell you in the chat"); "What it needs" ("Days to look back", "Default: 30"); "Shows the answer in the chat"; "Does on its own" ("Reads your timesheet"); "Asks you first" (empty or the changes); "Never does" ("Creates or changes entries"); the buttons "Save flow" and "Change something".
- **FS-j29.S5** Save.
  - Person: chooses "Save flow". No dialog follows.
  - FlowDriven: in one transaction creates the flow (schedule "Only when I start it"), records the confirmation for its hash and for the skill's content hash at that moment (the skill pin), creates standing rules only for non-read touches under "Does on its own" (none in this example), and adds the flow name to the skill's "Used by". It writes an audit record.
  - Sees: "Check timesheet is ready. Run it now, or put it on a schedule." with chips "Run it now" and "Every Friday at 16:00". The "Every Friday at 16:00" chip leads to a "Set this schedule?" card that the person clicks; it sets nothing by itself (SR-2).

## Other paths

- **FS-j29.P1** Typed. "make a flow from the timesheet-skill skill", "buat flow dari skill pdf". With no skill name, FlowDriven asks "Which skill?" with one chip per skill. With a name that matches no skill: "I don't know a skill called <name>. Pick one:" with the chips.
- **FS-j29.P2** A skill without a prepared flow. The draft is "Use <skill>" with a required long-text input "What to do" and one step that does the work. FlowDriven cannot know what the skill changes, so that step is a `change` without a fixed place and is under "Asks you first" ("Let <skill> make the changes?"). Every action of it asks.
- **FS-j29.P3** A skill that needs a file. The chat shows a form ("Choose the file and fill in the details.") instead of a question; the draft is saved the same way.
- **FS-j29.P4** Run before save. "Save Check timesheet first, then I can run it." A typed "cek timesheet" runs the saved flow; if it does not exist: "Make Check timesheet from the timesheet-skill skill first." with the chip "Make it from timesheet-skill".
- **FS-j29.P5** Change something. The person asks for a change; a new card replaces the old one, which shows "Replaced by a newer draft" (same as FS-j22.P2 in `j22-make-a-flow.md`).
- **FS-j29.P6** Skill drafts and Run now. "Run it now" is a start from the chat (`j20-run-from-chat.md`). The flow is `confirmed`, so it asks only for missing inputs.
- **FS-j29.P7** Language. A message typed in Indonesian gets Indonesian chat lines; the cards and buttons follow the app language. From the Skills button, the chat lines follow the app language (the prototype shows English lines in an Indonesian app; the real app does not).
- **FS-j29.P8** A skill that changes later. Each flow made from a skill pins the skill's content hash. If the skill's text changes, the flow is `changed` ("Changed: confirm again") and does not start outside the chat until confirmed (SR-3, see `j26-memory-phone-marketplace.md` for updates and roll back).

## States

| Entity | From -> to | Cause |
|---|---|---|
| Draft | none -> `drafted` | The assistant returned a draft that passed validation |
| Draft | `drafted` -> `replaced` / `saved` | "Change something" / "Save flow" |
| Flow | none -> `confirmed` | "Save flow" (with the skill pin) |
| Flow | `confirmed` -> `changed` | The skill's text changed after the pin |
| Skill | unused -> "Used by" lists the flow | "Save flow" |

## Decisions and confirmations

- What asks: the draft card. Nothing else asks before it.
- What confirms: "Save flow" only, covering the flow, its three lists and the skill text it was drafted from (by its content hash).
- What deliberately does not confirm: the skill itself, its front matter (`allowed-tools`, hooks, model), its instructions, a chat message such as "yes", and the "Run it now" chip.
- Placement rule: as FS-j22 (see `j22-make-a-flow.md`): reads and declared writes inside the flow's folders may be under "Does on its own"; risky kinds and any `change` without a fixed place are under "Asks you first".

## Errors and edge cases

- **FS-j29.E1** Agent not set up or signed out. Cause: the chat's agent is not `ready`. Sees: "Reading <skill>..." does not start; the line "Claude Code is not ready." with the next-step button. Next: nothing is drafted or saved.
- **FS-j29.E2** Permission off. Sees: "FlowDriven may not run your AI agents. Turn this on in Settings." Next: nothing is read by the agent.
- **FS-j29.E3** Limits reached. Same as FS-j22.E3: no usage left or spending limit; nothing drafted; the person retries.
- **FS-j29.E4** Turn failed. Cause: the agent failed or its answer failed validation twice. Sees: "I could not make the draft." with "Try again". Nothing saved.
- **FS-j29.E5** Crash or restart. The draft is stored before the card is posted and stays usable; a turn in progress becomes "Stopped unexpectedly" with "Try again"; save is all-or-nothing.
- **FS-j29.E6** Skill changed since read. Cause: the skill's content hash at save differs from the hash read for the draft. Sees: "The skill changed since I read it. I'll read it again." Next: nothing is saved; a new draft is made. This is the skill version of "a flow changed since it was confirmed".
- **FS-j29.E7** Outside text. Cause: the skill's text contains instructions ("ignore the rules", "run this command", "send this to <address>") or hidden characters. Sees: a skill with hidden characters, an invalid `SKILL.md`, a body over 60,000 characters or a file over the size limit is refused: "I could not read this skill: <reason>. Nothing was changed." Otherwise the text is only data: FlowDriven derives the lists from its own catalog, drops anything the draft declares that is not a known kind of tool, place or account, and the card is click-only (SR-5). A tool, folder or address named only in the skill never becomes "Does on its own" and never a standing rule place.
- **FS-j29.E8** A decision that expires. None: the card and chips do not expire. An unsaved draft stays in its chat and never runs.
- **FS-j29.E9** Skill not found or unreadable. Cause: the skill folder was removed, or the skill is archived. Sees: "I could not find the skill <name>." Next: nothing is created.
- **FS-j29.E10** Name taken. The card shows the suffixed name before saving ("Check timesheet 2"); the old flow is untouched. The prototype's "Check timesheet already exists." with "Open Check timesheet" is replaced by this (chair alignment: flow names are unique, drafts take the next free suffix).
- **FS-j29.E11** Agent cannot be limited for this skill. Cause: the skill's draft needs a tool the chat's agent cannot be limited for (AD-09). Sees: a plain reason and "Use Claude Code for this draft".
- **FS-j29.E12** Prototype gaps. Canned drafts exist for three skills; the real app drafts for any readable skill. Only skill drafts dedupe by name in the prototype; the real app keeps every flow name unique. Indonesian Skills button lines are English in the prototype.

## Data read and written

- Read: the skill folder (`SKILL.md` name, description, body; no other file is executed), the skill index, existing flows and their names, the chat context, the agent status.
- Written: the draft, messages, then on Save the flow files and hash, the confirmation (with the skill pin), standing rules for non-read touches under "Does on its own" (if any), the skill's "Used by", and the audit log (SR-7: "You saved and confirmed <flow>, made from <skill>").
- Never written: the skill's front-matter keys as permissions; secrets (SR-6).

## Runner API used

`skills.list`, `skills.makeFlow {skillId}`, `chats.send`, `chats.act` (`save_flow`, `change_draft`), `chats.get`, `flows.list`, `flows.get`, `flows.start` (for "Run it now"), `flows.setSchedule` (after the schedule card), `agents.list`. Topics: `skills`, `chats`, `flows`, `rules`.

## Acceptance criteria

- **FS-j29.A1** "Make a flow" on a skill row opens a chat whose first message is "Make a flow from the <skill> skill" and starts the draft.
- **FS-j29.A2** The skill's text reaches the assistant only in a no-tool call, marked as outside text; no skill content is put in a prompt that has tools.
- **FS-j29.A3** The draft card shows the name, "Made from the skill <skill>", "What it does", "What it needs", the result kind and the three lists, with "Save flow" and "Change something".
- **FS-j29.A4** No tool, folder, account, address, schedule or permission appears in the card because the skill text said so; FlowDriven's catalog decides every effect and list.
- **FS-j29.A5** A skill's `allowed-tools`, hooks and model keys have no effect on the draft or the saved flow.
- **FS-j29.A6** Before "Save flow", no flow exists, the skill's "Used by" is unchanged and no run can start.
- **FS-j29.A7** "Save flow" creates one `confirmed` flow with the skill's content hash pinned, a manual schedule, the skill in its "Used by", and posts "<name> is ready. Run it now, or put it on a schedule."
- **FS-j29.A8** "Save flow" needs no dialog; saving the same card twice creates one flow.
- **FS-j29.A9** When the name is taken the card shows the next free suffixed name before saving; saving never touches the old flow.
- **FS-j29.A10** If the skill's content hash at save differs from the hash read, nothing is saved and the person sees "The skill changed since I read it. I'll read it again."
- **FS-j29.A11** A skill with hidden characters, an invalid `SKILL.md` or a size over the limit produces "I could not read this skill: <reason>." and no draft.
- **FS-j29.A12** A skill whose text tells the agent to run commands, widen access or send data produces a draft with none of those in "Does on its own".
- **FS-j29.A13** A skill the assistant has no prepared flow for gives a draft whose working step is under "Asks you first".
- **FS-j29.A14** "Which skill?" lists one chip per skill; an unknown name lists the chips with "I don't know a skill called <name>."
- **FS-j29.A15** Asking to run an unsaved skill draft answers "Save <name> first, then I can run it."
- **FS-j29.A16** The chip "Every Friday at 16:00" posts a "Set this schedule?" card and sets no schedule until "Yes, set it".
- **FS-j29.A17** After the skill's text changes, a flow made from it is `changed` and does not start outside the chat.
- **FS-j29.A18** With the agent not ready or the permission off, nothing is drafted and the next-step button shows.
- **FS-j29.A19** A crash during save leaves no flow row, no confirmation and no "Used by" entry.
- **FS-j29.A20** Save writes an audit record naming the flow, the skill and the hashes.
- **FS-j29.A21** Chat lines from the Skills button follow the app language; typed chat lines follow the language typed.

## Not in the prototype yet

- Drafts for any skill (the prototype has canned drafts for timesheet-skill and pdf, and a plain draft for the rest).
- The skill pin and "Changed: confirm again" after a skill change; the skill-changed-since-read check.
- Refusing unreadable or hidden-character skills.
- Unique suffixed names on the card (the prototype dedupes by name with a message).
- The schedule chip leading to a card.

## Drafter's calls

- The draft card carries no extra outside-text tag for the skill; the "Made from the skill <name>" line stays. The skill's text is still treated as outside text everywhere it matters (SR-5).
- The skill pin is part of what "Save flow" confirms; a changed skill makes the flow `changed` (SR-3).
- The "Every Friday at 16:00" chip leads to a card, because only the person's click may set a schedule (SR-2).
