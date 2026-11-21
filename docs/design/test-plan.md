# Test plan: test-driven development for the real app

This plan says how every build step of the real app is driven by tests written first, where the tests live, and what they may not touch. The test cases themselves are in `test-cases/journeys.md` (one section per flow spec), `test-cases/safety.md` (one section per safety rule) and `test-cases/platform.md` (one section per component). `build-order.md` lists, for each build step, the test cases that must fail before its code is written.

## 1. The loop for every build step

Each build step (`B-01` to `B-30` in `build-order.md`) is split into plan tasks of one Codex call each. Every task follows the same loop:

1. Take the task's test cases from `build-order.md`.
2. Write those tests first. Run them and watch each one fail for the reason its "Fails first because" line gives. A test that passes before the code exists tests nothing: fix the test before going on.
3. Write the smallest code that makes the tests pass.
4. Tidy the code with the tests green.
5. Run `pnpm format`, then `pnpm check`. The task is done only when the gate passes.
6. Tick the task and add the handoff line from AGENTS.md: `Done by: <tool/model>, <date>. Evidence: <passing command>.` After two failures, write `Blocked: <short reason>` instead.

Codex writes tests and code, one task per call, and never commits. Claude reviews each task against its tests and commits (Chair step). A test is never weakened, skipped or deleted to make the gate pass. Deleting the tests of a screen or behavior that is being retired on purpose is an Ask-first item that the build plan names.

## 2. Test layers

| Layer | What it checks | Runs in | Uses | Typical file |
|---|---|---|---|---|
| L1 unit | One function or module: parsers, the decision function, schema refinements, word lookup | Vitest project `node` (packages) or `ui` (renderer helpers) | Plain inputs, injected clock and ids | `packages/runner/src/inputs/parse.test.ts` |
| L2 UI | What the person sees and can do: roles, names, words, keyboard, cards, dialogs | Vitest project `ui` with happy-dom and Testing Library | `renderApp(hash, {scenario})` from `apps/desktop/src/test/render.tsx` and `FixtureRunnerClient` | `apps/desktop/src/screens/chat/Composer.test.tsx` |
| L3 runner integration | A whole behavior inside the runner: a chat turn, a run with a held call, a scheduled start, a migration | Vitest project `node` | Real SQLite in a temporary data folder, the fake claude, the fake codex, the fake brain or the scripted harness, an injected clock | `packages/runner/src/starts/start-rule.test.ts` |
| L4 check tool | Repository rules enforced by `tools/checks` | `node:test` through `pnpm test:tools` | Temporary folders and files | `tools/checks/test/hidden-chars.test.mjs` |
| L5 Chair walk | What only a real window or a real agent can show: screenshots in both color modes and languages, a run on the owner's real agent with the owner watching | Not part of `pnpm check`; `pnpm capture` and the walk scripts in `apps/desktop/electron/` | The real app on its own data folder | `apps/desktop/electron/*-walk.ts` |

Prefer L1 and L3 for behavior, L2 for what the person sees, and L5 only where nothing else can see the result. The safety rules are tested at L1 (the decision table) and at L3 (the same rule end to end through the hook channel and the store).

## 3. Rules every test follows

- No test talks to the network, a real agent or a real account. Agents are the fake claude (`packages/runner/src/test-helpers/fake-claude.ts`), the fake codex (`packages/runner/src/test-helpers/fake-codex.ts`, new) and the fake brain (`packages/runner/src/test-helpers/fake-brain.ts`, new). The fakes run real hook scripts where the real agent would, so the hook channel is tested end to end.
- Sample data validates against `@flowdriven/contracts`. The chat-first sample (`packages/fixtures/src/story-v2/`, new) mirrors the prototype's flows: Build APK and upload it, Fill timesheet, Weekly supplier report, Email triage, Job review. The real app ships no sample; the fixtures exist for tests and `pnpm dev:web` only.
- Strings that need hidden or format characters are built at test time with `String.fromCodePoint`, never stored in a file. The hidden-character check scans every tracked file.
- Time comes from an injected clock; ids come from an injected generator. The suite runs with `TZ=UTC`. Every behavior that turns words into dates or times also has a test in a non-UTC zone (`Asia/Jakarta`) and one across a daylight-saving change (`Europe/Amsterdam`).
- No waiting on real time. Use the injected clock, fake timers or explicit events. A test that needs a sleep is a test that needs a seam.
- No test is skipped. `.skip`, `.only` and `.todo` do not reach a commit.
- Secrets never appear in fixtures. A test that needs a secret uses an obviously fake value built at test time and checks that it never reaches a prompt, a log line, a report or an export (SR-6).

