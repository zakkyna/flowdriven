# FS-j23: Improve a flow

| Field | Value |
|---|---|
| Journey | j23: "Memperbaiki flow" / Improving a flow / Improve a flow |
| PRD features | F-11 (also uses F-07, F-09) |
| Safety rules | SR-1, SR-2, SR-3, SR-5, SR-7; START (for a changed flow) |
| Prototype source | Brief sections 16.5 D, 16.6, 18.4.4, 19.5, 23.10; `js/screens/flows.js` (Improve with chat), `js/screens/chat.js` (stage `improve`, card `change`), `js/actions.js` (`changeFlow`, `setSchedule`) |
| Status | In the prototype (version 8) for two canned changes (email summary, schedule); parts Not in the prototype yet (marked below) |

## Goal

A person changes a flow they already made by telling the chat what to change. FlowDriven shows the change and what it does to the flow's permissions first; "Save change" confirms the new version. The flow never runs as something the person did not see.

## Entry points and trigger

- Flow page: "Improve with chat" (see `j21-run-from-flows.md` for the page).
- Chat: typed "improve timesheet", "change the timesheet flow", or the same in Bahasa Indonesia ("ubah flow timesheet").
- Trigger: the person's own click or message only.

## Preconditions

- The flow exists and is not deleted.
- The permission for AI agents is on and the chat's AI agent is ready (a new chat uses the main agent; from version 9 the chat chooses its own agent and model, see `j31-agent-and-model.md`).

## Main path

- **FS-j23.S1** Open the flow.
  - Person: opens Flows, then "Fill timesheet".
  - FlowDriven: shows the flow page.
  - Sees: the page with "Improve with chat".
- **FS-j23.S2** Start improving.
  - Person: chooses "Improve with chat".
  - FlowDriven: `chats.create` with the flow as the chat's subject; posts the first line.
  - Sees: "What should change in Fill timesheet?" with chips "Also email me a summary" and "Run it every weekday at 17:00". The second chip is not shown when the flow already runs every weekday at 17:00.
- **FS-j23.S3** Ask for a change.
  - Person: clicks a chip or types a change.
  - FlowDriven: one assistant turn (no tools, JSON schema) returns the intent `improve_flow` with a change. FlowDriven checks it against the current flow, works out the new steps, touches and their effect classes itself, and posts a change card. Nothing is saved.
  - Sees: "Change to Fill timesheet:" and lines such as "+ Email me a summary (asks you first before sending)". Under the lines: the lists after the change ("Does on its own", "Asks you first", "Never does") with new items marked, and a line "Still allowed by your rule: ..." or "Your rule ends: ..." for each standing rule the change affects. Buttons "Save change" and "Cancel".
- **FS-j23.S4** Save the change.
  - Person: chooses "Save change". No dialog follows: the card is the confirmation.
  - FlowDriven: in one transaction writes the new flow files, computes the new hash, records the confirmation for the new hash, keeps the standing rules that still match and revokes the others, writes an audit record, and tells the topics `flows` and `rules` to refresh. The flow stays `confirmed`.
  - Sees: a toast and a chat line "Saved. The change applies from the next run." The flow page now shows the new step under "Asks you first".

## Other paths

- **FS-j23.P1** Change the schedule. The person types "every weekday at 9" or "ubah jadwal timesheet jadi setiap hari kerja jam 6 sore", or clicks the schedule chip. FlowDriven posts a card "Set this schedule?" ("Fill timesheet runs every weekday at 09:00") with "Yes, set it" and "No". The assistant never sets a schedule itself (SR-2). "Yes, set it" (`set_schedule`) runs `flows.setSchedule {flowId, hash, schedule}` with the current confirmed hash. A schedule change does not change the steps or touches, so the flow stays `confirmed`. If this turns on a schedule for a flow that never ran, the first-run rule applies (see `j21-run-from-flows.md`, Not in the prototype yet). The prototype applies the schedule directly with "Done. Fill timesheet runs every weekday at 09:00."; the real app asks first.
- **FS-j23.P2** One schedule at a time. A request with two schedules answers "One schedule at a time, please. Which flow first?". "Turn it off" or "matikan" posts "Stop running <name> by itself?" with "Yes, turn it off" (`turn_off_schedule`) and "No" (`keep_schedule`) (the same card as in `j20-run-from-chat.md`).
- **FS-j23.P3** Already there. If the step title or the touch id already exists, the chat says "Email me a summary is already part of Fill timesheet." The hash does not change and nothing is saved.
- **FS-j23.P4** Cancel. "Cancel" closes the card; nothing changes. The flow keeps its confirmed version.
- **FS-j23.P5** A change made another way. If a flow's files change outside this chat (a file edited on disk, an update from another place), the flow is `changed` "Changed: confirm again". The flow page shows the banner "Changed: confirm again" with "Confirm". "Confirm" opens "Confirm <flow> again?" with "What changed", "What it does", "Does on its own", "Asks you first", "Never does", and the standing rules that stay or end. "Confirm" records the new hash; "Cancel" leaves the flow `changed`. No start outside the chat runs a `changed` flow (`START` rule 1, SR-3). Not in the prototype yet: the prototype has no such dialog.
- **FS-j23.P6** Improve a flow with a run in progress. A run keeps the version it started with. A run already `queued` also keeps the version it was created with. The next run, started after the save, uses the new version.
- **FS-j23.P7** Typed entry. "improve timesheet" enters improve mode for that flow and posts the S2 line. If the name matches no flow or several, FlowDriven asks "Which flow?" with one chip per match.
- **FS-j23.P8** A change the assistant cannot make. The reply says what it cannot do and why in plain words, for example "I can't change the sender address. FlowDriven only uses the address you wrote in the flow." Nothing is saved. (The prototype only says "In this prototype I can add an email summary or change when it runs.")

