# FS-j25: History and problems

| Field | Value |
|---|---|
| Journey | j25: "Riwayat dan masalah" / History and problems / History and problems |
| PRD features | F-14, F-23 (also uses F-16) |
| Safety rules | SR-3, SR-5, SR-6, SR-7, SR-8, SR-9; START (for "Run again") |
| Prototype source | Brief sections 4.10, 14.3, 16.7, 17.1, 17.6, 18.1.3; `js/screens/activity.js` (`activityDetail`), `js/actions.js` (`resumeRun`, `stopRun`, `exportReport`, `startBlockReason`) |
| Status | In the prototype (version 8); parts Not in the prototype yet (marked below) |

## Goal

Activity keeps every run. When a run is stuck, the cause is written in plain words and there is one button to go on. A finished run can be copied as a short report.

## Entry points and trigger

- Rail "Activity"; a run card's "Details" in a chat; the "See what it needs" link on a queued run; a system notification about a problem; the "Run page" link under a finished chat answer.
- Trigger: the person opens it. Problems also raise one notification (`run_blocked`) when a run becomes "Stuck", "Waiting for sign-in" or "Failed" while nobody watches.

## Preconditions

- At least one run exists. With none, Activity shows empty states ("Nothing needs you right now.", "Nothing is running.", "No activity to show.").

## Main path

- **FS-j25.S1** Find the problem.
  - Person: opens Activity and, under "Earlier", opens the job review that shows "Waiting for sign-in".
  - FlowDriven: `activity.summary` returns the three sections; the filters are "All", "Finished" and "Problems" (Problems = `failed`, `blocked`, `interrupted`, `needs_login`). `runs.status` returns the run.
  - Sees: the run page: back link, flow name, status badge with words, how it started ("Started by itself at 14:00"), the cause in plain words, one button, "Steps" with state badges and evidence.
- **FS-j25.S2** Read the cause.
  - Person: reads the line under the badge.
  - FlowDriven: shows the cause from the engine's recorded reason, in plain words (table in FS-j25.P4). It never shows run ids, token numbers or internal terms.
  - Sees, for the sample: "The job site asks you to sign in again in your browser. FlowDriven never passes a sign-in or robot check for you. The run waits up to 12 hours." and the button "Sign in and continue".
- **FS-j25.S3** Sign in and continue.
  - Person: signs in to the site in their own browser, then chooses "Sign in and continue".
  - FlowDriven: `runs.resume {runId}` is the person's action. The run goes to "Waiting for sign-in" while FlowDriven re-checks, then re-runs from the step that stopped (finished steps are not repeated). If the sign-in is still missing, the step stops again with the same cause (one attempt per click, no loop). FlowDriven never types a password or passes a check (SR-6).
  - Sees: the toast "Waiting for you to sign in...", then "Running", then "Finished" with the toast "Run resumed". The report adds the honest lines, for example "Read 4 job pages after you signed in."
- **FS-j25.S4** Copy the report.
  - Person: opens a run that shows "Finished" and chooses "Copy report".
  - FlowDriven: `runs.export {runId}` returns the report parts (the runner masks secrets and marks hidden characters); the renderer builds the Markdown in the run's language, shows it in a dialog and copies it.
  - Sees: a dialog with the text: `# <flow>, <when>`, `Result: Finished`, `Ended: 09:16`, `## Summary` and bullets. A "Copy" button; if the clipboard is blocked, "Press Cmd+C to copy".

## Other paths

- **FS-j25.P1** Sections and filters. "Needs you" (decisions and waiting questions, see `j24-decisions.md`), "Running now" (with "Stop"), "Earlier" (newest first, filtered by All, Finished, Problems). The rail and top bar show the count of things that need you.
- **FS-j25.P2** Run again. On any run whose flow still exists, "Run again" calls `flows.start {flowId, source: "again", fromRunId}` (the runner takes the inputs of that run) and so goes through `START`: a `new` or `changed` flow shows the confirm card in a chat and does not start; missing required inputs are asked in a chat; otherwise it starts. It runs the flow's current confirmed version, not the old run's version (SR-3). The start message lists the values used. If the flow was deleted, the button is not shown.
- **FS-j25.P3** Try again. Shown for `blocked` runs whose cause FlowDriven can re-check, and for `interrupted` runs. For a `blocked` run FlowDriven re-checks the cause: if it is gone the run starts again from the stopped step; if not, the page says "Still stuck: <reason>." and the run stays `blocked`. For an `interrupted` run (after a crash) "Try again" is the person's own action and resumes the steps that did not finish; the runner does this by itself after a restart only when every interrupted step is marked idempotent (SR-8).
- **FS-j25.P4** Causes in plain words. The run page uses this table (the words may be refined in `apps/desktop/src/i18n`):