## 4. Fakes and seams

| Seam | Used for | Where |
|---|---|---|
| Fake claude | Claude Code steps, chat turns, start proof, sign-in and quota events | existing `test-helpers/fake-claude.ts` and `fake-claude-script.ts` |
| Fake codex (new) | Codex steps, its event stream, its sandbox flag, sign-in status | `test-helpers/fake-codex.ts` |
| Fake brain (new) | Scripted chat-turn answers (intents as JSON) without an agent process | `test-helpers/fake-brain.ts` |
| Scripted harness | Engine tests that do not need a process | existing `scripted-harness.ts` |
| `FixtureRunnerClient` | Every renderer test | existing `packages/fixtures`, extended for contract v2 |
| Injected clock and ids | Schedules, expiry, 24-hour decisions, missed starts | engine and service dependencies |
| Fake keychain (new) | Secrets by reference (phone and bots, gateway) | `apps/desktop/electron/` tests |
| Fake notifier and tray (new) | Notifications, background running | `apps/desktop/electron/` tests |
| Temporary data folder | Store, migration, recovery, hook channel | `fs.mkdtemp` under the test's own folder |
| Store version 6 fixture (new) | The version 6 to 7 migration | `packages/runner/src/test-helpers/store-v6.ts` |

The adapter conformance suite (`packages/runner/src/agents/conformance.ts`, new) is one set of tests run against every agent adapter with its fake CLI: no bypass flag ever reaches the command line, the model flag is the only thing the picker changes, the start proof is required, Stop kills the process group, sign-in and quota states map to `needs_login` and the keeper, and the event stream maps to the same step results.

## 5. Test case ids and traceability

| Id | Meaning | File |
|---|---|---|
| `TC-jNN-xx` | A test for flow spec `FS-jNN` | `test-cases/journeys.md` |
| `TC-SRn-xx`, `TC-START-xx` | A test for a safety rule or the start rule | `test-cases/safety.md` |
| `TC-<COMPONENT>-xx` | A test for one component (`CON`, `SDK`, `STO`, `ENG`, `AST`, `INP`, `RES`, `STR`, `RUL`, `AGT`, `I18N`, `IPC`, `ELE`, `UI`, `SRCH`, `MEM`, `SKL`, `MKT`, `PHN`) | `test-cases/platform.md` |

Every test case names its layer, its file, Given, When, Then, what it traces (flow spec steps and acceptance criteria, safety rules, PRD features), its build step and why it fails first.

Coverage rules:
- Every acceptance criterion `FS-jNN.A*` has at least one test case.
- Every safety rule has tests at each of its enforcement points (for SR-1: the decision table, the Claude Code hook channel, the Codex tier, and later the gateway).
- Every threat in `threat-model.md` that a safety rule mitigates is covered by that rule's tests; the threat model names them.
- Every runner API operation has a schema test (L1, contracts) and a handler test (L3).
- Every word key used in code exists in English, and every other language has the same placeholders.

## 6. Safety-critical testing

- The decision function of SR-1 is tested as a table: one row per effect class, per declared or undeclared tool, per standing rule match or near miss (wrong place, wrong flow, revoked), per one-time grant match or near miss (other input, used once already), and per risky kind that a draft tries to pre-select. Every row has an expected result: run, hold or refuse.
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
- Both languages: each screen test that checks words runs in English and in Bahasa Indonesia.
- Long words: tests render Indonesian at the narrow width and check that no button text is cut (layout rules come from CSS; the L5 screenshots confirm them).

## 8. Chair walks (L5)

- `pnpm capture` produces screenshots of every screen in Light and Dark, and in both languages once version 9 is final.
- Real-agent walks run with the owner watching, on a separate data folder, never inside `pnpm check`: first launch with a real Set up, one chat run on Claude Code, one on Codex, one held decision answered with Always allow for this flow, one scheduled proactive question.
- The Codex research step (B-22) records the real CLI's behavior once with the owner watching; the recording becomes the fake codex's script, with anything personal removed.

## 9. Exit criteria for a release candidate

- Every test case of the release's build steps exists and passes; `pnpm check` is green.
- The independent security reviews of the marked steps are done and their findings are fixed or written down as known limits.
- The Chair walks of the release are done and recorded.
- The owner has approved the release's journeys in the prototype's Guide, and then tries the release candidate.