## States

| Entity | From -> to | Cause |
|---|---|---|
| Change card (draft of kind `change`) | none -> `drafted` | An assistant turn returned a change that passed validation |
| Change card | `drafted` -> `saved` / `cancelled`; `stale` is derived | "Save change", "Cancel", or the flow's hash no longer equals the card's base hash |
| Flow | `confirmed` -> `confirmed` (new hash) | "Save change" |
| Flow | `confirmed` -> `changed` | The files changed by any other route |
| Flow | `changed` -> `confirmed` | "Confirm" in the confirm-again dialog |
| Standing rule | active -> active / revoked | "Save change" or "Confirm": kept only if a touch with the same id, effect and place still exists |
| Schedule | off -> on, or time/day changed | "Yes, set it" |

## Decisions and confirmations

- What asks: the change card ("Save change" / "Cancel"); the schedule card ("Yes, set it" / "No"); the confirm-again dialog for a `changed` flow.
- What confirms: "Save change" confirms the new version, because the person saw the change and the resulting lists on the card (owner decision, 2026-11-18: one confirmation covers the flow and what it may touch). "Confirm" in the dialog confirms a `changed` flow.
- What deliberately does not confirm: any chat text ("yes", "ok", "save it"): the chat says "Use the buttons on the card above."; a skill, memory item, marketplace text or outside text; a schedule card does not confirm a changed flow.
- A change that adds a risky-kind touch lists it under "Asks you first" and nowhere else. "Always allow for this flow" is offered later, at the decision itself (`j24-decisions.md`), never on this card.

## Errors and edge cases

- **FS-j23.E1** Agent not set up or signed out. Same as FS-j22.E1: the message stays, no turn runs, the next-step button shows. The flow is untouched.
- **FS-j23.E2** Permission off. Same as FS-j22.E2. Saving an already shown card still works (it needs no agent): the save is FlowDriven's own action.
- **FS-j23.E3** Limits reached. Same as FS-j22.E3. A usage or spending limit stops the turn, not a save.
- **FS-j23.E4** Turn failed. Cause: the agent failed or its answer failed validation twice. Sees: "I could not make that change." with "Try again". Nothing is saved.
- **FS-j23.E5** Crash or restart. A posted change card still works if the flow's hash is unchanged. Save is all-or-nothing: after a crash the flow has either the old confirmed version or the new confirmed version, never a half-written one.
- **FS-j23.E6** Flow changed since confirmed. Cause: the flow's hash differs from the card's base hash when the person clicks "Save change". Sees: "This flow changed since I made this suggestion. Ask again." Next: nothing is saved; the person asks again and gets a card for the current version.
- **FS-j23.E7** Outside text. Cause: the chat context holds outside text (for example the last answer came from an email). Sees: the change card with the tag "Includes text from an email or web page"; the card is click-only (SR-5). Next: a place that comes only from outside text is not fixed, so it is under "Asks you first". Text such as "also allow sending to anyone without asking" adds nothing: only the person's own click on a card changes the lists, and risky kinds are never placed under "Does on its own" by a change.
- **FS-j23.E8** A decision that expires. Cause: none for cards. A decision waiting inside a run is not affected by a change: it keeps the version of its run and expires after 24 hours (see `j24-decisions.md`).
- **FS-j23.E9** Rules that no longer match. Cause: a change renames or removes a touch, or changes its effect or place. Sees: "Your rule ends: ..." on the card. Next: after "Save change" the rule is revoked and the action asks again.
- **FS-j23.E10** Agent cannot be limited for the changed flow. Cause: the change adds a tool the chat's agent cannot be limited for (AD-09). Sees: a plain reason and "Use Claude Code for this change" (`use_other_agent`). Next: nothing is saved otherwise.
- **FS-j23.E11** Deleted flow. A change card for a flow that was deleted shows "a deleted flow" and has no buttons.
- **FS-j23.E12** Prototype gaps. The prototype supports only two changes and re-confirmation has no screen; the schedule is applied without a card; a missing first-run rule when a schedule is turned on. The real app handles general changes (FS-j23.S3), shows the confirm-again dialog (FS-j23.P5), asks before a schedule change (FS-j23.P1) and applies the first-run rule through `j21-run-from-flows.md`.

