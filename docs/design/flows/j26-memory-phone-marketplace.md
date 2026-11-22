# FS-j26: Memory, Phone & bots, Marketplace (and Skills screen basics)

| Field | Value |
|---|---|
| Journey | j26: "Memori, HP, dan toko flow" / Memory, phone and the flow store / Memory, Phone & bots, Marketplace |
| PRD features | F-17, F-18, F-19, F-24 (also F-12 for the Skills screen; F-13 for phone decisions) |
| Safety rules | SR-1, SR-2, SR-3, SR-4, SR-5, SR-6, SR-7, SR-8; START |
| Prototype source | The prototype brief, 'Host rules', 'Fix round 4: after the chat-first check' and 'Inputs, results, proactive schedules, flows from skills, and every feature shown'; `js/screens/later.js` (memory, phone, marketplace), `js/screens/skills.js`, `js/actions.js` (`memoryKeep`, `memoryDrop`, `botSetup`, `setMcpMode`, `installListing`, `skillApproveUpdate`, `skillRollBack`). Original spec sections S21 (memory and skills), S14 (marketplace), S22 (phone and bots) |
| Status | In the prototype (version 8) as demos with canned data. Every behavior below that does real work is Not in the prototype yet. Release plan: Memory, Phone & bots and skill updates in V2 (B-25, B-26, B-27); Marketplace in V3 (B-28) |

## Goal

Four screens that the person can open from the left menu: Memory (what the agent remembers about them, with their say over each item), Phone & bots (answer decisions and start flows from a phone, and let other AI tools on this Mac start flows), Marketplace (flows made by others, installed as drafts that do nothing until confirmed) and Skills (the skills the agents have, with updates shown as changes). Each keeps the original spec's rules in plain words.

## Entry points and trigger

- Rail: "Memory", "Marketplace", "Phone & bots", "Skills". Search finds flows, not memory items.
- A proposed memory appears after a run or a chat; a skill update appears when a skill changes; a listing is opened from Browse.
- Trigger: the person's own click. Nothing in these screens runs a flow by itself.

## Preconditions

- The permission for AI agents is on for anything that needs an agent (Memory proposals, install checks).
- Phone & bots needs network access to Telegram or Discord, and a secret store (the system keychain, AD-19).
- Marketplace needs network access to the marketplace service. Browse and install are anonymous; a private (invited or team) flow needs an email code sign-in. The renderer loads no remote content: the runner talks to the service.

## Main path

Memory (V2).

- **FS-j26.S1** Open Memory.
  - Person: chooses "Memory".
  - FlowDriven: `memory.list`.
  - Sees: "Always used" (parts: "You", "Goals", "Kept", "Projects and flows", "Skills", each with a meter and no character counts), "Proposed" (memories the agent suggests, each with where it came from), and "Everything it remembers" with a search box and the filter "Applies to".
- **FS-j26.S2** Keep a proposal.
  - Person: on "Prefer fixed-price jobs over hourly ones." (from the Job review flow), chooses "Keep".
  - FlowDriven: `memory.keep {id}` writes an item (state `active`, scope as proposed, kind such as "Preference", not pinned). The runner is the only writer; the agent only proposes (spec R17).
  - Sees: the item moves into "Everything it remembers". "Drop" removes the proposal.
- **FS-j26.S3** Change an item.
  - Person: opens an item's menu: "Edit", "Pin" or "Unpin", "Delete".
  - FlowDriven: "Edit" opens a text box (500 characters at most); "Pin" puts it under "Kept"; "Delete" opens "Delete this memory?" ("The agent forgets it.") with "Delete" and "Cancel".
  - Sees: the list updates; search shows "Nothing matches." when empty; with no proposals "No proposed memories."

Phone & bots (V2).

- **FS-j26.S4** Open Phone & bots.
  - Person: chooses "Phone & bots".
  - FlowDriven: `phone.list`.
  - Sees: cards "Telegram" and "Discord", each with "Set up Telegram" or "Set up Discord" and the line "Connect a Telegram bot so you can answer from your phone.", and a card "Other AI tools on this Mac" with the switch "Let other AI tools on this Mac start your flows. They still ask you before anything is sent."
