# FlowDriven build order (V1 build plan)

Status: complete for the V1 build, 2026-11-21.

This file owns the build step ids `B-00` to `B-31` and the task ids `B-NN.Tn`. It turns the design set in `docs/design/` into ordered steps for a test-first build: Codex writes the code one task per call, Claude reviews and commits. Each task names the failing tests to write first by their test case ids, which live in `test-cases/journeys.md`, `test-cases/safety.md` and `test-cases/platform.md`. It follows `prd.md` (section 9, V1 scope and the register of behaviours the owner has not seen, and section 10), `architecture.md` (sections 14 and 15), `threat-model.md` (section 8, the security review gates), `test-plan.md` (the loop, the layers, Harness H and the exit criteria), `runner-api.md` (sections 7 and 14), `data-model.md` (section 5.4, the migration tests) and `contributing-plan.md` (B-31). Each step becomes one short plan in `docs/plans/` when it starts; the plan copies the step's tasks and adds nothing else. Files marked "(new)" do not exist yet; the others are in the repository today.

## Decisions for V1

All are Decided for V1 (revisable), 2026-11-21, and apply to every step below.

1. Translations are approved by the owner's own request (English and Bahasa Indonesia, with easy added languages). They are not an Ask-first item.
2. No new workspace package. The words live in `apps/desktop/src/i18n/` (`en.ts`, `id.ts`, `languages.ts`, `t.ts`, `plural.ts`, `when.ts`). The language check is `apps/desktop/src/i18n/i18n.test.ts`, run by `pnpm test`. `tools/checks/` and its allowlist stay unchanged. No words live in `packages/*`: the runner and the contracts carry codes and `Line` values only, and `packages/contracts/src/line-keys.ts` (new) lists the keys the runner emits. Electron main draws notifications from fixed `Line` values with no params and passes the registered language codes to the runner at spawn (`--languages=en,id`); there is no menu bar menu. The renderer builds the "Copy report" Markdown from `runs.export` parts and fills the chat result answer lines. The B-31 docs check is one Vitest test, `apps/desktop/src/docs.test.ts`.
3. No font files in V1: the system font stack.
4. The tests of the retiring builder-first screens are not deleted. Those screens are unrouted, and their code and tests keep passing on a frozen island: `packages/contracts/src/v1/` (a read-only copy of contract version 1) and `packages/fixtures/src/v1/` (the version 1 sample and fixture client). The retired operations stay in the operation table as 12 retired entries that the real runner answers `unavailable` with reason `retired`. Removing the island is a later Ask-first item.
5. Packaging and the runner bundle stay out of V1 (B-30). V1 runs from a checkout.
6. No CI change and no new dependency in V1: every V1 step says "Dependency changes: none".
7. Changes to approvals and the sandbox (AD-06, AD-07, Reject skipping an action, the Codex sandbox) follow the clickable prototype, which the owner approved. Each task that makes one is marked "Safety-core change: one independent security review before its pull request leaves draft."
8. `AGENTS.md` is not edited in V1. Its "Design:" pointer and a sentence about the language files are a later Ask-first change.
9. Always allow. "Always allow for this flow" exists exactly as in the prototype: only for a repeatable `change` action at a fixed place (the timesheet entry, one cloud storage folder upload). Standing rules exist only for `local_write`, `run_command` and `change`. A risky kind (send, post, pay, delete, merge) always asks: it can never be under "Does on its own", and `flows.confirm` refuses it there with `not_allowed`, reason `always_asks`. Built in B-04, B-05 and B-13.
10. No first run. Turning a schedule on never starts a run. The "Run it now?" offer that follows Save flow stays. Built in B-12.T6 and B-13.T3.
11. Permission off. A start with the permission off is refused with "FlowDriven may not run your AI agents." and a button "Turn on permission" that opens the same "Before you start" dialog as Settings; no run is created. A run going when the permission is turned off becomes `stopped`. Built in B-08.T6, B-12.T1, B-12.T5, B-20.T1 and B-20.T6.
12. Background. V1 adds no menu-bar icon and no Open at login. It keeps today's macOS behaviour: the app stays alive when its window closes, so schedules keep running until the person quits. There is no `background` setting, no `window.setBackground`, no `tray.ts`, no `login-item.ts` and no `starts.next`. Built in B-23.
13. Words. The runner never builds sentences: it emits a `Line` (a message code with values). Runner tests assert codes and values; the renderer and Electron main turn a `Line` into words. Built in B-06.
14. Unseen behaviour. One register in `prd.md` (section 9.1, PU-01 to PU-29) lists every V1 behaviour the owner has not seen in the prototype. Each step lists the PU items it builds; they go into the clickable prototype and are approved before the step starts. Everything on the "Removed from V1" list is not built.
15. Old tests. A test of behaviour that V1 changes is rewritten in the same task, with an equally strict assertion that cites the flow spec. The register "Tests that change" in section 6 lists them. Tests of the unrouted builder-first screens stay and keep passing.
16. Harness and order. The shared test setup (Harness H) is defined once in `test-plan.md` and built first (B-00). Each task report shows the failing test's name and failure message from the run before the code was written. Steps are ordered so every dependency comes first (the order table in section 3), and no case's Given relies on a case that is built later. Codex and the agents' install and sign-in details start as research steps (B-21.T4, B-22.T1); until then cases use an injected agent profile and assert the exact value it gives.
17. Contributor checks. The docs checks are Vitest tests outside `tools/checks/`; nothing there changes.
18. Approve all similar is kept, and its dialog lists every item in full (every recipient, the subject and the whole text) before anything is approved. Still `send` and `post` only, one run only. Built in B-05.T4 and B-19.T4.
19. Fixed text. Notifications (and, from V2, the tool server and phone messages) show fixed text only, never a decision title, a flow name, a payload or an input value. Built in B-06.T7 and B-12.T10.
20. Release. Signing, notarization, tags and releases are never agent steps: B-30.T3 and B-30.T4 are owner steps. Agents may prepare configuration that holds no secret.
21. Fixtures are synthetic. Research reads the agents' public help and documentation; the committed fake scripts are written by hand; a test scans fixtures and test helpers for local paths, `@` addresses and long tokens. Built in B-00.T5.
22. Privacy and words of the documents. No private skill names, no persona that identifies the owner, no paths outside the repository; the time zone in examples is `Asia/Bangkok`.
23. Network. FlowDriven sends nothing of its own. The only network action FlowDriven starts is the agent's official installer, which Set up runs only after the person chooses Set up.
24. Look and feel (F-25). Tokens, the step track states with their accessible names, the hero, the composer and Light, Auto and Dark follow the prototype brief, 'Visual redesign: the live current' and 'Light and dark mode the owner can choose'; the system font stack replaces the prototype's font. Built in B-16.T1, B-17, B-18, B-19 and B-20.
25. Plain words are checked (NF-54). The language check scans English and Indonesian values for the forbidden words of the plain-words principle, run ids and version numbers, with an explicit allowlist. Built in B-06.T5.
26. Window size and menu. The desktop window's minimum size is 480 by 600; the narrow layout applies below 768 px; widths from 320 to 479 px apply only to the browser preview and to layout tests. The V1 menu is New chat, Search, Flows, Activity, Skills and Settings; the V1 Settings sections are Appearance, Language, AI agents, Permission, Main AI agent, Spending limit and Notifications. Other items appear when their release ships.
27. A changed skill. V1 has the minimal behaviour: a flow whose skill changed is "Changed: confirm again" and its confirm dialog lists "The skill <name> changed" under what changed; the diff and roll back are V2 (B-27). Built in B-15.T3.
28. Remembered answers keep an `outside` mark. "Use my last answers" and `whenItsTime: "last"` are not offered when a needed value came from outside text, unless the person typed or confirmed that value. Built in B-09.T3 and B-12.T4.
29. Masking. V1 masks secrets by a named pattern list (`sk-` keys, `ghp_` tokens, `Bearer` values and the values of `secret_ref` inputs) in "Copy report" parts and the run page's text. Secrets inside the person's own files that an agent reads may still appear on the run page and reach the model maker. Built in B-19.T3.
30. Review gates. The gates read AGENTS.md broadly: the renderer tasks that show a held payload (the decision card in B-17.T4, and the decision card and the Approve all similar dialog in B-19.T4) are Required (approvals), as `threat-model.md` section 8 says.
31. Codex reads. "Declared folders only" holds for Claude Code; Codex's read scope is part of the Codex spike (`threat-model.md` section 10, item 1) and of the Codex research (B-22.T1).

With these, no V1 step has an Ask-first item. Section 6 settles the points these decisions do not name.

## 1. How a step is built

1. **Prototype gate.** Build only what the owner approved in the clickable prototype's Guide. Each step names the journeys that must be approved before it starts and lists the PU items (the register in `prd.md` section 9.1) it builds. A PU item goes into the clickable prototype first, is tried and approved by the owner, and only then is its step built. Nothing on the "Removed from V1" list of that register is built.
2. **The step's plan.** When a step starts, one short plan goes into `docs/plans/` (about one page: the goal, what the owner can try at the end, the tasks with files, tests and gate). One review per plan. No code in plans.
3. **Ask first.** V1 has no Ask-first item (decisions 1 to 31). V2, V3 and B-30 name theirs; approving this plan is the yes for exactly the named change and nothing else (AGENTS.md). Anything a task seems to need beyond its named files stops the task with `Blocked:`.
4. **A task is one Codex call.** One area, at most about five code files plus their tests, run with `-s workspace-write` set explicitly. For each task: write the failing tests first; run them and see each fail for the reason its case gives ("Fails first because"); a test that passes before the code exists is fixed first; write the smallest code that passes; tidy; run `pnpm format`, then `pnpm check`. No test is weakened, skipped or deleted to pass the gate. Codex never commits.
5. **The red run** (decision 16, `test-plan.md` section 1). The first failing run is saved: its command and, for every failing test, the test's name and failure message go to `.workflow/scratch/<task id>-red.txt` (git-ignored, never committed). The task report shows the same names and messages. The Chair compares each message with the case's "Fails first because" line and sends the task back when a test failed for another reason (for example a typo or an import error). Fixtures and test support (the Harness H parts of B-00 and the fakes) are exempt and have their own small tests.
6. **Handoff.** Tick the task only after the gate passes, and add one line under it: `Done by: <tool/model>, <date>. Evidence: <passing command>; red run: .workflow/scratch/<task id>-red.txt.` After two failures stop and write `Blocked: <short reason>`.
7. **Chair steps and owner steps.** A task marked "(Chair step: network)", "(Chair step: GUI)" or "(Chair step: commit)" is the Chair's (the session that does Chair steps): Codex skips it and leaves it unticked. Commits, installs and anything that opens a window are Chair steps. Research steps (B-21.T4 and B-22.T1) are Chair steps (network): they read the agents' public help and documentation and write a synthetic agent profile; nothing is recorded from a real agent or account (decision 21). A task marked "(Owner step)" (B-30.T3, B-30.T4) is the owner's own: no agent holds or uses a signing, notarization or release secret, and none creates a tag or a release. The real Codex and Claude Code are run only in Chair walks with the owner watching, on a separate data folder, never inside `pnpm check`.
8. **Old tests** (decision 15). A test whose subject V1 deliberately changes is rewritten in the same task as the new behaviour, with an equally strict assertion that cites the flow spec that now decides it. The task report lists it, and the register "Tests that change" in section 6 names each one. No test is deleted to make room for the new behaviour; the tests of the unrouted builder-first screens stay and keep passing.
9. **Security review.** A task marked "Safety-core change" gets one independent security review before its pull request leaves draft. The reviewer did not build the change and reads it as a diff from a checkout of the default branch. Each finding is fixed or recorded as a known limit, and pinned by a `review-*.test.ts` file. The gates per step come from `threat-model.md` section 8 and are repeated in each step.
10. **Done when** the step's tests pass, `pnpm format` then `pnpm check` pass, the security review (where the step has one) has no open finding, and the owner tried what the step says they can try.

Test layers: L1 unit, L2 UI, L3 runner integration, L4 check tool, L5 Chair walk (`test-plan.md`). Sample names are Build APK and upload it, Fill timesheet, Weekly supplier report, Email triage and Job review. Test files named in a task are the files the cases name; a file marked "(new)" is created by that task.


## 2. Overview

| Step | Name | Release | Depends on | Prototype gate (journeys) | PU items | Security review | Tasks | Test cases |
|---|---|---|---|---|---|---|---|---|
| B-00 | Shared test harness | V1 | None | - | - | No (test support) | 6 | 3 |
| B-01 | Contract version 2 | V1 | B-00 | all V1 journeys | - | Required (approvals) | 11 | 66 |
| B-02 | Flow format 1.2 | V1 | B-00 | j20, j21, j22, j27, j28 | - | Required (flow hashing) | 5 | 24 |
| B-03 | Store version 7 and migration | V1 | B-01, B-02 | j12, j20, j21, j22, j24, j27, j28 | - | Required (approvals) | 6 | 45 |
| B-04 | Safety core: the decision function | V1 | B-01, B-02, B-03 | j20, j24 | PU-22 | Required (approvals) | 6 | 44 |
| B-05 | Decisions and standing rules | V1 | B-03, B-04 | j20, j21, j24 | PU-15 to PU-18 | Required (approvals) | 10 | 97 |
| B-06 | Words and languages | V1 | B-01, B-03 | j01, j12, j30, j31 | - | Recommended | 9 | 66 |
| B-07 | AI agents, models and the one permission | V1 | B-00, B-01, B-03, B-05, B-21.T4 | j01, j12, j25, j31 | PU-01, PU-02, PU-27 | Required (sandbox limits) | 7 | 60 |
| B-08 | The assistant: chats and chat turns | V1 | B-05, B-06, B-07 | j20, j22, j27, j30, j31 | PU-04, PU-05, PU-07 | Required (approvals) | 8 | 71 |
| B-09 | Flow inputs | V1 | B-02, B-08 | j20, j27 | PU-28 | Recommended | 6 | 56 |
| B-10 | Runs from the chat | V1 | B-04, B-05, B-09 | j20, j21, j25, j31 | PU-06 | Required (runs and programs) | 5 | 26 |
| B-11 | Results | V1 | B-06, B-10 | j20, j24, j27 | - | Recommended | 4 | 21 |
| B-12 | Start rule, schedules and the proactive question | V1 | B-10, B-11 | j21, j23, j24, j25, j26, j27, j28, j31 | PU-07, PU-09, PU-10, PU-13, PU-16, PU-19, PU-25 | Required (runs and programs) | 12 | 136 |
| B-13 | Make a flow in the chat | V1 | B-02, B-04, B-05, B-08, B-10, B-12 | j20, j22, j29 | PU-05, PU-11, PU-12 | Required (approvals and flow hashing) | 5 | 35 |
| B-14 | Improve a flow with chat | V1 | B-13 | j23 | PU-11, PU-13, PU-14 | Required (flow hashing) | 3 | 22 |
| B-15 | Flows from skills | V1 | B-13, B-16, B-17.T1, B-17.T2 | j26, j29 | PU-05, PU-11, PU-12, PU-14 | Required (flow hashing) | 4 | 39 |
| B-16 | Renderer shell | V1 | B-01, B-06 | j12, j20 | - | Recommended | 8 | 45 |
| B-17 | Chat screen | V1 | B-08, B-16; T3 B-10, T5 B-09, T7 B-13, T8 B-14 | j20, j22, j23, j27, j29, j31 | PU-04 to PU-07, PU-11 to PU-14, PU-27, PU-28 | Required (approvals) for the decision card, which shows a held payload; Recommended for the rest | 8 | 42 |
| B-18 | Flows screen and flow page | V1 | B-12, B-13, B-15, B-16, B-17 | j21, j22, j23 | PU-04, PU-09, PU-10, PU-25 | No (UI only) | 4 | 26 |
| B-19 | Activity and the run page | V1 | B-05, B-11, B-16, B-17, B-18 | j24, j25 | PU-08, PU-15 to PU-18, PU-20 to PU-24 | Required (approvals) for the decision card and the Approve all similar dialog, which show a held payload; Recommended for the rest | 5 | 54 |
| B-20 | Settings | V1 | B-06, B-07, B-16 | j12, j30, j31 | PU-07, PU-29 | Required (approvals) | 7 | 53 |
| B-21 | First launch | V1 | B-07, B-16, B-20; T4 none | j01 | PU-01 to PU-03 | Required (runs and programs) | 5 | 17 |
| B-22 | Codex | V1 | B-07; T7 B-08, B-13, B-14, B-15; T1 none | j01, j12, j20, j22, j23, j29, j31 | PU-26 | Required (sandbox limits) | 7 | 35 |
| B-23 | Keeping the app alive | V1 | B-07, B-12, B-20 | j12, j28 | - | Required (runs and programs) | 4 | 14 |
| B-24 | Spending limit, usage limits and busy fallback | V1 | B-07, B-12, B-20 | j12, j25, j28, j31 | PU-08 | Required (runs and programs) | 5 | 32 |
| B-31 | Contributor guides | V1 | B-06 | - | - | No (documents) | 4 | 18 |
| B-25 | Memory | V2 | B-08, B-17 | j26 | - | Recommended | 4 | 26 |
| B-26 | Phone & bots and other AI tools | V2 | B-25, B-20 | j26 | - | Required (approvals) | 7 | 38 |
| B-27 | Skill updates with roll back | V2 | B-15, B-25 | j26 | - | Required (flow hashing) | 2 | 11 |
| B-28 | Marketplace client | V3 | B-13, B-18, B-27 | j26 | - | Required (signatures and release) | 7 | 36 |
| B-29 | FlowDriven gateway for account tools | V3 | B-22, B-26 | - | - | Required (approvals) | 3 | 3 |
| B-30 | Packaging and release path | Before any public download | All V1 steps | - | - | Required (signatures and release); owner steps | 4 | 0 |

V1 (B-00 to B-24 and B-31): 164 tasks and 1147 test cases. V2 (B-25 to B-27): 13 tasks and 75 cases. V3 (B-28, B-29): 10 tasks and 39 cases. B-30: 4 tasks and no cases yet. Everything: 191 tasks and 1261 test cases (every case of `test-cases/journeys.md` (572), `safety.md` (173) and `platform.md` (516) once). "Security review" follows `threat-model.md` section 8: Required is one of its Required classes (named in brackets), Recommended is its Recommended class, No is Not required. The renderer tasks that show a held payload are Required (approvals) and marked "Safety-core change: one independent security review before its pull request leaves draft." The Prototype gate column lists journeys; the PU items column lists the behaviours of the register in `prd.md` section 9.1 that the owner approves in the clickable prototype before the step starts. The order the steps are built in is the table of section 3.

Ask-first index: none in V1 (decisions 1 to 31). V2 and V3 steps and B-30 name theirs in their own sections.

## 3. V1 steps in build order

