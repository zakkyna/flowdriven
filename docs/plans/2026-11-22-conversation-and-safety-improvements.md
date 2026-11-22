# Conversation and safety improvements

**Goal:** Nothing is turned down without the person. A decision waits until the person answers. An action outside the flow's list asks first, with a plain warning. A decision offers Approve, Reject or Another way. While a flow runs, the person can give it a note in the chat. A run whose agent keeps repeating itself stops early instead of using up the person's quota.

## Owner decisions (2026-11-22)

The owner answered these in this session, in plain words. Decisions 2 and 3 change approvals: this is the "Ask first" record, and their build tasks get one independent security review.

1. **No automatic rejection.** Owner: "jangan ada yg ditolak otomatis". A decision no longer expires after 24 hours. It waits until the person answers, presses Stop, turns the permission off, or deletes the flow. While it waits, the flow's later scheduled starts are skipped and recorded, as for any busy flow. This replaces the expiry in PRD F-13.R5 and NF-14. The prototype already shows no expiry (PU-15).
2. **Actions outside the flow's list ask first.** Owner: "minta perizinan dulu, dengan penjelasan yg mudah dipahami sehingga user aware jika ada potensi bahaya". A call the flow did not declare is held, not refused. Its card says in plain words that the flow did not say it would do this, and that text it read (an email, a page) may have asked for it. This revises spec 15.2 item 1 and the first step of AD-06. What the OS sandbox and the scoped config lock out stays locked, because those calls never reach a decision: folders outside the project, the agent's own sign-in files, servers the flow did not declare, and bypass flags.
3. **Reject skips the action; "Another way" is a third choice with a text box.** Owner: "jika menolak ya skip saja ... sebaiknya ada pilihan opsi lain dari setuju, tolak, opsi lain (dengan kotak deskripsi)". Reject keeps the B-05.T3 rule: the action is skipped and the run goes on. Another way gives the agent the person's words, and the agent tries again in the same step. Every new call goes through the decision function again.
4. **Notes while a run runs, in V1.** A message to a running flow becomes a note for that run. It is used from the run's next step and shown on the run page. A note cannot widen what the run may touch: anything new asks (decision 2).
5. **The build resumes as soon as T1 has landed.** T1 removes the 24-hour rule, which B-05 would otherwise build. After that, planned tasks go on. The new build tasks wait until the owner approves the prototype.
6. **The prototype is approved, and V1 uses its look and font.** Owner, after trying prototype versions 10 and 11: "Oke buatkan versi 1 dengan UI yang bagus keren wow dan AI savvy". Asked about the font: "Plus Jakarta Sans". The download was approved with "ya unduh".
   - The variable font file and its OFL license come from the official Google Fonts repository. Their SHA-256 values are in `.workflow/scratch/fonts/SOURCE.txt`.
   - They wait outside the tree until the hidden-character scan accepts `.ttf` files. That change is to `tools/checks/`, which is Ask first.

## Chair's calls (owner may override)

- Approvals for actions outside the list are one-time only. They get no "Always allow" and no "Approve all similar", and the run report lists each one.
- Stuck guard: an attempt ends early when the agent makes the same call with the same input and the same result 4 times, or gets the same error 3 times. It counts as a failed attempt, and the next attempt gets one plain note about it. After the last attempt the run is `blocked` with "The agent kept repeating itself." The thresholds are defaults kept in one place. There is no silence timer, because long builds can be silent; the 30-minute attempt limit stays.
- Research only, in B-22.T1: an agent that asks FlowDriven before each action, through Codex's own approval channel or the open Agent Client Protocol that several agents speak. A separate plan decides whether to build it. Claude Code stays on its command line and hooks, because its SDK route raises a vendor-terms question.
- `ask` steps: flow format 1.2 keeps `expires` and `on_expiry`, because flows already carry them, but the runner ignores both, so a choice also waits for the person (decision 1). A later format version may drop them.
- Later, not V1: copying a chat to try another way.
- All code is written for FlowDriven from these ideas. No file is copied from another project, so no third-party notice is needed.