- **FS-j26.S5** Set up Telegram.
  - Person: chooses "Set up Telegram" and follows "Show the steps": create a bot with BotFather (`/newbot`) and copy the access code.
  - FlowDriven: step 1 explains; step 2 shows a password field.
  - Sees: "Paste the bot access code. It is saved in your Keychain."
- **FS-j26.S6** Save the code and pair.
  - Person: pastes the code, then sends the pairing code to the bot, then chooses "Check pairing".
  - FlowDriven: `phone.setSecret` stores the token in the system keychain by name and never shows it again (SR-6). `phone.startPairing` makes a random one-time code valid for 10 minutes. `phone.checkPairing` links the first account that sends the code.
  - Sees: a code such as "482-913" (a new random one each time in the real app), then "Paired with your account" and "Only your account can give it commands. Commands older than 10 minutes are ignored."
- **FS-j26.S7** Answer from the phone.
  - Person: on the phone, reads the fixed text "FlowDriven needs a decision" and "Open FlowDriven to see what is waiting." The phone message never shows a decision title, a flow name, a recipient or any payload (decided for V1, revisable; `j24-decisions.md`, FS-j24.P8).
  - FlowDriven: sends only that fixed text. Risky kinds are decided in the app. Whether a phone can still approve when it shows only fixed text is a V2 product decision, settled in the prototype when V2 is planned, with its own security review; if it is allowed, it is the same decision as `j24-decisions.md` (`approvals.resolve`), through the paired account only, with the two-tap rule for risky kinds.
  - Sees: the fixed message on the phone; a decision answered on the phone (if allowed) leaves Needs you in the window.
- **FS-j26.S8** Other AI tools.
  - Person: turns on "Let other AI tools on this Mac start your flows."
  - FlowDriven: `phone.setToolAccess {on}` starts a local-only server that lists and starts flows. Over it `approvals.list` gives flow id, step id and state only, never a title or payload.
  - Sees: the switch on, with the line "They still ask you before anything is sent."

Marketplace (V3).

- **FS-j26.S9** Browse.
  - Person: chooses "Marketplace", types in the search box.
  - FlowDriven: `market.search {text}`.
  - Sees: cards with the flow name, "By Mira Example - 1,240 people use it", and a badge ("No issues found" or "Warning"). The tabs are "Browse" and "Publish".
- **FS-j26.S10** Read a listing.
  - Person: opens a flow.
  - FlowDriven: `market.get {listingId}` returns the listing and its signed record; FlowDriven checks the signature (S12).
  - Sees: what it does; "Steps (4)"; the risk badge; "Will read", "Will change", "Will send or post (asks you first)", "Needs these accounts" ("None listed." when empty); the scan result; "Scanning reduces risk. It does not prove a flow is safe."; "Install" and "Report".
- **FS-j26.S11** Install.
  - Person: chooses "Install".
  - FlowDriven: shows "Install <name>?" with "It arrives as a draft. Nothing runs until you approve it." and "Install" / "Cancel". For a listing with a warning, one more line states it ("Warning: sends many emails."). On "Install", `market.install {listingId}` checks the signature and revocation list, saves the flow files pinned to the signed hash, and creates the flow in state `new`. It creates no standing rule and no schedule.
  - Sees: the flow page with "New: confirm it once", the banner "Check this flow once, then confirm it." and "Confirm". "Run" reads "Confirm first".
- **FS-j26.S12** Confirm (or not).
  - Person: chooses "Confirm" and reads the dialog "Confirm <name>?".
  - FlowDriven: the dialog lists "What it does", "Does on its own", "Asks you first", "Never does", each place in full. Only `read` touches are under "Does on its own" until the person moves one; sends and posts (every risky kind) are under "Asks you first" and cannot be moved (`flows.confirm` refuses them in `onItsOwn` with `not_allowed`, reason `always_asks`). "Confirm" records the hash and creates standing rules only for what the person left under "Does on its own" (non-read).
  - Sees: the flow without a badge. A "Run" click on a `new` flow, in the chat or anywhere else, shows "Confirm <flow> first?" instead of running (`START`).

Skills screen basics (list and updates, V1 list, V2 updates).