The build order is the table below. A step or task is built at its Order; a task that is not named in its own row takes its step's row. Every "Depends on" item of a step or task has a smaller Order than the step's last row (or than the task's row), and no case's Given names a case that is built at a larger Order (`design-set.test.ts` of B-00.T6 checks the second rule). The step ids stay as in `architecture.md` section 14; the steps are written below the table in id order.

| Order | Step or tasks | Why here |
|---|---|---|
| 1 | B-00 | Test support first: every later step writes its cases against one Harness H (`test-plan.md` section 4.1). |
| 2 | B-01 | The contract, the fixture client and the sample data that every later step uses. |
| 3 | B-02 | The flow format needs only B-00; it could run beside B-01. |
| 4 | B-03 | The store version 7 needs the contract and the format. |
| 5 | B-04 | The one decision function needs the store. |
| 6 | B-05 | Decisions and standing rules need the decision function; the engine stop is built here because the decision cases need it. |
| 7 | B-06 | Words, `Line` keys and the language check need the contract and the settings keys. |
| 8 | B-21.T4 | The research of the agents' install and sign-in details comes before the tasks that build Set up and sign-in (B-07.T5, B-07.T6). |
| 9 | B-07 | Agents, models and the one permission need the store, decisions and the research. |
| 10 | B-16 | The renderer shell needs the contract and the words; the owner can open the new window here, on the fixture client. |
| 11 | B-20 | Settings (appearance, language, permission) need the shell and the agents; the owner can try them before the assistant exists. |
| 12 | B-21.T1 to B-21.T3, B-21.T5 | First launch and the pinned catalog need Settings and the agents. |
| 13 | B-08 | The assistant needs decisions, words and agents. |
| 14 | B-17.T1, B-17.T2, B-17.T4, B-17.T6 | The first chat screen tasks (thread, composer, decision card, picker) need only the assistant's shapes, the shell and agents. |
| 15 | B-09 | Flow inputs need the format and the assistant. |
| 16 | B-17.T5 | The inputs form needs the inputs. |
| 17 | B-10 | Runs from the chat need the decision function, decisions and inputs. |
| 18 | B-17.T3 | The plan card and run card need runs from the chat. |
| 19 | B-11 | Results need words and runs from the chat. |
| 20 | B-12 | The start rule for every other source, schedules, the proactive question and notifications need runs and results. |
| 21 | B-13 | Make a flow needs the start rule, because Save flow offers "Run it now?". |
| 22 | B-17.T7 | The draft card and confirm dialog need Make a flow. |
| 23 | B-14 | Improve a flow needs Make a flow. |
| 24 | B-17.T8 | The change card and schedule card need Improve a flow. |
| 25 | B-15 | Flows from skills need Make a flow and the first chat screen. |
| 26 | B-18 | The Flows screen and flow page need the start rule, Make a flow, skills and the chat screen. |
| 27 | B-19 | Activity and the run page need decisions, results, the shell and the chat screen. |
| 28 | B-22.T1 | The Codex research is a Chair step; it comes before the Codex tasks. |
| 29 | B-22.T2 to B-22.T7 | The Codex adapter needs the agents port and the research; its last task needs the make, improve and skill drafts. |
| 30 | B-23 | Keeping the app alive and missed starts at wake need schedules and Settings. |
| 31 | B-24 | The spending limit, usage limits and busy fallback need agents, the start rule and Settings. |
| 32 | B-31 | The contributor guides are written last, when V1 behavior is known. |

The owner can open the new window at Order 10, use Settings at 11 and try first launch at 12, before the assistant exists; they run on the fixture client. B-21.T4 (research) is a Chair step and can be done any time before Order 9.

### B-00 Shared test harness

- Release: V1.
- Goal: The shared test setup that `test-plan.md` section 4.1 calls Harness H exists with its own small tests, so every later step writes its cases against one setup. Only the parts that need nothing new from V1 are built here; the other parts join in the task that builds the code they need.
- Depends on: None.
- Prototype gate: None (test support; nothing the person sees).
- Ask first: None.
- Dependency changes: none.
- Security review: Not required (test support). `threat-model.md` section 8.
- Tasks:
  - **B-00.T1 Data folder, store opener, clock and ids.** Files: packages/runner/src/test-helpers/: `service-harness.ts` (new: `createRunnerService` on a temporary data folder made with `fs.mkdtemp` under the test's own folder and removed after, with the store opened by a helper that also gives the test the store handle; calls go through `createDispatcher` with caller `window` unless a test says otherwise), `clock.ts` (new: an injected clock that takes an IANA zone and an instant, and a counting id generator such as `run-000000000001` and `ap-000000000001`), `time-zone.ts` (new: `withTimeZone(zone, fn)` sets the process zone, runs `fn` and restores the old value in a `finally`). Tests: `service-harness.test.ts`, `clock.test.ts`, `time-zone.test.ts` (all new). Tests first: none cited (test support is exempt from the red run and has its own small tests). Gate: pnpm format, then pnpm check.
  - **B-00.T2 Fake notice sink and call recording.** Files: packages/runner/src/test-helpers/: `notice-sink.ts` (new: the fake notice sink that records every notice); packages/fixtures/src/: `client.ts` (`FixtureRunnerClient` records every call in `client.calls`, an array of `{operation, input}` in call order; every call still goes through `client.call`, so existing `vi.spyOn(client, "call")` tests keep working). Tests: `notice-sink.test.ts` (new), `client-calls.test.ts` (new). Tests first: none cited (test support). B-01.T5 freezes today's client on the version 1 island and B-01.T8 gives the version 2 client the same `calls` list. Gate: pnpm format, then pnpm check.
  - **B-00.T3 Fake brain.** Files: packages/runner/src/test-helpers/: `fake-brain.ts` (new: scripted chat-turn answers as JSON intents with a call counter, no agent process). Tests: `fake-brain.test.ts` (new). Tests first: none cited (test support). Gate: pnpm format, then pnpm check.
  - **B-00.T4 Injected agent profiles and the fake codex.** Files: packages/runner/src/test-helpers/: `agent-profiles.ts` (new: the argv shapes, sign-in status output, model list and install command of an agent as values a test injects; synthetic, written by hand from the agents' public help and documentation, never a recording), `fake-codex.ts`, `fake-codex-script.ts` (new: a fake Codex command line driven by a profile). Tests: `agent-profiles.test.ts`, `fake-codex.test.ts` (new). Tests first: none cited (test support). Until the research (B-21.T4, B-22.T1) fixes the real flags and commands, a case asserts the exact value its profile gives. Gate: pnpm format, then pnpm check.
  - **B-00.T5 Fixture scan.** Files: apps/desktop/src/test/: `repo-rules.ts` (new: `findPrivateTraces(text)`); apps/desktop/src/: `repo-checks.test.ts` (new: every tracked file under the fixture and test-helper folders holds no local path, no `@` address other than `example.test` or `example.com`, and no long token). Tests: `repo-checks.test.ts`. Tests first: TC-REPO-11. Gate: pnpm format, then pnpm check.
  - **B-00.T6 Design-set checks.** Files: apps/desktop/src/: `design-set.test.ts` (new: every `NF-` id of `docs/design/prd.md` has a line in the NF coverage table of `docs/design/test-plan.md`; no case's Given names a case whose build step comes later, read from the order table of section 3 of this file). Tests: `design-set.test.ts`. Tests first: TC-REPO-12, TC-REPO-13. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click. The Chair shows the harness tests passing, and `pnpm check` failing on a fixture that holds a local path (then removed).
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-01 Contract version 2

- Release: V1.
- Goal: The runner API contract version 2 exists in `packages/contracts`: states, read models, cards, the 45 live operations with their table fields (and the 12 retired entries), the version check, and a fixture client that answers every operation.
- Depends on: B-00.
- Prototype gate: All V1 journeys (j01, j12, j20 to j25, j27 to j31), because the contract fixes every operation, card and state they use. No PU item of its own: nothing is shown to a person, and each PU behaviour the contract carries is approved before the step that builds it.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: new decision and run states and the person-only operations.
- Tasks:
  - **B-01.T1 Shared types, states and read models.** Files: packages/contracts/src/: `common.ts`, `run.ts`, `approval.ts`, `flow.ts`, `settings.ts`. Tests: `common.test.ts` (new), `run.test.ts`, `approval.test.ts`, `flow.test.ts`, `settings.test.ts`. Adds `Line`, `Place`, `ModelId`, run states `stopped` and `needs_login`, decision states `approved_edited` and `allowed_always`, flow states `new`, `changed`, `confirmed`. Tests first: TC-CON-10, TC-CON-11, TC-CON-12, TC-CON-13, TC-CON-14, TC-CON-16, TC-CON-20, TC-CON-23, TC-CON-25, TC-CON-26, TC-CON-35. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-01.T2 Chat, card, start and rule schemas.** Files: packages/contracts/src/: `chat.ts`, `card.ts`, `starts.ts`, `rules.ts` (all new). Tests: `chat.test.ts`, `card.test.ts`, `starts.test.ts` (all new). Card types and card actions of runner-api section 8. Tests first: TC-CON-15, TC-CON-17, TC-CON-18, TC-CON-19, TC-CON-22, TC-CON-37, TC-CON-40. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-01.T3 Agent, activity, search, skill, window and notice schemas.** Files: packages/contracts/src/: `agents.ts`, `activity.ts`, `search.ts`, `skills.ts`, `window.ts` (all new: `WindowPrefs` is `{colorMode, platform}`), `notice.ts` (a notice's `title` and `body` are fixed `Line` values with no params). Tests: `agents.test.ts` (new), `activity.test.ts` (new), `window.test.ts` (new), `notice.test.ts`. Tests first: TC-j01-10, TC-CON-21, TC-CON-24, TC-CON-27, TC-CON-31. Gate: pnpm format, then pnpm check.
  - **B-01.T4 Operation table version 2.** Files: packages/contracts/src/: `operations.ts` (45 live operations with `reasons`, `reads`, `writes`, `mcp`, `phone`, `personOnly`; no `flows.duplicate` and no `starts.next`), `client.ts` (`RunnerClient` version 2), `wire.ts`. Tests: `operations.test.ts`, `operations-v2.test.ts` (new), `client.test.ts`, `wire.test.ts`, `jitless.test.ts`. Tests first: TC-j12-34, TC-j21-32, TC-j24-38, TC-j26-04, TC-j28-43, TC-SR2-01, TC-CON-02, TC-CON-03, TC-CON-04, TC-CON-05, TC-CON-06, TC-CON-07, TC-CON-08, TC-CON-09, TC-CON-28, TC-CON-29, TC-CON-30, TC-CON-32, TC-CON-36. The existing `operations.test.ts`, which snapshots the version 1 table, is rewritten in this task. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-01.T5 Freeze version 1 and mark the retired operations.** Files: packages/contracts/src/v1/ (new: a read-only copy of contract version 1 and its `RunnerClient`), packages/fixtures/src/v1/ (new: the version 1 sample data and fixture client), `packages/contracts/src/operations.ts` (the 12 retired operations stay as retired entries; the real runner answers them `unavailable` with reason `retired`). Tests: the existing tests of the builder-first screens keep passing against the island; `operations-v2.test.ts` checks the retired entries. Tests first: TC-CON-39. No test is deleted. Gate: pnpm format, then pnpm check.
  - **B-01.T6 Contract version and the version check.** Files: packages/contracts/src/: `version.ts` (`CONTRACT_VERSION = 2`), `client.ts` (the client path refuses another version). Tests: `version.test.ts` (new), `client.test.ts`. Tests first: TC-j01-11, TC-CON-01, TC-CON-34. Gate: pnpm format, then pnpm check.
  - **B-01.T7 Main and renderer IPC checks.** Files: apps/desktop/electron/: `runner-ipc.ts`, `runner-link.ts` (asks `runner.info` first, refuses a mismatch, restarts at most three times in 60 seconds; exit codes 5 and 6 are not restarted); apps/desktop/src/runner/: `ipc-client.ts`. Tests: `runner-ipc.test.ts`, `runner-link.test.ts`, `ipc-client.test.ts`. Tests first: TC-IPC-08, TC-IPC-09, TC-IPC-10, TC-IPC-11, TC-IPC-12, TC-IPC-13, TC-IPC-15, TC-IPC-16, TC-IPC-18, TC-IPC-19, TC-IPC-20. Gate: pnpm format, then pnpm check.
  - **B-01.T8 Fixture client version 2.** Files: packages/fixtures/src/: `client.ts` (implements all 45 live operations in memory with the real rules and keeps the `calls` list of B-00.T2), `index.ts`. Tests: `client.test.ts` (parity with the contract: same shapes for the same calls, runner-api section 14). Tests first: TC-IPC-22. Gate: pnpm format, then pnpm check.
  - **B-01.T9 Chat-first sample data.** Files: packages/fixtures/src/story-v2/ (new): flows Build APK and upload it, Fill timesheet, Weekly supplier report, Email triage, Job review (generic, product-neutral names); chats; runs; decisions; settings. This is the `story-v2` part of Harness H. Tests: `story-v2.test.ts` (new; every record validates against the contract). Tests first: TC-CON-33. Gate: pnpm format, then pnpm check.
  - **B-01.T10 Dispatcher and `runner.info`.** Files: packages/runner/src/service/: `handlers.ts` (`createDispatcher` tags each call with its caller, refuses a person-only operation from a tool or phone caller, answers retired names `unavailable`, audits handler errors), `runner.info`. Tests: `handlers.test.ts`. Tests first: TC-SR2-02, TC-SR2-19, TC-SR7-10, TC-AGT-32, TC-ENG-25. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-01.T11 Source rules: no network, no raw HTML.** Files: packages/runner/src/: `source-rules.test.ts`, `test-helpers/network-rules.test.ts` (new: V1 runner and main import no network module). Tests: the two files. Tests first: TC-REPO-07, TC-REPO-08. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click. The Chair shows the contract tests passing, the list of 45 live operations and 12 retired entries, and the old screens still passing their tests on the frozen version 1 island.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-02 Flow format 1.2

- Release: V1.
- Goal: A flow file can declare typed inputs, a result, touches and a person-facing schedule in format 1.2; format 1.1 flows still load with the same hash.
- Depends on: B-00.
- Prototype gate: j20, j21, j22, j27, j28 (the inputs, result, touches and schedule they show). No PU item of its own.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (flow hashing). Focus: T-02, T-09, T-10. Why: touches and places are hashed.
- Tasks:
  - **B-02.T1 Input types.** Files: packages/sdk/src/: `format/inputs.ts` (new: `time`, `duration`, `longtext`, `choice`, `example`, `remember`, default codes `today` and `now`), `format/manifest.ts`, `vocab.ts` (the format id accepts 1.1 and 1.2). Tests: `format/inputs.test.ts` (new), `format/manifest-v12.test.ts` (new). Tests first: TC-SR9-11, TC-SDK-01, TC-SDK-02, TC-SDK-03, TC-SDK-04, TC-SDK-05, TC-SDK-06, TC-SDK-16, TC-SDK-17. Gate: pnpm format, then pnpm check.
  - **B-02.T2 Result and touches.** Files: packages/sdk/src/: `format/result.ts` (new), `format/touches.ts` (new), `validate/validate.ts` (each touch is checked against the requirements). Tests: `format/result.test.ts` (new), `format/touches.test.ts` (new), `validate/validate-v12.test.ts` (new). Tests first: TC-SR2-08, TC-SR3-02, TC-SDK-07, TC-SDK-08, TC-SDK-09, TC-SDK-10, TC-SDK-11, TC-SDK-19. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-02.T3 Schedule.** Files: packages/sdk/src/: `format/schedule.ts` (new: manual, daily, weekdays, weekly, after, `whenItsTime`), mapped onto the existing `schedule` and `flow_done` triggers. Tests: `format/schedule.test.ts` (new). Tests first: TC-j28-01, TC-SDK-12, TC-SDK-13, TC-SDK-14. Gate: pnpm format, then pnpm check.
  - **B-02.T4 Hash and loading.** Files: packages/sdk/src/: `hash/canonical.ts` (the 1.2 fields are part of the hash; a 1.1 flow hashes byte for byte as before), `load/` (loaders). Tests: `format/hash-v12.test.ts` (new), `load/load-v12.test.ts` (new), the existing hash tests unchanged. Tests first: TC-SDK-15, TC-SDK-18. Flow hashing change. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-02.T5 Runner import and mapping.** Files: packages/runner/src/service/: `map-flow.ts` (maps to the version 2 flow read model), `handlers.ts` (`flows.import` output; a flow file cannot turn a schedule on). Tests: `handlers.test.ts`. Tests first: TC-j28-46. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click. The Chair shows a sample 1.2 flow file loading and hashing, and the M1 flow in format 1.1 loading with its old hash.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-03 Store version 7 and migration

- Release: V1.
- Goal: The store is version 7: new tables, an additive and backed-up migration from version 6, and the new settings keys with their defaults.
- Depends on: B-01, B-02.
- Prototype gate: j12, j20, j21, j22, j24, j27, j28 (the data they keep). No PU item.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: confirmations replace the old consents.
- Tasks:
  - **B-03.T1 Schema and store version 7.** Files: packages/runner/src/: `schema.ts` (`SCHEMA_V7`), `sqlite-store.ts`, `storage.ts` (the new tables and indexes of data-model section 4). Tests: `sqlite-store-v7.test.ts` (new). Tests first: TC-SR6-04, TC-SR7-02, TC-STO-15, TC-STO-17, TC-STO-18, TC-STO-19, TC-STO-26, TC-STO-38. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-03.T2 Version 6 fixture, backup and failures.** Files: packages/runner/src/: `test-helpers/store-v6.ts` (new), `migrate.ts` (new: lock, version read, `VACUUM INTO` backup, failures). Tests: `migrate.test.ts` (new), data-model section 5.4 tests 2 to 6, 13, 15 (no TC ids). Tests first: TC-STO-01, TC-STO-03, TC-STO-04, TC-STO-05, TC-STO-06, TC-STO-07, TC-STO-14, TC-STO-16. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-03.T3 Migration steps 3 to 10.** Files: packages/runner/src/: `migrate.ts`, `schema.ts`. Tests: `migrate.test.ts`, data-model section 5.4 tests 1, 7 to 12, 14 (no TC ids). Tests first: TC-SR2-12, TC-SR3-12, TC-STO-02, TC-STO-08, TC-STO-09, TC-STO-10, TC-STO-11, TC-STO-12, TC-STO-13. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-03.T4 Store access for the new entities.** Files: packages/runner/src/: `storage.ts`, `sqlite-store.ts` (flow heads, confirmations, standing rules for `local_write`, `run_command` and `change` only, call grants, schedules without any first-run field, starts, chats, messages, drafts, waiting questions, remembered answers with the `outside` mark). Tests: `sqlite-store-v7.test.ts`. Tests first: TC-SR3-01, TC-ENG-19, TC-ENG-23, TC-STO-20, TC-STO-21, TC-STO-22, TC-STO-23, TC-STO-24, TC-STO-25, TC-STO-27. The store refuses a rule for another effect (`rule_effect_not_allowed`) and a place of the wrong kind for its effect (`rule_place_not_allowed`). Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-03.T5 Settings keys and defaults.** Files: packages/runner/src/service/: `handlers.ts`, `settings.ts` (new: `language`, `agentPermission`, `mainAgent`, `busyFallback`, `spendingLimit`; there is no `background` key). Tests: `handlers.test.ts`. Tests first: TC-j12-32, TC-j12-36, TC-j28-40, TC-STO-28. Gate: pnpm format, then pnpm check.
  - **B-03.T6 Retention, exit codes and secure delete.** Files: packages/runner/src/: `retention.ts` (new), `service/run-process.ts`, `main.ts` (exit codes 5 and 6), apps/desktop/electron/: `runner-link.ts`. The delete handlers that use the secure delete are built in B-05.T10 and B-07.T7. Tests: `retention.test.ts` (new), `runner-link.test.ts`. Tests first: TC-IPC-17, TC-STO-29, TC-STO-30, TC-STO-31, TC-STO-32, TC-STO-33. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click. The Chair shows a version 6 data folder (made by the fixture) opening as version 7: the backup file, unchanged row counts and the `store_migrated` audit line.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-04 Safety core: the decision function

- Release: V1.
- Goal: One decision function (SR-1) decides run, hold or refuse for every action from the confirmed flow version, standing rules and one-time grants.
- Depends on: B-01, B-02, B-03.
- Prototype gate: j20, j24. PU-22 (the rule that a step which can send never resumes by itself; the run page line is built in B-19).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: `decide` becomes the single decision point.
- Tasks:
  - **B-04.T1 Effect classes and the policy compiler.** Files: packages/runner/src/claude/: `effects.ts` (new: FlowDriven's catalog; an unknown tool counts as `change`), `policy.ts` (policy compiled from the confirmed version, its touches and requirements). Tests: `effects.test.ts` (new), `policy.test.ts`. Tests first: TC-SR1-04, TC-SR1-05, TC-SR1-12, TC-SR1-39, TC-SR5-13, TC-SR5-14, TC-SR5-18, TC-RUL-17. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-04.T2 The decision function.** Files: packages/runner/src/claude/: `decide.ts` (order of AD-06: refuse what is not declared, classify, read, declared writes and commands, exact grant, exact rule, otherwise hold). Tests: `decide.test.ts`. Tests first: TC-j24-15, TC-j24-48, TC-SR1-01, TC-SR1-02, TC-SR1-03, TC-SR1-06, TC-SR1-07, TC-SR1-08, TC-SR1-21, TC-RUL-11, TC-RUL-12, TC-RUL-25. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-04.T3 One-time grants.** Files: packages/runner/src/: `rules/decisions.ts` (new: grant bound to run, step, tool and input digest), `exec/held.ts`. Tests: `rules/decisions.test.ts` (new), `exec/grants-v2.test.ts` (new). Tests first: TC-j24-05, TC-ENG-20. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-04.T4 Run and step states for version 2.** Files: packages/runner/src/: `states.ts` (`stopped`, `needs_login`), `exec/recovery.ts` (a step that can send, post, pay, delete or merge never resumes by itself). Tests: `states.test.ts`, `exec/recovery-v2.test.ts` (new), `engine-reject.test.ts` (new), `engine-needs-login.test.ts` (new). Tests first: TC-ENG-01, TC-ENG-02, TC-ENG-03, TC-ENG-04, TC-ENG-05, TC-ENG-06, TC-ENG-12, TC-ENG-14, TC-ENG-17, TC-ENG-18, TC-ENG-21. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-04.T5 The hook channel fails closed.** Files: packages/runner/src/claude/: `hook-script.ts`, `channel.ts`. Tests: `hook-script.test.ts`, `channel.test.ts`, `review-r15-forged-allow.test.ts`; the existing `review-*.test.ts` files stay unchanged. Tests first: TC-SR1-31, TC-SR1-32, TC-SR1-33, TC-SR1-34, TC-SR1-35. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-04.T6 The decision function end to end on the fake claude.** Files: packages/runner/src/claude/: `run.ts`, `adapter.ts`. Tests: `adapter-limits.test.ts`, `adapter-held.test.ts` (new), `review-r15-injection.test.ts` (new). Tests first: TC-SR1-25, TC-SR1-26, TC-SR1-27, TC-SR4-14, TC-SR5-11, TC-SR7-04. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click. The Chair shows the decision table passing: each effect class gives run, hold or refuse, and a near-miss rule or grant still holds.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-05 Decisions and standing rules

- Release: V1.
- Goal: A held call becomes one decision shown everywhere; Approve, Edit, Reject, Approve all similar, Always allow and Ask me again work and are on the record; Stop and the permission switch end runs; deleting a flow ends its rules.
- Depends on: B-03, B-04.
- Prototype gate: j24 (and j20, j21 for the cards and rules). PU items to approve first: PU-15, PU-16, PU-17, PU-18. Nothing else is new.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: Reject skipping, expiry, standing rules.
- Tasks:
  - **B-05.T1 A held call becomes one decision.** Files: packages/runner/src/: `rules/decisions.ts`, `exec/held.ts`, `engine.ts`, service/`handlers.ts` (`approvals.list`), service/`notify-wiring.ts`. Tests: `rules/decisions.test.ts`, `engine-held.test.ts`. Tests first: TC-j20-30, TC-j24-01, TC-j24-04, TC-j24-06, TC-j24-35, TC-j24-41, TC-j24-42, TC-j24-47, TC-j24-51, TC-SR1-23, TC-SR5-09, TC-SR5-15, TC-SR7-03, TC-RUL-02, TC-RUL-22. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T2 Approve, Edit and choices.** Files: packages/runner/src/: `rules/decisions.ts`, `exec/ask.ts`, service/`handlers.ts` (`approvals.resolve`, `approvals.answer`). Tests: `rules/decisions.test.ts`, `engine-ask.test.ts`. Tests first: TC-j20-28, TC-j24-23, TC-j24-24, TC-j24-26, TC-j24-27, TC-j24-28, TC-j24-31, TC-j24-44, TC-j24-46, TC-SR1-28, TC-RUL-01, TC-RUL-03, TC-RUL-05, TC-RUL-06, TC-RUL-21. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T3 Reject skips the action; expiry counts as Reject.** Files: packages/runner/src/: `engine.ts`, `exec/held.ts`, `exec/recovery.ts`, `rules/decisions.ts`. Tests: `rules/decisions.test.ts`, `engine-held.test.ts`, `engine-recovery.test.ts`, `engine-reject.test.ts`. Tests first: TC-j24-08, TC-j24-29, TC-j24-30, TC-j24-32, TC-SR1-17, TC-SR1-18, TC-SR1-19, TC-SR1-20, TC-SR8-06, TC-SR8-09, TC-ENG-15, TC-ENG-16, TC-RUL-04, TC-RUL-07, TC-RUL-26. Replaces today's rule that a rejected action fails the run; the existing tests that pin the old rule are rewritten, not deleted. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T4 Approve all similar.** Files: packages/runner/src/: `rules/decisions.ts`, service/`handlers.ts` (`approvals.resolveSimilar`). Tests: `rules/decisions.test.ts`. Tests first: TC-j24-19, TC-j24-20, TC-j24-21, TC-SR1-24, TC-RUL-19, TC-RUL-20. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T5 Standing rules: the exact match.** Files: packages/runner/src/: `rules/standing.ts` (new: standing rules exist only for `local_write`, `run_command` and `change`; the place kind per effect is `account` or `folder` for `change`, `folder` for `local_write` and `command` for `run_command`), `rules/decisions.ts`, service/`handlers.ts` (`rules.list`, `rules.revoke`, `always_allow`). Tests: `rules/standing.test.ts` (new), `rules/decisions.test.ts`. Tests first: TC-j20-31, TC-j20-32, TC-j20-33, TC-j21-31, TC-j24-18, TC-SR1-09, TC-SR1-10, TC-SR1-11, TC-SR1-29, TC-SR1-30, TC-SR1-47. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T6 Always allow and Ask me again.** Files: packages/runner/src/: `rules/standing.ts`, `rules/decisions.ts`, service/`handlers.ts` (`rules.list`, `rules.revoke`, `always_allow`: `canAlwaysAllow` is true only for a pending `risky_action` decision whose effect is `change` at a fixed place, from the window; send, post, pay, delete and merge never get a standing rule). Tests: `rules/decisions.test.ts`, `service/decisions-handlers.test.ts`, `service/rules-handlers.test.ts`. Tests first: TC-j24-11, TC-j24-12, TC-j24-14, TC-j24-16, TC-j24-50, TC-SR1-15, TC-SR1-16, TC-SR1-45, TC-RUL-08, TC-RUL-09, TC-RUL-13, TC-RUL-14. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T7 Stop and the permission switch.** Files: packages/runner/src/: `engine.ts` (stop ends the process group, expires decisions, starts the next queued run), service/`handlers.ts` (`runs.stop`, `settings.update {agentPermission}`). Tests: `engine-stop.test.ts` (new), `rules/decisions.test.ts`. Tests first: TC-j24-33, TC-j24-34, TC-j25-21, TC-SR8-01, TC-SR8-03, TC-ENG-07, TC-ENG-08, TC-ENG-09, TC-ENG-10. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T8 Who may decide, and the record.** Files: packages/runner/src/: service/`handlers.ts`, `rules/decisions.ts`, audit writers. Tests: `rules/decisions.test.ts`. Tests first: TC-j20-35, TC-j24-36, TC-j24-37, TC-j24-39, TC-SR7-01, TC-SR8-07, TC-RUL-10. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T9 Confirm writes the standing rules.** Files: packages/runner/src/service/: `flows.ts` (new: `flows.confirm` with `onItsOwn`; a rule for each non-read touch left under Does on its own; a risky kind in `onItsOwn` is refused with `not_allowed`, reason `always_asks`; a re-confirm keeps, ends or revokes rules). Tests: `flows-handlers.test.ts`. Tests first: TC-j24-49, TC-RUL-15, TC-RUL-16, TC-RUL-18. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-05.T10 Delete a flow.** Files: packages/runner/src/service/: `flows-delete.ts` (new: `flows.delete` refuses a flow that has a running run (`conflict`, reason `flow_running`); otherwise it ends the flow's rules, stops its queued and paused runs and expires their decisions, closes its question, turns the schedules that follow it to manual and writes `flow_deleted`), `handlers.ts`. Tests: `service/flows-handlers.test.ts` (extended), `service/rules-handlers.test.ts`. Tests first: TC-SR8-11, TC-RUL-24, TC-STO-34. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing new to click (decisions get screens in B-17 and B-19). The Chair shows a scripted run on the fake claude: a held call waits as one decision; Approve runs it once; Reject skips it and the run goes on; Always allow stores one rule; Ask me again ends it; the audit log tells each in plain words.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-06 Words and languages

- Release: V1.
- Goal: The app has one words file per language (English and Bahasa Indonesia) in `apps/desktop/src/i18n/`, a check that keeps them in step, and the runner sends codes and `Line` values only.
- Depends on: B-01, B-03.
- Prototype gate: j30 (and the language parts of j01, j12, j31). No PU item.
- Ask first: None.
- Dependency changes: none.
- Security review: Recommended. Why: safety words need a second reader (T-28).
- Tasks:
  - **B-06.T1 Words core.** Files: apps/desktop/src/i18n/: `t.ts`, `plural.ts`, `languages.ts`, `en.ts` (key skeleton) (all new). Tests: `t.test.ts`, `plural.test.ts`, `languages.test.ts` (all new). Placeholders `{name}`, plural forms with `Intl.PluralRules`, English fallback. Tests first: TC-j30-03, TC-j30-18, TC-j30-19, TC-I18N-01, TC-I18N-02, TC-I18N-03, TC-I18N-04, TC-I18N-05, TC-I18N-06, TC-I18N-07, TC-I18N-08. Gate: pnpm format, then pnpm check.
  - **B-06.T2 Dates, times and numbers.** Files: apps/desktop/src/i18n/: `when.ts` (new). Tests: `when.test.ts` (new), including `Asia/Bangkok` (UTC+07:00, no daylight saving) and a daylight-saving change in `Europe/Amsterdam`, with the zone passed as an argument. Tests first: TC-j30-15, TC-j30-16, TC-j30-17, TC-I18N-09, TC-I18N-10, TC-I18N-11, TC-I18N-12. Gate: pnpm format, then pnpm check.
  - **B-06.T3 English and Indonesian words.** Files: apps/desktop/src/i18n/: `en.ts` (every word of the prototype), `id.ts`, `status.ts` (words for every state and touch rule code). Tests: `status.test.ts` (new), `id.test.ts` (new). Tests first: TC-j30-23, TC-j30-24. Gate: pnpm format, then pnpm check.
  - **B-06.T4 The language check, part 1.** Files: apps/desktop/src/i18n/: `i18n.test.ts` (new; run by `pnpm test`; first half: completeness, keys, plural forms, language codes). Tests first: TC-j30-20, TC-j30-28, TC-j30-29, TC-j30-30, TC-I18N-13, TC-I18N-14, TC-I18N-15, TC-I18N-16, TC-I18N-17, TC-I18N-18, TC-I18N-19, TC-I18N-20, TC-I18N-21, TC-I18N-22. Gate: pnpm format, then pnpm check.
  - **B-06.T5 The language check, part 2.** Files: apps/desktop/src/i18n/: `i18n.test.ts` (second half: hidden characters, markup, web addresses, placeholders, one sentence per key, one line per finding, plain words in both languages (NF-54: the forbidden words, run ids and version numbers, with an explicit allowlist), the real tree). The check is the file itself; it adds no script. Tests first: TC-j30-21, TC-j30-31, TC-j30-32, TC-I18N-23, TC-I18N-24, TC-I18N-25, TC-I18N-26, TC-I18N-27, TC-I18N-28, TC-I18N-29, TC-I18N-30, TC-I18N-32, TC-I18N-35. Gate: pnpm format, then pnpm check.
  - **B-06.T6 Language setting and spawn argument.** Files: packages/runner/src/: `main.ts` (`--languages=en,id` read at start), service/`handlers.ts` (`settings.update {language}`; an unknown code counts as English); apps/desktop/electron/: `runner-link.ts` (passes the registered codes). Tests: `handlers.test.ts`, `main.test.ts`. Tests first: TC-j30-01, TC-j30-06, TC-j30-07, TC-j30-35, TC-j30-36, TC-AGT-30, TC-AGT-40, TC-ELE-28, TC-I18N-33, TC-I18N-34. Gate: pnpm format, then pnpm check.
  - **B-06.T7 Line keys and notices.** Files: packages/contracts/src/: `line-keys.ts` (new: the keys the runner emits, with the `notice.*` keys); packages/runner/src/notify/: `policy.ts` (a notice carries a fixed `Line` with no params, never a title, a flow name or a payload); apps/desktop/electron/: `notifier.ts` (main draws notices from the words files, in the app language of the moment). Tests: `line-keys.test.ts` (new, contracts and runner), `notifier.test.ts`; `i18n.test.ts` checks that every key in `line-keys.ts` exists in `en.ts`. Tests first: TC-j30-26, TC-AST-36, TC-CON-38, TC-ELE-18. Gate: pnpm format, then pnpm check.
  - **B-06.T8 Repository checks and fixtures.** Files: apps/desktop/src/: `repo-checks.test.ts` (extended: the dependency gate refuses a new package, no workspace folder or `package.json` in the words folder, look-alike names and install hooks, hidden characters in code or a words file); packages/fixtures/src/: `no-secrets.test.ts` (new). No file of `tools/checks/` changes. Tests first: TC-SR6-06, TC-REPO-01, TC-REPO-02, TC-REPO-03, TC-REPO-04. Gate: pnpm format, then pnpm check.
  - **B-06.T9 Both-languages wrapper and the CSS guards.** Files: apps/desktop/src/test/: `render.tsx` (`renderAppBoth(hash, options, body)` runs one test body in English and in Bahasa Indonesia; `BOTH_LANGUAGES_SCREENS` lists the screens that must use it); apps/desktop/src/: `layout-guards.test.ts` (extended: CSS-guard tests find every `.css` file under `apps/desktop/src/` by a glob). Tests: `render-both.test.tsx` (new), `layout-guards.test.ts`. Tests first: none cited (test support, with its own small tests; the screens that use it fail the list check until they do). Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click yet. The Chair shows `pnpm test` failing when an Indonesian word, placeholder or plural form is missing, and passing on the real files.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-07 AI agents, models and the one permission

- Release: V1.
- Goal: The runner knows its agents behind one port, sets them up in one click, runs each chat and run on the chosen model through the model flag only, and obeys the one agent permission.
- Depends on: B-00, B-01, B-03, B-05, B-21.T4 (the research of the agents' install and sign-in details, needed by T5 and T6).
- Prototype gate: j01, j12, j25, j31. PU items to approve first: PU-01, PU-02, PU-27 (the runner side; the screens are built in B-21 and B-17).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (sandbox limits). Focus: T-12, T-18, T-19. Why: the model flag only; install commands run without a shell.
- Tasks:
  - **B-07.T1 Agent port and registry.** Files: packages/runner/src/: `agents/registry.ts` (new: `detect`, `signInStatus`, `agents.list`, `agents.rescan`), `harness.ts` (the `AgentAdapter` port), `claude/adapter.ts`. Tests: `agents/registry.test.ts` (new). Tests first: TC-j01-05, TC-j01-18, TC-j01-25, TC-SR6-07, TC-AGT-01, TC-AGT-02, TC-AGT-03, TC-AGT-04. Gate: pnpm format, then pnpm check.
  - **B-07.T2 Models.** Files: packages/runner/src/: `agents/models.ts` (new: each agent's own list, a cache, a model that goes away), `claude/run.ts` (one model for every call of a run). Tests: `agents/models.test.ts` (new), `claude/run-model.test.ts` (new), `contracts/src/agents.test.ts`. Tests first: TC-SR4-05, TC-AGT-13, TC-AGT-14, TC-AGT-33. Sandbox limits: no flag other than the model flag. Gate: pnpm format, then pnpm check.
  - **B-07.T3 The model flag only.** Files: packages/runner/src/claude/: `args.ts` (the picker changes only the model flag; every bypass flag is refused), `env.ts`, `scan.ts` (a build without a required flag is too old). Tests: `args.test.ts`, `adapter-model.test.ts` (new), `model-flag.test.ts` (new), `env.test.ts`, `scan.test.ts`. Tests first: TC-j31-19, TC-j31-20, TC-j31-24, TC-SR4-01, TC-SR4-02, TC-SR4-07, TC-SR6-01, TC-AGT-17, TC-AGT-18. Sandbox limits: no flag other than the model flag. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-07.T4 One permission and the start proof.** Files: packages/runner/src/: service/`claude-harness.ts` (the consent gate becomes the one permission; the existing consent tests are rewritten, not deleted), `agents/registry.ts`, `claude/run.ts`. Tests: `agents/registry.test.ts`, `claude/adapter-limits.test.ts`. Tests first: TC-j25-43, TC-j31-33, TC-SR4-11, TC-AGT-16, TC-AGT-28, TC-AGT-29, TC-AGT-31. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-07.T5 Set up: permission, install and the catalog command.** Depends on: B-21.T4. Files: packages/runner/src/: `agents/setup.ts` (new), `agents/catalog.ts` (new: install commands from the research, run with no shell and no bypass flag; a test injects the agent profile of B-00.T4 until B-21.T5 pins the real values), service/`handlers.ts` (`agents.setUp`, `agents.signIn`, `agents.models`). Tests: `agents/setup.test.ts` (new), `agents/no-network.test.ts` (new). Tests first: TC-j01-06, TC-j01-07, TC-j01-08, TC-j01-19, TC-j01-21, TC-j01-31, TC-SR6-08, TC-AGT-05, TC-AGT-06, TC-AGT-08, TC-AGT-09. The only network action FlowDriven starts is the agent's own installer, run after the person chooses Set up. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-07.T6 Sign-in wait, Scan again and restarts.** Depends on: B-21.T4. Files: packages/runner/src/: `agents/setup.ts` (the 10-minute sign-in wait polled every 2 seconds, Sign in, a restart that never resumes an install), service/`handlers.ts` (`agents.signIn`, `agents.rescan`). Tests: `agents/setup.test.ts`. Tests first: TC-j01-09, TC-j01-23, TC-j01-27, TC-j01-28, TC-AGT-07, TC-AGT-10, TC-AGT-11, TC-AGT-12. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-07.T7 The chat's agent and model.** Files: packages/runner/src/service/: `chats.ts` (new: `chats.create`, `chats.get`, `chats.delete`, `chats.setAgent`; a model that is no longer offered gives the note of PU-27), `handlers.ts`. Tests: `chats-agent.test.ts` (new). Tests first: TC-j12-16, TC-j12-17, TC-j31-01, TC-j31-06, TC-j31-23, TC-j31-28, TC-j31-31, TC-j31-35, TC-SR4-06, TC-SR7-11, TC-AST-25, TC-AST-26, TC-STO-35. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing new to click. The Chair shows: agents found with their states, Set up on a fake agent (permission, install, sign-in wait, ready), and two runs whose command lines differ only in the model value.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-08 The assistant: chats and chat turns

- Release: V1.
- Goal: A chat message is stored at once and answered by one agent call with no tools; FlowDriven validates the answer and turns it into messages and cards; nothing starts that was not asked.
- Depends on: B-05, B-06, B-07.
- Prototype gate: j20, j22, j27, j30, j31. PU items to approve first: PU-04 (the empty app and its two starter chips), PU-05 ("I did not understand that. Try again, or pick one of these."), PU-07 (the permission-off refusal with "Turn on permission").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: the assistant's cards; the source rule keeps `assistant/` away from every writer of permissions.
- Tasks:
  - **B-08.T1 The source rule.** Files: packages/runner/src/: `assistant/source-rules.test.ts` (new: `assistant/` imports neither the dispatcher nor the writers of confirmations, decisions, rules, schedules or settings). The fake brain is built in B-00.T3. Tests: `assistant/source-rules.test.ts` (new), `source-rules.test.ts`. Tests first: TC-SR2-04, TC-AST-22. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-08.T2 Chats service.** Files: packages/runner/src/service/: `chats.ts` (extended: `chats.list`, `chats.send` stores at once and runs one turn at a time per chat, `chats.setComposer`; `chats.get` and `chats.delete` are built in B-07.T7), `handlers.ts`. Tests: `assistant/turn.test.ts` (new). Tests first: TC-j20-01, TC-j20-02, TC-j20-42, TC-j30-10, TC-AST-13, TC-AST-17, TC-AST-18, TC-AST-24, TC-AST-27, TC-AST-28. Gate: pnpm format, then pnpm check.
  - **B-08.T3 Turn context.** Files: packages/runner/src/assistant/: `context.ts` (new: compact context, outside text marked outside, the standing instruction about language). Tests: `context.test.ts` (new). Tests first: TC-j20-07, TC-j20-22, TC-j30-08, TC-SR5-01, TC-SR6-09, TC-AST-08, TC-AST-09. Gate: pnpm format, then pnpm check.
  - **B-08.T4 Intents and the validator.** Files: packages/runner/src/assistant/: `intents.ts` (new: the intents of AD-10 checked against FlowDriven's own state; no intent changes the agent, model, language or a setting; "What needs me?" answers "Nothing is waiting for you." through `chat.nothingWaiting`, and a request for a flow that does not exist offers Make a new flow). Tests: `intents.test.ts` (new), `turn.test.ts`. Tests first: TC-j12-35, TC-j20-08, TC-j20-20, TC-j20-21, TC-j20-59, TC-j20-61, TC-j30-25, TC-j31-25, TC-j31-26, TC-SR2-05, TC-AST-02. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-08.T5 The turn: one call, no tools.** Files: packages/runner/src/assistant/: `turn.ts` (new: JSON schema, the chat's agent and model, retry limit, quota and crash handling), service/`chats.ts` (`chats.act`: `retry_turn`). Tests: `turn.test.ts`. Tests first: TC-j20-06, TC-j20-09, TC-j22-24, TC-j22-28, TC-j22-29, TC-SR8-10, TC-AST-01, TC-AST-10, TC-AST-11, TC-AST-12, TC-AST-32, TC-AST-33, TC-AST-34. Gate: pnpm format, then pnpm check.
  - **B-08.T6 Not ready and permission off.** Files: packages/runner/src/assistant/: `turn.ts`, `cards.ts` (new: the readiness and permission cards with one button each; with the permission off `chats.send` answers `not_allowed` with reason `permission_off`, stores nothing, and the card says `chat.permissionOff` ("FlowDriven may not run your AI agents.") with the button "Turn on permission"). Tests: `turn.test.ts`, `service/chats-agent.test.ts`. Tests first: TC-j20-43, TC-j22-20, TC-j22-21, TC-j31-17, TC-j31-18, TC-SR2-11, TC-SR4-12, TC-AST-14, TC-AST-15. The rule itself is owned by the runner-level case in B-12.T5; these cases are thin. Gate: pnpm format, then pnpm check.
  - **B-08.T7 Typed words and run intents.** Files: packages/runner/src/assistant/: `turn.ts` (a name alone, a question, a negation or a mention gives a card, never a run; outside text in the context never starts a run; typed words never answer a card), `cards.ts`. Tests: `turn.test.ts`, `cards.test.ts` (new). Tests first: TC-j20-23, TC-j20-41, TC-j27-32, TC-SR2-06, TC-SR5-03, TC-SR5-04, TC-AST-04, TC-AST-05, TC-AST-07, TC-AST-20. Gate: pnpm format, then pnpm check.
  - **B-08.T8 Language rules, `chats.act` and pasted text.** Files: packages/runner/src/: service/`chats.ts` (`chats.act` common rules: only the window, only the card's own actions; a suggestion chip is sent as the person's own message), `assistant/turn.ts` (the chat's language is set only by the person's typed message; FlowDriven's own lines are `Line` values with the chat's language; pasted text is outside text; a request for a model or a flag changes nothing). Tests: `service/chats-act.test.ts` (new), `chats-handlers.test.ts`, `turn.test.ts`. Tests first: TC-j27-21, TC-j30-09, TC-j30-11, TC-SR2-07, TC-SR4-10, TC-SR5-02, TC-AST-06, TC-AST-23, TC-AST-29. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Nothing to click until B-17. The Chair shows a chat turn on the fake brain and, with the owner watching, on the real Claude Code through a walk script: a question gets an answer, a run request gets a card, a signed-out agent gets one card with one button.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-09 Flow inputs

- Release: V1.
- Goal: Flow inputs are filled by FlowDriven's own typed parsers in a fixed order; the chat asks one short question only for what is missing; a form and remembered answers work.
- Depends on: B-02, B-08.
- Prototype gate: j27, j20. PU items to approve first: PU-28 (the messages for hidden characters, the 4,000-character limit, numbers and choices).
- Ask first: None.
- Dependency changes: none.
- Security review: Recommended. Why: typed values from outside text (T-14, T-26).
- Tasks:
  - **B-09.T1 Typed parsers: dates, times, durations.** Files: packages/runner/src/inputs/: `parse.ts` (new: dates in the person's zone, times, durations, choices, numbers, text, files). Tests: `parse.test.ts` (new), `parse-zones.test.ts` (new). Tests first: TC-j27-06, TC-j27-07, TC-j27-08, TC-j27-09, TC-INP-01, TC-INP-02, TC-INP-03, TC-INP-04, TC-INP-05, TC-INP-06, TC-INP-07. Gate: pnpm format, then pnpm check.
  - **B-09.T2 Typed parsers: numbers, choices, text, files.** Files: packages/runner/src/inputs/: `parse.ts` (numbers with limits, choices, text and long text, files, folders, addresses, booleans, lists; hidden characters refused). Tests: `parse.test.ts`. Tests first: TC-j27-11, TC-j27-12, TC-SR6-05, TC-INP-08, TC-INP-09, TC-INP-10, TC-INP-11, TC-INP-12. Gate: pnpm format, then pnpm check.
  - **B-09.T3 Fill order and remembered answers.** Files: packages/runner/src/inputs/: `fill.ts` (new: message, then remembered, then default; never remembered dates or times), `remember.ts` (new: a remembered answer keeps an `outside` mark when its value came from outside text, until the person types or confirms it). Tests: `fill.test.ts` (new), `remember.test.ts` (new). Tests first: TC-j20-45, TC-j27-01, TC-j27-02, TC-j27-17, TC-j27-34, TC-SR5-06, TC-INP-13, TC-INP-14, TC-INP-15, TC-INP-16, TC-INP-17, TC-INP-23, TC-INP-24, TC-INP-26. Gate: pnpm format, then pnpm check.
  - **B-09.T4 One short question.** Files: packages/runner/src/assistant/: `cards.ts`, `turn.ts`; apps/desktop/src/screens/chat/: `inputsAsk.ts` (new: the question and chips as pure functions). Tests: `inputsAsk.test.ts` (new), `turn.test.ts`, `inputs/ask.test.ts` (new). Tests first: TC-j20-10, TC-j20-24, TC-j27-03, TC-j27-10, TC-j27-13, TC-j27-20, TC-INP-18, TC-INP-19, TC-INP-20, TC-INP-27, TC-INP-28. Gate: pnpm format, then pnpm check.
  - **B-09.T5 Answers in words and last answers.** Files: packages/runner/src/assistant/: `turn.ts`; inputs/`fill.ts` (values from outside text fill but never start; parsers decide whatever the agent returned). Tests: `turn.test.ts`. Tests first: TC-j27-04, TC-j27-05, TC-j27-18, TC-j27-19, TC-j27-23, TC-j27-30, TC-j27-31. Gate: pnpm format, then pnpm check.
  - **B-09.T6 The form.** Files: packages/runner/src/service/: `chats.ts` (`chats.act` form submit and cancel). Tests: `turn.test.ts`. Tests first: TC-j27-16, TC-j27-27, TC-AST-16, TC-INP-21, TC-INP-22. Gate: pnpm format, then pnpm check.
- Owner can try at the end: In the real app: write "fill my timesheet for today, 2 hours". FlowDriven lists what it understood and asks one short question for what is missing, with an example and "Use a form".
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-10 Runs from the chat

- Release: V1.
- Goal: From the chat the person can run one flow, several together or a chain, see run cards with the agent and model, and stop; every start goes through the START order.
- Depends on: B-04, B-05, B-09.
- Prototype gate: j20, j21 (the START order), j25, j31. PU items to approve first: PU-06 ("<flow> failed. <names> did not start.").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (the runner starts runs or programs). Focus: T-03, T-21, T-22, T-23, T-24. Why: chains, and a start that happens without a click on each flow.
- Tasks:
  - **B-10.T1 The START order.** Files: packages/runner/src/starts/: `start-rule.ts` (new: permission, then confirmation, then inputs, then start; a new or changed flow never starts; the confirm card), service/`handlers.ts` (`flows.start`, `starts.request`). Tests: `start-rule.test.ts` (new). Tests first: TC-j21-08, TC-j21-09, TC-j31-34, TC-SR3-10, TC-START-08. Replaces the retired `flows.run`. Gate: pnpm format, then pnpm check.
  - **B-10.T2 One flow from the chat.** Files: packages/runner/src/assistant/: `turn.ts` (`run` intent), service/`chats.ts` (`chats.act`: `run_now`), engine run records agent and model. Tests: `turn.test.ts`. Tests first: TC-j20-17, TC-j20-19, TC-j20-26, TC-j31-08, TC-j31-10, TC-SR4-09, TC-START-06, TC-AST-03. Gate: pnpm format, then pnpm check.
  - **B-10.T3 Several flows and chains.** Files: packages/runner/src/assistant/: `turn.ts` (`run_together`, `run_chain`, plan card, `change_plan`; each next flow starts through `starts.request` with source `after`). Tests: `turn.test.ts`. Tests first: TC-j20-11, TC-j20-13, TC-j20-18, TC-j20-47, TC-j20-57, TC-j24-10, TC-j31-13, TC-AST-21. Gate: pnpm format, then pnpm check.
  - **B-10.T4 Stop from the chat.** Files: packages/runner/src/: `assistant/turn.ts` (`stop` intent, `stop_runs`, `keep_running`), service/`handlers.ts` (`runs.stop`). Tests: `turn.test.ts`. Tests first: TC-j20-36, TC-j20-38, TC-AST-19, TC-ENG-11. Gate: pnpm format, then pnpm check.
  - **B-10.T5 Crash during a chain.** Files: packages/runner/src/: `assistant/turn.ts`, `exec/recovery.ts`. Tests: `assistant/crash.test.ts` (new). Tests first: TC-j20-51. Gate: pnpm format, then pnpm check.
- Owner can try at the end: In the real app: "Run Build APK and upload it, then fill my timesheet". A plan card appears; Start; run cards show the step and the agent; Stop ends a run at once.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-11 Results

- Release: V1.
- Goal: A finished run gives its answer in the chat or says "Done. The report is in Activity."; the lines about decisions are honest.
- Depends on: B-06, B-10.
- Prototype gate: j20, j24, j27. No PU item.
- Ask first: None.
- Dependency changes: none.
- Security review: Recommended. Why: a report must say only what happened (T-26).
- Tasks:
  - **B-11.T1 Answer lines.** Files: packages/runner/src/results/: `answer.ts` (new: which answer template and its parts, in the run's language); apps/desktop/src/screens/chat/: `answer.ts` (new: the renderer fills the template and draws dates). Tests: `results/answer.test.ts` (new), `screens/chat/answer.test.ts` (new), `answer-lines.test.ts` (new). Tests first: TC-j20-29, TC-j27-22, TC-RES-01, TC-RES-02, TC-RES-03, TC-RES-04, TC-RES-05, TC-RES-06. Gate: pnpm format, then pnpm check.
  - **B-11.T2 Decision lines.** Files: packages/runner/src/: `results/report-lines.ts` (new: "You approved: X.", "Done by your rule: X.", "You said no: X. It was not done." as `Line` values), `rules/decisions.ts`; apps/desktop/src/screens/activity/: `decisionLines.ts` (new: draws them). Tests: `results/report-lines.test.ts` (new), `rules/decisions.test.ts`, `decisionLines.test.ts` (new), `start-rule.test.ts`, `rules/standing.test.ts`, `engine-reject.test.ts`, `service/runs-handlers.test.ts`. Tests first: TC-j20-48, TC-j24-40, TC-SR5-10, TC-SR7-09, TC-ENG-13, TC-RES-07, TC-RES-08. Gate: pnpm format, then pnpm check.
  - **B-11.T3 What the chat posts.** Files: packages/runner/src/assistant/: `turn.ts` (run card text, the after-start line, the audit lines in plain words). Tests: `turn.test.ts`. Tests first: TC-j20-25, TC-j20-52. Gate: pnpm format, then pnpm check.
  - **B-11.T4 Honest reports and sealed secrets.** Files: packages/runner/src/: `report.ts`, `claude/prompt.ts`, service/`runs.ts`. Tests: `report.test.ts`, `claude/prompt.test.ts`, `service/secrets-never.test.ts` (new). Tests first: TC-SR5-17, TC-SR6-02, TC-SR6-03, TC-SR7-08. Gate: pnpm format, then pnpm check.
- Owner can try at the end: In the real app: a finished flow posts its answer lines in the chat, or "Done. The report is in Activity."; a rejected action shows "You said no: ... It was not done."
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-12 Start rule, schedules and the proactive question

- Release: V1.
- Goal: Every start outside the chat follows one start rule; schedules, "after another flow", the 17:00 question and notifications work. Turning a schedule on never starts a run.
- Depends on: B-10, B-11.
- Prototype gate: j21, j28, j23, j24, j25, j26 (START cases), j27, j31. PU items to approve first: PU-07 (the permission-off refusal), PU-09 (the daily run limit line), PU-10 (the schedule checks), PU-13 ("Set this schedule?"), PU-16 ("Already answered" and "This decision expired"), PU-19 (notifications with fixed text), PU-25 (the confirm card, then "Run it now?").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (the runner starts runs or programs). Focus: T-03, T-21, T-22, T-23, T-24. Why: starts nobody watches.
- Tasks:
  - **B-12.T1 Start rule: Flows starts and refusals.** Files: packages/runner/src/starts/: `start-rule.ts`; service/`handlers.ts` (a start with the permission off returns `{outcome: "refused", reason: "permission_off"}` and creates no run). Tests: `start-rule.test.ts`. Tests first: TC-j21-04, TC-j21-06, TC-j21-22, TC-j21-24, TC-j21-25, TC-j21-27, TC-j25-30, TC-j26-41, TC-j31-11, TC-START-03, TC-START-07, TC-START-09, TC-STR-03, TC-STR-05, TC-STR-06, TC-STR-07, TC-STR-10. Gate: pnpm format, then pnpm check.
  - **B-12.T2 Start rule: Run again.** Files: packages/runner/src/starts/: `start-rule.ts`; service/`handlers.ts`. Tests: `start-rule.test.ts`. Tests first: TC-j21-36, TC-j25-17, TC-j25-18, TC-j25-19, TC-j27-33, TC-INP-25. Gate: pnpm format, then pnpm check.
  - **B-12.T3 Start rule: new or changed flows.** Files: packages/runner/src/starts/: `start-rule.ts`. Tests: `start-rule.test.ts`. Tests first: TC-j23-16, TC-j27-25, TC-j28-18, TC-j28-19, TC-j28-33, TC-SR3-03, TC-START-01, TC-START-04, TC-STR-01, TC-STR-04. Gate: pnpm format, then pnpm check.
  - **B-12.T4 Start rule: missing inputs and last answers.** Files: packages/runner/src/starts/: `start-rule.ts`. Tests: `start-rule.test.ts`. Tests first: TC-j28-10, TC-j28-11, TC-j28-12, TC-j28-27, TC-j28-47, TC-j28-48, TC-START-02, TC-START-12, TC-INP-29, TC-STR-02, TC-STR-08, TC-STR-09. Gate: pnpm format, then pnpm check.
  - **B-12.T5 Schedules.** Files: packages/runner/src/: `starts/schedules.ts` (new), service/`handlers.ts` (`flows.setSchedule`, which has no first-run input, and `flows.tryNextRun`, which takes `{flowId}` only), `triggers/service.ts`, service/`trigger-wiring.ts`. Tests: `starts/schedules.test.ts` (new), `triggers/service.test.ts`, `service/trigger-wiring.test.ts`, `service/handlers.test.ts`. Tests first: TC-j12-13, TC-j21-12, TC-j21-13, TC-j21-15, TC-j21-16, TC-j21-19, TC-j21-33, TC-j21-34, TC-j21-35, TC-j21-40, TC-j28-02, TC-j28-03, TC-SR7-05, TC-SR9-08, TC-START-13, TC-STR-13, TC-STR-24, TC-STR-25, TC-STR-28. Gate: pnpm format, then pnpm check.
  - **B-12.T6 Turning a schedule on starts nothing.** Files: packages/runner/src/starts/: `schedules.ts`, `start-rule.ts` (no first run: turning a schedule on never starts a run, posts no question and makes no chat; a run that ends stuck, failed or stopped never changes the schedule). Tests: `schedules.test.ts`, `start-rule.test.ts`. Tests first: TC-j21-17, TC-j28-42, TC-j28-44, TC-STR-14, TC-STR-15. Gate: pnpm format, then pnpm check.
  - **B-12.T7 Scheduled starts.** Files: packages/runner/src/starts/: `schedules.ts` (report or chat result; a slot that cannot start is recorded as a `starts` row with its outcome and reason, `missed` or `skipped`, and in the audit log, and Activity does not list it; the daily limit; the permission off records `missed` with reason `permission_off`; catch-up once at wake inside the grace window). Tests: `schedules.test.ts`. Tests first: TC-j12-12, TC-j21-20, TC-j28-13, TC-j28-14, TC-j28-15, TC-j28-16, TC-j28-17, TC-j28-28, TC-j28-36, TC-SR8-05, TC-STR-11, TC-STR-12, TC-STR-16, TC-STR-17, TC-STR-18, TC-STR-19, TC-STR-23. Gate: pnpm format, then pnpm check.
  - **B-12.T8 The proactive question: post and answer.** Files: packages/runner/src/starts/: `proactive.ts` (new: one waiting question per flow, worded "It's <time>. Time for <flow>."; the slot decides "today"; the chat is made by FlowDriven on the main default, in the app language of the moment). Tests: `proactive.test.ts` (new). Tests first: TC-j27-26, TC-j28-04, TC-j28-05, TC-j28-06, TC-j28-07, TC-j28-08, TC-j28-09, TC-j30-37, TC-j31-12, TC-AGT-15, TC-STR-20, TC-STR-21, TC-STR-22. Gate: pnpm format, then pnpm check.
  - **B-12.T9 The proactive question: lifetime.** Files: packages/runner/src/starts/: `proactive.ts` (a waiting question has no expiry of its own; a decision inside a run still expires after 24 hours). Tests: `proactive.test.ts`. Tests first: TC-j27-24, TC-j28-30, TC-j28-31, TC-j28-32, TC-j28-34, TC-j28-35, TC-j28-49, TC-j28-50, TC-j28-51, TC-SR5-05, TC-SR8-04, TC-START-11, TC-STR-30. Gate: pnpm format, then pnpm check.
  - **B-12.T10 Notifications.** Files: packages/runner/src/notify/: `policy.ts`; service/`notify-wiring.ts`; apps/desktop/electron/: `notifier.ts` (new kinds and targets; the title and body are fixed `Line` values with no params, drawn by main from the words files; shown only when no window is focused; a flow started after another sends none). Tests: `notify/policy.test.ts`, `notify-wiring.test.ts`, `notifier.test.ts`. Tests first: TC-j24-43, TC-j25-34, TC-j28-20, TC-j28-21, TC-j28-22, TC-SR5-16, TC-ELE-21, TC-ELE-22, TC-ELE-23, TC-ELE-24, TC-IPC-14, TC-STR-27. Gate: pnpm format, then pnpm check.
  - **B-12.T11 Schedule and repeat cards in the chat.** Files: packages/runner/src/assistant/: `turn.ts`, `cards.ts` (`propose_schedule`, `turn_off_schedule`, `keep_schedule`, `every_time`, `only_this_time`; the assistant only proposes). Tests: `turn.test.ts`. Tests first: TC-j20-15, TC-j20-39, TC-j20-40, TC-j20-49, TC-j20-50, TC-j28-45. Gate: pnpm format, then pnpm check.
  - **B-12.T12 Every start is recorded and passes one function.** Files: packages/runner/src/: `starts/start-rule.ts`, `engine.ts` (a run keeps its confirmed hash), service/`handlers.ts` (kept operations keep working). Tests: `source-rules.test.ts`, `engine-steps.test.ts`, `starts/start-rule.test.ts`, `handlers.test.ts`. Tests first: TC-j20-58, TC-SR3-04, TC-SR7-06, TC-SR9-07, TC-START-05, TC-ENG-24. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Through the chat: "every weekday at 17:00" gives a card, not a schedule, and turning a schedule on starts nothing; a Chair walk with a fast clock shows the 17:00 question appear in a chat and as a notification, and "Try the next run now" ask the same way.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-13 Make a flow in the chat

- Release: V1.
- Goal: The person describes work, answers one question, reads a draft card, and "Save flow" saves one confirmed flow with its rules; the confirm dialog data lists the three groups.
- Depends on: B-02, B-04, B-05 (`flows.confirm` and its rules), B-08, B-10, B-12.
- Prototype gate: j22 (and j20, j29 for the shared card). PU items to approve first: PU-05, PU-11 ("Replaced by a newer draft", the stale-card refusal, the suffixed unique name), PU-12 (the outside-text tag on a draft).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals and flow hashing). Focus: T-02, T-04, T-05, T-06, T-09, T-10, T-17. Why: Save flow is a confirmation of an exact hash.
- Tasks:
  - **B-13.T1 Draft card.** Files: packages/runner/src/assistant/: `turn.ts` (`make_flow`: exactly one question, then a draft card), `cards.ts` (FlowDriven, not the agent, places each touch; a risky kind is always under Asks you first and cannot be moved to Does on its own). Tests: `cards.test.ts`, `turn.test.ts`. Tests first: TC-j22-03, TC-j22-04, TC-j22-05, TC-j22-06, TC-j22-14, TC-j22-32, TC-SR1-13, TC-SR1-46, TC-SR5-07, TC-AST-35. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-13.T2 Save flow.** Files: packages/runner/src/: service/`flows.ts` (`save_flow` in `chats.act` on top of `flows.confirm` from B-05; one flow, unique name), `assistant/turn.ts`. Tests: `turn.test.ts`, `starts/schedules.test.ts`, `cards.test.ts`, `service/flows-handlers.test.ts`. Tests first: TC-j22-08, TC-j22-09, TC-j22-11, TC-j22-12, TC-j22-13, TC-j22-15, TC-j22-23, TC-j22-25, TC-j22-27, TC-SR1-14, TC-SR1-22, TC-SR1-44, TC-SR3-05, TC-SR3-06, TC-SR3-07, TC-SR3-09. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-13.T3 Confirm and the run offer.** Files: packages/runner/src/: service/`flows.ts` (the chain continues after `flows.confirm`), `assistant/turn.ts` (`run_now`, chat words never save). Tests: `turn.test.ts`. Tests first: TC-j20-14, TC-j22-17, TC-j22-18, TC-j22-19, TC-j22-26. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-13.T4 Outside text and the life of a draft.** Files: packages/runner/src/assistant/: `turn.ts`. Tests: `turn.test.ts`. Tests first: TC-j22-16, TC-j22-22, TC-j22-33. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-13.T5 Folders the agent cannot write.** Files: packages/runner/src/claude/: `policy.ts` (the agent cannot write where the control or data folder is). Tests: `policy-folders.test.ts` (new). Tests first: TC-SR2-09. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: In the real app: describe a flow in the chat, answer the one question, read the draft card, click "Save flow", then "Run now".
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-14 Improve a flow with chat

- Release: V1.
- Goal: A requested change gives a change card; "Save change" writes the new version and confirms it in one click; a schedule change asks first.
- Depends on: B-13.
- Prototype gate: j23. PU items to approve first: PU-11, PU-13 ("Set this schedule?"), PU-14 (the confirm-again dialog).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (flow hashing). Focus: T-02, T-09, T-10. Why: a rule carries over only when its touch is the same.
- Tasks:
  - **B-14.T1 Change card.** Files: packages/runner/src/assistant/: `turn.ts` (`improve_flow`), `cards.ts` (a risky touch added by a change is only ever under Asks you first). Tests: `cards.test.ts`, `turn.test.ts`. Tests first: TC-j23-03, TC-j23-04, TC-j23-08, TC-j23-20, TC-j23-23, TC-j23-24, TC-j23-25, TC-j23-26. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-14.T2 Save change.** Files: packages/runner/src/: service/`flows.ts` (new version, new confirmed hash), `rules/standing.ts` (rules stay only for the same id, effect and place), `assistant/turn.ts`. Tests: `turn.test.ts`, `rules/standing.test.ts`, `engine-held.test.ts`. Tests first: TC-j23-05, TC-j23-07, TC-j23-09, TC-j23-10, TC-j23-18, TC-j23-19, TC-j23-21, TC-j23-22, TC-j23-28, TC-j23-29. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-14.T3 Schedule changes by chat.** Files: packages/runner/src/assistant/: `turn.ts`, `cards.ts` (the Indonesian request makes the same card; two schedules set none). Tests: `turn.test.ts`. Tests first: TC-j23-11, TC-j23-12, TC-j23-13, TC-j23-15. Gate: pnpm format, then pnpm check.
- Owner can try at the end: In the real app: on a saved flow write "also email me a summary". A change card appears; "Save change" keeps the flow confirmed and shows the new step.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-15 Flows from skills

- Release: V1.
- Goal: The Skills screen lists skills; "Make a flow" opens a chat with a draft built from the skill read as outside data; Save flow records the skill pin.
- Depends on: B-13, B-16, B-17.T1, B-17.T2.
- Prototype gate: j29, j26 (the Skills screen basics). PU items to approve first: PU-05, PU-11, PU-12, PU-14 ("The skill <name> changed").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (flow hashing). Focus: T-02, T-09, T-10. Why: the skill pin is part of the confirmed flow.
- Tasks:
  - **B-15.T1 Skill library.** Files: packages/runner/src/skills/: `library.ts` (new: `skills.list` reads the agents' skills and finds which flows use them), `skill-folder.ts`. Tests: `library.test.ts` (new), `skill-folder.test.ts`. Tests first: TC-j26-03, TC-j29-04, TC-AST-31, TC-SKL-01, TC-SKL-02, TC-SKL-03, TC-SKL-04, TC-SKL-05, TC-SKL-13. Gate: pnpm format, then pnpm check.
  - **B-15.T2 Skill draft.** Files: packages/runner/src/: `assistant/context.ts` (skill text only in a no-tool call, marked outside), `assistant/turn.ts`, service/`chats.ts` (`skills.makeFlow`). Tests: `context.test.ts`, `turn.test.ts`. Tests first: TC-j29-02, TC-j29-03, TC-j29-06, TC-j29-07, TC-j29-12, TC-j29-13, TC-j29-15, TC-j29-16, TC-j29-19, TC-j29-23, TC-j29-24, TC-j29-25, TC-SR2-14, TC-SR5-08, TC-AST-30. Gate: pnpm format, then pnpm check.
  - **B-15.T3 Save from a skill and the pin.** Files: packages/runner/src/: service/`flows.ts` (the pin), `starts/start-rule.ts` (a changed skill makes the flow Changed), `assistant/turn.ts`. Tests: `turn.test.ts`, `start-rule.test.ts`. Tests first: TC-j29-08, TC-j29-10, TC-j29-11, TC-j29-17, TC-j29-18, TC-j29-20, TC-j29-21, TC-j29-22, TC-j29-27, TC-j29-28, TC-SR3-08, TC-SKL-06. Flow hashing change. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-15.T4 Skills screen.** Files: apps/desktop/src/screens/skills/: `SkillsScreen.tsx` (new). Tests: `SkillsScreen.test.tsx` (new). Tests first: TC-j26-01, TC-j26-02, TC-j29-01. Gate: pnpm format, then pnpm check.
- Owner can try at the end: The Skills screen lists skills with origin and use; "Make a flow" on a row opens a chat with the draft; "Save flow" saves it.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-16 Renderer shell

- Release: V1.
- Goal: The new window opens with the rail, the chat list in groups, Search, the new routes and narrow-screen layout; the old screens are unrouted but keep their tests.
- Depends on: B-01, B-06.
- Prototype gate: j20, j12 (the shell). No PU item.
- Ask first: None.
- Dependency changes: none.
- Security review: Recommended. Why: the safe text renderer draws agent and outside text (T-14).
- Tasks:
  - **B-16.T1 Tokens and the system font stack.** Files: apps/desktop/src/styles/: `tokens.css` (the live current tokens, Light and Dark), `base.css`. No font files are added: the system font stack. Tests: `repo-checks.test.ts` (extended); the screenshots are L5 checks. Tests first: TC-REPO-10. Gate: pnpm format, then pnpm check.
  - **B-16.T2 Routes and the unrouted old screens.** Files: apps/desktop/src/: `nav/route.ts` (`#/chat`, `#/chat/<chatId>`, `#/flows`, `#/flows/<flowId>`, `#/activity`, `#/activity/<runId>`, `#/skills`, `#/settings`, `#/welcome`), `App.tsx`, `legacy/LegacyApp.tsx` (new: mounts the builder-first screens on the version 1 island for their tests), `test/render.tsx`, `test/render-legacy.tsx` (new). Tests: the existing screen tests keep passing; no test is deleted. Tests first: none cited; the cases for this task are written with its plan. Gate: pnpm format, then pnpm check.
  - **B-16.T3 Rail and chat list.** Files: apps/desktop/src/shell/: `Rail.tsx`, `ChatList.tsx` (groups Today, Yesterday, Earlier in the person's zone) (all new). Tests: `ChatList.test.tsx` (new). Tests first: TC-j20-03, TC-UI-23, TC-UI-24, TC-UI-25, TC-UI-26, TC-UI-27, TC-UI-28, TC-UI-29. Gate: pnpm format, then pnpm check.
  - **B-16.T4 Search.** Files: packages/runner/src/search/: `query.ts` (new: `LIKE` over chat titles, message text, flow names and summaries, limited), service/`handlers.ts` (`search.query`); apps/desktop/src/shell/: `SearchDialog.tsx` (new, Cmd or Ctrl+K). Tests: `search/query.test.ts`, `search/query-timing.test.ts`, `service/search-handlers.test.ts` (all new), `sqlite-store-v7.test.ts`. Tests first: TC-SRCH-01, TC-SRCH-02, TC-SRCH-03, TC-SRCH-04, TC-SRCH-05, TC-SRCH-06, TC-SRCH-07, TC-SRCH-08, TC-SRCH-09, TC-SRCH-10. Gate: pnpm format, then pnpm check.
  - **B-16.T5 Window language.** Files: apps/desktop/src/shell/: `language.tsx` (new: the window language is English whatever the system says; the words come from `apps/desktop/src/i18n/`). Tests: `language.test.tsx` (new). Tests first: TC-j30-02. Gate: pnpm format, then pnpm check.
  - **B-16.T6 Window and narrow screens.** Files: apps/desktop/electron/: `window.ts` (minimum size 480 by 600), `security.ts`, `window-api.ts` (new: `getPrefs`, `openLink`), `preload.ts`; apps/desktop/src/: `csp.mts`. Tests: `window.test.ts`, `security.test.ts`, `csp.test.ts`, `window-api.test.ts` (new). Tests first: TC-ELE-01, TC-ELE-02, TC-ELE-03, TC-ELE-04, TC-ELE-05, TC-ELE-06, TC-ELE-07, TC-ELE-25. Gate: pnpm format, then pnpm check.
  - **B-16.T7 Safe text renderer.** Files: apps/desktop/src/text/: `SafeText.tsx` (new: no raw HTML, no markdown, no remote images, hidden characters shown, the outside tag once, links shown and opened only by a click through main's check). Tests: `SafeText.test.tsx` (new), `source-rules.test.ts` (new). Tests first: TC-UI-01, TC-UI-02, TC-UI-03, TC-UI-04, TC-UI-05, TC-UI-06, TC-UI-07, TC-UI-08, TC-UI-09. Gate: pnpm format, then pnpm check.
  - **B-16.T8 Shared UI parts.** Files: apps/desktop/src/ui/: `Dialog.tsx`, `RadioGroup.tsx` (new), `StatusBadge.tsx` (icon plus words for every state), `Toast.tsx` (new). Tests: `Dialog.test.tsx`, `RadioGroup.test.tsx`, `StatusBadge.test.tsx`, `Toast.test.tsx`. Tests first: TC-UI-12, TC-UI-13, TC-UI-14, TC-UI-15, TC-UI-16, TC-UI-20, TC-UI-21, TC-UI-22. Gate: pnpm format, then pnpm check.
- Owner can try at the end: `pnpm dev:web` opens the new window: the rail with New chat, Search, Flows, Activity, Skills, Settings; the chat list in groups; Cmd+K Search; light and dark; a narrow width. Memory, Marketplace and Phone & bots do not appear in V1.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-17 Chat screen

- Release: V1.
- Goal: The chat screen works against the fixture client: composer, cards, the form, the confirm dialog and the agent and model picker.
- Depends on: B-08, B-16 (T5 also needs B-09; T3 needs B-10; T7 and T8 need B-13 and B-14). It uses the fixture client; the real runner answers the same shapes as those steps land.
- Prototype gate: j20, j22, j23, j27, j29, j31. PU items to approve first (renderer parts): PU-04, PU-05, PU-06, PU-07, PU-11, PU-12, PU-13, PU-14, PU-27, PU-28.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals) for the decision card (T4), which shows a held payload; Recommended for the rest (T1 to T3, T5 to T8). Why: decision cards and the draft card (T-14, T-05).
- Tasks:
  - **B-17.T1 Message thread.** Files: apps/desktop/src/screens/chat/: `Thread.tsx` (new: draws messages with the safe renderer of B-16), `Lines.tsx` (new: FlowDriven's posted lines in the chat's language). Tests: `safe-text.test.tsx` (new), `Lines.test.tsx` (new), `text/SafeText.test.tsx`. Tests first: TC-j30-12, TC-SR2-10, TC-UI-10. Gate: pnpm format, then pnpm check.
  - **B-17.T2 Composer and empty chat.** Files: apps/desktop/src/screens/chat/: `Composer.tsx`, `EmptyChat.tsx` (new: with no flows the empty chat shows two starter chips, "Make a new flow" and "What needs me?"). Tests: `Composer.test.tsx`, `EmptyChat.test.tsx` (new). Tests first: TC-j20-04, TC-j20-05, TC-j20-44, TC-j27-28. Gate: pnpm format, then pnpm check.
  - **B-17.T3 Plan card and run card.** Depends on: B-10. Files: apps/desktop/src/screens/chat/: `PlanCard.tsx`, `RunCard.tsx` (new). Tests: `PlanCard.test.tsx`, `RunCard.test.tsx` (new). Tests first: TC-j20-12, TC-j20-37, TC-j20-53, TC-j20-56, TC-j31-09, TC-SR8-02. Gate: pnpm format, then pnpm check.
  - **B-17.T4 Decision card.** Files: apps/desktop/src/screens/chat/: `DecisionCard.tsx`, `summary.ts` (new: the card with its buttons; "Always allow for this flow" only when `canAlwaysAllow` is true; the summary drawn from `Line` values in the app language). Tests: `DecisionCard.test.tsx`, `summary.test.ts` (new). Tests first: TC-j20-27, TC-j20-34. This task shows a held payload, so it is Required (approvals). Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-17.T5 Inputs form.** Depends on: B-09. Files: apps/desktop/src/screens/chat/: `InputsForm.tsx`, `Form.tsx` (new). Tests: `InputsForm.test.tsx`, `Form.test.tsx` (new). Tests first: TC-j27-14, TC-j27-15, TC-j29-14, TC-j30-13, TC-j30-14. Gate: pnpm format, then pnpm check.
  - **B-17.T6 Agent and model picker.** Files: apps/desktop/src/: `screens/chat/ModelPicker.tsx` (new), `ui/Menu.tsx` (new). An agent in state `unknown` shows its status and "Manage AI agents" (Settings), with no "Check again"; a model that is no longer offered shows the note of PU-27. Tests: `ModelPicker.test.tsx`, `ui/Menu.test.tsx` (new). Tests first: TC-j31-02, TC-j31-03, TC-j31-04, TC-j31-05, TC-j31-16, TC-j31-29, TC-j31-30, TC-j31-36, TC-j31-37, TC-j31-38, TC-j31-39, TC-j31-40, TC-UI-18, TC-UI-19. Gate: pnpm format, then pnpm check.
  - **B-17.T7 Draft card and confirm dialog.** Depends on: B-13. Files: apps/desktop/src/screens/: `chat/DraftCard.tsx`, `flows/ConfirmDialog.tsx` (all new: the draft card with its suffixed unique name, the outside tag and "Replaced by a newer draft"; the confirm dialog lists the three groups, and a changed skill adds "The skill <name> changed"). Tests: `chat/DraftCard.test.tsx`, `chat/Cards.test.tsx`, `flows/ConfirmDialog.test.tsx` (all new). Tests first: TC-j20-16, TC-j22-07, TC-j22-10, TC-j29-05, TC-j29-09, TC-SR2-17. Gate: pnpm format, then pnpm check.
  - **B-17.T8 Change card and schedule card.** Depends on: B-14. Files: apps/desktop/src/screens/chat/: `ChangeCard.tsx`, `ScheduleCard.tsx` (all new: the change card with Save change and Set this schedule?). Tests: `ChangeCard.test.tsx`, `ScheduleCard.test.tsx` (all new). Tests first: TC-j23-06, TC-j23-14. Gate: pnpm format, then pnpm check.
- Owner can try at the end: `pnpm dev:web`: type a message (Enter sends, Shift+Enter adds a line); see a plan card, a run card, a decision card with its buttons, a draft card, the form and the model picker with its keyboard use.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-18 Flows screen and flow page

- Release: V1.
- Goal: The Flows list and the flow page show what a flow does, needs and touches, its schedule, standing rules and recent activity; Run and Delete work. There is no Duplicate in V1.
- Depends on: B-12, B-13, B-15, B-16, B-17.
- Prototype gate: j21, j22, j23. PU items to approve first: PU-04 ("No flows yet"), PU-09, PU-10, PU-25.
- Ask first: None.
- Dependency changes: none.
- Security review: Not required (UI only).
- Tasks:
  - **B-18.T1 Flow read models, import and delete cleanup.** Files: packages/runner/src/service/: `flows-delete.ts` (extended: the skill links and the dependants a flow page shows), `flows-import.ts` (new: `flows.import`; there is no `flows.duplicate`), `map-flow.ts`, `handlers.ts` (`flows.list`, `flows.get` version 2 shapes). Tests: `flows-delete.test.ts`, `flows-import.test.ts` (new). Tests first: TC-j21-29, TC-STO-36, TC-STO-37. Gate: pnpm format, then pnpm check.
  - **B-18.T2 Flows list and the make dialog.** Files: apps/desktop/src/screens/flows/: `FlowsList.tsx`, `MakeFlowDialog.tsx` (new; with no flows the list says "No flows yet" and shows "Make a new flow"). Tests: `FlowsList.test.tsx`, `MakeFlowDialog.test.tsx` (new). Tests first: TC-j21-01, TC-j21-02, TC-j21-03, TC-j21-05, TC-j21-07, TC-j21-10, TC-j21-23, TC-j21-37, TC-j21-41, TC-j22-01, TC-j22-02, TC-UI-11. Gate: pnpm format, then pnpm check.
  - **B-18.T3 Flow page.** Files: apps/desktop/src/screens/flows/: `FlowPage.tsx` (new: what it does, needs, the three columns, standing rules with Ask me again, recent activity, Improve with chat). Tests: `FlowPage.test.tsx` (new). Tests first: TC-j21-11, TC-j21-28, TC-j21-30, TC-j21-38, TC-j21-39, TC-j23-01, TC-j23-02, TC-j23-17, TC-j24-17. Gate: pnpm format, then pnpm check.
  - **B-18.T4 Schedule section.** Files: apps/desktop/src/screens/flows/: `ScheduleSection.tsx` (new). Tests: `ScheduleSection.test.tsx` (new). Tests first: TC-j21-14, TC-j21-18. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Flows: each card has the right button and badge; open a flow page, change its schedule, click Ask me again on a rule, and Delete (with its dialog); with no flows, Flows says "No flows yet".
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-19 Activity and the run page

- Release: V1.
- Goal: Activity lists what needs the person, what runs and what finished (run rows only); the run page explains each problem in plain words with the right button; reports can be copied with secret-looking text masked.
- Depends on: B-05, B-11, B-16, B-17, B-18.
- Prototype gate: j24, j25. PU items to approve first: PU-08 (the spending pause and the usage-limit reason), PU-15, PU-16, PU-17, PU-18 (the Approve all similar dialog), PU-20 (a sign-in wait of 12 hours, then "Stuck"), PU-21 ("Still stuck: <reason>."), PU-22 (the line for an interrupted step that may have sent), PU-23 (secret masking in "Copy report"), PU-24 (a place with non-ASCII letters also shown in ASCII).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals) for the decision card and the Approve all similar dialog (T4), which show a held payload; Recommended for the rest. Focus: T-02, T-04, T-05, T-06, T-17 for T4; T-26 for the rest. Why: what a decision shows, honest lines and secret masking.
- Tasks:
  - **B-19.T1 Activity summary and audit lines.** Files: packages/runner/src/service/: `activity.ts` (new: `activity.summary` lists run rows only; a missed or skipped slot is a `starts` row and an audit line, not an Activity row), `audit-plain.ts` (new). Tests: `activity.test.ts`, `audit-plain.test.ts` (new). Tests first: TC-j25-04, TC-j25-31, TC-j25-38, TC-ENG-22, TC-RES-09, TC-STR-26. Gate: pnpm format, then pnpm check.
  - **B-19.T2 Sign-in waits, resume and recovery.** Files: packages/runner/src/: `engine.ts`, `exec/recovery.ts` (`runs.resume`; twelve hours without sign-in become Stuck; only all-idempotent runs resume by themselves; a step that can send, post, pay, delete or merge never does). Tests: `engine-needs-login.test.ts`, `engine-recovery.test.ts`, `engine-resume.test.ts` (new). Tests first: TC-j25-09, TC-j25-10, TC-j25-11, TC-j25-12, TC-j25-13, TC-j25-15, TC-j25-16, TC-j25-42. Gate: pnpm format, then pnpm check.
  - **B-19.T3 Export parts.** Files: packages/runner/src/: `results/export.ts` (new), service/`runs.ts` (`runs.export` returns structured parts; secret-looking text is masked by a named pattern list (`sk-` keys, `ghp_` tokens, `Bearer` values and the values of `secret_ref` inputs), run ids are hidden, hidden characters are shown; no bug-report copy of versions or log lines); apps/desktop/src/screens/activity/: `exportReport.ts`, `export-markdown.ts` (new: the renderer builds the Copy report Markdown and words the endings). Tests: `results/export.test.ts` (new), `export-markdown.test.ts` (new), `exportReport.test.ts` (new), `service/runs-handlers.test.ts`. Tests first: TC-j25-24, TC-j25-25, TC-j25-26, TC-j25-27, TC-RES-10, TC-RES-11, TC-RES-12, TC-RES-13, TC-RES-14, TC-RES-15. Gate: pnpm format, then pnpm check.
  - **B-19.T4 Activity screen and decision card.** Files: apps/desktop/src/screens/activity/: `ActivityScreen.tsx`, `DecisionCard.tsx`, `SimilarDialog.tsx`, `cause.ts` (new; the Approve all similar dialog lists every item in full, and a place with non-ASCII letters is also shown in ASCII). Tests: `ActivityScreen.test.tsx`, `DecisionCard.test.tsx`, `SimilarDialog.test.tsx`, `cause.test.ts` (new). Tests first: TC-j24-02, TC-j24-03, TC-j24-07, TC-j24-09, TC-j24-13, TC-j24-22, TC-j24-25, TC-j24-52, TC-j25-01, TC-j25-02, TC-j25-03, TC-j25-07, TC-j25-22, TC-j30-38, TC-UI-17. This task shows held payloads, so it is Required (approvals). Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-19.T5 Run page.** Files: apps/desktop/src/screens/activity/: `RunPage.tsx` (new: the agent and model the run used, "Still stuck: <reason>." after Try again, "This step may have sent: <title>. Check before you choose Try again."; no banner about an earlier version of the flow). Tests: `RunPage.test.tsx` (new). Tests first: TC-j25-05, TC-j25-06, TC-j25-08, TC-j25-14, TC-j25-20, TC-j25-23, TC-j25-28, TC-j25-29, TC-j25-36, TC-j25-37, TC-j25-39, TC-j25-40, TC-j25-41, TC-SR7-07, TC-SR8-08. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Activity: three sections with a count; a decision card with all its buttons; a stuck run explains the cause and offers the right button; "Copy report" shows its dialog.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-20 Settings

- Release: V1.
- Goal: Settings has Appearance, Language, AI agents, Permission, Main AI agent, Spending limit and Notifications (other items appear when their release ships); the permission switch and appearance work.
- Depends on: B-06, B-07, B-16.
- Prototype gate: j12, j30, j31. PU items to approve first: PU-07 (the button "Turn on permission" opens the same "Before you start" dialog as Settings), PU-29 ("Could not save. Try again.").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: the permission switch.
- Tasks:
  - **B-20.T1 Permission in the runner.** Files: packages/runner/src/service/: `handlers.ts` (`settings.update {agentPermission}` on the record with source window; turning it off stops running work: a run going at that moment becomes `stopped`). Tests: `handlers.test.ts`, `permission-off.test.ts` (new). Tests first: TC-j12-10, TC-j12-11, TC-SR6-10. The refusal of chat turns and starts while the permission is off is built with them (B-08.T6, B-12.T5). Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-20.T2 Appearance in Electron.** Files: apps/desktop/electron/: `appearance.ts` (new: `nativeTheme.themeSource`, its own small file, applied before the first window); packages/contracts/src/: `window.ts`. Tests: `appearance.test.ts` (new), `contracts/src/window.test.ts`. Tests first: TC-j12-03, TC-j12-04, TC-ELE-08, TC-ELE-09, TC-ELE-10, TC-ELE-11, TC-ELE-12, TC-ELE-27, TC-IPC-25, TC-IPC-28. Gate: pnpm format, then pnpm check.
  - **B-20.T3 Preload and window API.** Files: apps/desktop/electron/: `preload.ts` (one frozen object), `window-api.ts` (the four channels `getPrefs`, `setColorMode`, `openLink` and `quit`; every channel checks its sender and argument count; there is no `setBackground`, no tray and no login item), `window.ts` (capture windows). Tests: `preload.test.ts` (rewritten in this task: the existing test pins a bridge with only `kind` and `runner`), `window-api.test.ts`, `window.test.ts`, `source-rules.test.ts` (new). Tests first: TC-j28-39, TC-SR2-18, TC-ELE-13, TC-ELE-14, TC-ELE-15, TC-ELE-16, TC-ELE-26, TC-IPC-01, TC-IPC-02, TC-IPC-03, TC-IPC-04, TC-IPC-05, TC-IPC-06, TC-IPC-07, TC-IPC-23, TC-IPC-24, TC-IPC-26, TC-IPC-27. Gate: pnpm format, then pnpm check.
  - **B-20.T4 Settings shell and Appearance.** Files: apps/desktop/src/screens/settings/: `Settings.tsx`, `Appearance.tsx` (new; the sections are Appearance, Language, AI agents, Permission, Main AI agent, Spending limit and Notifications, and there is no Background section; a save that fails says "Could not save. Try again."). Tests: `Settings.test.tsx` (rewritten in this task: the existing test asserts the old Brain, Fallback order and Monthly budget sections), `Appearance.test.tsx` (new). Tests first: TC-j12-01, TC-j12-02, TC-j12-29, TC-j12-30, TC-j12-33, TC-j31-32. Gate: pnpm format, then pnpm check.
  - **B-20.T5 Language and AI agents sections.** Files: apps/desktop/src/screens/settings/: `LanguageSection.tsx`, `AgentsSection.tsx` (new; an agent in state `unknown` shows its status and "Manage AI agents" leads here, where Scan again is; no usage rows and no plan-limits note). Tests: `Language.test.tsx`, `LanguageSection.test.tsx`, `AgentsSection.test.tsx` (new). Tests first: TC-j12-05, TC-j12-07, TC-j12-37, TC-j30-04, TC-j30-05, TC-j30-27, TC-j30-33, TC-j30-34. Gate: pnpm format, then pnpm check.
  - **B-20.T6 Permission and main agent.** Files: apps/desktop/src/screens/settings/: `PermissionSection.tsx`, `MainAgentSection.tsx` (new; "Give permission" and "Turn on permission" open the same "Before you start" dialog, which holds no sentence about the model makers). Tests: `PermissionSection.test.tsx`, `MainAgentSection.test.tsx` (new). Tests first: TC-j12-08, TC-j12-09, TC-j12-14, TC-j12-15. Gate: pnpm format, then pnpm check.
  - **B-20.T7 Spending limit section.** Files: apps/desktop/src/screens/settings/: `SpendingSection.tsx`, `limit.ts` (new; the enforcement is B-24). Tests: `SpendingSection.test.tsx`, `limit.test.ts` (new). Tests first: TC-j12-21, TC-j12-22, TC-j12-23, TC-j12-28. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Settings: Light, Auto and Dark change the window at once; Bahasa Indonesia changes the words at once; turning the permission off asks first and stops running work; the spending limit dialog checks the amount.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-21 First launch

- Release: V1.
- Goal: A new person sees Welcome, gives one permission, sets up an agent with one click and starts chatting. A research step first reads the agents' public help and documentation for their install and sign-in details.
- Depends on: B-07, B-16, B-20 (T1 to T3 and T5); T4 is a research step and depends on nothing.
- Prototype gate: j01. PU items to approve first: PU-01 (install failure and sign-in timeout), PU-02 (an agent too old to run safely), PU-03 (the version mismatch screen).
- Ask first: None.
- Dependency changes: none.
- Security review: Required (the runner starts runs or programs). Focus: T-03, T-21, T-22, T-23, T-24. Why: Set up runs an install command.
- Tasks:
  - **B-21.T1 Start route and version gate.** Files: apps/desktop/src/: `nav/start-route.tsx`, `runner/version-gate.tsx` (new); apps/desktop/electron/: `main.ts`. Tests: `start-route.test.tsx`, `version-gate.test.tsx`, `version.test.tsx` (all new), `main.test.ts`; `nav/route.test.ts` and `screens.test.ts` are rewritten in this task (the existing tests open `#/builder` first). Tests first: TC-j01-01, TC-j01-02, TC-j01-12, TC-ELE-17, TC-IPC-21. Gate: pnpm format, then pnpm check.
  - **B-21.T2 Welcome cards.** Files: apps/desktop/src/screens/welcome/: `Welcome.tsx` (new: one card per catalog agent, the ready screen, the language options; the card keeps "Set up Claude Code", which for a ready agent only gives the permission, and holds no sentence about the model makers). Tests: `Welcome.test.tsx` (new). Tests first: TC-j01-03, TC-j01-04, TC-j01-13, TC-j01-14, TC-j01-15, TC-j01-29. Gate: pnpm format, then pnpm check.
  - **B-21.T3 Set up states.** Files: apps/desktop/src/screens/welcome/: `Welcome.tsx`, `AgentCard.tsx` (new: Install it yourself, Scan again, failure line and retry, Sign in, a catalog entry with no command). Tests: `Welcome.test.tsx`. Tests first: TC-j01-16, TC-j01-17, TC-j01-22, TC-j01-24, TC-j01-26. Gate: pnpm format, then pnpm check.
  - **B-21.T4 Research the agents' install and sign-in details (Chair step: network).** Files: packages/runner/src/test-helpers/: `agent-profiles.ts` (only its hand-written values). The Chair reads the public help and documentation of Claude Code and Codex (the install command and package name, the sign-in status command and its output, the model list and the flags that run a step) and writes a synthetic agent profile with hand-written values into `packages/runner/src/test-helpers/agent-profiles.ts`; nothing is recorded from a real agent or account, and raw notes stay in `.workflow/scratch/` and are never committed. Tests: none. Tests first: none (a Chair step). It comes before B-07.T5 and B-07.T6. Gate: the Chair records the result.
  - **B-21.T5 Pin the catalog.** Depends on: B-07, B-21.T4. Files: packages/runner/src/agents/: `catalog.ts` (the entries hold the values the research confirmed). Tests: `catalog.test.ts` (new). Tests first: TC-j01-30. Gate: pnpm format, then pnpm check.
- Owner can try at the end: A fresh data folder opens Welcome. One card per agent; Set up (on a fake agent in sample mode; on the real agent in a Chair walk with the owner watching); Start chatting opens an empty chat.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-22 Codex

- Release: V1.
- Goal: Codex runs chat turns and flow steps behind the same port, always in its workspace-write sandbox. When the chat's agent cannot be limited for a flow, FlowDriven says so and starts nothing (PU-26). A research step first reads Codex's public help and documentation.
- Depends on: B-07; T7 also needs B-08, B-13, B-14 and B-15. T1 is a research step and depends on nothing.
- Prototype gate: j31, j01, j12, j20, j22, j23, j29. PU items to approve first: PU-26 ("Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it.").
- Ask first: None.
- Dependency changes: none.
- Security review: Required (sandbox limits). Focus: T-12, T-18, T-19. Why: the Codex sandbox.
- Tasks:
  - **B-22.T1 Research the Codex command line (Chair step: network).** Files: packages/runner/src/test-helpers/: `agent-profiles.ts` (only the Codex values). The Chair reads Codex's public help and documentation (flags, the event stream, the sign-in status command, the sandbox proof, what it loads from configuration, and the read scope of its sandbox, which is part of the Codex spike, `threat-model.md` section 10, item 1) and writes the shapes into the Codex profile as hand-written values. Raw notes stay in `.workflow/scratch/` and are never committed; nothing is recorded from a real agent or account. Tests: none. Tests first: none (a Chair step). Gate: the Chair records the result.
  - **B-22.T2 Fake codex script shapes.** Files: packages/runner/src/test-helpers/: `fake-codex-script.ts` (the flags and events the research found, written by hand with synthetic values, on top of the fake codex of B-00.T4). Tests: the fake's own self-test (extended); the fixture scan of B-00.T5 scans the script. Tests first: none cited; the cases for this task are written with its plan. Gate: pnpm format, then pnpm check.
  - **B-22.T3 Arguments and event stream.** Files: packages/runner/src/codex/: `args.ts`, `stream.ts` (new: `-s workspace-write` set explicitly every time, or `-c sandbox_mode=workspace-write` for a resume; the model flag; no full-access or bypass flag; Codex is offered for chats only when it has a tool-free mode). Tests: `args.test.ts`, `stream.test.ts`, `model-flag.test.ts` (all new). Tests first: TC-j31-21, TC-SR4-03, TC-SR4-08, TC-AGT-19, TC-AGT-20, TC-AGT-22. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-22.T4 Adapter.** Files: packages/runner/src/codex/: `adapter.ts` (new: prompt on stdin, minimal environment, start proof, capability tiers). Tests: `adapter.test.ts` (new), `handlers.test.ts`, `agents/registry.test.ts`. Tests first: TC-j12-18, TC-j20-54, TC-j25-35, TC-j31-22, TC-SR1-36, TC-SR1-37, TC-SR1-40, TC-SR4-04, TC-SR4-13, TC-SR5-12, TC-AGT-21, TC-AGT-23, TC-AGT-24. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-22.T5 Conformance suite.** Files: packages/runner/src/agents/: `conformance.ts` (new: no bypass flag, the model flag only, start proof required, Stop kills the process group, sign-in and quota states, the same step result), run against the Claude Code adapter and the Codex adapter. Tests: `conformance.test.ts` (new). Tests first: TC-SR4-15, TC-AGT-34, TC-AGT-35, TC-AGT-36, TC-AGT-37, TC-AGT-38, TC-AGT-39. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-22.T6 Codex set up and sign-in.** Files: packages/runner/src/agents/: `setup.ts`, `catalog.ts` (Codex entry with the values of B-21.T5; sign-in through the agent's own status command). Tests: `setup.test.ts`. Tests first: TC-j01-20, TC-j12-06. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-22.T7 Capability tier and the cannot-run line.** Depends on: B-13, B-14, B-15. Files: packages/runner/src/: `agents/capability.ts` (new: what Codex may run), `assistant/turn.ts`, `assistant/cards.ts` (when the chat's agent cannot be limited for a flow, the line `chat.agentCannotRunFlow` with the parameter `agent` says "Codex cannot run this flow safely yet. Choose Claude Code in the picker to run it." and nothing starts; there is no `use_other_agent` action). Tests: `turn.test.ts`. Tests first: TC-j20-55, TC-j22-31, TC-j23-27, TC-j29-26, TC-j31-07, TC-j31-27, TC-SR1-38. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Choose Codex in the model picker (when it has a tool-free mode); a chat turn and a flow run on Codex (a Chair walk with the owner watching); a flow Codex cannot be limited for says so in plain words and starts nothing.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-23 Keeping the app alive

- Release: V1.
- Goal: The app stays alive when its window closes, as it does today on macOS, so schedules keep running until the person quits; a slot missed while the computer slept runs once at wake or is recorded `missed`. V1 has no menu-bar icon, no Open at login, no `background` setting and no `starts.next`.
- Depends on: B-07, B-12, B-20.
- Prototype gate: j28, j12. No PU item: this is today's behaviour. The menu bar, Open at login and the quit warning go into the prototype first, later.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (the runner starts runs or programs). Focus: T-03, T-21, T-22, T-23, T-24. Why: runs nobody watches.
- Tasks:
  - **B-23.T1 Background setting.** (Removed from V1: the `background` setting, `window.setBackground` and the Background section of Settings. Their absence is pinned in B-03.T5, B-20.T3 and B-20.T4.)
  - **B-23.T2 Keep the app alive when the window closes.** Files: apps/desktop/electron/: `window.ts` (`stayAliveWhenAllWindowsClosed(platform)`: true on macOS only), `main.ts` (`registerAppLifecycle`: quitting stops the runner first and nothing runs while FlowDriven is quit). Tests: `window.test.ts`, `main.test.ts`. Tests first: TC-j01-32, TC-j12-31, TC-j28-37, TC-j28-38, TC-ELE-19, TC-ELE-20. Gate: pnpm format, then pnpm check.
  - **B-23.T3 Notifications with no window.** Files: apps/desktop/electron/: `notifier.ts` (a click creates a window when none is open). Tests: `notifier.test.ts`. Tests first: TC-j28-41. Gate: pnpm format, then pnpm check.
  - **B-23.T4 Wake and missed starts.** Files: packages/runner/src/: `starts/schedules.ts`, `triggers/service.ts` (inside two hours a missed slot runs once; else it is recorded `missed` and nothing lists it or runs it late; a clock moved back starts nothing). Tests: `starts/schedules.test.ts`. Tests first: TC-j20-60, TC-j21-21, TC-j28-23, TC-j28-24, TC-j28-25, TC-j28-26, TC-START-14. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Close the window: FlowDriven keeps running, as today, so a schedule still fires; quit it and nothing runs; after sleep a slot missed less than two hours ago runs once, and an older one does not run.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-24 Spending limit, usage limits and busy fallback

- Release: V1.
- Goal: The spending limit and the agents' usage limits pause runs with a "Needs you" item; the busy fallback moves only starts outside a chat.
- Depends on: B-07, B-12, B-20.
- Prototype gate: j12, j25, j28, j31. PU items to approve first: PU-08 (the spending pause as one "Needs you" item, and the usage-limit wait reason). The main agent that decides real runs, the busy fallback and the counting limit follow the prototype.
- Ask first: None.
- Dependency changes: none.
- Security review: Required (the runner starts runs or programs). Focus: T-03, T-21, T-22, T-23, T-24. Why: the busy fallback and runs that pause.
- Tasks:
  - **B-24.T1 Usage limits.** Files: packages/runner/src/agents/: `registry.ts`, `usage.ts` (new: an agent's own usage limit becomes a wait reason; there are no usage rows and no plan-limits note in Settings). Tests: `registry.test.ts`. Tests first: TC-j25-32, TC-SR9-06, TC-SR9-09, TC-SR9-10. Gate: pnpm format, then pnpm check.
  - **B-24.T2 Spending: counting and the pause.** Files: packages/runner/src/: `agents/spend.ts` (new: only money charged per use counts; the month follows the person's zone), service/`spending.ts` (new). Tests: `agents/spend.test.ts`, `service/spending.test.ts` (new). Tests first: TC-j12-25, TC-j12-27, TC-j25-33, TC-SR9-01, TC-SR9-02, TC-SR9-04, TC-SR9-12, TC-AGT-26, TC-AGT-27. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-24.T3 Spending: raising the limit.** Files: packages/runner/src/: service/`handlers.ts` (`settings.update {spendingLimit}`: the limit can only be raised, by the Settings click, which resolves the synthetic `budget_raise` decision), `rules/decisions.ts`. Tests: `service/settings-handlers.test.ts`, `service/spending.test.ts`, `rules/decisions.test.ts`, `decisions-handlers.test.ts`. Tests first: TC-j12-24, TC-j12-26, TC-j24-45, TC-SR2-13, TC-SR9-05, TC-AGT-25, TC-RUL-23. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-24.T4 Limits in starts and chats.** Files: packages/runner/src/: `starts/start-rule.ts`, `starts/schedules.ts`, `assistant/turn.ts`. Tests: `start-rule.test.ts`, `schedules.test.ts`, `turn.test.ts`. Tests first: TC-j20-46, TC-j21-26, TC-j22-30, TC-j27-29, TC-j28-29, TC-SR9-03. Gate: pnpm format, then pnpm check.
  - **B-24.T5 Busy fallback.** Files: packages/runner/src/starts/: `start-rule.ts` (only outside a chat, only to a ready agent that can run the flow; a limit never switches a chat's agent). Tests: `start-rule.test.ts`, `turn.test.ts`. Tests first: TC-j12-19, TC-j12-20, TC-j31-14, TC-j31-15, TC-SR4-16, TC-STR-29. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Set a small limit (with the fake agent reporting a cost): a run pauses with a "Needs you" item; raising the limit in Settings lets it go on; with the busy fallback on, a scheduled start moves to the other ready agent and a chat does not.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-31 Contributor guides

- Release: V1.
- Goal: A new person can try FlowDriven from the README, contribute by hand with CONTRIBUTING.md, and add a language with the translating guide.
- Depends on: B-06; written last, when V1 behavior is known.
- Prototype gate: None (documents).
- Ask first: None.
- Dependency changes: none.
- Security review: Not required (documents).
- Tasks:
  - **B-31.T1 Translating guide and its check.** Files: docs/: `translating.md` (new); apps/desktop/src/i18n/: `i18n.test.ts` (a test language with two words passes and falls back to English). Tests: `i18n.test.ts`. Tests first: TC-j30-22, TC-DOC-07, TC-DOC-08, TC-DOC-09, TC-I18N-31. Gate: pnpm format, then pnpm check.
  - **B-31.T2 README and CONTRIBUTING.** Files: `README.md`, `CONTRIBUTING.md` (new; contents as in `contributing-plan.md`). Tests: `docs.test.ts` (B-31.T3). Tests first: TC-DOC-05, TC-DOC-06, TC-DOC-10. Gate: pnpm format, then pnpm check.
  - **B-31.T3 Docs test.** Files: apps/desktop/src/: `docs.test.ts` (new: every `pnpm` script named in README.md, CONTRIBUTING.md and docs/translating.md exists; every relative link and anchor resolves; paths in code spans exist). It runs inside `pnpm test`; `tools/checks/` is not touched. Tests: `docs.test.ts`. Tests first: TC-DOC-01, TC-DOC-02, TC-DOC-03, TC-DOC-04, TC-DOC-11, TC-DOC-12. Gate: pnpm format, then pnpm check.
  - **B-31.T4 Repository rule tests.** Files: apps/desktop/src/: `repo-checks.test.ts` (extended: the bypass-flag rule over the instruction files and guides; a Codex command in a guide sets the sandbox explicitly); the existing `tools/checks/test/agent-rules.test.mjs` and `dependency-gate.test.mjs` run unchanged inside `pnpm test` and are the pins of the two cases below (nothing under `tools/checks/` is edited). Tests first: TC-SR4-17, TC-SR4-18, TC-REPO-05, TC-REPO-06. Gate: pnpm format, then pnpm check.
- Owner can try at the end: A fresh reader follows the README quickstart (`pnpm install --frozen-lockfile`, then `pnpm dev:web` or `pnpm start`) and the translating guide; the docs test passes.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

## 4. V2 and V3 steps

Decided for V1 (revisable): V2 is B-25 to B-27 and raises the contract version to 3 (and the store to version 8); V3 is B-28 and B-29 and raises it to 4. These steps are shorter because their plans are written when they come due. Their Ask-first items are named here and need the owner's yes at that time. Each step still needs its journeys approved in the clickable prototype, and the parts that do real work (not demo data) go into the prototype first.

### B-25 Memory

- Release: V2.
- Goal: Memory keeps what the person decides to keep, proposes items from outside text only as tagged proposals, and never widens a run.
- Depends on: B-08, B-17; contract version 3 (this step raises it for all of V2).
- Prototype gate: j26 (Memory). The real behaviors (proposals, 30-day drop, secure delete) are Not in the prototype yet and go into it first.
- Ask first: None.
- Dependency changes: None.
- Security review: Recommended. Why: memory poisoning (T-13).
- Tasks:
  - **B-25.T1 Contract version 3 and store version 8.** Files: packages/contracts/src/: `memory.ts` (new), `operations.ts`, `version.ts` (`CONTRACT_VERSION = 3`); packages/runner/src/: `memory/migration.ts` (new: store version 8 adds the memory tables and keeps everything). Tests: `memory.test.ts` (new), `memory/migration.test.ts` (new). Tests first: TC-MEM-01, TC-MEM-13. Gate: pnpm format, then pnpm check.
  - **B-25.T2 Memory service.** Files: packages/runner/src/memory/: `memory.ts` (new: keep, drop, edit, pin, supersede, 500 characters, secure delete, 30-day lapse, export), `scope.ts` (new: a flow sees only its own scope and what the person granted), `memory-limits.ts` (new). Tests: `service.test.ts`, `scope.test.ts`, `memory-limits.test.ts`, `memory.test.ts` (all new). Tests first: TC-j26-07, TC-j26-08, TC-j26-10, TC-j26-13, TC-j26-14, TC-j26-15, TC-j26-16, TC-j26-17, TC-MEM-02, TC-MEM-03, TC-MEM-04, TC-MEM-05, TC-MEM-06, TC-MEM-07, TC-MEM-08, TC-MEM-09, TC-MEM-10, TC-MEM-12. Gate: pnpm format, then pnpm check.
  - **B-25.T3 Memory in the assistant.** Files: packages/runner/src/assistant/: `context.ts`, `turn.ts` (a kept outside item stays marked and stops a turn from starting a run). Tests: `turn.test.ts`. Tests first: TC-j26-12, TC-MEM-11. Gate: pnpm format, then pnpm check.
  - **B-25.T4 Memory screen.** Files: apps/desktop/src/screens/memory/: `MemoryScreen.tsx` (new); the rail shows Memory from this release. Tests: `MemoryScreen.test.tsx` (new). Tests first: TC-j26-05, TC-j26-06, TC-j26-09, TC-j26-11. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Memory screen with its sections; Keep and Drop at once; Delete asks first.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, and the owner tried it.

### B-26 Phone & bots and other AI tools

- Release: V2.
- Goal: A paired phone answers one decision at a time through a bot, and other AI tools on this Mac can list and start flows, all through the start rule.
- Depends on: B-25, B-20; the `runAsNode` fuse decision (threat-model spike 3) before any secret is stored.
- Prototype gate: j26 (Phone & bots). Real pairing, stale commands and the tool switch are Not in the prototype yet and go into it first.
- Ask first: A client library for the bot platforms, if one is wanted, is a new dependency: it is named with its exact version in the step's plan and must pass `pnpm check:deps`. The system keychain through Electron needs no package.
- Dependency changes: See Ask first.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: phone approvals and the tool server (T-17, T-16).
- Tasks:
  - **B-26.T1 Spikes before code.** (Chair step: network) Files: Decide the `runAsNode` fuse question (utility process, separately signed Node or helper) and record what the bot platforms store and preview. Tests: none. Tests first: none (a Chair step). Gate: the Chair records the result.
  - **B-26.T2 Secrets in the keychain.** Files: apps/desktop/electron/: `secrets.ts` (new, through the system keychain), `window-api.ts` (`secrets.save`); packages/runner/src/phone/: `secrets.ts` (new). Tests: `secrets.test.ts` (new). Tests first: TC-j26-20, TC-j26-21, TC-SR6-11, TC-PHN-01, TC-PHN-02, TC-PHN-03. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-26.T3 Pairing.** Files: packages/runner/src/phone/: `pairing.ts` (new). Tests: `pairing.test.ts` (new). Tests first: TC-j26-22, TC-j26-29, TC-PHN-04, TC-PHN-05, TC-PHN-14, TC-PHN-15, TC-PHN-16. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-26.T4 Phone commands.** Files: packages/runner/src/phone/: `commands.ts` (new: commands older than 10 minutes ignored, forwarded text never starts a run). Tests: `commands.test.ts` (new). Tests first: TC-j26-23, TC-j26-26, TC-j26-27, TC-j26-28, TC-SR2-15, TC-PHN-06, TC-PHN-07, TC-PHN-08, TC-PHN-13. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-26.T5 Phone decisions.** Files: packages/runner/src/phone/: `decisions.ts` (new: approve and reject only, two taps for risky kinds, no standing rules). Tests: `decisions.test.ts` (new). Tests first: TC-j26-24, TC-j26-25, TC-SR2-03, TC-PHN-09, TC-PHN-10, TC-PHN-11, TC-PHN-12. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-26.T6 Other AI tools.** Files: packages/runner/src/phone/: `tool-server.ts` (new: off by default, local only, five operations, starts through the start rule, no standing rule applies). Tests: `tool-server.test.ts` (new). Tests first: TC-j26-30, TC-j26-31, TC-START-10, TC-PHN-17, TC-PHN-18. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-26.T7 Audit and screen.** Files: packages/runner/src/phone/: `audit.ts` (new); apps/desktop/src/screens/phone/: `PhoneScreen.tsx` (new). Tests: `audit.test.ts`, `PhoneScreen.test.tsx` (new). Tests first: TC-j26-18, TC-j26-19, TC-j26-32, TC-PHN-19. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Phone & bots screen; set up Telegram with the owner's own bot and pair; answer one decision from the phone (a Chair walk).
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-27 Skill updates with roll back

- Release: V2.
- Goal: A changed skill is shown as a change the person approves or keeps current; roll back restores the earlier text; a used skill is never archived.
- Depends on: B-15, B-25.
- Prototype gate: j26 (skill updates). Whether diff and roll back keep the plain-words look is a prototype question to settle first.
- Ask first: None.
- Dependency changes: None.
- Security review: Required (flow hashing). Focus: T-02, T-09, T-10. Why: skill pins.
- Tasks:
  - **B-27.T1 Skill versions in the runner.** Files: packages/runner/src/skills/: `library.ts` (`skills.approveUpdate`, `skills.keepCurrent`, `skills.rollBack`, `skills.archive`; dependent flows become Changed). Tests: `library.test.ts`. Tests first: TC-j26-50, TC-j26-51, TC-j26-53, TC-SKL-07, TC-SKL-08, TC-SKL-09, TC-SKL-10, TC-SKL-11, TC-SKL-12. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-27.T2 Skills screen updates.** Files: apps/desktop/src/screens/skills/: `SkillsScreen.tsx`, `UpdateDialog.tsx` (new). Tests: `SkillsScreen.test.tsx`. Tests first: TC-j26-49, TC-j26-52. Gate: pnpm format, then pnpm check.
- Owner can try at the end: A skill change shows as a diff; Approve update makes its flows Changed; Roll back restores the text.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-28 Marketplace client

- Release: V3.
- Goal: The person can browse, read and install signed flows as drafts that do nothing until confirmed; revoked versions cannot run.
- Depends on: B-13, B-18, B-27; contract version 4; the marketplace server (closed source, a later phase).
- Prototype gate: j26 (Marketplace). Real signatures, revocation and publish are Not in the prototype yet and go into it first.
- Ask first: The first network code of FlowDriven's own (NF-18 says none in V1), the pinned public key and the signature scheme, and any library for them (named in the step's plan). Chair step for the key.
- Dependency changes: See Ask first.
- Security review: Required (signatures and release). Focus: T-09, T-15, T-30. Chair step and a decision about the pinned public key.
- Tasks:
  - **B-28.T1 Contract version 4 and market operations.** Files: packages/contracts/src/: `market.ts` (new), `operations.ts`, `version.ts`. Tests: `market.test.ts` (new). Tests first: TC-MKT-01. Gate: pnpm format, then pnpm check.
  - **B-28.T2 Signatures and the pinned key.** Files: packages/runner/src/market/: `verify.ts`, `pinned-key.ts` (new: canonical bytes, signature check against the pinned public key; no private key in the repository). Tests: `verify.test.ts`, `pinned-key.test.ts` (new). Tests first: TC-MKT-02, TC-MKT-03, TC-MKT-04, TC-MKT-05, TC-MKT-06. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-28.T3 Install and signature checks.** Files: packages/runner/src/market/: `install.ts` (new: signature and revocation list, a draft with no rule and no schedule, a signed update is never silent, a local edit forks). Tests: `install.test.ts` (new). Tests first: TC-j26-37, TC-j26-38, TC-j26-44, TC-j26-48, TC-SR2-16, TC-SR3-11, TC-MKT-10, TC-MKT-11, TC-MKT-12, TC-MKT-14. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-28.T4 Revocation.** Files: packages/runner/src/market/: `revocation.ts` (new). Tests: `revocation.test.ts` (new). Tests first: TC-j26-42, TC-j26-43, TC-MKT-07, TC-MKT-08, TC-MKT-09. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-28.T5 Confirm lists and publish.** Files: packages/runner/src/market/: `confirm.ts`, `publish.ts` (new). Tests: `confirm.test.ts`, `publish.test.ts` (new). Tests first: TC-j26-39, TC-j26-47, TC-MKT-13, TC-MKT-15, TC-MKT-16. Gate: pnpm format, then pnpm check.
  - **B-28.T6 Marketplace screen and the new-flow dialog.** Files: apps/desktop/src/screens/marketplace/: `MarketplaceScreen.tsx` (new); `screens/flows/FlowPage.tsx`. Tests: `MarketplaceScreen.test.tsx` (new), `FlowPage.test.tsx`. Tests first: TC-j26-33, TC-j26-34, TC-j26-35, TC-j26-36, TC-j26-40, TC-j26-45, TC-j26-46. Gate: pnpm format, then pnpm check.
  - **B-28.T7 Marketplace client.** Files: packages/runner/src/market/: `client.ts` (new: the runner talks to the service; listing data is parsed strictly and stays text; offline search says so). Tests: `client.test.ts`, `source-rules.test.ts` (the network stays in two files). Tests first: TC-MKT-17, TC-MKT-18, TC-REPO-09. Gate: pnpm format, then pnpm check.
- Owner can try at the end: Browse the Marketplace; install a signed listing as a draft; the flow page shows New and the confirm dialog lists the three groups.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

### B-29 FlowDriven gateway for account tools

- Release: V3.
- Goal: A local gateway lets account tools reach every agent under the same decision rule, so Codex can run flows that need accounts.
- Depends on: B-22, B-26; contract version 4.
- Prototype gate: None yet (it adds connectors, not a new journey); any visible part goes into the prototype first.
- Ask first: A library for the MCP protocol, if one is used, is a new dependency named with its exact version in the step's plan.
- Dependency changes: See Ask first.
- Security review: Required (approvals). Focus: T-02, T-04, T-05, T-06, T-17. Why: the gateway proxies account tools. Spike 8 (connector tool descriptions) first.
- Tasks:
  - **B-29.T1 Gateway server.** Files: packages/runner/src/gateway/: `server.ts` (new: a local MCP server proxying declared account tools through `decide`). Tests: `gateway/gateway.test.ts` (new). Tests first: TC-SR1-41, TC-SR1-42, TC-SR1-43. Needs a library for the MCP protocol or a hand-written one; a new dependency is named in the step's plan and passes `pnpm check:deps` (Ask first at that time). Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-29.T2 Connect the agents.** Files: packages/runner/src/: `claude/` and `codex/` adapters point at the gateway. Tests: the conformance suite of B-22, run through the gateway. Tests first: none cited; the cases for this task are written with its plan. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
  - **B-29.T3 Connector catalog.** Files: packages/runner/src/gateway/: `catalog.ts` (new: more connectors, each with its tools classified by FlowDriven). Tests: written with the step's plan. Tests first: none cited; the cases for this task are written with its plan. Safety-core change: one independent security review before its pull request leaves draft. Gate: pnpm format, then pnpm check.
- Owner can try at the end: A flow that reads and sends through an account tool runs on Codex through the gateway and asks first.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

## 5. B-30 Packaging and release path

Before any public download. AGENTS.md says no agent creates tags or releases, edits a release or its files, or holds or uses a signing, notarization or release secret. Agents may prepare packaging configuration that holds no secret; every signing, notarization, upload, tag and release action is the owner's own (B-30.T3 and B-30.T4 are owner steps). Nothing in B-30 is part of V1.

### B-30 Packaging and release path

- Release: Before any public download.
- Goal: A signed, notarized, updatable download exists.
- Depends on: All V1 steps; the `runAsNode` fuse decision (`threat-model.md` section 10, item 3).
- Prototype gate: None.
- Ask first: Everything in this step: the runner bundle, packaging, signing, notarization and the update channel (AGENTS.md: release, signing and update setup).
- Dependency changes: A bundler or packaging tool is a new dependency named in the step's plan (Ask first).
- Security review: Required (signatures and release). Focus: T-09, T-15, T-30. Owner steps, and configuration that holds no secret.
- Tasks:
  - **B-30.T1 Fuse and process decision.** (Chair step: GUI) Files: Decide how the packaged app starts the runner so the `runAsNode` fuse can be off. Tests: none. Tests first: none (a Chair step). Gate: the Chair records the result.
  - **B-30.T2 Runner bundle.** Files: The runner bundled to JavaScript for a packaged app; apps/desktop/electron/: `runner-paths.ts`. A bundler or Node tooling may be a new dependency (Ask first, named in the plan). Tests: a bundle start test (cases added when the step's plan is written). Tests first: none cited; the cases for this task are written with its plan. Gate: pnpm format, then pnpm check.
  - **B-30.T3 Packaging, signing, notarization, update channel (Owner step).** Files: Packaging configuration that holds no secret may be prepared by an agent (named in the step's plan, Ask first). Signing, notarization and the update channel's keys are held and used by the owner only, with no secret in any session. Tests: none in `pnpm check`. Tests first: none (an owner step). Gate: the owner records the result.
  - **B-30.T4 Release (Owner step).** Files: the tag, the release and its files are created by the owner; no agent creates a tag or a release, edits a release or its files, or holds a signing secret (AGENTS.md). Tests first: none (an owner step). Gate: the owner records the result.
- Owner can try at the end: A person downloads, opens and updates FlowDriven without a checkout.
- Done when: its tests pass, `pnpm format` then `pnpm check` pass, the security review has no open finding, and the owner tried it.

## 6. Coverage

Every test case id of `test-cases/journeys.md` (572), `test-cases/safety.md` (173) and `test-cases/platform.md` (516) is cited by exactly one task above, and no other test case id appears in this file. The migration tests of `data-model.md` section 5.4 (numbered 1 to 15 there) have no case ids; they are written in B-03.T2 and B-03.T3 as that section says. Counts by step (journey, safety, component cases; component cases are the platform cases):

| Step | Journey | Safety | Component | Total | Tasks |
|---|---|---|---|---|---|
| B-00 | 0 | 0 | 3 | 3 | 6 |
| B-01 | 7 | 4 | 55 | 66 | 11 |
| B-02 | 2 | 3 | 19 | 24 | 5 |
| B-03 | 3 | 5 | 37 | 45 | 6 |
| B-04 | 3 | 25 | 16 | 44 | 6 |
| B-05 | 43 | 26 | 28 | 97 | 10 |
| B-06 | 21 | 1 | 44 | 66 | 9 |
| B-07 | 26 | 10 | 24 | 60 | 7 |
| B-08 | 32 | 13 | 26 | 71 | 8 |
| B-09 | 26 | 2 | 28 | 56 | 6 |
| B-10 | 18 | 4 | 4 | 26 | 5 |
| B-11 | 6 | 6 | 9 | 21 | 4 |
| B-12 | 79 | 20 | 37 | 136 | 12 |
| B-13 | 23 | 11 | 1 | 35 | 5 |
| B-14 | 22 | 0 | 0 | 22 | 3 |
| B-15 | 27 | 3 | 9 | 39 | 4 |
| B-16 | 2 | 0 | 43 | 45 | 8 |
| B-17 | 36 | 3 | 3 | 42 | 8 |
| B-18 | 23 | 0 | 3 | 26 | 4 |
| B-19 | 42 | 2 | 10 | 54 | 5 |
| B-20 | 27 | 2 | 24 | 53 | 7 |
| B-21 | 15 | 0 | 2 | 17 | 5 |
| B-22 | 13 | 10 | 12 | 35 | 7 |
| B-23 | 11 | 1 | 2 | 14 | 4 |
| B-24 | 16 | 11 | 5 | 32 | 5 |
| B-31 | 1 | 2 | 15 | 18 | 4 |
| B-25 | 13 | 0 | 13 | 26 | 4 |
| B-26 | 15 | 4 | 19 | 38 | 7 |
| B-27 | 5 | 0 | 6 | 11 | 2 |
| B-28 | 15 | 2 | 19 | 36 | 7 |
| B-29 | 0 | 3 | 0 | 3 | 3 |
| B-30 | 0 | 0 | 0 | 0 | 4 |
| All | 572 | 173 | 516 | 1261 | 191 |

### Cases moved from their first stated build step

A case moves only when its code, its file or the screen it checks belongs to another step, or when the order of section 3 requires it. The case files now name the new step in their `- Build step:` line. The ids are written without the prefix on purpose; the cases are cited in their tasks.

| Case | First stated step | Now | Reason |
|---|---|---|---|
| j01-29 | B-06 | B-21 | the welcome screen is built in B-21 |
| j12-13 | B-20 | B-12 | it is the runner-level owner of the permission-off rule and calls `chats.send`, `flows.start` and `flows.tryNextRun`, which B-12.T5 completes |
| j12-18 | B-07 | B-22 | it asserts the argv of a Codex run, so it needs the Codex adapter (B-22) |
| j12-37 | B-06 | B-20 | the Language section of Settings is built in B-20 |
| j20-16 | B-13 | B-17 | the confirm dialog is a renderer part (B-17.T7) |
| j20-26 | B-05 | B-10 | needs a chat run started from the chat (B-10); B-05 has no chat start yet |
| j20-27 | B-11 | B-17 | its file is `apps/desktop/src/screens/chat/summary.test.ts`, the decision card of B-17.T4 |
| j20-54 | B-07 | B-22 | it asserts the argv of a Codex run, so it needs the Codex adapter (B-22) |
| j20-60 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j21-08 | B-12 | B-10 | chains start the second flow through the START order, so its core is built in B-10 |
| j21-09 | B-12 | B-10 | chains start the second flow through the START order, so its core is built in B-10 |
| j21-21 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j21-27 | B-05 | B-12 | starts from the Flows list go through `flows.start` (B-12.T1) |
| j23-14 | B-14 | B-17 | its file is `apps/desktop/src/screens/chat/ScheduleCard.test.tsx`, a renderer card (B-17.T8) |
| j24-10 | B-12 | B-10 | the chain exists after B-10 and the rejection after B-05; the case sits with the chain tasks of B-10 |
| j25-21 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| j25-30 | B-07 | B-12 | it calls `flows.start` and `chats.act`, so it follows the start handlers (B-12.T1) |
| j25-31 | B-07 | B-19 | it reads `activity.summary`, built in B-19.T1 |
| j25-35 | B-07 | B-22 | it resumes a run on Codex, so it needs the Codex adapter (B-22) |
| j25-40 | B-17 | B-19 | the run page is built in B-19 |
| j27-21 | B-06 | B-08 | its file is `assistant/turn.test.ts`, which B-08 creates |
| j27-23 | B-08 | B-09 | needs the typed input fill of B-09 |
| j27-27 | B-08 | B-09 | needs the form submit of B-09 |
| j28-23 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j28-24 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j28-25 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j28-26 | B-12 | B-23 | the wake and missed-start handling belongs to B-23 (keeping the app alive) |
| j28-39 | B-23 | B-20 | it checks the window API keys and `window.json`, which B-20.T3 builds |
| j28-45 | B-08 | B-12 | the schedule proposal card is built in B-12 |
| j29-09 | B-15 | B-17 | its file `DraftCard.test.tsx` is the draft card of B-17.T7 |
| j29-18 | B-12 | B-15 | the skill pin it tests is built in B-15 |
| j29-23 | B-08 | B-15 | the skill draft it stops is built in B-15 |
| j30-02 | B-06 | B-16 | the window language provider is part of the renderer shell (B-16) |
| j30-10 | B-06 | B-08 | its file is `assistant/turn.test.ts`, which B-08 creates |
| j30-12 | B-06 | B-17 | its file is `apps/desktop/src/screens/chat/Lines.test.tsx`, a renderer part built with the chat screen (B-17) |
| j31-07 | B-08 | B-22 | it sends a chat turn to the fake codex, so it needs the Codex adapter (B-22) |
| j31-30 | B-06 | B-17 | the model picker is built in B-17 (B-06 builds no screen) |
| SR2-11 | B-21 | B-08 | it sends a chat message (`chats.send`) while the permission is unset, which B-08.T6 builds |
| SR4-12 | B-07 | B-08 | it sends a chat message to an agent that is too old, which B-08.T6 answers with the readiness card |
| SR6-08 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| SR7-05 | B-20 | B-12 | its table calls `flows.setSchedule`, built in B-12.T5 |
| SR7-11 | B-03 | B-07 | it calls `chats.delete`, built in B-07.T7, and `flows.delete`, built in B-05.T10 |
| SR8-01 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| SR8-03 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| SR8-04 | B-20 | B-12 | it needs a due schedule slot and an open waiting question, built in B-12 |
| SR8-11 | B-13 | B-05 | it calls `flows.delete`, built in B-05.T10 |
| STO-34 | B-03 | B-05 | it calls `flows.delete`, built in B-05.T10 |
| STO-35 | B-03 | B-07 | it calls `chats.delete`, built in B-07.T7 |
| ENG-07 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| ENG-08 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| ENG-09 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| ENG-10 | B-10 | B-05 | the engine stop is built in B-05, because the decision cases j24-33 and j24-34 and the permission switch need it |
| AST-18 | B-06 | B-08 | its file is `assistant/turn.test.ts`, which B-08 creates |
| INP-25 | B-09 | B-12 | it starts a run again through `flows.start`, built in B-10, with the rest of the Run again cases in B-12.T2 |
| AGT-05 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-06 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-07 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-08 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-09 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-10 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-11 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| AGT-12 | B-21 | B-07 | Set up and Scan again are built in B-07 (`agents/setup.ts`), where their journey cases j01-06 to j01-28 are; B-21 only adds the welcome screens |
| IPC-27 | B-16 | B-20 | it uses the setup of IPC-23, which B-20.T3 builds |
| ELE-17 | B-20 | B-21 | `startMain` is built with the start route and the version gate in B-21.T1 |
| ELE-20 | B-21 | B-23 | it uses the lifecycle of ELE-19, which B-23.T2 builds |

65 cases moved.

### Tests that change

The register of decision 15 and `test-plan.md` section 1: an existing test whose subject V1 deliberately changes is rewritten in the task named here, with an equally strict assertion that cites the flow spec that now decides it. None is deleted.

| Existing file | What it pins today | The approved change | Task |
|---|---|---|---|
| `packages/runner/src/engine-held.test.ts` | A rejection fails the step and the run; the old reason text "This call is too large to show for your approval." | A rejection skips the action and the run goes on; the new reason text (j24-08, j24-41 are in B-05) | B-05.T3, B-05.T1 |
| `packages/contracts/src/version.test.ts` | `CONTRACT_VERSION` is 1 | It is 2, with the version check (j01-11 is in B-01) | B-01.T6 |
| `packages/contracts/src/operations.test.ts` | The version 1 operation table | The version 2 table of 45 live operations and the 12 retired entries (j24-38, j26-04 are in B-01) | B-01.T4 |
| `apps/desktop/src/nav/route.test.ts` and `apps/desktop/src/screens.test.ts` | The start route opens `#/builder` | The start route opens `#/welcome` or the chat; the old routes still parse but are not linked (j01-01 is in B-21) | B-21.T1 |
| `apps/desktop/src/screens/settings/Settings.test.tsx` | The old Brain, Fallback order and Monthly budget sections | The seven V1 sections and no Background section (j12-01, j12-30 are in B-20) | B-20.T4 |
| `apps/desktop/electron/preload.test.ts` | The bridge exposes only `kind` and `runner` (`call` and `subscribe`) | The bridge also exposes the frozen `window` API with exactly `getPrefs`, `setColorMode`, `openLink` and `quit`, and no background setting (j28-39 is in B-20) | B-20.T3 |
| The `claude-harness*.test.ts` files of `packages/runner/src/service/` that pin the per-agent consent gate | A consent per agent | The one agent permission; the consent gate becomes the permission | B-07.T4 |
| `apps/desktop/src/screens/harnesses/Harnesses.test.tsx` and the other tests of the unrouted builder-first screens | The old screens and their consent dialog | Nothing changes: they stay and keep passing on the frozen version 1 island | none |

### Security review gates

Every step follows `threat-model.md` section 8. `test-cases/safety.md` names these steps as needing a review: B-01, B-03, B-04, B-05, B-07, B-08, B-10, B-12, B-13, B-14, B-20, B-21, B-22, B-23, B-24 (and B-26, B-28, B-29 when they ship). Every one of them is already Required in the threat model, so no step was added. The threat model also requires a review for B-02, B-15 (flow hashing) and B-27, which `safety.md` leaves out; they keep it. The renderer parts that show a held payload (the decision card in B-17.T4, and the decision card and the Approve all similar dialog in B-19.T4) are Required (approvals) and marked as safety-core changes (decision 30); the rest of B-17 and B-19, and B-06, B-09, B-11, B-16 and B-25, are Recommended; B-00, B-18 and B-31 are not required. The safe text renderer (T-14) is built in B-16, so B-16 is Recommended.

### Points the decisions do not name

Each is Decided for V1 (revisable), so no V1 step waits for a question:

- Flow hashing (an Ask-first area in AGENTS.md). The hash function does not change: `contentHash` still hashes every file of a flow, so the format 1.2 fields are covered because they are in the files, and a 1.1 flow hashes byte for byte as before (B-02.T4). The skill pin already exists (`consent_pins`) and moves into the confirmation (B-15.T3). No change to flow hashing is made; both tasks keep their security review.
- The runner starting programs and runs nobody watches (AGENTS.md: changing the runner). Set up's install command (B-07.T5), chains (B-10), schedules and the proactive question (B-12) and the busy fallback (B-24) follow the clickable prototype the owner approved; the behaviours the owner has not seen are the PU items, approved in the prototype first. As with decision 7, the approved prototype is the owner's product decision for these, and each step keeps its security review.
- `tools/checks/`. SR4-17 and SR4-18 are pinned by the existing `agent-rules.test.mjs` and `dependency-gate.test.mjs`, which run unchanged inside `pnpm test`; V1 edits nothing under `tools/checks/`. The wider checks are REPO-01 and REPO-05 in `apps/desktop/src/repo-checks.test.ts`.
- The Safety page of `threat-model.md` section 9. V1 has no Safety page: the sentences with a place in the app are built where they belong (the confirm dialog in B-17.T7, decision cards in B-17.T4 and B-19.T4, the run page in B-19.T5), and the others go into the README's short safety note (B-31). A Safety page in the app is a later prototype item.


## 7. Drafter's calls

All are Decided for V1 (revisable).

- Order of the build. The order is the table of section 3 and every "Depends on" item comes before what names it. B-16, B-20 and B-21 come right after B-07, and the chat screen tasks that need only the assistant come right after B-08, so the owner can try the new window early. The chat screen tasks that need inputs, runs, Make a flow or Improve a flow (B-17.T5, T3, T7, T8) are split into later rows; B-15 comes after the first chat screen tasks because it builds a screen. Reason: these screens run on the fixture client and need only B-01 and B-06; `architecture.md` section 14 lists the same dependencies.
- The research steps. B-21.T4 (the agents' install and sign-in details) comes before B-07.T5 and B-07.T6, the tasks that build Set up and sign-in; B-22.T1 (the Codex command line) comes before the Codex tasks. Both are Chair steps (network) that read public documentation and write synthetic values. Reason: until the research is done, B-07 uses an injected agent profile from B-00.T4, and the real values are pinned in B-21.T5 and B-22.T2 to T6. B-22.T2 and the fake codex of B-00.T4 are hand-written; no step records a real agent.
- B-17.T4 is the decision card alone, so the one renderer task that shows a held payload in the chat is the one marked as a safety-core change; the draft card and the confirm dialog (T7) and the change and schedule cards (T8) are new tasks.
- The version 1 island (decision 4) is built in B-01.T5 and used by the unrouted old screens from B-16.T2. Reason: the old screens call operations that retire; `runner-api.md` sections 1, 2.2 and 7 keep them as retired entries (45 live, 12 retired).
- Reject skipping an action is built in B-05 (where its cases are), although the `architecture.md` step list puts it in B-04. B-04 builds the decision function and the states.
- `flows.confirm` and its standing rules are built in B-05.T9, because its cases are in B-05; B-13 builds Save flow on top of it.
- The engine stop is built in B-05.T7, not B-10, because the decision cases and the permission switch need it; B-10 keeps the chat's stop card and the chain case.
- The START order core (B-10.T1) is built before the rest of the start rule (B-12), because chains start the second flow through it.
- The runner-level owner of the permission-off rule (j12-13) is in B-12.T5, because it calls `chats.send`, `flows.start` and `flows.tryNextRun`; the thin cases of B-08, B-17 and B-20 only check their own side. The case that turns the permission off with a due slot and an open question (SR8-04) is in B-12.T9 for the same reason.
- B-23 is only the app staying alive (as today), notifications with no window and missed starts at wake; the tray, the login item, the `background` setting and `starts.next` are not built, so B-23.T1 is kept as a removed task and its absence cases sit in B-03.T5, B-20.T3 and B-20.T4.
- Cases that repeat each other and so cannot all fail first: j12-11, j24-34 and j25-31 (the permission switch stops runs), and j25-09 to j25-12 with ENG-02 to ENG-06 (sign-in waits). I kept each cited once where the case lists put it; the writer of the later case should add only what it asserts beyond the earlier one.
- The renderer's draw of "Copy report", of the answer lines and of FlowDriven's posted lines follows decision 2: the runner builds parts and `Line` values, so some cases whose file was in the runner are now renderer tests (the case files already say so).
- B-31's two `tools/checks/` cases pin existing tests and edit nothing there (section 6).
- Task sizes: a task holds one area and at most about 20 cases; where a file held more (for example the start rule's 60 cases) it is split across tasks.

