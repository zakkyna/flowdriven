# Test plan: test-driven development for the real app

This plan says how every build step of the real app is driven by tests written first, where the tests live, and what they may not touch. The test cases themselves are in `test-cases/journeys.md` (one section per flow spec), `test-cases/safety.md` (one section per safety rule) and `test-cases/platform.md` (one section per component). `build-order.md` lists, for each build step, the test cases that must fail before its code is written, and the register "Tests that change".

## 1. The loop for every build step

Each build step (`B-00` to `B-30` in `build-order.md`) is split into plan tasks of one Codex call each. Every task follows the same loop:

1. Take the task's test cases from `build-order.md`.
2. Write those tests first. Run them and watch each one fail for the reason its "Fails first because" line gives. A test that passes before the code exists tests nothing: fix the test before going on.
3. Save that first failing run. Its command and, for every failing test, the test's name and its failure message go to `.workflow/scratch/<task id>-red.txt` (git-ignored, never committed). The task report shows the same names and messages. The Chair compares each message with the case's "Fails first because" line and sends the task back when a test failed for another reason (for example a typo or an import error).
4. Write the smallest code that makes the tests pass.
5. Tidy the code with the tests green.
6. Run `pnpm format`, then `pnpm check`. The task is done only when the gate passes.
7. Tick the task and add the handoff line from AGENTS.md, citing the red run: `Done by: <tool/model>, <date>. Evidence: <passing command>; red run: .workflow/scratch/<task id>-red.txt.` After two failures, write `Blocked: <short reason>` instead.

Codex writes tests and code, one task per call, and never commits. Claude reviews each task against its tests and commits (Chair step). A test is never weakened, skipped or deleted to make the gate pass.

Exemptions and special cases:
- Fixtures (sample data, fake agent scripts) and test support (the harness of section 4) are exempt from the red run. Test support has its own small tests, as `fake-claude.test.ts` and `fake-chrome.test.ts` do today.
- Old tests. A test whose subject V1 deliberately changes is rewritten in the same task as the new behaviour, with an equally strict assertion that cites the flow spec that now decides it. The task report lists it, and `build-order.md` holds the register "Tests that change" (existing file, test, approved behaviour change, task). The existing tests that pin the old behaviour of a reject (the run fails), of the start route, of the captured routes, of the Settings sections, of the contract version and of the operation table are examples. A test is never deleted to make room for the new behaviour.
- Retired screens. The tests of the unrouted builder-first screens stay and keep passing (`prd.md`, Q-04): the route stays parseable but is not linked, and the retired operations stay in the operation table as retired entries and in the fixture client for as long as those tests exist. Removing the screens and their tests is a later Ask-first item.

## 2. Test layers

| Layer | What it checks | Runs in | Uses | Typical file |
|---|---|---|---|---|
| L1 unit | One function or module: parsers, the decision function, schema refinements, word lookup, CSS source guards | Vitest project `node` (packages) or `ui` (renderer helpers) | Plain inputs, injected clock and ids | `packages/runner/src/inputs/parse.test.ts` |
| L2 UI | What the person sees and can do: roles, names, words, keyboard, cards, dialogs | Vitest project `ui` with happy-dom and Testing Library | `renderApp(hash, {scenario})` from `apps/desktop/src/test/render.tsx` and `FixtureRunnerClient` | `apps/desktop/src/screens/chat/Composer.test.tsx` |
| L3 runner integration | A whole behavior inside the runner: a chat turn, a run with a held call, a scheduled start, a migration | Vitest project `node` | Harness H (section 4): real SQLite in a temporary data folder, the fake claude, the fake codex, the fake brain or the scripted harness, an injected clock | `packages/runner/src/starts/start-rule.test.ts` |
| L4 check tool | Repository rules enforced by `tools/checks` | `node:test` through `pnpm test:tools` | Temporary folders and files | `tools/checks/test/hidden-chars.test.mjs` |
| L5 Chair walk | What only a real window or a real agent can show: screenshots in both color modes and languages, measured times, a run on the owner's real agent with the owner watching | Not part of `pnpm check`; `pnpm capture` and the walk scripts in `apps/desktop/electron/` | The real app on its own data folder | `apps/desktop/electron/*-walk.ts` |