## What the owner can try at the end

First, in the prototype (j24, j20, j25):
- a decision card with Approve, Reject and Another way;
- a card for an action outside the flow, with its warning;
- a decision still waiting the next day;
- a note typed during a run;
- the stuck line on the run page.

Then the same things in the real app, on the fake claude, as a Chair walk.

## Tasks

Gate for every task: `pnpm format`, then `pnpm check`.

- [x] **T1 Decisions wait for an answer (design set). Must land before B-05 resumes.**
  Done by: Codex gpt-6.1-terra, 2026-11-22. Evidence: pnpm check.
  Chair review, 2026-11-22:
  - Curly apostrophes were changed back to straight ones.
  - The edge-case category "a decision that expires" is renamed "a decision that waits" in every flow spec and in the flows README.
  - The note on `ask` steps was added to architecture 6.6.
  - New task B-05.T14 runs first in B-05.
  - Remove the 24-hour expiry from `docs/design/`:
    - PRD: F-13.R5, F-13.R14 and NF-14.
    - data-model: `expiresAt` and `resolvedVia: "expiry"`.
    - runner-api, architecture, and threat-model T-06.
    - Flows: j20, j24 and j25.
    - Test cases: TC-j24-29, TC-j25-42, TC-SR1-19 and TC-SR1-20, and the report line `report.noAnswer`.
  - Change the matching words of B-05.T1 and B-05.T3 in `build-order.md` and in the B-05 plan.
  - `expired` stays only where Stop, permission off or a deleted flow ends a decision.
  - If the version 2 contract carries `expiresAt`, T1 adds a contract task to B-05 that drops it, because a contract change is its own task.
  - Section 6 coverage of `build-order.md` must still hold.
  - Executor: Codex.
- [x] **P1 Prototype update (separate session, prototype repository).** Started 2026-11-22 in session `prototype-p1`.
  Done by: Claude Opus 5.5 (session prototype-p1), 2026-11-22. Evidence: prototype versions 10 (brief 26) and 11 (brief 27, the shorter menu) were published with every prototype gate passing. The owner approved both in chat (decision 6).
  - j24: Approve, Reject and Another way; the card for an action outside the flow, with its words; no expiry.
  - j20: a note during a run.
  - j25: the stuck line.
  - Gate: the prototype's own checks.
  - The owner tries it and approves it in `reviews`.
- [x] **T2 Step B-32 in the design set (after P1 is approved).**
  Done by: Codex gpt-6.1-terra (two parts), 2026-11-22. Evidence: pnpm check.
  Chair review, 2026-11-22:
  - The order numbers in build-order.md that the new rows shifted were corrected.
  - B-32 is placed at Order 14 for T1 to T4, which need only B-05, and at Order 26 for T5, which needs B-08 and B-10, rather than after B-19.
  - The screen work of T7 went into the unbuilt B-16, B-17 and B-19 tasks instead of a task of its own, so nothing is built twice. The shorter menu of prototype version 11 is in B-16.
  - The plan tasks map to the build: T3 is B-32.T2, T4 is B-32.T3, T6 is B-32.T4, T5 is B-32.T5, and B-32.T1 is their contract.
  - A B-32 section in `build-order.md`, placed after B-19 in the V1 order, holding T3 to T7.
  - New cases in `docs/design/test-cases/` (journeys and safety), and the coverage table.
  - The spec words for decisions 2 to 4 and the stuck guard in the PRD, architecture (AD-06), data-model and threat-model.
- [ ] **T3 Actions outside the list ask (B-32).**
  - Files: `packages/runner/src/claude/decide.ts` (an undeclared call is held as kind `outside_flow`), `rules/decisions.ts`, `exec/held.ts`.
  - Tests: `claude/decide.test.ts` (the refuse assertions are rewritten, equally strict, with register rows) and the new cases.
  - Security review: required.