| State | Cause | Words | Button |
|---|---|---|---|
| `needs_login` | Agent signed out | "Claude Code needs you to sign in." | "Sign in to Claude Code" |
| `needs_login` | A site or account asked for sign-in | "<Site> asks you to sign in again in your browser. FlowDriven never passes a sign-in or robot check for you. The run waits up to 12 hours." | "Sign in and continue" |
| `blocked` | Permission off | "Allow FlowDriven to run AI agents in Settings." | "Open Settings" |
| `blocked` | Agent not set up | "Set up Claude Code first." | "Set up Claude Code" |
| `blocked` | Usage limit | "Claude Code has no usage left right now. It will be available again at 14:05." | "Try again" |
| `waiting_approval` | Spending limit (a "Needs you" `budget_raise` decision, not `blocked`) | "Monthly limit reached. Raise it in Settings to continue." | "Raise limit" (opens Settings and the dialog of `j12-settings.md`); raising the limit resolves the decision and the run continues, so there is no "Try again" |
| `blocked` | Checks keep failing | "The check for <step> still fails after 2 tries." | "Try again" |
| `blocked` | A requirement is missing | "<Folder or account> is missing." | "Fix it" (readiness row) |
| `blocked` | Flow not confirmed | "Confirm <flow> first." | "Confirm" |
| `blocked` | Limits did not take effect | "Claude Code did not apply the limits FlowDriven asked for, so the step did not run." | "Try again" |
| `interrupted` | Crash or restart | "FlowDriven stopped while this was running." | "Try again" |
| `failed` | Step failed after tries | The recorded reason, for example "The mail service did not answer twice in a row, so the run stopped. Run it again later." | "Run again" |
| `stopped` | The person pressed Stop | "You stopped this run." | "Run again" |