Prefer L1 and L3 for behavior, L2 for what the person sees, and L5 only where nothing else can see the result. The safety rules are tested at L1 (the decision table) and at L3 (the same rule end to end through the hook channel and the store). A case is labelled with the layer it really runs in: a test that uses fake windows or a fake notifier is L3 (or L2), not L1, and a formatter is L1 wherever it lives.

## 3. Rules every test follows

- No test talks to the network, a real agent or a real account. Agents are the fake claude (`packages/runner/src/test-helpers/fake-claude.ts`), the fake codex (`packages/runner/src/test-helpers/fake-codex.ts`, new) and the fake brain (`packages/runner/src/test-helpers/fake-brain.ts`, new). The fakes run real hook scripts where the real agent would, so the hook channel is tested end to end.
- Fixtures are synthetic. Sample data and fake agent scripts are written by hand from the agents' public help and documentation, never a recording of a real session, account or machine. A test (`TC-REPO-11`) scans fixtures and test helpers (`packages/fixtures/`, `packages/*/src/test-helpers/`) for local paths (paths inside a person's home folder on macOS or Linux), `@` addresses other than `example.test` and `example.com`, and long tokens, and fails on any.
- Sample data validates against `@flowdriven/contracts`. The chat-first sample (`packages/fixtures/src/story-v2/`, new) mirrors the prototype's flows: Build APK and upload it, Fill timesheet, Weekly supplier report, Email triage, Job review. The real app ships no sample; the fixtures exist for tests and `pnpm dev:web` only. Names are generic and product-neutral (cloud storage, `timesheet-skill`, Project Example, Example Corp).
- Strings that need hidden or format characters are built at test time with `String.fromCodePoint`, never stored in a file. The hidden-character check scans every tracked file.
- Time comes from an injected clock; ids come from an injected generator. The suite runs with `TZ=UTC` (set in `vitest.config.ts`) only as a stable default.
- Time zones. Product code that turns words into dates or times takes an IANA zone as an argument and uses `Intl` with `timeZone`; it never reads the process zone. A test passes the zone explicitly and never sets `process.env.TZ`. The one place that reads the process zone is the single boundary that finds the person's zone once; its test uses `withTimeZone(zone, fn)` (in `packages/runner/src/test-helpers/time-zone.ts`, part of B-00), which sets the zone, runs `fn` and restores the old value in a `finally`, so no other test sees it. The zones used are `UTC`, `Asia/Bangkok` (UTC+07:00, no daylight saving; local 17:00 on Thursday 2026-11-19 is 10:00Z) and `Europe/Amsterdam` (for a daylight-saving change). Every behavior that turns words into dates or times has a test in `Asia/Bangkok` and one across a daylight-saving change in `Europe/Amsterdam`.
- No waiting on real time. Use the injected clock, fake timers or explicit events. A test that needs a sleep is a test that needs a seam.
- No test is skipped. `.skip`, `.only` and `.todo` do not reach a commit. Biome's recommended preset (`biome.json`, checked with Biome 2.6.3) does not flag them, so a Vitest test scans the test files for them and fails the gate. Turning on Biome's `noFocusedTests` and `noSkippedTests` rules would be a further change that the owner approves in a plan task first.
- Secrets never appear in fixtures. A test that needs a secret uses an obviously fake value built at test time and checks that it never reaches a prompt, a log line, an export or a part of the report that the masking list covers (SR-6). Secrets inside an agent's own file reads are a known limit, not a test.
- Words. The runner never builds sentences. Runner tests (L1, L3) assert message codes and values (a `Line`); L2 tests and Electron main tests assert words. A sentence quoted in a runner case is only the English drawing of its `Line`.
- Agent details start as research. Codex's and the agents' install and sign-in details (install command, package name, status output, flags) start as a small research step (B-21, B-22) that reads their public help and documentation. Until the research is done, cases use an injected agent profile and assert the exact value the profile gives; literal flags and install commands are pinned in B-21 and B-22. A Codex case asserts the exact sandbox value for its situation (`workspace-write` for a flow run, as AGENTS.md requires) and the conformance suite asserts that no bypass or full-access value ever appears.