- [ ] **T4 Another way (B-32).**
  - Files: `rules/decisions.ts` (outcome `another_way`, with text from the window only), `exec/held.ts` and `engine.ts` (the text reaches the worker as the person's words in the same step; the attempt count still holds), `service/handlers.ts` (`approvals.resolve`).
  - Tests: `service/decisions-handlers.test.ts`, `engine-reject.test.ts`, and the new cases.
  - Security review: required.
- [ ] **T5 Notes during a run (B-32).**
  - Files: `assistant/intents.ts` and `assistant/turn.ts` (`note_run`), `engine.ts` (notes reach the next step marked as the person's words), `service/map-run.ts`.
  - Tests: `assistant/turn.test.ts`, `engine-steps.test.ts`, and the new cases.
- [ ] **T6 Stuck guard (B-32).**
  - Files: `exec/stuck.ts` (new), `claude/run.ts` (watches the event stream), `engine.ts`, `report.ts`.
  - Tests: `exec/stuck.test.ts` (new), and the new cases on the fake claude.
- [ ] **T7 Screens (B-32).**
  - Files: the decision card and the run page under `apps/desktop/src/screens/`, and their words in `apps/desktop/src/i18n/en.ts` and `id.ts`.
  - Tests: renderer tests through `renderApp` and `renderAppBoth`.
- [x] **T8 Research: agents that ask before acting (Chair step: no network).**
  Done by: Claude Opus 5.5 (Chair step), 2026-11-22. Evidence: local `codex --help`, `codex exec --help` and `codex app-server generate-json-schema` output of codex-cli 0.166.0, read on this Mac only. Raw notes are in `.workflow/scratch/t8/`, not committed.
  - Added to B-22.T1.
  - From Codex's local `--help` output only: can it ask FlowDriven before each command, file change and tool call?
  - The result goes into the B-22 plan. B-22 has no plan file yet, so the result is recorded in B-22.T1 in `build-order.md`, which the plan copies.
  - Result:
    - `codex exec` has no approval option. A headless exec run cannot ask a person: it offers only automatic review (`--approve-for-me`) or the forbidden bypass flag.
    - The experimental `codex app-server` speaks JSON-RPC and sends its client approval requests before commands, file changes and extra permissions, and for MCP elicitations. Connector tools also have a `prompt` approval mode. So FlowDriven can be the approving client in front of Codex, as the hook channel is in front of Claude Code.
    - Still open: whether every MCP tool call reaches the client before it runs. The protocol is marked experimental, so a build plan would pin the Codex version and cover it in the conformance suite (B-22.T5).
- [x] **T9 Bundle Plus Jakarta Sans (decision 6).** The owner's yes to the `tools/checks/` change, 2026-11-22: "ya boleh", with "selesaikan task T1 sampai T8 tanpa bertanya".
  Done by: Codex gpt-6.1-terra, 2026-11-22. Evidence: pnpm check.
  - The Chair copied `PlusJakartaSans-VariableFont.ttf` and `OFL.txt` into `apps/desktop/src/styles/fonts/`. Their SHA-256 values are in `.workflow/scratch/fonts/SOURCE.txt`.
  - `tools/checks/lib/repo-files.mjs`: `ttf` joins the binary list, and a file counts as binary only if it starts with the TrueType signature (bytes 00 01 00 00). A `.ttf` without it is still read as text and fails, as today.
  - Tests first in `tools/checks/test/` (`node:test`, bytes built at test time):
    - a `.ttf` with the signature is binary;
    - a `.ttf` without it fails with "NUL byte in a text file";
    - every other extension behaves as before.
  - Design text: the PRD lines on the font (F-25 and its release line, and item 3 "No font files in V1"), and B-16.T1 in `build-order.md` with its plan copy.
    - The renderer loads the bundled font with `@font-face` from that folder, with the system font stack as the fallback.
    - Nothing is loaded from the internet (NF-23).
    - The OFL license stays next to the font.
  - Gate: `pnpm format`, then `pnpm check`.