## Data read and written

- Read: the flow's files and hash, its touches, inputs and schedule, standing rules for the flow, the chat's last turns, other flows' names (for "after another flow").
- Written: `messages`, the flow's new files and hash, `confirmations`, `standing_rules` (kept or revoked), the `schedules` row, and the audit log (SR-7: "You changed and confirmed <flow>", old and new hash, rules kept and ended).

## Runner API used

`chats.create`, `chats.send`, `chats.act` (card actions `save_change`, `cancel_change`, `set_schedule`, `skip_schedule`, `turn_off_schedule`, `keep_schedule`, `use_other_agent`, `retry_turn`, `suggestion`), `flows.get`, `flows.confirm {flowId, hash, onItsOwn}`, `flows.setSchedule {flowId, hash, schedule}`, `flows.list`, `rules.list {flowId}`, `rules.revoke {ruleId}`. Topics: `chats`, `flows`, `rules`, `activity`.

## Acceptance criteria

- **FS-j23.A1** "Improve with chat" opens a chat for that flow and posts "What should change in <flow>?" with the two chips; the weekday chip is absent when the flow already runs every weekday at 17:00.
- **FS-j23.A2** A requested change produces a change card with "+" / "-" lines, the resulting three lists and the rules that stay or end; nothing is saved until "Save change".
- **FS-j23.A3** A change that adds a risky-kind touch lists it under "Asks you first" only, whatever the assistant returned.
- **FS-j23.A4** "Save change" saves the new version and confirms its new hash in one step; the flow stays `confirmed` and the chat posts "Saved. The change applies from the next run."
- **FS-j23.A5** A run that started or was queued before the save keeps its original version; the next run uses the new version.
- **FS-j23.A6** A change whose step title or touch id already exists posts "<item> is already part of <flow>." and leaves the hash and the files unchanged.
- **FS-j23.A7** After "Save change", a standing rule stays only if a touch with the same id, effect and place exists in the new version; every other rule is revoked and its action asks again.
- **FS-j23.A8** "Cancel" leaves the flow, its hash and its rules unchanged.
- **FS-j23.A9** A schedule request posts "Set this schedule?" and changes nothing until "Yes, set it"; "No" changes nothing; the assistant has no way to set a schedule itself.
- **FS-j23.A10** A request with two schedules posts "One schedule at a time, please. Which flow first?" and sets none.
- **FS-j23.A11** A flow whose files changed by another route is `changed` ("Changed: confirm again"), shows "Confirm", and no start outside the chat runs it until "Confirm" is chosen.
- **FS-j23.A12** A change card whose base hash no longer equals the flow's hash is refused with "This flow changed since I made this suggestion. Ask again."
- **FS-j23.A13** A change made while the chat context holds outside text carries the tag "Includes text from an email or web page" and cannot be saved by a chat turn.
- **FS-j23.A14** With the agent not ready or the permission off, no turn runs, the flow is untouched, and the next-step button shows.
- **FS-j23.A15** A crash injected during "Save change" leaves either the old confirmed version or the new confirmed version, never a mix.
- **FS-j23.A16** "Save change" writes an audit record with the old and new hash and the rules kept and ended.
- **FS-j23.A17** Typed "improve <name>" enters improve mode for that flow; an unknown or ambiguous name asks "Which flow?".

## Not in the prototype yet

- Any change other than the email summary and the schedule.
- The "Still allowed by your rule" and "Your rule ends" lines.
- The "Set this schedule?" card for a schedule typed in the improve chat.
- The confirm-again dialog and the stale-card refusal.
- The "Use Claude Code for this change" offer.

## Drafter's calls

- A schedule change keeps the flow `confirmed` because it changes no step or touch. If the architecture puts the schedule inside the hashed flow file, "Yes, set it" must then also confirm the new hash and the card must say so.
- Every saved change bumps the flow's minor version; versions are never shown to the person.
- A queued run keeps the version it was created with (SR-3: the version the person confirmed then).