- **FS-j25.P5** Stopped and failed runs. `stopped` ("Stopped by you") and `failed` have no "Try again" in V1; they offer "Run again" and "Copy report" (the contract allows resuming a failed run; the screen does not offer it, see Drafter's calls).
- **FS-j25.P6** Stop. A run that is queued, starting, running, trying again or waiting has "Stop" on the run page, in "Running now" and on chat run cards. It ends the agent's process group at once with no confirmation (`runs.stop {runId}`, SR-8), sets the run and its running step `stopped`, expires its waiting decisions and starts the next queued run of the same flow.
- **FS-j25.P7** The run page parts. "This is waiting for your OK." with the decision cards when `waiting_approval`; "Result" (outputs) when `done`; "Steps" with the track, state badges and evidence; decision lines ("You approved: ...", "Done by your rule: ...", "You said no: ... It was not done."); the cost line ("Included in your plan", or an amount when billed per use, no token numbers); "Run again"; "Copy report". The decisions and the audit lines come from SR-7.
- **FS-j25.P8** Queue. A second run of a flow that is already open is `queued` ("Waiting to start": "Waiting for the earlier run of this flow"). If the earlier run needs the person, the line "The earlier run needs you first." with "See what it needs" is shown.
- **FS-j25.P9** Unknown run. An id that does not exist shows "This activity does not exist." with "Go to Activity".
- **FS-j25.P10** After a flow change. A run page keeps the version the run used. A banner "This run used an earlier version of the flow." is shown when the flow has changed since.
- **FS-j25.P12** A step that can send, post, pay, delete or merge never resumes by itself after a crash, even when marked idempotent, and the run page names what the interrupted step may have done: "This step may have sent: <title>. Check before you choose Try again." (Decided for V1, revisable; T-24; Not in the prototype yet.)

### Version 9 parts

- **FS-j25.P11** Agent and model on the run page. The page and the run card show the agent and model the run used ("Claude Code · Sonnet 5.5"), recorded when the run started (see `j31-agent-and-model.md`). Today's prototype names no agent here and hard-codes Claude Code in the usage line.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Run | `queued` -> `checking` -> `running` | The earlier run of the flow ended; the start check passed |
| Run | `checking` -> `blocked` | The check failed (agent, permission, requirement, limit); the cause is recorded |
| Run | `running` -> `needs_login` | A sign-in or robot check stopped a step |
| Run | `needs_login` -> `running` | "Sign in and continue" and the re-check passed |
| Run | `needs_login` -> `blocked` | 12 hours passed without sign-in |
| Run | `blocked` / `interrupted` -> `running` | "Try again" |
| Run | any open state -> `stopped` | "Stop" |
| Run | `running` -> `interrupted` | Crash or restart (at recovery) |
| Run | `running` -> `done` / `failed` | The last step passed, or a step failed after its tries |
| Step | `running` -> `failed`, `interrupted`, `stopped`, `passed`, `skipped` | As the engine records |

## Decisions and confirmations

- What asks: nothing here asks before acting, except what the start rule or a decision asks (confirm card for a `new` or `changed` flow, missing inputs, held calls).
- What confirms: the person's own click on "Sign in and continue", "Try again", "Run again", "Stop", "Raise limit".
- What deliberately has no dialog: Stop, Try again, Sign in and continue, Run again, Copy report (owner decision, 2026-11-18).
- What never happens by itself: signing in for the person, passing a robot check, resuming a half-done non-idempotent step after a crash, continuing after a limit is reached (SR-6, SR-8, SR-9).

## Errors and edge cases

- **FS-j25.E1** Agent not set up or signed out. Cause: the run's agent is `not_installed` or `needs_login`. Sees: "Waiting for sign-in" or "Stuck" with the cause row from FS-j25.P4 and the next-step button. Next: after the agent is `ready`, "Try again" resumes. The prototype checks only Claude Code for every run; the real app checks the agent the run uses.
- **FS-j25.E2** Permission off. Cause: the permission for AI agents is off. Sees: runs started now are "Stuck" with "Allow FlowDriven to run AI agents in Settings." and "Open Settings". Turning it off while runs are open stops them (SR-8). Next: the person turns it on, then "Try again".
- **FS-j25.E3** Limits reached. Cause: an agent's usage window or the monthly spending limit. Sees: the rows in FS-j25.P4 and one notification. Next: a run never continues silently (SR-9); for the spending limit the person raises the limit in Settings and the run goes on by itself; for a usage limit the person waits and chooses "Try again".
- **FS-j25.E4** Stopped or failed run. See FS-j25.P5 and P6. A stopped run keeps its finished steps; nothing half-done is hidden: the report says "Stopped before finishing."
- **FS-j25.E5** Crash or restart. At start, runs that were `queued`, `checking`, `running` or `retrying` become `interrupted` (audit `run_interrupted`). Only runs whose interrupted steps are all idempotent, and none of which can send, post, pay, delete or merge, resume by themselves; others wait for "Try again". Pending decisions keep their expiry times.
- **FS-j25.E6** Flow changed since confirmed. Cause: the flow is `changed` or `new` when the person chooses "Run again". Sees: the confirm card in a chat (`START` rule 1) and no run. "Try again" on an old run keeps that run's confirmed version (FS-j25.P10).
- **FS-j25.E7** Outside text. Cause: step evidence, an email subject or a web page says "sign in at this link" or "run this command". Sees: evidence from outside text is marked "Includes text from an email or web page", hidden characters are shown, links are shown but not opened by a click on the run page without main's check. Next: the text never steers the run, never sets the cause words and never adds a button (SR-5). The exported report keeps the tag.
- **FS-j25.E8** A decision that expires. Cause: a decision waits 24 hours. Sees: "Expired" on the run page and the honest line in the report (`j24-decisions.md`). A sign-in wait is different: it lasts 12 hours, then the run is "Stuck" with the same cause. The prototype's 12 hours is only text; the real app enforces it.
- **FS-j25.E9** Still blocked. Cause: "Try again" with the cause still present. Sees: "Still stuck: <reason>." Next: the state does not change; no retry loop runs.
- **FS-j25.E10** Clipboard blocked. Sees: "Press Cmd+C to copy" with the text selected.
- **FS-j25.E11** Secrets in a report. Cause: a step's output contains something that looks like a secret. Sees: the exported report masks it ("[hidden]"). Next: FlowDriven never writes secrets to a report (SR-6).
- **FS-j25.E12** Prototype gaps. (a) `blocked` with a resume problem unreachable: replaced by FS-j25.E9. (b) Nothing times out: fixed by FS-j25.E8. (c) Usage rows are hard-coded: the real app shows the run's own agent and cost line. (d) Run ids and token counts must not appear (words check).

## Data read and written

- Read: runs, steps, evidence, decisions, outputs, the audit log (`audit.list {runId}`), usage rows (for the cost line), agent status, settings.
- Written: run and step states, `runs.resume` resets failed or interrupted steps to pending, audit records for every start, stop, resume and permission change (SR-7). The report parts are built on request and not stored; the renderer builds the Markdown.

## Runner API used

`activity.summary`, `runs.list`, `runs.status`, `runs.report`, `runs.export`, `runs.resume`, `runs.stop`, `flows.start {flowId, source: "again", fromRunId}`, `flows.get`, `approvals.list`, `audit.list`, `agents.signIn`, `agents.list`, `settings.update` (limit, from the dialog). Topics: `runs`, `activity`, `approvals`, `agents`, `settings`.

## Acceptance criteria

- **FS-j25.A1** Activity lists "Needs you", "Running now" and "Earlier"; the filter "Problems" shows only `failed`, `blocked`, `interrupted` and `needs_login`; "Finished" shows only `done`.
- **FS-j25.A2** A run page shows the state badge with icon and words, how the run started, the cause in plain words, one button, the steps with evidence and the honest decision lines; it shows no run id and no token numbers.
- **FS-j25.A3** For each cause in the table (FS-j25.P4) the run page shows its words and its button.
- **FS-j25.A4** "Sign in and continue" resumes the run from the step that stopped, without repeating passed steps; if the sign-in is still missing the run stops again with the same cause and no loop starts.
- **FS-j25.A5** A run in `needs_login` for 12 hours (injected clock) becomes `blocked` with the same cause and a "Try again" button; it never becomes `done` by itself.
- **FS-j25.A6** "Try again" on a `blocked` run whose cause remains shows "Still stuck: <reason>." and keeps the state; when the cause is gone the run continues.
- **FS-j25.A7** After a runner restart, runs that were open become `interrupted`; only runs with all-idempotent interrupted steps resume by themselves; others resume only on "Try again".
- **FS-j25.A8** "Run again" goes through `START`: a `new` or `changed` flow shows the confirm card and starts nothing; missing required inputs are asked in a chat; otherwise it starts with the same inputs on the current confirmed version.
- **FS-j25.A9** "Run again" is not shown when the flow was deleted.
- **FS-j25.A10** "Stop" ends the run with no dialog, sets `stopped`, expires its waiting decisions, and starts the next queued run of that flow.
- **FS-j25.A11** `stopped` and `failed` runs offer "Run again" and "Copy report" and no "Try again".
- **FS-j25.A12** "Copy report" gives Markdown (built by the renderer from the `runs.export` parts) that starts with `# <flow>, <when>`, has `Result: <words>`, `Ended: <time>` and `## Summary`; a run that did not finish lists its passed steps and ends with "<status words> before finishing." or "Stopped before finishing."; it has no tokens, no secrets and no run id; hidden characters are made visible; outside text keeps its tag.
- **FS-j25.A13** An unknown run id shows "This activity does not exist." and "Go to Activity".
- **FS-j25.A14** Empty Activity shows "Nothing needs you right now.", "Nothing is running." and "No activity to show."
- **FS-j25.A15** With the permission off, a new run is `blocked` with "Allow FlowDriven to run AI agents in Settings."; turning the permission off stops open runs.
- **FS-j25.A16** A reached usage limit leaves the run `blocked` with its row from the table and one notification; a reached spending limit pauses the run with a "Needs you" `budget_raise` decision that only raising the limit resolves; nothing continues by itself.
- **FS-j25.A17** A run page keeps the version the run used and shows "This run used an earlier version of the flow." after the flow changed.
- **FS-j25.A18** Evidence from outside text is tagged and never changes the cause words, the buttons or any permission.
- **FS-j25.A19** (version 9) The run page and run card show the agent and model the run recorded.
- **FS-j25.A20** Every start, stop, resume and refusal appears in the audit log and on the run page in plain words.

## Not in the prototype yet

- The 12-hour wait enforced, then "Stuck".
- Real cause rows for permission, agent, limits and "limits did not take effect".
- The agent and model line (version 9).
- "Still stuck: <reason>." from a real re-check.
- The banner "This run used an earlier version of the flow."
- Secret masking in the exported report.
- Stop and Run again for runs whose agent is not Claude Code.

## Drafter's calls

- `failed` offers "Run again" only, as in the prototype, although `runs.resume` accepts failed runs; reason: a failed run already tried twice, and the prototype owner approved "Run it again later".
- "Run again" reuses the run's inputs, including date, because the person chose that run; the start message lists them and the submit still asks.
- After 12 hours without sign-in the run becomes `blocked` (spec 12.4 says the run waits up to 12 hours; it does not name the next state).
- Problems filter excludes `stopped`; reason: "Stopped by you" is not a problem.