- **FS-j26.S13** Open Skills.
  - Person: chooses "Skills".
  - FlowDriven: `skills.list` returns the skills of the agents on this Mac and the library.
  - Sees: rows with name, one-line "about", origin ("Claude Code", "Comes with FlowDriven" or "More skills"), "Used by: ...", "Last used: ...", the tag "Update available" when there is one, "Make a flow" (see `j29-flow-from-skill.md`) and Expand/Collapse.
- **FS-j26.S14** Review an update (V2).
  - Person: expands a row with "Update available".
  - FlowDriven: shows "Update changes:" with added lines marked "+" and removed lines marked "-", then "Approve update" and "Keep current version". (V1 minimal behaviour, before this screen exists: when a skill that a flow was made from changes, that flow is `changed` and its confirm-again dialog lists "The skill <name> changed" under "What changed"; see FS-j23.P5 and FS-j29.P8. The diff, "Approve update" and "Roll back" are V2.)
  - Sees: the diff in plain text. "Approve update" makes the new text the active version; flows that use the skill show "Changed: confirm again" until the person confirms them (their confirmation pinned the old text). "Keep current version" dismisses the update.
- **FS-j26.S15** Roll back (V2).
  - Person: on an older version, chooses "Roll back".
  - FlowDriven: "Roll back <name> to an earlier version?" ("Flows that use it switch to that version.") with "Roll back" and "Cancel". The restored text becomes active; a flow whose confirmed pin equals the restored text is `confirmed` again; any other flow shows "Changed: confirm again".
  - Sees: newer versions marked "Newer". A skill unused for 90 days shows "Not used for 97 days. Archive it?" with "Archive"; a skill that a flow uses is never archived.

## Other paths

