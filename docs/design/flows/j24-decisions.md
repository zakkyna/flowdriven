# FS-j24: Things that need your decision

| Field | Value |
|---|---|
| Journey | j24: "Yang butuh keputusan Anda" / What needs your decision / Things that need your decision |
| PRD features | F-13, F-16 (also uses F-14) |
| Safety rules | SR-1, SR-2, SR-3, SR-5, SR-7, SR-8, SR-9 |
| Prototype source | Brief sections 4.10, 14.3.5-6, 16.3.8, 17.2.1-2, 18.1.5, 19.13, 23.10; `js/screens/activity.js`, `js/actions.js` (`ask`, `decide`, `approveSimilar`, `alwaysAllow`, `revokeRule`, `stopRun`) |
| Status | In the prototype (version 8); parts Not in the prototype yet (marked below) |

## Goal

When a run reaches something it must not do on its own, it stops and asks. The person sees exactly what would happen, decides in FlowDriven (or on a paired phone), and the run goes on. Nothing is sent, posted, paid, deleted or merged before the person says yes.

## Entry points and trigger

- A run holds a call or reaches a choice. FlowDriven creates a decision (`waiting_approval`) and shows it in four places: the run's chat card (when the run started in a chat), Activity "Needs you", a system notification, and a paired phone.
- Activity (rail "Activity" with the count of things that need you), the notification, a chat card, "See what it needs" on a queued run.
- Trigger: the engine holding a call (the runner's one decision function, AD-06) or an `ask` step.

## Preconditions

- A run exists and is `waiting_approval`.
- The decision is `pending` and is less than 24 hours old.
- The person is in FlowDriven's window (all choices), or on a paired phone (one decision at a time, a reduced set, see FS-j24.P8).

## Main path

- **FS-j24.S1** See what needs you.
  - Person: opens Activity.
  - FlowDriven: `activity.summary` returns the Needs you list: first unanswered scheduled questions ("<flow> is waiting for your answer" with "Answer in chat", see `j28-proactive-schedule.md`), then each waiting decision, newest first.
  - Sees: section "Needs you", then "Running now" and "Earlier".
- **FS-j24.S2** Read a decision.
  - Person: reads the card for the email to Sam.
  - FlowDriven: shows the held call in full.
  - Sees: badge "Needs you"; the title ("Send reply to Sam Example?"); the flow name; a one-line summary; the tag "Includes text from an email or web page" when outside text is involved; a preview (To, Subject, body; hidden characters shown as "[U+200B hidden character]"); "Expires in 22 hours"; buttons "Approve", "Edit", "Reject", and "Approve all similar (3)" when it applies.
- **FS-j24.S3** Approve.
  - Person: chooses "Approve".
  - FlowDriven: `approvals.resolve {approvalId, decision: "approve"}`. It writes a one-time grant bound to the run, step, tool and the exact input digest, sets the decision `approved`, removes the notification, adds the decision line "You approved: Send reply to Sam Example." to the run, and re-runs the step so the call is made once, exactly as written.
  - Sees: the toast "Approved. The run continues." If other decisions of the same step still wait, the toast says "Approved. 2 more need you." and the run stays "Needs you".
- **FS-j24.S4** Answer a choice.
  - Person: on the job choice, ticks two jobs and chooses "Send choice".
  - FlowDriven: `approvals.answer {approvalId, picks}`. The picks become the loop items of the later step; the decision is `approved` with the picks and shows "Choice sent". A third tick is refused.
  - Sees: checkboxes (the first max number allowed; a third pick shows the toast "Pick up to 2."), "Send choice", "Pick none". Then, for each picked job, one decision "Approve the build plan for <job>" with the plan text and the warning "Approving this plan lets a later step run commands on your Mac. Read it first." (an own-text sign-off). They come one at a time.
- **FS-j24.S5** The run goes on.
  - Person: approves or rejects the remaining decisions.
  - FlowDriven: after the last decision of a step, the step is `passed` (or `skipped` when rejected) and the run continues. When the run ends, the report lists each decision honestly.
  - Sees: the run page: "You approved: ...", "Done by your rule: ...", "You said no: ... It was not done."

## Other paths

- **FS-j24.P1** Edit (text payloads only). "Edit" opens a text box with the subject and body (never To or Cc, which come from the held call). "Save and approve" sets the decision `approved_edited`; the edited text is what is sent; the grant is bound to the digest of the edited call. "Cancel edit" returns to the card. Edit is absent for payloads that are not text (post with media, diff, amount, choice, sign-off). Hidden or format characters in the edited text are refused with "Remove the hidden characters first."; empty text is refused with "Write the text first." (Not in the prototype yet: the prototype's edit has no checks.)
- **FS-j24.P2** Reject. "Reject" skips that action at once. There is no confirmation dialog (owner decision, 2026-11-18). The decision is `rejected`, the step is `skipped`, the run goes on, and later steps that needed that action's result are skipped too and listed. The toast reads "Rejected. Nothing was sent." (for a post: "Rejected. Nothing was posted."). The report says "You said no: <title>. It was not done." This changes today's engine, where a rejection fails the step and the run (Ask first, product decision with a security review, AD-07).
- **FS-j24.P3** Approve all similar. When two or more waiting decisions in the same run share a group (for example three replies to different people), "Approve all similar (3)" opens the dialog "Approve similar emails?". It lists every item (To, Subject, start of the body) and says "Approves these 3 emails in this run only. This is logged." Buttons "Approve all 3" and "Cancel". "Approve all 3" calls `approvals.resolveSimilar {runId, group, approvalIds}` (the ids the dialog listed) and each item gets its own grant bound to its own exact input. It covers only the items listed, only this run, only for the kinds `send` and `post`; it is never offered for `pay`, `delete`, `merge`, choices, sign-offs or limits. If the list changed while the dialog was open, the dialog refreshes and asks again. The toast reads "Approved 3 similar emails".
- **FS-j24.P4** Choices. Pick none: the decision is `approved` with no picks, and the remaining steps that needed picks are `skipped` ("Nothing was picked"). A choice that expires follows the flow's own rule (`on_expiry: end` ends the run `done` with no picks; `fail` fails the step), as today.
- **FS-j24.P5** Always allow for this flow. The button is shown only when the action's place is fixed in the flow (for example the timesheet account, one cloud storage folder, the person's own address) and the decision was not made on a phone (SR-1, SR-2). FlowDriven compares the call's place with the flow's declared touch; it never uses a place that came from what the run read (for example "reply to whoever wrote" has no button). Choosing it approves this call, stores a standing rule `{flow, touch, effect, place}` (state `allowed_always`, "Always allowed") and continues. No dialog. The toast reads "Done. Fill timesheet now does this by itself. Undo it on the flow page with Ask me again." and the chat line reads "Okay. From now on Fill timesheet does this by itself. You can undo it on its page with Ask me again." Next time the same action in the same place runs without asking: the step passes with the evidence "Allowed by your rule", the run's report says "Done by your rule: <step title>.", and the audit log records "by rule". If the effect or place differs, FlowDriven asks again.
- **FS-j24.P6** Ask me again. On the flow page (see `j21-run-from-flows.md`), the list "Does on its own" shows "<sentence> (you allowed this)" with "Ask me again". It revokes the rule at once with no dialog (`rules.revoke`). The next such action asks. A call the run already started under the rule is not undone. A changed flow keeps a rule only if a touch with the same id, effect and place still exists, and the confirm dialog shows it again.
- **FS-j24.P7** Expiry after 24 hours. Each decision has an expiry 24 hours after it was created. The card counts down ("Expires in 22 hours"). When the time passes, the decision becomes `expired` and counts as Reject: the action is skipped, the run goes on, and the report says "No answer in 24 hours: <title>. It was not done." The notification is removed. The sweep runs on every read and on a 60-second timer. (Not in the prototype yet: the prototype never shows or enforces it.)
- **FS-j24.P8** Phone approvals, at a high level (V2, see `j26-memory-phone-marketplace.md`). A paired Telegram or Discord account receives "FlowDriven: Send reply to Sam Example?" with the flow, the step and the summary. One decision at a time. For risky kinds, "Approve" needs two taps ("Tap again to confirm", then "Approved from your phone."); choices and sign-offs need one tap. The phone has no Edit, no Approve all similar and no Always allow (no standing rules from a phone, SR-2). Commands older than 10 minutes are ignored. Only the paired account is obeyed. For sensitive runs the message carries only the flow, the step and a short summary; the payload is approved in the app. A decision answered on the phone disappears from the window at once.
- **FS-j24.P9** From the chat card. A run started in a chat shows the decision card in that chat with "Approve", "Always allow for this flow" (when offered), "Reject" and "Details" (opens the run page). It is the same decision; answering in one place removes it from the others.
- **FS-j24.P10** Notifications (F-16). FlowDriven sends a system notification when a decision is created: "Waiting for you" and the title. Clicking opens the decision on the run page. It sends notifications only for decisions, problems and scheduled questions, never for progress or success.
- **FS-j24.P11** Stop. "Stop" on a run ends it at once with no confirmation (SR-8). Its waiting decisions become `expired` and their notifications are removed.
- **FS-j24.P12** After a Reject or an expiry, no standing rule applies for the rest of that run: every later `change`, `send`, `post`, `pay`, `delete` or `merge` asks, with the line "You said no to an earlier step in this run, so FlowDriven asks again." (Decided for V1, revisable; T-06; Not in the prototype yet.)
- **FS-j24.P13** "Done by your rule: <step title>." carries the tag "Includes text from an email or web page" when the step's input came from an outside-marked step (Decided for V1, revisable; T-07; Not in the prototype yet).
- **FS-j24.P14** A place with non-ASCII letters (for example a web address) is shown on the decision card in its own letters and also in ASCII, so a look-alike address cannot pass as the one the person knows (Decided for V1, revisable; T-05; Not in the prototype yet).

## States

| Entity | From -> to | Cause |
|---|---|---|
| Decision | none -> `pending` | The engine held a call, or reached an `ask` step |
| Decision | `pending` -> `approved` | "Approve", "Send choice", or "Approve all N" |
| Decision | `pending` -> `approved_edited` | "Save and approve" with edited text |
| Decision | `pending` -> `rejected` | "Reject" |
| Decision | `pending` -> `expired` | 24 hours passed, or the run was stopped or ended |
| Decision | `pending` -> `allowed_always` | "Always allow for this flow" |
| Run | `running` -> `waiting_approval` | A decision is created |
| Run | `waiting_approval` -> `running` | The last decision of the step is resolved |
| Run | `waiting_approval` -> `stopped` | The person pressed Stop (SR-8) |
| Step | `waiting_approval` -> `passed` / `skipped` | Approved, or rejected or expired |
| Standing rule | none -> active -> revoked | "Always allow for this flow"; "Ask me again" or a flow change that no longer matches |
| One-time grant | none -> used | Approve; used once for the exact call |

## Decisions and confirmations

- What asks: every action that is not a read and not already allowed for this exact place (SR-1).
- What confirms: Approve, Edit then "Save and approve", "Send choice", "Approve all N" (after its dialog), "Always allow for this flow". Only the person's own click in FlowDriven's window (or one decision on a paired phone) counts (SR-2).
- What deliberately has no dialog: Reject, Stop, Always allow, Ask me again, "Pick none" (owner decision, 2026-11-18: Reject and Stop need no confirmation; the standing rule is visible and revocable).
- What has a dialog: "Approve all similar".
- What never confirms: text in a chat message, an email, a skill, memory, a marketplace flow, a bot message or another AI tool. Another AI tool on this Mac can list decisions but never resolve one.

## Errors and edge cases

- **FS-j24.E1** Agent not set up or signed out. Cause: after Approve the agent has signed out. Sees: the decision shows "Approved"; the run shows "Waiting for sign-in" with "Sign in to Claude Code". Next: the grant stays valid for its run; after sign-in the step re-runs and uses it.
- **FS-j24.E2** Permission off. Cause: the person turned off "FlowDriven may run your AI agents". Sees: every run stops (SR-8) and the waiting decisions become `expired`. Next: nothing continues until the person turns the permission on and starts again.
- **FS-j24.E3** Limits reached. Cause: the spending limit or an agent's usage limit is reached. Sees: for the spending limit, a `budget_raise` decision "Monthly limit reached. Raise it in Settings to continue." with "Raise limit" (it opens Settings and the dialog from `j12-settings.md`; `approvals.resolve` on it gives `raise_in_settings`, so only raising the limit resolves it and the runs continue); for a usage limit, the run shows "Stuck" with "Claude Code has no usage left right now". Next: the run never continues silently (SR-9). Approving a held call under a reached limit records the approval and the run waits.
- **FS-j24.E4** Stopped or failed run. Cause: Stop, or the run failed while decisions waited. Sees: the decisions show "Expired" and leave Needs you. Next: nothing is sent. A new run asks again.
- **FS-j24.E5** Crash or restart. Cause: FlowDriven or the runner stopped. Sees: pending decisions are still there with the same expiry time (the clock does not restart). The run shows "Stopped unexpectedly". Next: a step that may have half-happened and is not marked idempotent is never repeated by itself (SR-8); "Try again" (see `j25-history-and-problems.md`) resumes it. An approved but unused grant stays valid for that run until it expires.
- **FS-j24.E6** Flow changed since confirmed. Cause: the person changes the flow while a decision waits. Sees: a note "This flow changed after this run started. The run keeps the version you confirmed." Next: the decision applies to the run's own version (SR-3). Standing rules of the new version apply only to runs that start after it.
- **FS-j24.E7** Outside text. Cause: the decision includes text from an email or web page. Sees: the tag "Includes text from an email or web page"; hidden characters shown as "[U+200B hidden character]"; links shown but not opened. Next: the text is shown as plain text, never as a button or instruction; "Always allow for this flow" is not offered when the place came from outside text; outside text cannot approve, edit or widen anything (SR-5). An own-text sign-off (the build plan) is approved as the person's own words only after the person reads it.
- **FS-j24.E8** A decision that expires. See FS-j24.P7. A click on "Approve" at the moment of expiry gets "This decision expired. The action was not done." and nothing is sent.
- **FS-j24.E9** Answered twice. Cause: the decision was already answered in another window or on the phone. Sees: "Already answered: Approved from your phone." and the card disappears. Next: nothing is done twice (the grant is one-time).
- **FS-j24.E10** Payload too large to show. Cause: the held call's input is over 4,000 characters. Sees: no card; the step fails with "FlowDriven could not show the whole text, so it did not ask." Next: the run reports it; nothing is sent.
- **FS-j24.E11** More than three holds. Cause: a step keeps making new held calls (the engine allows 3 per step or item). Sees: the step fails with the reason. Next: the person decides whether to run again.
- **FS-j24.E12** Prototype gaps. (a) `expires` is never shown or enforced: fixed by FS-j24.P7. (b) The toast "Approved. The run continues." also shows when other items wait: the real app counts them (FS-j24.S3). (c) A run with no chat posts no answer: the real app posts the answer to a new chat made for the run (AD-12, see `j20-run-from-chat.md`). (d) Stopped and failed runs have no resume button: see `j25-history-and-problems.md`. (e) The kinds `post` and `budget` are not seeded: the real app creates them as `risky_action` (post) and `budget_raise`; `requirement_addition` is never created (a flow change goes through Improve with chat).
- **FS-j24.E13** Stale batch. The batch dialog's list differs from the items waiting when "Approve all N" is chosen. Sees: the refreshed list. Next: nothing is approved until the person confirms the new list.
- **FS-j24.E14** No usable place. A decision whose touch has no fixed place hides "Always allow for this flow". Next: the person can still Approve one by one.

## Data read and written

- Read: approvals (`approvals.list`), the run, step and held call, the flow's touches and standing rules, the clock (injected in tests), settings (notifications).
- Written: the decision state, `resolvedAt`, `picks`, `editedText`; a one-time grant (run, step, tool, input digest); a standing rule (`standing_rules`) for Always allow; run decision lines; chat messages; the audit log for every held call, decision, rule use and rule change (SR-7), with hidden characters made visible and no secrets (SR-6).

## Runner API used

`approvals.list`, `approvals.resolve {approvalId, decision: approve|edit|reject|always_allow, editedText?, editedSubject?}`, `approvals.resolveSimilar {runId, group, approvalIds}`, `approvals.answer {approvalId, picks}`, `rules.list {flowId?}`, `rules.revoke {ruleId}`, `activity.summary`, `runs.status`, `runs.stop {runId}`, `chats.get`. Topics: `approvals`, `runs`, `rules`, `activity`, `chats`. MCP: other AI tools may list decisions; they can never resolve one, revoke a rule or change a permission (SR-2).

## Acceptance criteria

- **FS-j24.A1** A held call becomes one `pending` decision shown in Activity "Needs you", in the run's chat (when it has one), as a notification, and on a paired phone; the rail count includes it.
- **FS-j24.A2** The decision card shows the held call in full, with outside-text tag and hidden characters made visible, and an expiry countdown.
- **FS-j24.A3** "Approve" makes a one-time grant bound to run, step, tool and the exact input digest; the call is made once, exactly as written; the decision is `approved`; the run continues; a second use of the same grant is refused.
- **FS-j24.A4** When other decisions of the step still wait, Approve keeps the run at "Needs you" and the toast says how many remain.
- **FS-j24.A5** "Edit" is offered only for text payloads; "Save and approve" sets `approved_edited`, sends exactly the edited text, never changes recipients, and refuses empty text or text with hidden or format characters.
- **FS-j24.A6** "Reject" needs no dialog, sets `rejected`, skips the action, marks the step `skipped`, lets the run go on, and the report says "You said no: <title>. It was not done."
- **FS-j24.A7** A rejection does not fail the run and does not stop a chain.
- **FS-j24.A8** "Approve all similar (N)" is offered only for two or more waiting `send` or `post` decisions of the same run and group; its dialog lists every item; "Approve all N" approves only those items, only in this run, each with its own grant, and is logged; a changed list refreshes the dialog and approves nothing.
- **FS-j24.A9** "Approve all similar" is never offered for `pay`, `delete`, `merge`, choices, sign-offs or limit decisions.
- **FS-j24.A10** A choice accepts at most its maximum number of picks; "Send choice" sets the picks; "Pick none" skips the steps that needed picks.
- **FS-j24.A11** "Always allow for this flow" is offered only when the action's place is fixed in the flow's declared touch and the person is in the desktop window; it stores a standing rule for that exact flow, touch, effect and place.
- **FS-j24.A12** A later call that matches the rule exactly runs without asking, passes with the evidence "Allowed by your rule", adds "Done by your rule: <step title>." to the report and is audited; a call with another place or effect asks again.
- **FS-j24.A13** "Ask me again" revokes the rule at once with no dialog; the next such action asks.
- **FS-j24.A14** A changed flow keeps a rule only if a touch with the same id, effect and place exists in the new version.
- **FS-j24.A15** A decision still `pending` 24 hours after creation (injected clock) becomes `expired`, counts as Reject, the run goes on, and the report says "No answer in 24 hours: <title>. It was not done."
- **FS-j24.A16** A restart does not restart the 24-hour clock and does not lose pending decisions.
- **FS-j24.A17** Stop (or turning off the agent permission) ends the run at once, expires its waiting decisions and removes their notifications, with no confirmation.
- **FS-j24.A18** A decision answered twice (window and phone) is applied once; the second answer is refused with "Already answered".
- **FS-j24.A19** A phone decision follows the phone rules: only the paired account, nothing older than 10 minutes, two taps for risky kinds, no Edit, no Approve all similar, no Always allow.
- **FS-j24.A20** Outside text never creates, widens or revives a decision, grant or rule, and never decides the place of a standing rule.
- **FS-j24.A21** Every held call, decision, rule use, rule change and refusal appears in the audit log and in plain words on the run page.
- **FS-j24.A22** A held call whose input is over 4,000 characters produces no decision; the step fails with a plain reason.
- **FS-j24.A23** Notifications are sent for new decisions only, never for progress or success.

## Not in the prototype yet

- The expiry countdown and the 24-hour expiry as Reject.
- The remaining count in the Approve toast.
- Checks on edited text (hidden characters, empty text).
- Approve all similar limited to `send` and `post`, and its refresh when the list changed.
- Real notifications, the paired phone and other AI tools on this Mac (V2).
- The "Already answered" and "This decision expired" messages.
- Decisions for `pay`, `delete`, `merge` and `budget_raise` as real cards.

## Drafter's calls

- Approve all similar is offered only for `send` and `post`; reason: the original spec offers it for repeated sends, and the one rule favors the narrowest batch.
- Expiry of an action decision reads "No answer in 24 hours" rather than "You said no", because the person did not say no (SR-7: honest lines).
- "Always allow" follows SR-1 only: it is offered for any risky kind when the place is fixed; the architecture drafter may add a stricter rule for `pay`, `delete` and `merge`.
- A decision of a stopped run is `expired` (the vocabulary has no other state for it).
- Steps that need a skipped action's result are skipped and listed; the report says why.