## 4. Fakes and seams

| Seam | Used for | Where |
|---|---|---|
| Fake claude | Claude Code steps, chat turns, start proof, sign-in and quota events | existing `test-helpers/fake-claude.ts` and `fake-claude-script.ts` |
| Injected agent profile | The argv shapes, sign-in status output, model list and install command of an agent, until the research step fixes them | `test-helpers/agent-profiles.ts` (new) |
| Fake codex (new) | Codex steps, its event stream, its sandbox flag, sign-in status; driven by an agent profile | `test-helpers/fake-codex.ts` |
| Fake brain (new) | Scripted chat-turn answers (intents as JSON) without an agent process | `test-helpers/fake-brain.ts` |
| Scripted harness | Engine tests that do not need a process | existing `scripted-harness.ts` |
| `FixtureRunnerClient` | Every renderer test | existing `packages/fixtures`, extended for contract v2 |
| Call recording | What a UI test asserts about calls (below) | `FixtureRunnerClient` |
| Injected clock and ids | Schedules, expiry, 24-hour decisions, missed starts | engine and service dependencies |
| Fake keychain (new, V2) | Secrets by reference (phone and bots, gateway) | `apps/desktop/electron/` tests |
| Fake notifier (new) | System notifications | `apps/desktop/electron/` tests |
| Temporary data folder | Store, migration, recovery, hook channel | `fs.mkdtemp` under the test's own folder |
| Store version 6 fixture (new) | The version 6 to 7 migration | `packages/runner/src/test-helpers/store-v6.ts` |

Call-recording seam. `FixtureRunnerClient` records every call itself in `client.calls`, an array of `{operation, input}` in call order, and every call still goes through `client.call`, so the existing tests that use `vi.spyOn(client, "call")` keep working. New tests read `client.calls` only. A test about start-up calls asserts the set of calls, not their order, unless the case says order matters. Operation names, card actions and field names in a case are exactly those of `runner-api.md` (for example `canAlwaysAllow`; decision cards answer through `approvals.resolve`, never `chats.act`). A case that spells a name differently is wrong, not the contract.

The adapter conformance suite (`packages/runner/src/agents/conformance.ts`, new) is one set of tests run against every agent adapter with its fake CLI: no bypass flag ever reaches the command line, the model flag is the only thing the picker changes, the start proof is required, Stop kills the process group, sign-in and quota states map to `needs_login` and the keeper, and the event stream maps to the same step results.

### 4.1 Harness H (the shared L3 setup)

Harness H is defined here once. Test cases name it ("Harness H") and add only what is special to them. B-00 "Shared test harness" is the first V1 step; it builds the parts that need nothing new from V1. The other parts join the harness in the task that builds the code they need.