- **FS-j26.P1** Memory proposals from outside text. A proposal whose source is an email or web page carries the tag "Includes text from an email or web page", shows hidden characters, and waits for the person; it is never kept by itself. A kept item that came from outside text stays marked outside: a chat turn whose context holds it never starts a run by itself (SR-5, spec R15).
- **FS-j26.P2** Proposals lapse. A proposal the person never answers is dropped after 30 days.
- **FS-j26.P3** Memory reaches flows only by its own scope or a per-item grant by the person (spec R20). Memory text never adds a tool, folder, account or permission (spec R14).
- **FS-j26.P4** Delete is final. "Delete" removes the item with secure deletion; memory is never published, exported to the marketplace or put in a log or bug report (spec R18). "Export" writes Markdown only when the person asks.
- **FS-j26.P5** What a paired phone can do. List flows, start a flow (through `START`, source `phone`; a `new` or `changed` flow answers "Confirm it in FlowDriven first." and shows a "Needs you" item), see what needs you, see that a decision waits, stop a run (answering a decision from a phone is a V2 product decision, FS-j24.P8). It cannot create or change standing rules, schedules, permissions or limits, and cannot edit text (SR-2). Forwarded messages, files and links in a bot chat are outside text (SR-5); a message that contains them never starts a run by itself.
- **FS-j26.P6** Pairing limits. One account per bot; a second account is ignored; "Unpair" removes the link and the stored token reference; commands older than 10 minutes are ignored (no replay). WhatsApp is not supported. Memory or history commands over the bots are off (Drafter's calls).
- **FS-j26.P7** Other AI tools. They can list flows and start them through `START` (source `tool`), and a run started this way uses no standing rule: every risky action asks (Decided for V1, revisable; T-16; Not in the prototype yet). Their decisions still open in FlowDriven's window. They can never resolve a decision, revoke a rule, change a schedule, a limit or the permission (SR-2). The switch is off by default and listens locally only.
- **FS-j26.P8** Install variants. A signed update of an installed flow never applies silently: FlowDriven shows the changes in requirements, permissions and steps and the flow becomes `changed` until the person confirms. A local edit of an installed flow forks it into a local flow; updates stop. A listing that needs the person's own browser (`session: own`) cannot be installed in the first release (spec R13) and says so.
- **FS-j26.P9** Revocation. FlowDriven fetches a signed revocation list at start, every 6 hours, and before each run of a marketplace flow. A revoked version cannot run: the run is `blocked` with "This flow was withdrawn from the Marketplace." and the flow shows a "Needs you" row.
- **FS-j26.P10** Report. "Report" opens a dialog with a text box and "Send report", then "Report sent."
- **FS-j26.P11** Publish. The tab "Publish" has a flow select, a checklist ("Format is valid", "Scan found no issues", "No private data found"), the audience ("Only me", "People I invite", "Team", "Public") and "Publish". For any audience other than "Only me" a dialog says "Publish <name> to <audience>? Published versions cannot be changed. A fix is a new version." with "Publish" and "Cancel". The service scans (static checks, consistency, pattern rules, an AI reviewer that treats the package as data, reputation) and signs. Memory, history, standing rules and secrets are never in the package (SR-6, spec R18).
- **FS-j26.P12** Install from a private audience. A private flow asks for an email code sign-in at the service; FlowDriven never sees the mailbox.

## States

| Entity | From -> to | Cause |
|---|---|---|
| Memory proposal | none -> `proposed` | A run or chat produced one |
| Memory item | `proposed` -> `active` / dropped | "Keep" / "Drop", or 30 days |
| Memory item | `active` -> `retired` / `superseded` / deleted | "Delete", or a newer item with the same key |
| Bot link | `off` -> pairing -> `paired` -> `off` | "Set up", "Check pairing", "Unpair" |
| Other-tools access | off -> on -> off | The switch |
| Installed flow | none -> `new` | "Install" |
| Installed flow | `new` -> `confirmed` | "Confirm" |
| Installed flow | `confirmed` -> `changed` | A signed update, a local edit or a pinned skill change |
| Installed flow | any -> blocked at run | The version was revoked |
| Skill | active -> update available -> active (new version) | "Approve update" |
| Skill | active (new) -> active (old) | "Roll back" |
| Skill | active -> archived | "Archive" after 90 days unused and not used by a flow |
| Flow using a skill | `confirmed` -> `changed` | The skill's text changed (the confirmation pinned the old text) |

## Decisions and confirmations

- What asks: "Delete this memory?", "Install <name>?", "Confirm <name>?", "Roll back ...?", "Publish ... to <audience>?", the pairing and the switch for other tools (the click itself).
- What confirms: only the person's click in FlowDriven's window. Install confirms nothing about running: it creates a draft. "Confirm" is what allows the lists. "Approve update" allows new skill text, and then each flow that uses it asks to be confirmed again.
- What deliberately does not confirm: a paired phone (no standing rules, no settings, no limits), another AI tool, a bot message, a marketplace listing, a skill's text, a memory item, a scan verdict ("Scanning reduces risk. It does not prove a flow is safe.").
- No dialog: Keep, Drop, Pin, Edit, Report (the person's own typing), Archive (reversible by Roll back), the one-click phone approve of a choice.

## Errors and edge cases

- **FS-j26.E1** Agent not set up or signed out. Cause: a memory proposal or an install check needs an agent and none is ready. Sees: proposals stop appearing; the screens still work; install works (the check is FlowDriven's, not the agent's). Next: "Set up" or "Sign in" in Settings.
- **FS-j26.E2** Permission off. Cause: permission for AI agents is off. Sees: memory proposals are not made; a phone start answers "FlowDriven may not run your AI agents." and creates no run (the permission is turned on in the FlowDriven window with "Turn on permission"). Next: nothing runs.
- **FS-j26.E3** Limits reached. Cause: a started flow hits a limit. Sees: the same "Needs you" item as in `j24-decisions.md`; a phone message shows only the fixed text "FlowDriven paused a flow" and "Open Activity to see why." Next: nothing continues silently (SR-9). A bot or tool start cannot raise a limit.
- **FS-j26.E4** Stopped or failed run. A phone "Stop" ends the run at once (SR-8). A failed run sends the fixed text "A flow needs your attention" and "Open Activity to see what happened." to the phone, with no cause words, flow name or detail.
- **FS-j26.E5** Crash or restart. Pairing state and the keychain reference survive; the bot connection restarts by itself; a command received before the restart and older than 10 minutes is ignored. An install is all-or-nothing: a flow is either complete and pinned, or not saved.
- **FS-j26.E6** Flow changed since confirmed. A signed update, a local edit or a skill change makes the flow `changed`; no start outside the chat runs it (SR-3). A phone start answers "Confirm it in FlowDriven first."
- **FS-j26.E7** Outside text. Listing text, a bot message, a memory source or a skill diff is outside text: shown as plain text, hidden characters made visible, never a button or an instruction. It never adds tools, places or permissions, never chooses the place of a standing rule and never starts a run (SR-5). A listing's "Will read / change / send" list is checked against the flow's real declared touches by FlowDriven; a mismatch blocks the install ("The listing does not match the flow.").
- **FS-j26.E8** Signature fails. Cause: the signature, hash or publisher does not verify against the public key pinned in the app. Sees: "FlowDriven could not check this flow, so it was not installed." Next: nothing is saved. Before each run FlowDriven re-checks the pinned hash; a mismatch blocks the run with "This flow changed on this Mac since you installed it."
- **FS-j26.E9** What waits and what expires. A phone decision is the same decision and waits without a time limit (`j24-decisions.md`); a bot command older than 10 minutes is ignored; a pairing code expires after 10 minutes; a memory proposal lapses after 30 days.
- **FS-j26.E10** Token problems. A wrong or revoked bot token shows "Telegram did not accept the access code. Paste it again." The token never appears in a log, chat, report or test fixture (SR-6). Secrets are asked from the keychain only at the moment of use.
- **FS-j26.E11** Offline. Marketplace shows "The Marketplace is not reachable. Your installed flows still work." Installed flows run from their saved files; the revocation check uses the last list and, if it is older than 24 hours, shows a "Needs you" row but does not block (Drafter's calls).
- **FS-j26.E12** Prototype gaps. Memory is never created by a run (the real app proposes); pairing and demo taps are view-local; the token is not stored; Telegram, Discord and Marketplace are canned. The prototype's install gives reads and changes "Does on its own"; the real app does not (FS-j26.S12).

## Data read and written

- Read: memory items and proposals (`memory_items`), skills (`skills`, `skill_versions`), `phone_links`, `market_installs`, the keychain (by name, only to use), the revocation list, the pinned public key, flows and standing rules.
- Written: memory items (runner only), bot link records and keychain references, install records with the signed hash, flows in state `new`, skill versions and pins, the audit log (SR-7: installs, pairings, tool-access changes, every phone or tool start and decision). Never written: tokens in the store, secrets in any log, memory or history in a published package.

## Runner API used

V2: `memory.list`, `memory.keep`, `memory.drop`, `memory.edit`, `memory.pin`, `memory.delete`, `memory.export`, `phone.list`, `phone.setSecret`, `phone.startPairing`, `phone.checkPairing`, `phone.unpair`, `phone.setToolAccess`, `skills.list`, `skills.approveUpdate`, `skills.rollBack`, `skills.archive`, `approvals.resolve`, `approvals.answer`, `flows.start`. V3: `market.search`, `market.get`, `market.install`, `market.report`, `market.publish`, `market.revocations`, `flows.confirm`. Topics: `memory`, `phone`, `market`, `skills`, `flows`, `approvals`. MCP exposure: `flows.list`, `flows.get`, `flows.start`, `runs.status` and `approvals.list` only; never `approvals.resolve`, `rules.*`, `settings.*`.

## Acceptance criteria

- **FS-j26.A1** Memory shows "Always used", "Proposed" and "Everything it remembers", with search, the filter "Applies to", and the empty texts "No proposed memories." and "Nothing matches."
- **FS-j26.A2** "Keep" turns a proposal into an `active` item; "Drop" removes it; neither needs a dialog; only the runner writes memory.
- **FS-j26.A3** "Delete" asks "Delete this memory?" and, once confirmed, removes the item with secure deletion; "Edit" refuses text over 500 characters.
- **FS-j26.A4** A proposal from outside text carries the tag, shows hidden characters and is never kept without the person's click; a kept outside item keeps the outside mark.
- **FS-j26.A5** A proposal not answered for 30 days (injected clock) is dropped.
- **FS-j26.A6** Memory text never adds a tool, folder, account, address or permission to any flow or run.
- **FS-j26.A7** The bot token is stored only in the system keychain by name; it appears in no log, store row, chat, report or fixture.
- **FS-j26.A8** A pairing code is random, single use, and expires after 10 minutes; only the account that sent it is paired; a second account is ignored.
- **FS-j26.A9** A phone command older than 10 minutes is ignored and audited.
- **FS-j26.A10** (V2) A phone message holds fixed text only; risky kinds are decided in the app unless phone approval is allowed by the later product decision, in which case a risky kind needs two taps and a choice or sign-off one; the phone has no Edit, no Approve all similar and no Always allow; the result is the same decision as in the window.
- **FS-j26.A11** A phone cannot create or change a standing rule, a schedule, a limit or the permission.
- **FS-j26.A12** A phone or tool start of a `new` or `changed` flow runs nothing and answers that the flow must be confirmed in FlowDriven.
- **FS-j26.A13** A bot message holding forwarded text, a file or a link is treated as outside text and never starts a run by itself.
- **FS-j26.A14** Other AI tools can list and start flows through `START` when the switch is on and nothing when it is off; they can never resolve a decision or change a permission.
- **FS-j26.A15** "Install" checks the signature against the pinned public key and the revocation list, saves the flow pinned to the signed hash and creates it in state `new` with no standing rule and no schedule.
- **FS-j26.A16** A listing whose signature or hash fails is not installed and writes nothing; a listing whose list of reads, changes and sends does not match the flow's real touches is not installed.
- **FS-j26.A17** The confirm dialog for an installed flow places only `read` touches under "Does on its own"; sends and posts are under "Asks you first" and cannot be moved; "Confirm" creates standing rules only for the non-read touches the person left under "Does on its own" (kinds `local_write`, `run_command` and `change` only).
- **FS-j26.A18** A `new` installed flow cannot start from the chat, the Flows list, a schedule, a phone or a tool; each shows or answers "Confirm <flow> first".
- **FS-j26.A19** A revoked version cannot run: the run is `blocked` with "This flow was withdrawn from the Marketplace." The list is fetched at start, every 6 hours and before each run of a marketplace flow.
- **FS-j26.A20** A signed update of an installed flow is never applied silently: the flow becomes `changed` with the differences shown; a local edit forks the flow.
- **FS-j26.A21** Publishing for any audience other than "Only me" shows the confirm dialog; the package never contains memory, history, standing rules or secrets.
- **FS-j26.A22** Skills lists origin, "Used by", "Last used" and "Update available"; "Approve update" makes flows that use the skill "Changed: confirm again"; "Roll back" restores the earlier text; a skill used by a flow is never archived.
- **FS-j26.A23** Every pairing, tool-access change, install, update, publish, phone or tool start and decision is in the audit log.
- **FS-j26.A24** Marketplace flows cannot declare the person's own browser in the first release.

## Not in the prototype yet

- Everything real in this journey (V2 and V3, apart from the Skills list of V1): proposals from runs, real pairing, the keychain, the local tool server, signatures, revocation, real install and publish, the pinned skill text and "Changed: confirm again" after a skill update.
- The confirm dialog's rule that only reads are pre-placed for an installed flow.
- Memory lapse after 30 days, secure deletion, memory export.
- The publish confirm dialog.

## Drafter's calls

- Installed flows get only `read` touches under "Does on its own"; reason: the places come from outside text (SR-5), and the person's own move is the decision. The prototype pre-placed reads and changes.
- Phone messages, notifications and the tool server show fixed text only (Decided for V1, revisable; V2). Reason: a title or recipient on a lock screen or in another tool is a leak; phone approval is a V2 product decision with its own review.
- Release split: Skills list in V1 (needed by `j29-flow-from-skill.md`); update diffs and roll back in V2; Memory and Phone & bots in V2; Marketplace in V3 (`prd.md`, section 9).
- Pairing code valid 10 minutes, single use; reason: it matches the 10-minute command rule.
- Memory and history commands over the bots are off and not offered in V2; reason: the spec makes them a per-channel opt-in, which the prototype never showed.
- A revocation list older than 24 hours shows a "Needs you" row but does not block runs; reason: offline use should not break installed flows, and a block would be a new product decision.
- A skill update makes dependent flows "Changed: confirm again" (the skill text is part of what runs, SR-3); the prototype says flows "switch to that version".