What Harness H is:
- `createRunnerService` on a temporary data folder (created with `fs.mkdtemp` under the test's own folder and removed after), with the store opened by a helper that also gives the test the store handle.
- The sample flows of `packages/fixtures/src/story-v2/` registered and, unless a case says otherwise, confirmed at their current hashes. The hashes in cases are written `H1`, `H2`, `H3`: distinct `sha256:` values built by `contentHash` of the sample files.
- The fake claude signed in with the models `opus-5.5`, `sonnet-5.5` (default) and `haiku-5.5`; the fake codex built from an injected agent profile; the fake brain; a fake notice sink; a fake notifier.
- An injected clock that takes an IANA zone and an instant, and a counting id generator (`run-000000000001`, `ap-000000000001`, and so on). The default zone is `UTC`. A case that needs another zone says so and passes the zone as an argument (section 3).
- The settings of a ready app: the permission `on`, the main agent `claude-code` with model `sonnet-5.5`, `ready`, language `en`.
- Calls go through `createDispatcher` with caller `window` unless a case says otherwise.
- Builders that make the state a case would otherwise take from another case: `pendingDecision()`, `approvedDecision()`, `standingRule()`, `flowWithRules()`, `scheduleCard()`, `scheduleSet()`, `savedSkillFlow()` (their values are in the writer's calls of `test-cases/journeys.md`). A case uses a builder instead of naming another case in its Given.
- The sample flow `example.fill-timesheet` "Fill timesheet": inputs `date` (date, default `today`), `start` (time, optional, default "next free time"), `duration` (duration, required), `customer`, `project`, `activity` (choice Meeting, Bug fix, Feature work; all three `remember`), `did` (longtext, required); one touch `log-hours` (effect `change`, place `{kind: "account", value: "timesheet-account", label: "Timesheet account"}`, rule `asks_first`). Remembered: Example Corp, Project Example, Feature work.
- Remembered answers, the flows `example.weekly-supplier-report` and `example.email-triage`, the scripted fake-claude scripts (such as `email-triage-quiet`) and `CATCH_UP_GRACE_MS` (7,200,000 ms) are part of the story-v2 sample and the harness setup; a case that relies on one names it and the writer's calls in `journeys.md` give its value.

Which task adds each part:

| Part | Added by |
|---|---|
| Temporary data folder and store opener, the injected clock with an IANA zone, the counting id generator, the fake notice sink, `withTimeZone`, the call-recording seam in `FixtureRunnerClient`, the fake brain, the injected agent profiles and the fake codex driven by them, the fixture scan `TC-REPO-11` | B-00 |
| The `story-v2` sample data and its scenarios | B-01.T9 |
| The store version 6 fixture | B-03 |
| The both-languages `renderApp` wrapper and the CSS guards | B-06 |
| `renderApp` options such as `permission` and `failSettingsUpdate`, and the scenario `first_launch` | the task that builds the screen that needs them (B-20, B-21) |
| The fake notifier | the first task that sends a system notification (B-05) |
| Each builder (`pendingDecision()` and the others above) | the task that builds the state the builder makes |
| The real fake-codex script shapes (flags, events), written by hand after the research | B-22 |
| The fake keychain | B-26 (V2) |

Every test support part has its own small tests.

## 5. Test case ids and traceability

| Id | Meaning | File |
|---|---|---|
| `TC-jNN-xx` | A test for flow spec `FS-jNN` | `test-cases/journeys.md` |
| `TC-SRn-xx`, `TC-START-xx` | A test for a safety rule or the start rule | `test-cases/safety.md` |
| `TC-<COMPONENT>-xx` | A test for one component (`CON`, `SDK`, `STO`, `ENG`, `AST`, `INP`, `RES`, `STR`, `RUL`, `AGT`, `I18N`, `IPC`, `ELE`, `UI`, `SRCH`, `MEM`, `SKL`, `MKT`, `PHN`, `REPO`, `DOC`) | `test-cases/platform.md` |
| `L5-nn` | A Chair walk check (section 8) | this file |

Every test case names its layer, its file, Given, When, Then, what it traces (flow spec steps and acceptance criteria, safety rules, PRD features), its build step and why it fails first. A "Fails first because" line names the missing function, field, screen or word; "fails until the code exists" is not a reason.

Coverage rules:
- Every acceptance criterion `FS-jNN.A*` has at least one test case.
- Every safety rule has tests at each of its enforcement points (for SR-1: the decision table, the Claude Code hook channel, the Codex tier, and later the gateway).
- Every threat in `threat-model.md` that a safety rule mitigates is covered by that rule's tests; the threat model names them.
- Every runner API operation has a schema test (L1, contracts) and a handler test (L3).
- Every word key used in code exists in English, and every other language has the same placeholders. Keys built from a code (a status, for example) come from an exported key list (such as `STATUS_KEYS`) that the unused-key scan reads, because a scan cannot see a key that is built at run time.
- Every non-functional requirement (`NF-*` in `prd.md`) is covered by a test case, by an L5 check or by a measured target (section 8). The table "NF coverage" in section 8 lists how, and a test (`TC-REPO-12`) fails when an `NF-` id of `prd.md` is missing from it.
- A case's Given relies only on builders, fixtures and cases of the same or an earlier build step. A test (`TC-REPO-13`) reads the case files and `build-order.md` and fails when a Given names a case whose build step comes later.
- Cases that assert on words run in both languages where section 7 says so; runner cases assert codes and values.

## 6. Safety-critical testing

- The decision function of SR-1 is tested as a table: one row per effect class, per declared or undeclared tool, per standing rule match or near miss (wrong place, wrong flow, revoked), per one-time grant match or near miss (other input, used once already), and per risky kind that a draft tries to pre-select (the answer is always `not_allowed`, reason `always_asks`). Every row has an expected result: run, hold or refuse.
- Negative tests are first-class: outside text never creates or widens a standing rule; a chat turn with outside text in its context never starts a run; an approval answers only the exact action it showed (input digest); the agent's own output can never call a permission operation; the picker never adds a flag other than the model flag.
- Fail-closed tests: the hook channel denies on a timeout, an unreadable answer, a reused tool-use id or a wrong session; a missing start proof stops the step.
- Crash tests: after a simulated crash, a step that is not marked idempotent is not repeated by itself, and a held call does not run without its grant.
- The existing `review-*.test.ts` files keep pinning earlier security findings. New findings get new `review-*.test.ts` files.
- AGENTS.md requires one independent security review before merging changes to the runner, approvals, sandbox limits, flow hashing or signature checks. `build-order.md` marks the steps that need it.

## 7. UI testing

- Query by role and accessible name, the way a person or a screen reader finds things. Avoid test ids except for the existing `data-screen` and `data-screen-ready` markers.
- Status is always icon plus words: tests check the words, not a color.
- Keyboard paths are tested: Enter sends and Shift+Enter adds a line in the composer; Cmd or Ctrl+K opens Search; the agent and model menu moves with the arrow keys, chooses with Enter and returns focus to its button on Escape.
- Confirmations are tested both ways: the actions that must confirm (Delete, installs other than Set up, Approve all similar, turning the permission off, raising the spending limit) open a dialog; the actions that must not (Reject, Stop, Ask me again) act at once.
- Both languages. `renderAppBoth(hash, options, body)` (in `apps/desktop/src/test/render.tsx`, added in B-06) runs the same test body once in English and once in Bahasa Indonesia. It is used for the listed screens: welcome, the empty chat, the chat with each card kind, the picker menu, Flows, the flow page, Activity, the run page, Settings, Skills, the decision card and each dialog. A test lists the screens (`BOTH_LANGUAGES_SCREENS`) and fails when a listed screen has no test that uses the wrapper. A test that checks words on another screen may stay English-only.
- Long words. happy-dom has no layout, so no L2 test claims to see a cut button. Instead, CSS-guard tests (L1, in `layout-guards.test.ts`, which finds every `.css` file under `apps/desktop/src/` by a glob, so a new screen is guarded) assert on the CSS source: buttons, tags and tabs have no `word-break: break-all` and no `overflow-wrap: anywhere`; text inside a flex row sets `min-width: 0`; no horizontal overflow is allowed on the page; every `animation` and `transition` sits under `@media (prefers-reduced-motion: no-preference)` or is switched off under `reduce` (NF-33). The screenshots at narrow widths (L5-03) confirm what the guards imply.

## 8. Chair walks (L5)

L5 checks are done by the Chair with the owner, recorded in a short walk record per release (a note in `.workflow/`, with the date, the build and a pass or fail for each id). They are not part of `pnpm check`. `pnpm capture` produces the screenshots.

| Id | Check | Covers |
|---|---|---|
| L5-01 | Screenshots of every V1 screen in Light and Dark, in English and Bahasa Indonesia, at the window's minimum size and at 1440 px | F-25.R1, R3, R4, R5, NF-30 |
| L5-02 | The step track in each run state (done, running, waiting, failed, finished, stopped) in both color modes; with reduced motion on, nothing moves | F-25.R2, NF-33 |
| L5-03 | Narrow widths (480 px in the window; 320, 360 and 768 px in the browser preview) in both languages: no sideways scroll, no button, tag or tab cut inside a word | NF-35 |
| L5-04 | A keyboard-only walk of every V1 screen | NF-31 |
| L5-05 | A screen reader pass over the chat, the picker, a decision card and a dialog | NF-34 |
| L5-06 | A contrast spot check of the real screens in both modes (the token test of F-25.R6 covers the token pairs) | NF-32 |
| L5-07 | Measured times on a Mac less than five years old: first screen, message and working indicator, Search with 1,000 chats and 200 flows, 1,000 rows in the lists, a held call as a decision and as a notification, Stop | NF-01, NF-02, NF-04, NF-05, NF-06, NF-07 |
| L5-08 | Idle use with no run and the window closed: CPU and memory over ten minutes | NF-43 |
| L5-09 | A real first launch with a real Set up (the agent's own installer, run with the owner watching) on a separate data folder | F-01 |
| L5-10 | One chat run on Claude Code and one on Codex | F-04, F-21 |
| L5-11 | One held decision answered with Always allow for this flow, then undone with Ask me again | F-13 |
| L5-12 | One scheduled proactive question | F-09 |

Real-agent walks run with the owner watching, on a separate data folder, never inside `pnpm check`. A measured target (L5-07, L5-08) is a number recorded in the walk record against the target; it is not a gate, and a miss becomes a task.

The Codex research step (B-22) reads Codex's public help and documentation. The committed fake codex script is written by hand with synthetic values and follows the documented shapes. Raw notes from the research stay in `.workflow/scratch/` and are never committed. `TC-REPO-11` scans the committed script.

NF coverage (the check `TC-REPO-12` reads the ids in this table):

| NF ids | How they are covered |
|---|---|
| NF-01, NF-02, NF-04, NF-05, NF-06, NF-07 | Measured target, L5-07 |
| NF-43 | Measured target, L5-08 |
| NF-03, NF-08, NF-09, NF-10, NF-11, NF-12, NF-13, NF-14, NF-15, NF-16 | Runner test cases (L3) under `ENG`, `STO`, `STR` and `AGT` in `platform.md` and the journey cases that trace them |
| NF-17, NF-18, NF-19, NF-20, NF-21, NF-22 | Test cases under `STO`, `ELE`, `AGT` and `REPO` (including `TC-REPO-11`) |
| NF-23, NF-24, NF-25, NF-26, NF-27, NF-28, NF-29 | Test cases under `ELE`, `IPC`, `UI` and `AGT`, and the existing check tools |
| NF-30, NF-34 | L2 tests (words, roles, names), L5-05 |
| NF-31 | L2 keyboard tests, L5-04 |
| NF-32 | L1 token contrast test (F-25.R6), L5-06 |
| NF-33 | CSS-guard test (section 7), L2 test of the track, L5-02 |
| NF-35 | CSS-guard tests (section 7), L5-03 |
| NF-36, NF-37, NF-38, NF-54 | `I18N` cases (NF-54 is `TC-I18N-35`) |
| NF-39, NF-41, NF-42, NF-44 | Test cases under `AGT`, `ELE` and `AST` |
| NF-40 | Not a V1 test: the supported systems are set in B-30 |
| NF-45, NF-46, NF-47 | `REPO`, `SDK` and `RES` cases and `pnpm check:deps` |
| NF-48, NF-49, NF-50, NF-51, NF-52 | `CON` cases, the red run record (section 1), the no-network rule (section 3), the conformance suite and `pnpm check` |
| NF-53 | `DOC` cases |

## 9. Exit criteria for a release candidate

- Every test case of the release's build steps exists and passes; `pnpm check` is green.
- Every task of the release has its red run record cited in its handoff line.
- The independent security reviews of the marked steps are done and their findings are fixed or written down as known limits.
- The Chair walks of the release (section 8) are done and recorded.
- The owner has approved in the prototype the `PU` items (`prd.md` section 9.1) that the release's steps need, and then tries the release candidate.
