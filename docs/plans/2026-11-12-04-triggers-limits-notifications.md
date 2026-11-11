# Plan 04: Triggers, Limits and Notifications Implementation Plan

> **Execution:** one task per Codex call through the handoff rules in AGENTS.md; Claude reviews each task against its gates. Steps use checkbox syntax for tracking.

**Goal:** With the window closed and FlowDriven still open, an hourly schedule starts a run on its own; a flood of 500 file changes starts at most 24 runs, drops the rest and sends one notification. The owner switches each trigger on from the flow's screen; a macOS notification appears when an approval waits, a run is blocked, the weekly limit needs an answer, a flood is capped or a trigger is paused after three blocked runs.

**Architecture:** A trigger service inside the runner (`triggers/` pure cores, `service/trigger-wiring.ts` glue) turns schedule ticks, file snapshots and finished upstream runs into `engine.beginStart(..., { trigger })`, so every fire passes readiness, R4, the keeper (class 2, the weekly line) and every other check a manual run passes. Enabling is an app-only operation that stores the flow's content hash; a changed hash stops the fire. A pure notice policy in the runner decides what may notify; the runner sends a fixed-template `notice` frame to the Electron main process, which shows a macOS notification through an injected function and opens the item on click. The runner stays the app's child over stdin/stdout.

**Tech Stack:** only what is on `tools/checks/allowlist.json`: Node 24 built-ins (`node:fs` for `watch`, `readdirSync`, `realpathSync`; `node:crypto`; `node:sqlite`), Zod 4 through `@flowdriven/contracts`, React 19, Electron 45 (`Notification`), Vitest, Biome. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-11-10-flow-maker-design.md` sections 8.3, 10.6, 12.4, 13.1 to 13.6, 15.2, 20.3, 20.6, 20.7 (R1, R4, R6, R7, R19 by analogy), 21.2, 21.7 (R19). Roadmap: `docs/plans/ROADMAP.md`, section "Order changed on 2026-11-12: plan 04 split", row 04. Branch `work/plan-04`, cut from the tip of `work/plan-03b`.

**Owner approval.** The owner answered the chair's question about starting plan 04 (triggers, schedule, notifications) with "Lanjut sekarang" on 2026-11-12, after asking on 2026-11-11 that work carry on without waiting for approval of each step. The chair takes that as the yes, under the "Ask first" list of AGENTS.md, for the runner changes this plan names: Tasks 2 to 11, 9b, 15 and 16 (the store, the trigger service and its wiring, the engine's day function in Task 7, the notice policy and the server's `notice` frame in Task 10). No approvals code is touched: `service/weekly-limit.ts` and its test are not edited, and Task 10 watches its settings write instead. Tasks 1, 12, 13, 14 and 17 touch contracts, Electron main, fixtures and the app and are not on that list. Anything else on that list (a dependency, CI, `tools/checks/`, an instruction file, a secret, the hashing and signature code, the sandbox limits, the approvals code, a test weakened) still needs its own yes, and the executor stops and writes `Blocked:` if a task seems to need one.

## Global Constraints

- Node `>=24.14.0`, pnpm `10.9.0`; English everywhere, ASCII only (no em dash) in this plan and in every file it creates.
- **Plain-Node rule** (plan 02b): code in `packages/*/src` uses relative imports that end in `.ts` and erasable TypeScript only (no `enum`, no `namespace`, no parameter properties). No `any`; `noUncheckedIndexedAccess` is on (write `list.at(0)?.x`); a bare `!` needs a comment. Time, ids, the day function, the watcher and the repeating job are injected. Hidden characters in tests are built with `String.fromCodePoint`.
- **Imports.** The runner imports `@flowdriven/contracts` only under `service/`, in `main.ts` and in `test-helpers/` (`source-rules.test.ts`), so `triggers/` and `notify/` define their own types and `service/` maps them. No `console.log` in runner sources (the demo script writes with `process.stdout.write`). `TZ=UTC` is fixed for every test by `vitest.config.ts` (lines 11 and 21); a test that needs another zone runs a child `node` with `TZ` set (Task 3), it never assigns `process.env.TZ`. The runner never imports `zod`. No runner source other than `test-helpers/` names `process.execPath`.
- **No wall-clock waits in tests.** No `setTimeout`, `sleep`, real polling or real `fs.watch` timing in a test of this plan. The clock (`now`), the repeating job (`every`), the watcher (`watch`) and the day function (`dayOf`) are injected, as the keeper's `every` is (03b decision 16). Tests call `svc.tick()` by hand and await `svc.settled()`. Real folders appear only as temporary directories that a test fills before it calls `tick()`. The known flaky test "S4b a tool that runs without the check after the abort still trips the wire and blocks" (`claude/review-03-s4.test.ts`) is not touched; if it fails in a full run it is re-run alone before it is blamed on this plan.
- **Fail closed.** A store row that does not parse, a flow that is missing, a hash that differs, a clock that moves back, a callback that throws: no fire, no throw out of `tick()`, one audit line where useful.
- **Off until the owner says so.** Only `triggers.setEnabled` (not offered over MCP, handled in `service/handlers.ts`) stores `enabled: true`; the only other write to `enabled` is the auto-pause of Task 9b, which writes `false`. No flow field, memory text, skill text, worker output, trigger payload or file name reads or writes it.
- **Counted by the runner (R6).** The per-day count is `store.counter("runs:<flowId>", day)`, the same row the engine increments; the dropped count is `store.counter("dropped:<flowId>", day)`. Neither comes from a payload or a worker.
- UI: plain CSS modules with the tokens of `apps/desktop/src/styles/tokens.css`; status is icon plus words, never colour alone.
- The executor never commits. Steps marked "Chair step (commit)", "Chair step (GUI)" or "Chair step (network)" are skipped and left unticked. After two failed attempts write `Blocked: <short reason>` under the task and stop. **No task asks the executor to run `pnpm start`, `pnpm capture`, electron, the real `claude`, to install the launch agent, or to bind a socket.**
- Nothing in this plan weakens, skips or deletes a present test, edits `tools/checks/`, CI, `AGENTS.md`, `CLAUDE.md` or a configuration file. A present test that lists operations, versions or counts is extended or changed to the equally strict new value; the few that must change are named under Tasks 1, 2 and 14 with the old and the new line. No other present test may change.

## Gates

| Gate | Command | Passes when | Who |
|---|---|---|---|
| Task gate | `pnpm format && pnpm check` | exit 0 | executor |
| One test file | `pnpm vitest run <path>` | the named tests pass | executor |
| Demo | `node packages/runner/src/test-helpers/trigger-demo.ts` | prints the lines of Task 16 | **Chair step (GUI)**, Task 18 |
| Capture | `pnpm capture` | `captured 22 screens`, exit 0 | **Chair step (GUI)**, Task 18 |
| Walk | the steps of Task 17 | the run appears with the window closed; a real notification shows | **Chair step (GUI)**, Task 18 |
| Commit | `git add ... && git commit ...` | commit created | **Chair step (commit)**, end of every task |

## Dependency changes

None.

## Facts

What the code looks like today (branch `work/plan-04`, commit `a4cd7f3`); every task relies on these. Lines are in `packages/runner/src/` unless a path is given.

1. **A triggered run already goes through `beginStart`.** `engine.ts:261-334`: `options.trigger` is `{ kind, payload? }` (`:43`, `:318`); a non-manual kind needs a trigger of that kind in the manifest (`:267-269`); the manifest is validated again and any error refuses the start (`:270-279`), which is R4 at run start, because `validateManifest` sets `beforeAsk` true for any manifest with a non-manual trigger (`sdk/src/validate/validate.ts:77`, `:179`). Required inputs are not defaulted (`:306-308`).
2. **The per-day cap exists and uses the UTC day.** `engine.ts:322-331`: `day = now().toISOString().slice(0, 10)`, counter `runs:<flowId>`, cap `manifest.limits?.max_runs_per_day ?? 24`, over it an audit `run_dropped` and `EngineError("not_allowed", "Daily run limit reached.")` (asserted at `engine-steps.test.ts:266`). The owner's day is local, so Task 7 replaces `now().toISOString().slice(0, 10)` with an injected `dayOf`.
3. **Runs of one flow already queue.** `engine.ts:84-110` (`enqueue`, `overlapping`) and `exec/chain.ts:1-30`: a new run of a flow that has a pending chain waits for the earlier one and `waitingOf` reports `flow_overlap` (`engine.ts:111-117`). So `overlap: queue` is the engine's behaviour; `overlap: skip` must be decided before `beginStart`. A run in `waiting_approval` does not hold the chain (its walk has returned).
4. **The SDK grammar.** `sdk/src/format/manifest.ts:7-47`: `schedule` has `every` (a `Duration`) or `at` (`HH:MM`), optional `days` (`mon` to `sun`), `catch_up: none|once` (default `none`), `overlap: skip|queue` (default `skip`); `file_change` has `path`, `glob` (default `**/*`), `debounce` (default `10s`); `flow_done` has `flow` and `status: done|any` (default `done`). `Duration` accepts `1s` (`sdk/src/format/steps.ts:5-12`), `durationMs` is exported (`:14`). `Limits` has `max_runs_per_day` and `max_items` (`steps.ts:31-36`). Loops already default `max_items` to 20 for a flow with a non-manual trigger (`exec/loop.ts:50`).
5. **`trigger` is a template root.** `exec/scope.ts:35` puts `run.trigger` in scope and `sdk/src/validate/refs.ts:41` allows `${trigger...}` in templates, so a payload that carries file names reaches instructions. Taint marks (R1) are not built yet.
6. **The keeper already treats triggered runs as class 2.** `service/keeper-wiring.ts:121` (`cls: run.trigger && run.trigger.kind !== "manual" ? 2 : 1`); the weekly line holds class 2 (`keeper/gate.ts`), the item and its answer exist (`service/weekly-limit.ts:1-129`, `onLimit` at `:75`). `createWeekly` has no callback when an item is created; it stores a new window with `putSetting("weekly:<id>", { resetsAt, askedAt, percent })` (`:101`, `resetsAt` in epoch seconds) and an answer with the same call plus `answer` (`:124`). Task 10 watches that write rather than change the file.
7. **The service has one place that builds things.** `service/service.ts:36-120`: the store is used as given, `weekly` is created at `:63`, the engine at `:68`, handlers at `:80`, `start()` at `:100-113` (recovery, then the demo flow), `stop()` at `:115-118`. `Handlers` is typed over every operation (`service/handlers.ts:40`) and so is the fixtures client (`packages/fixtures/src/client.ts:40`); a new operation needs both.
8. **The store.** `sqlite-store.ts:51-58` refuses `user_version > 3` and creates or migrates to 3; `schema.ts` holds `SCHEMA`, `HARNESS_STATE_SCHEMA`, `USAGE_SCHEMA`; `storage.ts:110-145` is the `Store` interface with `getSetting`, `putSetting`, `deleteSetting`, `increment`, `counter`, `listRuns({ flowId, state })`, `listFlows`, `getFlow(id, hash?)` (no hash: the newest registered). `service/events.ts:20-53` (`wrapStore`) maps store methods to change topics through a `Proxy`; `run-process.ts:55` wraps the store with it.
9. **Events and the link.** `service/server.ts:166-175` `notify` writes only `{ jsonrpc, method: "event", params }` and coalesces `changed` topics under back-pressure (`:168`, drain at `:157`); `apps/desktop/electron/runner-link.ts:150` accepts a notification only when `method === "event"`, anything else without an id fails the link (`:152-155`; the `event` branch is `:150-151`); `runner-bridge.ts:28` forwards events to the windows; with no window open they are dropped (`runner-ipc.ts:53-57` `broadcastRunnerEvent`).
10. **The app stays alive with its window closed on macOS.** `apps/desktop/electron/main.ts:50-52` quits on `window-all-closed` only when `process.platform !== "darwin"`; the runner child (`runner-link.ts`) keeps running; `activate` re-creates the window (`main.ts:45-48`). `createMainWindow` accepts a `hash` (`window.ts:82`, `:100`). The preload exposes exactly `call` and `subscribe` (`preload.test.ts`), so this plan does not touch the preload: a notification click navigates by hash.
11. **No folder-grant mechanism exists.** `projectDir` is `<dataDir>/project` (`service/service.ts:37`) and `flows.run` always uses it (`service/handlers.ts:251`); the `path` requirement's extra-folder grant of spec 9.4 is not built. So `file_change.path` can only be a folder inside the project folder in this plan (Decision 9).
12. **The demo walk and capture.** `apps/desktop/electron/screens.json` has 10 entries (20 captures, two themes); `src/screens.test.ts:8-9` asserts 10. `claude-walk.ts` imports a check flow into a real runner and drives the real Claude Code.
13. **A run's own folders are not inside the project folder.** The harness control folder is `<dataDir>/control/<id>` (`claude/control.ts:15-26`, `service/claude-harness.ts:234`) and the project folder is `<dataDir>/project` (`service/service.ts:40`), so a run's control folder can never lie inside a watched folder and the scan needs no special skip for it. A worker's own output files do land in the project folder (Known limits).
14. **`registerFlow` refuses a flow that fails R4.** `engine.ts:444-452` validates on registration and throws `invalid_input`; `review-r1.test.ts:42` relies on it. A test that needs such a flow stores it with `store.putFlow`.
15. **Present assertions this plan must change** (each named under its task): `operations.test.ts` sorted operation list (Task 1); `sqlite-store.test.ts:154-185` (version 3 to 4, "version 4 is refused" to "version 5 is refused") and the title of the migration test in `sqlite-store-usage.test.ts:~71` (Task 2); `screens.test.ts:8-9` (10 to 11, Task 14). `runner-link.test.ts` has no assertion about an unknown method, so the new `notice` method needs no change there.

**Measured on 2026-11-12** (this Mac, macOS 27.2, Node v24.14.0; scripts in `.workflow/scratch/plan-04/`, git-ignored):

| Command | Result |
|---|---|
| `TZ=America/New_York node dst.mjs` | `new Date(2026, 2, 8, 2, 30)` (a time that does not exist) gives 03:30 EDT, so a local clock time can shift by an hour; 09:00 local on 2026-03-07 to 09:00 on 03-09 is 47 elapsed hours, 48 under `Asia/Jakarta` and `UTC`. `new Date(2026, 10, 1, 1, 30)` (a time that exists twice) gives the first one (05:30Z). |
| `node watch.mjs` (`fs.watch(root, { recursive: true, persistent: false })`, then a file and a nested folder with a file are written) | three `rename` events: `a.txt`, `sub/deep`, `sub/deep/b.txt`; the event names are relative paths. |
| `fs.watch("/nonexistent/x", { recursive: true })` | throws `ENOENT` synchronously. |
| `readdirSync(dir, { withFileTypes: true })` over a folder with a symlinked folder and a symlinked file | both report `isSymbolicLink() === true`, `isDirectory() === false`, `isFile() === false`. |
| a write to a folder that a watched folder only links to | no event reached the watcher. |

Consequences: `every` slots are counted in elapsed time and `at` slots in local calendar dates (Decision 4); the watcher is only a wake-up signal and a scan is the truth (Decision 8); a scan skips every symlink (Task 4).

## Decisions made in this plan

Spec 18.4 and 20.3 leave these to the builder. Where the spec and the code disagree, the spec wins unless the decision says why not. All are the chair's call (owner may override).

1. **Triggers live in the runner, which stays the app's child.** On macOS the app lives on when its window closes (Fact 10), so a trigger fires with the window closed. No socket, no launch agent, no login item, no tray icon, no keep-awake and no wake from sleep: all of that is plan 04b (ROADMAP). A Mac that sleeps or an app that is quit does not fire; the screen says so (Task 14).
2. **Off until the owner enables it, by an app-only operation, bound to the flow's hash.** `triggers.setEnabled` is `mcp: "no"`, is written only in `service/handlers.ts`, and stores `{ enabled, hash, spec, enabledAt }`. If the flow's hash or the trigger's spec differs, the trigger does not fire and the screen says "Needs your OK again". The same hash returning (an undo) resumes it, because the owner's yes was about that exact content.
3. **A fire is a normal run.** The service calls `engine.beginStart(flowId, { project, inputs, trigger })`; nothing bypasses readiness, R4, the keeper or the checks. Inputs come from the declared defaults; a flow with a required input that has no default cannot be enabled (the reason is shown).
4. **Schedule evaluation is a pure function over injected time.** `every` slots are anchored at the enable time and counted in elapsed milliseconds (DST cannot move them); `at` slots are local calendar dates and clock times with one slot per date. `days` filters by the local weekday. The shortest `every` is 60 seconds (the SDK grammar stays; the service refuses shorter ones with a reason). The service ticks every 30 seconds. A slot older than 2 minutes when a tick sees it is "missed". `catch_up: once` turns all missed slots into at most one fire (payload `missed: N`); `none` drops them and records "missed". A clock that moves back fires nothing until time passes the last handled slot again.
5. **Overlap.** For `schedule`: `skip` (default) drops the fire while a run of the flow is open (`queued`, `checking`, `running`, `retrying`, `waiting_approval`); `blocked` and `interrupted` runs do not count, otherwise a crash could stop a schedule for ever (there is no cancel operation). `queue` lets the engine's chain hold it, with at most 2 queued runs per flow; more are not started. `file_change` and `flow_done` behave as `queue`; when the queue is full they retry on a later tick and consume nothing.
6. **The daily cap and floods (R7).** Cap = `limits.max_runs_per_day` or 24. Over it a fire is dropped and consumed (its keys are marked handled, so tomorrow does not replay them), `dropped:<flowId>` is incremented for the owner's local day, one audit line `trigger_capped` is written at drops 1, 10, 100 and 1000, and exactly one notice (`flood_cap`) goes out, on the first drop of that day. The engine's own check stays as a backstop.
7. **The day is the owner's local day**, from an injected `dayOf(date)` that defaults to local year, month and date. The engine uses it instead of the UTC day (Task 7).
8. **`file_change`: scan is the truth, `fs.watch` is a wake-up.** The runner watches the folder with `fs.watch(recursive)` when it can, marks it dirty on any event, waits for the debounce (default 10 seconds; while writes continue, at most the longer of 6 times the debounce and 60 seconds) and then scans. The service only wakes on its 30 second tick, so the real wait is the debounce rounded up to the next tick. It also scans at start and every 5 minutes, so a missed event or a restart is caught by the snapshot compare. The snapshot is `path -> [size, mtimeMs]` in a settings row; the key of a change is path plus size plus mtime. Enabling takes a baseline, so existing files do not fire. One fire carries at most `limits.max_items` (default 20) changed files; the rest stay changed and roll into the next fire.
9. **`file_change` stays inside the project folder.** No grant mechanism exists (Fact 11), so the path is resolved by real path at enable time and at every scan and must lie inside the real project folder; a relative path is relative to it; a symlink is never followed; at most 5,000 entries are scanned and the screen says when the cap is hit. Extra folders arrive with the grant work (Known limits).
10. **`flow_done` is deduplicated by the upstream run id** (the `fire_keys` table), survives a restart (each tick scans the upstream flow's runs that ended after the enable time and at most 7 days ago and claims the ones not yet handled), and stops chains with a depth cap of 3 (a run started by `flow_done` records `depth` in its payload) plus the daily cap. A flow cannot name itself.
11. **Payloads hold only what the runner made.** `schedule`: `{ slot, missed }`; `flow_done`: `{ flow, run, status, depth }`; `file_change`: `{ count, total, files }` where `files` are relative paths with control and hidden characters removed, each cut to 200 characters. File names are outside text and R1's taint mark is not built (Known limits); the unattended prefix check (R4) still bounds what such a run may do before its first `ask`.
12. **Notices come from a pure policy and fixed templates.** Five events (approval waiting, run blocked, weekly limit, flood cap, trigger paused); never progress or success; one per run per 10 minutes unless an approval waits; one per approval; one per flood per flow per local day; at most one weekly-limit notice per harness per 24 hours (a reset time that jitters cannot notify again); a flow that blocks again within 6 hours says nothing new (so an hourly flow with a missing requirement does not notify 24 times a day; spec 10.6 asks for batching, the 6 hours are the chair's choice). Text is a fixed template plus a sanitised flow name cut to 60 characters; never step output, never payload text.
13. **Transport.** The runner writes `{ jsonrpc, method: "notice", params }` on its stdout (a new method, not a new `changed` shape, so the renderer's event stream and the preload are untouched). Electron main validates the notice strictly, suppresses it while a window of the app is focused, shows it with the injected `Notification`, and on click focuses or re-creates the window and navigates by hash. The target is an allow-listed screen plus an id that matches `^[A-Za-z0-9:._-]{1,100}$`.
14. **Demo mode starts no triggers.** `triggers.list` works; `setEnabled(true)` answers `not_allowed` ("Triggers stay off in the demo."). Live mode starts the service after recovery.
15. **Unsupported kinds** (`new_item`, `link`, `webhook`, `manual`) are listed as "Not available yet" (`manual` as "Run by hand", never switchable) and `setEnabled(true)` on them is `not_allowed`.
16. **A contract change is its own task** (Task 1), additive (`CONTRACT_VERSION` stays 1), with stub handlers so the gate passes. The store migration is additive (3 to 4, Task 2).
17. **Not built, on purpose:** the socket, the launch agent, the hook channel on the socket (plan 04b); `new_item`, `link`, `webhook`; a tray icon; other adapters; `LoopStep.parallel` (so the R19 case "a flow's `parallel` only lowers the ceiling" stays for the plan that honours it); extra folder grants.
18. **Auto-pause (the chair's call, owner may override).** Three runs in a row started by one trigger that are all currently `blocked` switch that trigger off: `enabled: false` and `pausedAt` on its row, its watcher closed, an audit line `trigger_paused`, one notice of the kind `trigger_paused` (not held back by the 6 hour rule of Decision 12). Only the owner switches it on again; that clears `pausedAt` and `recentRuns`. The screen shows state `off` with the reason "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on." (no new contract value). Why: spec 20.7 R5 says a block gets no retry, and an hourly trigger that keeps running into the same block is a retry that also spends quota; plan 05 can pause at once on a challenge page through the same mechanism. It applies to all three kinds and does not change Decision 5 (a blocked run is still not "open").

## Review Focus

1. **A trigger fires without the owner's yes, or after the flow changed.** `review-04-r.test.ts` "only triggers.setEnabled switches a trigger on" and "an enabled trigger stops when the flow's content hash changes" (Task 15); `service.test.ts` "after the flow's hash changes the trigger does not fire" and "a setEnabled(false) that lands while a tick is held is not overwritten" (Task 7).
2. **A flood is not capped, or notifies more than once.** `service.test.ts` "the daily cap" (Task 7), `service-files.test.ts` "500 changed files" (Task 8), `service-done.test.ts` "a capped upstream run is counted once" (Task 9) and the demo test (Task 16).
3. **A fire skips a check a manual run passes.** `review-04-r.test.ts` "R4 at run start" and "a triggered run is class 2 at the keeper" (Task 15).
4. **A watched folder reaches outside the project folder** (a symlink, `..`, a path swapped after enable). `scan.test.ts` and `service-files.test.ts` (Tasks 4 and 8).
5. **Time misbehaves** (sleep, a clock that jumps back, DST). `schedule.test.ts`, `schedule-dst.test.ts` (Task 3) and `service.test.ts` "a clock that moves back" (Task 7).
6. **Notification text carries outside text.** `policy.test.ts` "a hostile flow name" (Task 6) and `notifier.test.ts` (Task 12).
7. **A trigger keeps running into the same block.** `service-pause.test.ts` (Task 9b) and `review-04-r.test.ts` "three blocked runs in a row pause the trigger" (Task 15).

---

## File Structure

```
packages/contracts/src/trigger.ts (new), notice.ts (new), operations.ts, run.ts, wire.ts, index.ts   TriggerStatus, Notice, operations, RunSummary.trigger (Task 1)
packages/runner/src/
  schema.ts, sqlite-store.ts, storage.ts, service/events.ts       triggers and fire_keys tables, migration 4, topics (Task 2)
  triggers/constants.ts, schedule.ts                              pure schedule and local day (Task 3)
  triggers/scan.ts                                                folder scan, snapshot diff, root check (Task 4)
  triggers/rules.ts                                               checkEnable, preflight, sanitising (Task 5)
  notify/policy.ts                                                the notice policy and templates (Task 6)
  triggers/service.ts, test-helpers/trigger-rig.ts, engine.ts     schedule, cap, overlap, flood (Task 7)
  triggers/service.ts                                             file_change (Task 8), flow_done (Task 9), auto-pause (Task 9b)
  service/notify-wiring.ts, server.ts, run-process.ts             store observer (approvals, blocked runs, the weekly settings write), notices, the notice frame, the sink (Task 10)
  service/trigger-wiring.ts, map-trigger.ts, map-run.ts, handlers.ts, service.ts   operations and start (Task 11)
  review-04-r.test.ts                                             proofs (Task 15)
  test-helpers/trigger-demo-run.ts, trigger-demo.ts               the evidence (Task 16)
apps/desktop/electron/runner-link.ts, runner-bridge.ts, notifier.ts (new), main.ts   notice to a macOS notification (Task 12)
packages/fixtures/src/state.ts, client.ts, story/triggers.ts (new), story/looped.ts   sample triggers (Task 13)
apps/desktop/src/screens/builder/TriggersPanel.tsx (new), BuilderScreen.tsx; screens/runs/RunsTable.tsx, RunDetailScreen.tsx; electron/screens.json   the screen (Task 14)
apps/desktop/electron/trigger-walk.ts, trigger-walk-steps.ts (new)   the walk for the real app (Task 17; Task 18 is the chair's)
docs/plans/ROADMAP.md                                             the 04 and 04b rows (written with this plan)
```

## Known limits

- Triggers fire only while FlowDriven is open. A Mac that sleeps through a slot treats it as missed (`catch_up` decides); a quit app fires nothing until it is opened again, when the first tick applies `catch_up`. A runner that exits and is restarted by the app keeps its triggers (state is in the store).
- `file_change` watches only folders inside the project folder (Decision 9). Beyond 5,000 entries the rest are not seen and the screen says so. `fs.watch` can miss events; the 5-minute scan and the start scan are the safety net, so a change can take up to 5 minutes to show when a watcher event is lost. Network and some external volumes may give no events at all.
- File names in a `file_change` payload are outside text and R1's taint mark is not built (Decision 11). A flow that puts `${trigger.payload.files}` into an instruction is exposed to prompt injection by a file name; the R4 prefix check limits what it can do before an `ask`, and nothing more.
- The notice policy keeps its throttle state in memory, so a restart forgets "one per run per 10 minutes". Flood notices cannot repeat because their source is stored (the first drop of a day); the weekly notice is limited to one per harness per 24 hours in memory, and a restart can allow one more.
- Notifications need macOS to allow them for the app. In development the app shows as "Electron". Whether a click on an existing window changes its hash without a reload is checked in the GUI step (Task 18), not by a test.
- The 6-hour quiet time for a flow that blocks again (Decision 12) stays next to the auto-pause (Decision 18); both are guesses to be tuned after real use. Three blocked runs are counted from the runs' current states, so a trigger whose runs end `failed` or `done` never pauses.
- Spec 10.6 also lists "the budget cap is reached or no worker has quota left" and "a revoked flow version is installed". Neither is built here: the budget cap needs the API-key brain (not built), a wait for quota leaves the run `running` and never notifies (spec 21.2: waiting on memory or the ceiling never notifies), and revoked versions need the marketplace.
- A `file_change` folder that the flow itself writes into re-triggers the flow after every run (the run's own files change the snapshot) until the daily cap stops it (24 runs a day by default, bounded by R7, but it spends quota). A run's control folder is outside the project folder (Fact 13) so it never causes this; a worker's output in the watched folder does. Nothing detects it; the owner should watch a folder the flow only reads.
- macOS App Nap can delay the runner's 30 second timer while the window is closed. A tick that comes more than 2 minutes after a slot counts that slot as missed, and with the default `catch_up: none` it is dropped silently (only `Missed while FlowDriven was closed` on the screen). No keep-awake is added (Decision 1); Task 18 step 4 observes two real slots.
- The debounce of `file_change` is rounded up to the 30 second tick (only the repeating job is injected; a watcher signal does not wake the service), so "10 seconds" means 10 to 40 seconds.
- `LoopStep.parallel` is still not honoured by the runner; the R19 case for it waits for the plan that does.
- Not proven: behaviour across a real DST change in the running app (the pure functions are proven in two zones, the service is proven only under `TZ=UTC`), and macOS notification delivery (chair steps only).

### Task 1: Contract: trigger status, two operations, the notice and the trigger on a run

**Files:**
- Create: `packages/contracts/src/trigger.ts`, `packages/contracts/src/notice.ts`, `packages/contracts/src/trigger.test.ts`
- Modify: `packages/contracts/src/operations.ts`, `run.ts`, `wire.ts`, `index.ts`, `operations.test.ts`; stub handlers in `packages/runner/src/service/handlers.ts` and `packages/fixtures/src/client.ts` so the typecheck passes (Tasks 11 and 13 replace them)

**Interfaces:**
- `trigger.ts`: `TriggerKind = z.enum(TRIGGER_KINDS)`; `TRIGGER_SWITCHES = ["off", "on", "needs_ok", "unavailable"]`, `TriggerSwitch`; `FIRE_OUTCOMES = ["started", "skipped_overlap", "dropped_cap", "dropped_queue_full", "duplicate", "needs_ok", "refused", "missed", "depth", "error"]`, `FireOutcome`; `TriggerStatus = z.object({ flowId: Id, index: z.number().int().min(0), kind: TriggerKind, summary: z.string(), state: TriggerSwitch, canEnable: z.boolean(), reason: z.string().max(300).optional(), nextAt: IsoDateTime.optional(), last: z.object({ at: IsoDateTime, outcome: FireOutcome, runId: Id.optional(), detail: z.string().max(200).optional() }).optional(), firesToday: z.number().int().min(0), droppedToday: z.number().int().min(0), dailyCap: z.number().int().min(1) })`.
- `notice.ts`: `NOTICE_KINDS = ["approval_waiting", "run_blocked", "weekly_limit", "flood_cap", "trigger_paused"]`; `NoticeId = z.string().regex(/^[A-Za-z0-9:._-]{1,100}$/)`; `NoticeTarget = z.discriminatedUnion("screen", [z.object({ screen: z.literal("inbox"), approvalId: NoticeId.optional() }), z.object({ screen: z.literal("run"), runId: NoticeId }), z.object({ screen: z.literal("builder"), flowId: NoticeId })])`; `Notice = z.object({ id: z.string().min(1).max(200), kind: z.enum(NOTICE_KINDS), title: z.string().min(1).max(80), body: z.string().min(1).max(240), target: NoticeTarget })` (all `.strict()` via `z.strictObject`).
- `operations.ts`: `"triggers.list"`: input `{ flowId: Id }`, output `z.array(TriggerStatus)`, `mcp: "no"`, errors `["invalid_input", "not_found"]`, reads `["flows", "runs"]`, writes `[]`. `"triggers.setEnabled"`: input `{ flowId: Id, index: z.number().int().min(0), enabled: z.boolean(), hash: ContentHash }`, output `TriggerStatus`, `mcp: "no"`, errors `["invalid_input", "not_found", "not_allowed", "unavailable"]`, reads `[]`, writes `["flows"]`.
- `run.ts`: `RunTrigger = z.object({ kind: z.string().regex(/^[a-z_]{1,20}$/), words: z.string().min(1).max(200) })` (a plain string kind, because `flow.ts` imports `run.ts` and an import of `TRIGGER_KINDS` would make a cycle) and `RunSummary` gains `trigger: RunTrigger.optional()`.
- `wire.ts`: `RpcNoticeFrame = z.object({ jsonrpc: z.literal("2.0"), method: z.literal("notice"), params: Notice })`.
- Stubs: runner `"triggers.list": () => []`, `"triggers.setEnabled": () => unavailable("Switching a trigger arrives in this plan.")`; fixtures `"triggers.list": () => []`, `"triggers.setEnabled": () => { throw new RunnerError("unavailable", "Switching a trigger arrives in this plan."); }`.
- **Present assertion that changes** (`operations.test.ts`, the sorted list of operation names): old: `... "settings.update", "usage.summary"]`; new: `... "settings.update", "triggers.list", "triggers.setEnabled", "usage.summary"]`. The MCP list in the next test is not changed, which proves both new operations are off MCP.

- [x] **Step 1: Write the failing tests** in `trigger.test.ts`:
  1. "a trigger status has a switch state, a reason, the next run, the last fire and today's counts" (parse a full and a minimal value; refuse a negative `firesToday` and a `dailyCap` of 0)
  2. "setEnabled needs an index, a boolean and a content hash" (refuse `hash: "abc"`, `index: -1`, a missing `enabled`)
  3. "both trigger operations are off MCP and are the only writers of the flows topic from this plan" (`operations["triggers.setEnabled"].mcp === "no"`, same for list)
  4. "a run summary carries its trigger in words and is still valid without it" (parse both; refuse empty `words`)
  5. "a notice has a kind, a short title and body, and an allow-listed target" (parse one of each target; refuse screen `"settings"`, a 300-character body, a `runId` with a slash, an extra key)
  6. "the notice frame is a `notice` notification and an `event` frame is not one" (`RpcNoticeFrame.safeParse` on both)
- [x] **Step 2: Run:** `pnpm vitest run packages/contracts/src/trigger.test.ts`. Expected: FAIL ("Cannot find module ./trigger.ts").
- [x] **Step 3: Implement** the files above and the stubs; update `operations.test.ts` as named. Export `trigger.ts` and `notice.ts` from `index.ts`.
- [x] **Step 4: Run** `pnpm vitest run packages/contracts packages/fixtures`. Expected: PASS (fixtures still validate; the new fields are optional).
- [x] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**

```bash
git add packages/contracts packages/runner/src/service/handlers.ts packages/fixtures/src/client.ts
git commit -m "Add the trigger status, the trigger operations, the notice and the run's trigger to the contract" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-12. Evidence: pnpm format && pnpm check.

---

### Task 2: The store: trigger rows, fire keys and migration 4

**Files:**
- Modify: `packages/runner/src/schema.ts`, `storage.ts`, `sqlite-store.ts`, `service/events.ts`, `sqlite-store.test.ts`, `sqlite-store-usage.test.ts`, `service/events.test.ts`
- Create: `packages/runner/src/sqlite-store-triggers.test.ts`

**Interfaces:**
- `schema.ts`: `TRIGGER_SCHEMA` = `CREATE TABLE triggers (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (flow_id, idx)); CREATE TABLE fire_keys (flow_id TEXT NOT NULL, idx INTEGER NOT NULL, key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (flow_id, idx, key));`
- `storage.ts`: `TriggerOutcome = "started" | "skipped_overlap" | "dropped_cap" | "dropped_queue_full" | "duplicate" | "needs_ok" | "refused" | "missed" | "depth" | "error"`; `TriggerRow = { flowId: string; index: number; enabled: boolean; hash: string; spec: string; enabledAt: string; cursorMs?: number; recentRuns?: string[]; pausedAt?: string; lastFire?: { at: string; outcome: TriggerOutcome; runId?: string; detail?: string } }` (`spec` is `JSON.stringify` of the manifest trigger; `cursorMs` is the last schedule slot handled; `recentRuns` holds the ids of the last 3 runs this trigger started, because a run row carries the kind but not the index; `pausedAt` is set by the auto-pause of Task 9b). No schema change: both live in the JSON `data` column. `Store` gains `getTrigger(flowId: string, index: number): TriggerRow | undefined`, `putTrigger(row: TriggerRow): void`, `listTriggers(flowId?: string): TriggerRow[]` (ordered by flow id, index), `claimKey(flowId: string, index: number, key: string, at: string): boolean` (true when the key was new), `purgeKeys(before: string): number`.
- `sqlite-store.ts`: refuse `user_version > 4`; version 0 creates everything and sets 4; 1 adds `HARNESS_STATE_SCHEMA`, `USAGE_SCHEMA`, `TRIGGER_SCHEMA`; 2 adds `USAGE_SCHEMA`, `TRIGGER_SCHEMA`; 3 adds `TRIGGER_SCHEMA`; each in one transaction. A row that does not parse as JSON or whose fields have the wrong types (including `recentRuns` that is not an array of at most 3 strings and a `pausedAt` that is not a date) reads as absent (`getTrigger`) and is left out of `listTriggers`; it is never repaired and never throws.
- `events.ts`: `putTrigger: ["flows"]` in `topics`.
- **Present assertions that change.** `sqlite-store.test.ts`: `:159`, `:169` and `:174` `expect(version(path)).toBe(3)` become `toBe(4)`; the titles at `:154` and `:171` say "version 4"; the test at `:177-185` sets `user_version = 5` and is titled "a database from version 5 is refused". `sqlite-store-usage.test.ts` "a version 2 database migrates to 3 and keeps its rows; version 99 is still refused": title says "to 4" and a line `expect(new DatabaseSync(path).prepare("PRAGMA user_version").get()?.user_version).toBe(4)` is added after the open (close that handle). Each is the same assertion for the new version, not a looser one.

- [x] **Step 1: Write the failing tests** in `sqlite-store-triggers.test.ts` (and `events.test.ts` for the last):
  1. "a trigger row round-trips, a put replaces it, and the list is by flow and index" (two flows, three rows, `listTriggers("f")`)
  2. "a row that is not JSON, or has the wrong field types (also `recentRuns` and `pausedAt`), reads as absent and is left out of the list" (write raw rows with `new DatabaseSync` on a temp file)
  3. "claimKey is true once per flow, index and key; the same key on another index or flow is new"
  4. "purgeKeys removes keys older than the cut and keeps the rest, and returns the count"
  5. "a version 3 database migrates to 4 and keeps its rows; version 5 is refused" (build with `SCHEMA`, `HARNESS_STATE_SCHEMA`, `USAGE_SCHEMA`, `PRAGMA user_version = 3`)
  6. (`events.test.ts`) "putTrigger marks the flows topic"
- [x] **Step 2: Run:** `pnpm vitest run packages/runner/src/sqlite-store-triggers.test.ts`. Expected: FAIL (`store.putTrigger is not a function`).
- [x] **Step 3: Implement**; change the present assertions as named.
- [x] **Step 4: Run** `pnpm vitest run packages/runner/src/sqlite-store packages/runner/src/service/events`. Expected: PASS.
- [x] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src
git commit -m "Add trigger rows, fire keys and migration 4 to the store" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-12. Evidence: pnpm format && pnpm check.

---

### Task 3: The schedule evaluator and the local day

**Files:**
- Create: `packages/runner/src/triggers/constants.ts`, `schedule.ts`, `schedule.test.ts`, `schedule-dst.test.ts`

**Interfaces:**
- `constants.ts`: `TICK_MS = 30_000`, `GRACE_MS = 120_000`, `MIN_EVERY_MS = 60_000`, `MAX_WINDOW_MS = 8 * 86_400_000`, `MAX_SCAN_ENTRIES = 5_000`, `RESCAN_MS = 300_000`, `MAX_DEBOUNCE_WAIT_MS = 60_000`, `DEFAULT_MAX_ITEMS = 20`, `DEFAULT_DAILY_CAP = 24`, `MAX_QUEUED_TRIGGERED = 2`, `MAX_CHAIN_DEPTH = 3`, `FLOW_DONE_WINDOW_MS = 7 * 86_400_000`, `FLOW_DONE_PER_TICK = 50`, `KEY_KEEP_MS = 30 * 86_400_000`, `OPEN_STATES = ["queued", "checking", "running", "retrying", "waiting_approval"]`, `SUPPORTED_KINDS = ["schedule", "file_change", "flow_done"]`.
- `schedule.ts`: `type ScheduleSpec = { everyMs?: number; at?: string; days?: number[] }` (`days`: 0 is Sunday); `localDay(date: Date): string` (`YYYY-MM-DD` from `getFullYear`, `getMonth`, `getDate`, zero padded); `scheduleOf(t: { every?: string; at?: string; days?: string[] }): ScheduleSpec` (`mon` to `sun` to 1..6,0; `every` through `durationMs`, a value it cannot read becomes `NaN`); `dueSlots(spec, w: { afterMs: number; uptoMs: number; anchorMs: number }): { slots: number; latest?: number; capped: boolean }`; `nextSlot(spec, w: { afterMs: number; anchorMs: number }): number | undefined`; `slotKey(spec: ScheduleSpec, slotMs: number): string`.
- No import of the contracts; `durationMs` from `@flowdriven/sdk`.

**Rules:**
1. `every`: slots are `anchorMs + k * everyMs` for `k >= 1`, counted in elapsed milliseconds; with `days`, only slots whose local weekday is listed. Without `days` the count is arithmetic, with `days` it iterates the window (at most 11,520 steps at 60 s).
2. `at` (`HH:MM`, validated; anything else gives no slots): for each local date from the date of `afterMs` to the date of `uptoMs`, the slot is `new Date(y, m, d, H, M).getTime()` on listed weekdays (the weekday is that of the date, not of the shifted time); it counts when `afterMs < slot <= uptoMs`.
3. A window longer than `MAX_WINDOW_MS` is cut to its last 8 days and `capped` is true. `afterMs >= uptoMs` (a clock that moved back), a spec with both or neither of `every` and `at`, a non-finite or non-positive `every`, or `every < 1`: no slots, no throw.
4. `slotKey`: `every:<slotMs>` or `at:<localDay of the slot>` (one key per date, so a slot that DST shifts by an hour still has one key).
5. `nextSlot` for `every` without `days` is arithmetic and has no window (`every: 30d` still shows its next slot); with `days` or for `at` it looks at most `MAX_WINDOW_MS` ahead and returns `undefined` when `days` is empty or nothing is found.

- [ ] **Step 1: Write the failing tests.** `schedule.test.ts` (`TZ=UTC`; `const H = 3_600_000`, `const T0 = Date.parse("2026-11-12T00:00:00.000Z")`, a Thursday):

```ts
test("every: slots follow the anchor in elapsed time, never at the anchor itself, and latest is the newest", () => {
  const spec = { everyMs: H };
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0, anchorMs: T0 })).toEqual({ slots: 0, capped: false });
  expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 3 * H + 5, anchorMs: T0 })).toEqual({ slots: 3, latest: T0 + 3 * H, capped: false });
  expect(dueSlots(spec, { afterMs: T0 + 3 * H, uptoMs: T0 + 3 * H + 5, anchorMs: T0 })).toEqual({ slots: 0, capped: false });
});
test("a clock that moved back and a bad spec give no slots and do not throw", () => {
  expect(dueSlots({ everyMs: H }, { afterMs: T0 + H, uptoMs: T0, anchorMs: T0 }).slots).toBe(0);
  for (const spec of [{}, { everyMs: 1, at: "09:00" }, { everyMs: Number.NaN }, { everyMs: -5 }, { at: "9:00" }, { at: "25:00" }])
    expect(dueSlots(spec, { afterMs: T0, uptoMs: T0 + 9 * H, anchorMs: T0 }).slots).toBe(0);
});
```
  Further tests: 3. "days filters by the local weekday for every and for at" (`days: [6]` Saturday 2026-11-14); 4. "at: one slot per local date at the clock time, none before it, two dates over two days"; 5. "a window longer than 8 days is cut and says capped"; 6. "nextSlot for every skips unlisted days and returns undefined for no days, and for at is today when the time is ahead and tomorrow when it has passed"; 7. "slotKey is per slot for every and per date for at, and localDay pads month and day"; 8. "scheduleOf maps names to weekdays and an unreadable duration to NaN".
  `schedule-dst.test.ts` runs `spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: zone, NODE_OPTIONS: "" }, encoding: "utf8" })` where `script` imports `schedule.ts` by `pathToFileURL`, calls the function and prints JSON (the pattern of `source-rules.test.ts`): 9. "America/New_York: at 02:30 on the spring-forward day 2026-03-08 gives one slot (03:30 EDT) and the key is that date, and at 01:30 on 2026-11-01 gives one slot, not two"; 10. "every 1h between 2026-03-07 09:00 and 2026-03-09 09:00 local counts 47 slots in America/New_York and 48 in Asia/Jakarta".
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/schedule`. Expected: FAIL ("Cannot find module ./schedule.ts").
- [ ] **Step 3: Implement** `constants.ts` and `schedule.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers
git commit -m "Add the schedule evaluator and the local day" -m "Assisted-by: Codex"
```

---

### Task 4: The folder scan, the snapshot compare and the watch root

**Files:**
- Create: `packages/runner/src/triggers/scan.ts`, `packages/runner/src/triggers/scan.test.ts`

**Interfaces:**
- `type Snapshot = Record<string, [number, number]>` (relative path with `/` to `[size, mtimeMs floored]`); `type ScanResult = { files: Snapshot; capped: boolean; outside: boolean }`.
- `resolveRoot(project: string, path: string): { ok: true; root: string } | { ok: false; reason: string }`: `project` real path (missing: `The project folder is missing.`); a relative `path` is joined to it; an empty path or one with NUL: `That folder path is not valid.`; the real path of the target (missing: `That folder does not exist.`); not a directory: `That path is not a folder.`; outside the real project folder (`relative()` starts with `..` or is absolute): `Only folders inside the project folder can be watched for now.`
- `scanFolder(root: string, o: { glob: string; maxEntries: number; within: string }): ScanResult`: iterative, directories and names sorted; skips every symlink (`Dirent.isSymbolicLink()`), anything that is neither a file nor a directory, and any file that vanishes mid-scan; before each directory checks that its real path is still inside `within` (a swapped folder is skipped) and checks it again after listing it (a listing taken after a swap to a link out is dropped); entries are read with `lstatSync`, never `statSync`, and only names, sizes and mtimes are read, never content; `outside: true` and no files when the root's own real path is outside `within`; counts every visited entry and stops at `maxEntries` with `capped: true`; only files whose relative path matches the glob are kept. No regular expression is built from the glob: `globMatches(glob: string, rel: string): boolean` matches by segments with `**` as zero or more segments and `*`, `?` inside a segment, by dynamic programming (no backtracking blow-up). `*` and `?` match dot-files; matching is case-sensitive; `**` counts only as a whole segment, anywhere else it is two `*`.
- `diffSnapshot(stored: Snapshot, scanned: Snapshot): { changed: string[]; removed: string[] }` (`changed`: new paths and paths whose size or mtime differ, sorted; `removed`: in stored, not in scanned).
- `parseSnapshot(value: unknown): Snapshot | undefined` (an object of `[number, number]` pairs with finite non-negative numbers and at most 5,000 keys, else `undefined`).
- `mergeHandled(stored: Snapshot, scanned: Snapshot, batch: string[]): Snapshot`: every scanned path is taken at its scanned value if it is unchanged or in `batch`; a changed path that is not in `batch` keeps its stored value (or stays absent), so it shows as changed again; removed paths are dropped.

- [ ] **Step 1: Write the failing tests** (real temporary folders from `test-helpers/tmp.ts`; no timing):
  1. "scans relative paths with size and floored mtime, sorted, and keeps only files that match the glob" (`**/*.pdf`, `*.txt`, `a?c.md`, `docs/**`)
  2. "a symlinked file and a symlinked folder inside the root are skipped" (target outside the project)
  3. "the cap stops the scan, says capped, and the same files are kept on a second scan"
  4. "a root whose real path is outside `within` scans nothing and says outside" (root is a symlink to a sibling folder)
  5. "resolveRoot accepts a relative and an absolute folder inside the project, and refuses `..`, a symlink out, a missing folder, a file and a NUL byte, each with its reason"
  6. "globMatches handles `**` with zero segments, a pattern of 40 stars without hanging, a literal dot, dot-files, case, and `a**b` as two stars"
  7. "diffSnapshot finds new, resized and re-dated paths and the removed ones"
  8. "parseSnapshot refuses a wrong shape, a non-finite number and more than 5,000 keys"
  9. "mergeHandled keeps the old value of a changed path that is not in the batch"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/scan.test.ts`. Expected: FAIL ("Cannot find module ./scan.ts").
- [ ] **Step 3: Implement** `scan.ts` with `node:fs` and `node:path` only.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers
git commit -m "Add the folder scan, the snapshot compare and the watch root check" -m "Assisted-by: Codex"
```

---

### Task 5: The enable check, the fire preflight and text sanitising

**Files:**
- Create: `packages/runner/src/triggers/rules.ts`, `packages/runner/src/triggers/rules.test.ts`

**Interfaces:**
- `checkEnable(i: { manifest: FlowManifest; files: Record<string, string>; index: number; projectDir: string; flowExists: (id: string) => boolean; selfId: string }): { ok: true } | { ok: false; reason: string }`. First failure wins, in this order: (1) no trigger at `index`: `There is no such trigger.`; (2) `manual`: `Run by hand. There is nothing to switch.`; `new_item`, `link`, `webhook`: `Not available yet.`; (3) `validateManifest(manifest, { files: new Set(Object.keys(files)) })` has an error (R4 among them): `This flow cannot run unattended: <message> at <path>` built from the first error issue (for R4 the message is `unattended prefix` and the path is `steps.0`; the SDK is not changed). At enable time this is a backstop, because `engine.registerFlow` already refuses a flow that fails R4 (Fact 14); (4) a required input without a default: `Input "<id>" is required and has no default, so a trigger cannot start this flow.`; (5) `schedule`: `every` below `MIN_EVERY_MS`: `The shortest schedule is every 1 minute.`; `days: []`: `No days are selected.`; (6) `file_change`: an empty or NUL path, a glob longer than 200 characters or with more than 8 `**`: `That file pattern is too long or too complex.`; `resolveRoot` failing: its reason; (7) `flow_done`: `flow === selfId`: `A flow cannot start itself.`; `!flowExists(flow)`: `The flow "<flow>" is not on this Mac.`
- `inputsFromDefaults(manifest: FlowManifest): { ok: true; inputs: Record<string, Value> } | { ok: false; reason: string }` (a declared default of a supported value type becomes the input; a required input without one fails with the reason of rule 4).
- `preflight(i: { enabled: boolean; hashOk: boolean; r4Errors: string[]; runsToday: number; cap: number; open: number; queued: number; overlap: "skip" | "queue" }): { ok: true } | { ok: false; outcome: TriggerOutcome; consume: boolean; detail: string }`. Order: not enabled or hash differs: `needs_ok`, `consume: false`; any `r4Errors`: `refused`, `consume: true`, detail the first message cut to 200; `runsToday >= cap`: `dropped_cap`, `consume: true`; `open > 0` and `overlap === "skip"`: `skipped_overlap`, `consume: true`; `open > 0` and `queued >= MAX_QUEUED_TRIGGERED`: `dropped_queue_full`, `consume: false`; else ok.
- `sanitizeText(text: string, max: number): string`: first replaces every `\p{White_Space}` character (so `\t`, `\n`, `\r` and U+2028 become spaces and words are not joined), then removes `\p{Cc}`, `\p{Cf}`, `\p{Zl}` and `\p{Zp}`, then collapses runs of spaces to one, trims, and when longer than `max` cuts to `max - 3` characters and adds `...`; works on code points, not UTF-16 units.
- `payloadFiles(paths: string[], max: number): string[]` (first `max` paths through `sanitizeText(path, 200)`; an empty result after sanitising is dropped).
- `triggerWords(kind: string, payload: Value | undefined, flowNameOf: (id: string) => string | undefined): string | undefined`: `schedule`: `Started by its schedule` (`, catching up on N missed` when `payload.missed > 0`); `file_change`: `Started by a change in the watched folder`; `flow_done`: `Started after <flow name or id>` (name through `sanitizeText(..., 60)`); `manual` or an unknown kind: `undefined`.

- [ ] **Step 1: Write the failing tests** (`rules.test.ts`, manifests from `parseManifest` as in `test-helpers/flows.ts`; the R4 case is a flow with a requirement `{ id: "mail", type: "mcp_server", ref: "mail", tools: ["SMSSend"] }` and a first step `uses: ["mail"]` followed by nothing before the end, with a `schedule` trigger, as in `sdk/src/validate/validate.test.ts:141-148`):
  1. "checkEnable accepts a schedule, a file_change inside the project and a flow_done for a flow that exists"
  2. "checkEnable refuses a flow that fails R4, with the reason `This flow cannot run unattended: unattended prefix at steps.0`"
  3. "checkEnable refuses new_item, link and webhook as not available yet and manual as nothing to switch"
  4. "checkEnable refuses a required input without a default, a 30 second schedule, an empty days list, a path outside the project, a flow_done on itself and on a missing flow"
  5. "inputsFromDefaults fills declared defaults and fails on a required input with none"
  6. "preflight decides in order: needs_ok, refused, cap, skip, queue full, ok, and says whether the fire is consumed" (table test)
  7. "a hostile flow name loses control, bidi and zero-width characters, collapses spaces and is cut at 60 characters" (characters built with `String.fromCodePoint(0x202e, 0x200b, 0x0007, 0x2028)`)
  8. "sanitizeText cuts by code points and never splits a surrogate pair" (an emoji built with `String.fromCodePoint(0x1f600)` at the cut)
  9. "payloadFiles caps the count and the length and drops names that sanitise to nothing"
  10. "triggerWords gives plain words for each kind and nothing for manual"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/rules.test.ts`. Expected: FAIL ("Cannot find module ./rules.ts").
- [ ] **Step 3: Implement** `rules.ts` (imports `scan.ts`, `schedule.ts`, `constants.ts`, `@flowdriven/sdk`; `TriggerOutcome` from `../storage.ts`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers
git commit -m "Add the enable check, the fire preflight and text sanitising for triggers" -m "Assisted-by: Codex"
```

---

### Task 6: The notice policy

**Files:**
- Create: `packages/runner/src/notify/policy.ts`, `packages/runner/src/notify/policy.test.ts`

**Interfaces:**
- `type NoticeEvent = { kind: "approval_waiting"; runId: string; approvalId: string; flowName: string } | { kind: "run_blocked"; runId: string; flowId: string; flowName: string } | { kind: "weekly_limit"; harnessId: string; percent: number; resetsAtMs: number } | { kind: "flood_cap"; flowId: string; flowName: string; day: string; cap: number } | { kind: "trigger_paused"; flowId: string; index: number; flowName: string; pausedAt: string }`.
- `type NoticeTarget = { screen: "inbox"; approvalId?: string } | { screen: "run"; runId: string } | { screen: "builder"; flowId: string }`; `type NoticeOut = { id: string; kind: NoticeEvent["kind"]; title: string; body: string; target: NoticeTarget }`.
- `createNoticePolicy(o: { nowMs: () => number }): { decide(event: NoticeEvent): NoticeOut | undefined }`. Constants `RUN_THROTTLE_MS = 600_000`, `BLOCKED_FLOW_QUIET_MS = 21_600_000`, `WEEKLY_QUIET_MS = 86_400_000`, `NAME_MAX = 60`, `SENT_MAX = 1000`. The module imports `sanitizeText` from `../triggers/rules.ts` and no contracts.

**Rules (no other kind can notify, so progress and success never do):**
1. `approval_waiting`: id `approval:<approvalId>`, sent once per approval id; not subject to the per-run throttle but it sets the run's last-sent time. Title `Waiting for you`, body `<name>: an approval is waiting.` Target `{ screen: "inbox", approvalId }`.
2. `run_blocked`: id `blocked:<runId>`; dropped when the same run notified in the last 10 minutes; dropped when the same flow notified a block in the last 6 hours. Title `Run blocked`, body `<name> is blocked and needs a look.` Target `{ screen: "run", runId }`.
3. `weekly_limit`: id `weekly:<harnessId>:<resetsAtMs>`; at most one per harness per 24 hours (a second one inside 24 hours is dropped even when `resetsAtMs` differs, so a reset time that jitters cannot notify again); refuse a `harnessId` that does not match `^[a-z0-9-]{1,40}$` and a `percent` outside 0..100. `<who>` is `Claude Code` for `claude-code` and `A harness` for any other id. Title `<who>'s weekly limit`, body `<who>'s weekly limit is <percent>% used and resets on <weekday>. Keep running triggered flows?` (weekday from `toLocaleDateString("en-US", { weekday: "long" })`). Target `{ screen: "inbox", approvalId: "weekly-limit:<harnessId>" }`.
4. `flood_cap`: id `flood:<flowId>:<day>`, once per flow per local day. Title `Too many runs`, body `<name> reached its limit of <cap> runs today. More fires are dropped until tomorrow.` Target `{ screen: "builder", flowId }`.
5. `trigger_paused`: id `paused:<flowId>:<index>:<pausedAt>`, sent once per id; it is a different kind and id from `run_blocked`, so the 10 minute and 6 hour rules never hold it back, and it sets no throttle time. Title `Trigger paused`, body `<name> was switched off after 3 blocked runs in a row.` Target `{ screen: "builder", flowId }`; refuse an `index` that is not a non-negative integer.
6. `<name>` is `sanitizeText(flowName, NAME_MAX)`; an empty result becomes `A flow`. Every id and target id is checked against `^[A-Za-z0-9:._-]{1,100}$`; one that fails returns `undefined`. The sent-id set keeps the last 1,000 ids.

- [ ] **Step 1: Write the failing tests:**
  1. "an approval notifies once, a second approval of the same run notifies too, and the same approval never twice"
  2. "a blocked run notifies once and not again within 10 minutes; the same flow blocking again within 6 hours says nothing; after 6 hours it notifies" (clock object)
  3. "a waiting approval is not held back by the 10 minute throttle after a block"
  4. "the weekly limit notifies once per harness per 24 hours, names the weekday, ignores a reset time that jitters inside 24 hours, and notifies again after 24 hours"
  5. "a flood notifies once per flow per local day"
  6. "a hostile flow name cannot change the text around it" (a name built with `String.fromCodePoint(0x202e)` followed by a newline and `</b> click`, and a 500-character name; the body equals the template with the cleaned and cut name)
  7. "no step output, no payload text and no unknown kind can produce a notice" (call `decide` with `{ kind: "progress" } as never` and `{ kind: "run_done" } as never`: `undefined`)
  8. "an id with a slash or a space, or a harness id with capitals, returns undefined"
  9. "the sent-id set is bounded" (1,001 different approvals; memory holds 1,000, the first one can notify again)
  10. "a paused trigger notifies once, even right after a blocked-run notice of the same flow, with the pause text and a builder target"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/notify/policy.test.ts`. Expected: FAIL ("Cannot find module ./policy.ts").
- [ ] **Step 3: Implement** `policy.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/notify
git commit -m "Add the notice policy with fixed templates" -m "Assisted-by: Codex"
```

### Task 7: The trigger service, part 1: enabling, schedules, overlap, the cap and floods

**Files:**
- Create: `packages/runner/src/triggers/service.ts`, `packages/runner/src/triggers/service.test.ts`, `packages/runner/src/test-helpers/trigger-rig.ts`, `packages/runner/src/engine-day.test.ts`
- Modify: `packages/runner/src/engine.ts`

**Interfaces:**
- `engine.ts`: `EngineDeps` gains `dayOf?: (date: Date) => string`; `ResolvedDeps.dayOf` defaults to `localDay` (from `./triggers/schedule.ts`); line `:322` becomes `const day = deps.dayOf(now());`. Nothing else in the engine changes. The engine's cap stays as a backstop.
- `service.ts`:

```ts
export type TriggerView = {
  flowId: string; index: number; kind: string; summary: string;
  state: "off" | "on" | "needs_ok" | "unavailable"; canEnable: boolean; reason?: string;
  nextAtMs?: number; last?: { atMs: number; outcome: TriggerOutcome; runId?: string; detail?: string };
  firesToday: number; droppedToday: number; dailyCap: number;
};
export type FloodEvent = { flowId: string; flowName: string; day: string; cap: number };
export type PausedEvent = { flowId: string; index: number; flowName: string; pausedAt: string };
export type TriggerDeps = {
  store: Store; now: () => Date; dayOf: (date: Date) => string; projectDir: string;
  begin: (flowId: string, options: StartOptions) => Begun;
  every: (ms: number, fn: () => void) => () => void;
  watch: (path: string, onSignal: () => void) => (() => void) | undefined;
  summaryOf: (trigger: Trigger) => string;
  onFlood?: (event: FloodEvent) => void;
  onPaused?: (event: PausedEvent) => void;   // Task 9b
};
export interface TriggerService {
  list(flowId: string): TriggerView[];                  // manual entries are left out; index is the manifest index
  setEnabled(flowId: string, index: number, enabled: boolean, hash: string): TriggerView;
  start(): void; stop(): void; tick(): Promise<void>; poke(): void; settled(): Promise<void>;
}
export function createTriggerService(deps: TriggerDeps): TriggerService;
```

- `trigger-rig.ts`: `triggerRig(flows: { manifest: FlowManifest; files?: Record<string, string>; raw?: true }[], script?: Script, options?: { project?: string; readiness?: EngineDeps["readiness"]; afterList?: () => void })` builds on `test-helpers/engine.ts` `setup` (scripted harness, in-memory store, a clock with `advance`; `readiness` is passed to the engine so a test can make every run end `blocked`), registers every flow with `engine.registerFlow` under its own hash `sha256:<n repeated 64>` (an entry with `raw: true` is stored with `store.putFlow({ id, version, hash, manifest, files, registeredAt })` instead, because `registerFlow` refuses a flow that fails R4, Fact 14), and returns `{ svc, engine, store, clock, project, floods, jobs, watchers, hashOf(flowId), enable(flowId, index), runsOf(flowId), idle(), setDay(fn) }` where `jobs` holds the `every` callbacks (a test calls `svc.tick()` itself), `watchers` maps a watched path to its signal function and records `close` calls, `floods` collects `onFlood` events, `begin` records every `Begun` so `idle()` awaits all their `settled`, `dayOf` is `localDay` until `setDay` replaces it, and `project` is a temporary directory. A helper `triggerFlow(id, triggers, extra?: { limits?; inputs?; steps? })` builds a one-step flow named `Test` (as `oneStepFlow` does) with the given triggers and `limits`; `r4Flow(id)` builds a flow with a `schedule` trigger, an `mcp_server` requirement `mail` with the tool `SMSSend`, and a first step that uses it (R4 refuses it, as in `sdk/src/validate/validate.test.ts:141-148`); a test passes it with `raw: true`.

**Rules:**
1. `setEnabled(flowId, index, enabled, hash)`: the flow must exist (`not_found`, "There is no flow <id>.") and `index` must exist (`not_found`); `hash` must equal the stored flow's hash, else `not_allowed` ("This flow changed since you looked at it. Reload and check it again."). Turning off always works: the row keeps its hash and spec with `enabled: false`, any watcher for it is closed, an audit `trigger_disabled` is written (`{ flowId, index }`). Turning on runs `checkEnable` (Task 5); a failure is `not_allowed` with its reason; on success the row is `{ enabled: true, hash, spec: JSON.stringify(trigger), enabledAt, cursorMs: nowMs }` (a re-enable resets the cursor, so the time the trigger was off is never caught up, and clears `pausedAt` and `recentRuns`), an audit `trigger_enabled` is written (`{ flowId, index, kind, hash }`), and `file_change` takes its baseline (Task 8). Enabling an enabled row with the same hash returns the view unchanged.
2. `list`/view state: no row or `enabled: false`: `off` (when the row has `pausedAt` the reason is "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on."); `enabled` and `row.hash === flow.hash` and the manifest trigger's `JSON.stringify` equals `row.spec`: `on`; `enabled` with a different hash or spec: `needs_ok`, reason "This flow changed. Turn the trigger on again to approve this version."; kinds other than the three: `unavailable`, reason "Not available yet.". `canEnable` is `checkEnable(...).ok` (and false for `unavailable`); when it is false its reason is `reason`. `nextAtMs` for an `on` schedule is `nextSlot(spec, { afterMs: nowMs, anchorMs: enabledAt })`. `firesToday` is `store.counter("runs:<flowId>", dayOf(now))`, `droppedToday` is `store.counter("dropped:<flowId>", day)`, `dailyCap` is `limits.max_runs_per_day ?? 24`. `last` comes from the row.
3. `tick()` is serialised through one promise chain; it never throws. For each row of `store.listTriggers()` that is `enabled` (inside each trigger's own synchronous section the row is **re-read** with `store.getTrigger`, skipped when it is no longer enabled, and `lastFire`, `cursorMs`, `recentRuns` and every other field are written onto that fresh row; a row read before an await is never written back, so a `setEnabled(false)` that lands in between cannot be overwritten with `enabled: true`): skip when the flow is missing, when `flow.hash !== row.hash` or the spec differs (record `needs_ok` once: only when the stored `lastFire` is not already `needs_ok`), or when the row does not parse (the store already hides it). Each trigger is handled inside its own `try`; an exception becomes `lastFire: { outcome: "error", detail: message cut to 200 }` and the next trigger goes on. `poke()` schedules one `tick()` in a microtask, coalesced.
4. **Schedule handling.** `anchor = Date.parse(row.enabledAt)`, `cursor = row.cursorMs ?? anchor`, `due = dueSlots(scheduleOf(trigger), { afterMs: cursor, uptoMs: nowMs, anchorMs: anchor })`. No slots: nothing. `onTime = nowMs - due.latest <= GRACE_MS`. When not on time and `catch_up !== "once"`: set `cursorMs = latest`, `lastFire = { at, outcome: "missed", detail: "<n> missed" }`, no run. Otherwise one fire with key `slotKey(...)` and payload `{ slot: ISO of latest, missed: onTime ? slots - 1 : slots }`. After any outcome the cursor becomes `latest` (a slot is handled once, even when it is dropped). When `cursorMs > nowMs + 86_400_000` (the clock jumped far ahead and came back) the cursor is reset to `nowMs` and `lastFire` records `missed` with detail `clock moved back`, so the trigger is never silent until a far-future time.
5. **The common fire path** `fire(row, flow, trigger, key, payload, overlap)`, all synchronous, in this order: (a) `r4Errors` = the error messages of `validateManifest(manifest, { files })`; (b) `preflight(...)` with `runsToday`, `cap`, `open` (runs of the flow in `OPEN_STATES`), `queued` (runs in `queued`), `overlap` (`trigger.overlap` for a schedule, `"queue"` for the other kinds); (c) a result that is not ok and has `consume: false` (`needs_ok`, `dropped_queue_full`) returns at once: nothing is claimed or counted, so the fire can be retried; (d) `store.claimKey(flowId, index, key, at)`; false means `duplicate` and the fire returns without counting anything, so a key that was already dropped is never counted again; (e) a result that is not ok and has `consume: true` (`refused`, `dropped_cap`, `skipped_overlap`) now takes its drop path (rule 6) with the key already claimed, so it is counted once; (f) `inputsFromDefaults` (a failure is `refused`); (g) `deps.begin(flowId, { project: deps.projectDir, inputs, trigger: { kind, payload } })` inside `try`; an `EngineError` with code `not_allowed` or `invalid_input` is `refused` with its message, any other error is `error`; success is `started` with the run id, which is pushed onto the row's `recentRuns` (the last 3 are kept). The row's `lastFire` is updated with the outcome, the time and the run id, but for an outcome other than `started` only when the outcome or the detail differs from the stored one (a missing folder or a full queue must not write a row, and mark the `flows` topic, every 30 seconds). Order matters: a key is claimed before the run starts, so a crash in between loses a fire and never doubles it.
6. **Drops (R7).** `dropped_cap`: `n = store.increment("dropped:<flowId>", day)`; an audit `trigger_capped` (`{ flowId, day, cap, dropped: n }`) when `n` is 1, 10, 100 or 1000; when `n === 1` call `deps.onFlood({ flowId, flowName, day, cap })` inside `try` (an exception is swallowed). `refused` writes an audit `trigger_refused` (`{ flowId, index, reason }`) at most once per row and reason (compare with the stored `lastFire.detail`).
7. **Overlap and queue.** `skip` with an open run: `skipped_overlap`, the slot is consumed. `queue` with an open run: the run starts and the engine's chain holds it (`flow_overlap`); with 2 runs already `queued`: `dropped_queue_full`, nothing consumed. For a `schedule` the cursor still moves (the slot is lost, as with `skip`); only `file_change` and `flow_done` keep their fire for a retry.
8. **Time and callbacks.** The service reads only `deps.now()`; a `now` earlier than the cursor yields no slots and changes nothing (Task 3 rule 3); `start()` calls `deps.every(TICK_MS, () => void tick())` and runs one `tick()` at once; `stop()` cancels the job and closes every watcher. A `deps.every` or `deps.watch` that throws is treated as "cannot": `start()` writes an audit `trigger_start_failed` and does not throw; a missing watcher is the periodic fallback of Task 8.
9. **Two triggers of one flow due in one tick** are handled in index order; the second sees the first one's run as open and follows its own overlap rule.
10. **A fire is decided and started in one synchronous section** (the check of `enabled`, the hash, the claim and `begin` have no await between them). `setEnabled(false)` that comes before the section stops the fire; one that comes after it does not cancel the run that started (switching off stops new fires only).

- [ ] **Step 1: Write the failing tests.** `service.test.ts` (rig; flows `local.hourly` with `{ kind: "schedule", every: "1h" }`; `const H = 3_600_000`; the clock starts at the rig's `2026-11-11T09:00:00.000Z`):

```ts
test("an hourly schedule fires once an hour, as a triggered run with its slot, and not before it is enabled", async () => {
  const r = await triggerRig([{ manifest: triggerFlow("local.hourly", [{ kind: "schedule", every: "1h" }]) }]);
  r.clock.advance(2 * H); await r.svc.tick(); await r.idle();
  expect(r.runsOf("local.hourly")).toHaveLength(0);              // off until the owner enables it
  r.enable("local.hourly", 0);
  r.clock.advance(H); await r.svc.tick(); await r.idle();
  const run = r.runsOf("local.hourly").at(0);
  expect(run?.trigger).toEqual({ kind: "schedule", payload: { slot: "2026-11-11T12:00:00.000Z", missed: 0 } });
  expect(run?.state).toBe("done");
  r.clock.advance(H); await r.svc.tick(); await r.idle();
  expect(r.runsOf("local.hourly")).toHaveLength(2);
});
test("the daily cap: 30 fires of a flow capped at 3 start 3 runs, drop 27, notify once, and the next local day starts again", async () => {
  const r = await triggerRig([{ manifest: triggerFlow("local.capped", [{ kind: "schedule", every: "1m" }], { limits: { max_runs_per_day: 3 } }) }]);
  r.enable("local.capped", 0);
  for (let i = 0; i < 30; i++) { r.clock.advance(60_000); await r.svc.tick(); await r.idle(); }
  expect(r.runsOf("local.capped")).toHaveLength(3);
  expect(r.store.counter("dropped:local.capped", "2026-11-11")).toBe(27);
  expect(r.floods).toEqual([{ flowId: "local.capped", flowName: "Test", day: "2026-11-11", cap: 3 }]);
  expect(r.store.listAudit().filter((a) => a.kind === "trigger_capped")).toHaveLength(2);   // at drops 1 and 10
  r.setDay(() => "2026-11-12"); r.clock.advance(60_000); await r.svc.tick(); await r.idle();
  expect(r.runsOf("local.capped")).toHaveLength(4);
});
```
  Further tests: 3. "enabling stores the hash, the spec and the enable time, refuses a stale hash with not_allowed, refuses an R4 flow (`raw: true`) with the reason `This flow cannot run unattended: unattended prefix at steps.0`, and writes an audit line without payload text"; 4. "a tick that sees an old slot: catch_up none records missed and starts nothing; catch_up once starts one run for five missed slots with missed 5" (advance 5 hours 30 minutes, then tick: the newest slot is 30 minutes old, so it is not on time; at exactly 5 hours it would be on time and `missed` would be 4); 5. "after the flow's hash changes the trigger does not fire, the view says needs_ok, and re-registering the old hash resumes it" (`engine.registerFlow(changed, newHash)` then `registerFlow(original, oldHash)`: `getFlow` with no hash returns the newest registered, so register the original last); 6. "overlap skip drops the fire while a run is open and consumes the slot; overlap queue starts it behind the open run and stops at 2 queued; a second trigger of the same flow due in the same tick sees the first one's run as open" (a `gate()` holds the step); 7. "R4 at run start: an enabled row for a flow that fails the validator (stored with `raw: true`) starts nothing and records refused" (put the row with `store.putTrigger` directly); 8. "a clock that moves back fires nothing and does not replay slots when it returns; a cursor far in the future is reset to now and records missed"; 9. "a missing flow, an unreadable row and an error from begin, onFlood, watch or every fire nothing or are recorded or swallowed, tick never throws, and the other triggers still fire"; 10. "disabling stops new fires and leaves a run in progress; re-enabling does not catch up the time it was off"; 11. "a setEnabled(false) that lands between the list and the trigger's section is not overwritten: the row stays off and nothing fires" (the rig has an option `afterList?: () => void` that is called right after the store's `listTriggers()` returns inside a tick; the test sets it to call `setEnabled(false)` once, so the switch lands after the list and before the trigger's section, then checks that the row is still off and no run started).
  `engine-day.test.ts`: "the daily cap follows the injected day function, not the UTC day": an engine with `dayOf` returning a value a test changes, a flow with `max_runs_per_day: 1` and a schedule trigger, two `beginStart(..., { trigger: { kind: "schedule" } })` calls on one day (the second throws `Daily run limit reached.`), then the day changes and a third works.
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/service.test.ts packages/runner/src/engine-day.test.ts`. Expected: FAIL ("Cannot find module ./service.ts").
- [ ] **Step 3: Implement** the service (schedule kind, enabling, view, tick, fire path, drops) with `file_change` and `flow_done` handled as "not yet" branches that Tasks 8 and 9 fill (`switch` on kind, the other two `return`). Change the engine line.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src
git commit -m "Add the trigger service for schedules with overlap, the daily cap and floods" -m "Assisted-by: Codex"
```

---

### Task 8: The trigger service, part 2: file changes

**Files:**
- Modify: `packages/runner/src/triggers/service.ts`, `packages/runner/src/test-helpers/trigger-rig.ts`
- Create: `packages/runner/src/triggers/service-files.test.ts`

**Interfaces:** no new exports. The rig gains `signal(path?: string)` (calls the stored watcher callback for the folder) and `writeFile(rel: string, text?: string, mtimeMs?: number)` (writes into `project`, sets the mtime with `utimesSync` so two writes never share a key by accident).

**Rules:**
1. Per `file_change` row the service keeps in memory `{ root, unwatch?, watching: boolean, dirtyFirst?, dirtyLast?, lastScan? }`. On the first tick after start or enable it resolves the root with `resolveRoot(projectDir, trigger.path)`; a failure records `lastFire: { outcome: "refused", detail: reason }`, fires nothing and is retried each tick (the folder may come back). It then calls `deps.watch(root, signal)`; `undefined` means "cannot watch": the view says "Watching is not available here; this folder is checked every 5 minutes." A signal sets `dirtyFirst` (if unset) and `dirtyLast` to `nowMs`.
2. A scan happens when (a) `lastScan` is unset (the first tick: the snapshot compare at runner start) or `nowMs - lastScan >= RESCAN_MS`, or (b) `dirtyLast !== undefined` and either `nowMs - dirtyLast >= debounceMs` or `nowMs - dirtyFirst >= max(6 * debounceMs, MAX_DEBOUNCE_WAIT_MS)` (`debounceMs = durationMs(trigger.debounce)`). A scan clears the dirty marks and sets `lastScan`.
3. The snapshot is the setting `snap:<flowId>:<index>` (`parseSnapshot`). **Enabling** scans and saves the baseline, so files that exist then never fire; a scan that is `outside` or fails makes `setEnabled` fail with its reason. A stored value that does not parse is replaced by the current scan as a new baseline and fires nothing (fail safe).
4. `scanFolder(root, { glob, maxEntries: MAX_SCAN_ENTRIES, within: realpath(projectDir) })`; `outside` (the root was swapped for a link out) records `refused` and fires nothing; `capped` is shown in the view as "Only the first 5,000 files are watched."
5. `diffSnapshot(stored, scanned)`; no `changed`: save the scan when anything was removed, no fire. Otherwise `max = limits.max_items ?? DEFAULT_MAX_ITEMS`, `batch = changed.slice(0, max)`, key `files:` + the SHA-256 (hex, `node:crypto`) of the lines `path|size|mtimeMs` of the batch, payload `{ count: batch.length, total: changed.length, files: payloadFiles(batch, max) }`. The fire path of Task 7 runs with `overlap: "queue"`. When the result is consumed (`started`, `dropped_cap`, `refused`, `duplicate`) the saved snapshot is `mergeHandled(stored, scanned, batch)`; when it is not (`dropped_queue_full`, `needs_ok`) the old snapshot stays and the scan repeats on a later tick. When files remain (`total > batch.length`) the dirty marks are set so that the next tick scans again.
6. Switching a trigger off, `stop()` and a hash change close the watcher; a watcher that reports an error is closed and the trigger falls back to the periodic scan.

- [ ] **Step 1: Write the failing tests** (`service-files.test.ts`, rig with a `file_change` flow on `inbox`; `r.writeFile("inbox/a.txt")` and `r.signal()`):
  1. "enabling takes a baseline: files that already exist do not fire"
  2. "a signal and then the debounce fire one run with count, total and relative paths; before the debounce nothing fires"
  3. "signals that keep coming delay the scan, but at 6 times the debounce (or 60 seconds) it scans anyway"
  4. "with no signal at all the scan still runs at start and every 5 minutes, so a change made while the runner was down fires once after a restart, and a second service over the same store does not fire it again"
  5. "more changed files than max_items: the first batch fires, the rest roll into the next fire, none is lost or repeated" (25 files, `max_items` 10: batches of 10, 10, 5)
  6. "a file that did not change in size or mtime never fires twice; a new mtime fires again"
  7. "a root swapped for a symlink to a folder outside the project, after enabling, is refused at the next scan, fires nothing and the view says why"
  8. "500 changed files with max_items 1 and the default cap give 24 runs, 476 dropped and one flood event, and the next local day does not replay them" (each tick: `signal`, advance 10 s, `tick`, `idle`)
  9. "while a run is open and 2 are queued a fire is retried on a later tick and consumes nothing" (a `gate()` holds the step)
  10. "a watcher that cannot start falls back to the 5 minute scan and the view says so"
  11. "switching off, a hash change and stop() close the watcher"
  12. "an unreadable snapshot row becomes a new baseline and fires nothing"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/service-files.test.ts`. Expected: FAIL (the `file_change` branch does nothing).
- [ ] **Step 3: Implement** the `file_change` branch and the rig helpers.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers packages/runner/src/test-helpers
git commit -m "Add file_change triggers: watch, debounce, snapshot compare and batches" -m "Assisted-by: Codex"
```

---

### Task 9: The trigger service, part 3: flow_done

**Files:**
- Modify: `packages/runner/src/triggers/service.ts`
- Create: `packages/runner/src/triggers/service-done.test.ts`

**Rules:**
1. For each enabled `flow_done` row the tick lists `store.listRuns({ flowId: trigger.flow })` whose `endedAt` is set, with `Date.parse(endedAt) >= max(Date.parse(row.enabledAt), nowMs - FLOW_DONE_WINDOW_MS)` and a state of `done` (`status: "done"`) or `done` or `failed` (`status: "any"`); a `blocked` or `interrupted` run is not finished. They are handled oldest first, at most `FLOW_DONE_PER_TICK` per tick; the rest wait for the next tick.
2. For each: `depth` is 1 plus the upstream run's own `trigger.payload.depth` when that run's trigger kind is `flow_done` (any other trigger, or none, counts 0). `depth > MAX_CHAIN_DEPTH`: claim the key, record `depth`, write an audit `trigger_depth` (`{ flowId, upstream, depth }`), no run. Otherwise the fire path of Task 7 with key = the upstream run id, `overlap: "queue"` and payload `{ flow, run, status, depth }` (`flow` and `run` are runner ids, `status` is the upstream state).
3. A key that is already claimed is skipped without a record (survives a restart: the keys are in the store). A fire that is not consumed (`dropped_queue_full`, `needs_ok`) leaves its upstream run unhandled for the next tick. Because Task 7 rule 5 claims the key before it counts a drop, an upstream run that was dropped by the cap is counted once and is not counted again on every tick or replayed after midnight. Purge: every tick calls `store.purgeKeys(now - KEY_KEEP_MS)` at most once per hour (memory flag).
4. `poke()` (Task 7) is how a finished run reaches this branch quickly; the 30 second tick is the fallback.
5. An upstream flow that is missing fires nothing and does not throw.

- [ ] **Step 1: Write the failing tests** (rig with flows `local.up` (manual) and `local.down` (`flow_done`), the upstream run started with `engine.beginStart("local.up", { project })` and awaited):
  1. "a finished upstream run starts the downstream flow once, with payload flow, run, status and depth 1"
  2. "status done ignores a failed upstream run and status any takes it" (a scripted failing step)
  3. "an upstream run that ended before the downstream trigger was enabled is not replayed"
  4. "restart: a run that ended while the runner was down starts the downstream once, and a second service over the same store does not start it again"
  5. "poke() runs one tick without re-entering the store call that caused it" (finish the upstream run, `await r.svc.settled()`, the downstream run exists)
  6. "a chain of flows each started by the one before stops at depth 3, records depth and an audit line; a cycle of two flows stops too"
  7. "200 finished upstream runs: at most 50 are handled per tick and the daily cap of 24 holds, with one flood event"
  8. "a missing upstream flow fires nothing and tick does not throw"
  9. "a downstream run refused by R4 records refused and consumes the key, so it is not retried every tick"
  10. "a capped upstream run is counted once, not once per tick: 30 upstream runs against a cap of 3 give `dropped` 27 after one tick and still 27 after five more ticks, and the next local day does not replay them"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/service-done.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `flow_done` branch and the purge.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers
git commit -m "Add flow_done triggers with upstream run keys and a depth cap" -m "Assisted-by: Codex"
```

---

### Task 9b: The trigger service, part 4: the auto-pause after three blocked runs

**Files:**
- Modify: `packages/runner/src/triggers/service.ts`, `packages/runner/src/test-helpers/trigger-rig.ts`
- Create: `packages/runner/src/triggers/service-pause.test.ts`

**Interfaces:** `PausedEvent` and `TriggerDeps.onPaused` are declared in Task 7. The rig's `readiness` option (Task 7) makes every run end `blocked` ("No harness is connected yet." style); a helper `rig.finishBlocked(flowId, n)` is not needed, the tests tick the schedule.

**Rules** (the chair's call, Decision 18):
1. At the start of each enabled trigger's synchronous section (Task 7 rule 3, after the fresh re-read, before any firing): when `row.recentRuns` holds 3 ids and `store.getRun(id)?.state === "blocked"` for all three (a missing run row counts as not blocked; states are read now, so a run the owner resumed that is running or done keeps the trigger on), the service writes onto the fresh row `enabled: false`, `pausedAt: <now ISO>`, `recentRuns: []`, closes the trigger's watcher, writes an audit `trigger_paused` (`{ flowId, index }`) and calls `deps.onPaused({ flowId, index, flowName, pausedAt })` inside `try` (a throw is swallowed). The trigger does not fire in that tick.
2. `recentRuns` is pushed by the fire path only on `started` (Task 7 rule 5), keeps the last 3, and is never read from a payload or a worker.
3. A run that ended `done` or `failed`, or is still open, keeps the trigger from pausing; the check is only "the last three runs this trigger started are all blocked now".
4. The pause applies to `schedule`, `file_change` and `flow_done` alike. Pausing one trigger of a flow leaves its other triggers as they are.
5. A paused row is `off` for every purpose: no fires, no catch-up, the cap and the cursor are not touched; `list` gives state `off` and the reason of Task 7 rule 2. Only `setEnabled(true)` brings it back, and that clears `pausedAt` and `recentRuns` and resets the cursor (Task 7 rule 1). Nothing else writes `enabled: true`.
6. The pause runs inside `tick()`, and `poke()` (Task 11 calls it when a run becomes `blocked`) makes a tick soon, so the trigger pauses within a tick of the third block, not after the next slot.

- [ ] **Step 1: Write the failing tests** (`service-pause.test.ts`; rig with `readiness: () => ({ ready: false, reason: "No harness is connected yet." })`, a `schedule every 1m` flow, ticks one minute apart):
  1. "three blocked runs in a row from one trigger pause it: the row is off with `pausedAt` and empty `recentRuns`, the watcher is closed, one `trigger_paused` audit line is written and `onPaused` is called once"
  2. "a run that ended done or failed, one that is still open and a run row that is missing each keep the trigger from pausing" (table over the three, using a rig whose third run differs)
  3. "a paused trigger fires nothing on later ticks, its view is `off` with the Paused reason, and the daily counters and the cursor do not change"
  4. "turning it on again clears `pausedAt` and `recentRuns`, resets the cursor and does not catch up the paused time; three more blocked runs pause it again"
  5. "a blocked run that the owner resumed and that is now done does not count: blocked, blocked, then resumed and done, then one more blocked run does not pause it"
  6. "the pause applies to file_change and to flow_done"
  7. "a flow with two triggers: pausing the schedule leaves the file_change on"
  8. "an error thrown by onPaused is swallowed and the trigger is still paused"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/triggers/service-pause.test.ts`. Expected: FAIL (nothing pauses).
- [ ] **Step 3: Implement** the pause section in `service.ts`.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers packages/runner/src/test-helpers
git commit -m "Pause a trigger after three blocked runs in a row" -m "Assisted-by: Codex"
```

---

### Task 10: Notices in the runner: the store observer and the notice frame

**Files:**
- Create: `packages/runner/src/service/notify-wiring.ts`, `packages/runner/src/service/notify-wiring.test.ts`
- Modify: `packages/runner/src/service/server.ts`, `packages/runner/src/service/server.test.ts`, `packages/runner/src/service/run-process.ts`, `packages/runner/src/service/run-process.test.ts`

`service/weekly-limit.ts` and its test are **not** edited (no approvals code is touched): the weekly notice is derived from the settings write that file already makes (Fact 6).

**Interfaces:**
- `notify-wiring.ts`: `observeStore(store: Store, hooks: { onApproval(row: ApprovalRow): void; onRunState(runId: string, state: RunState): void; onWeekly(harnessId: string, info: { percent: number; resetsAtMs: number }): void }): Store` (a `Proxy` like `wrapStore`; after a successful `createApproval` call `onApproval(row)`; after a successful `updateRun(id, patch)` with `patch.state` call `onRunState(id, patch.state)`; after a successful `putSetting(name, value)` whose name matches `^weekly:([a-z0-9-]{1,40})$` and whose value is an object with no `answer`, a finite `resetsAt` (epoch **seconds**) and an integer `percent` from 0 to 100, call `onWeekly(id, { percent, resetsAtMs: resetsAt * 1000 })`; the owner's answer (a value with `answer`) and the `weekly-index` setting call nothing; hooks run in a `queueMicrotask` and a throw is swallowed, so a rolled-back transaction is checked by the consumer); `createNotifier(o: { store: Store; now: () => Date; send: (notice: Notice) => void }): { onApproval(row: ApprovalRow): void; onRunState(runId: string, state: RunState): void; onFlood(event: FloodEvent): void; onPaused(event: PausedEvent): void; onWeekly(harnessId: string, info: { percent: number; resetsAtMs: number }): void }` (`Notice` from `@flowdriven/contracts`; each method builds a `NoticeEvent` and asks `createNoticePolicy({ nowMs })`; the result goes through `Notice.safeParse` and `send` inside `try`; flow names come from `store.getRun` then `store.getFlow(run.flowId, run.flowHash)` (for `onFlood` and `onPaused` the event already carries the name) and its manifest `name` only when it is a string, else `A flow`; `onApproval` re-reads `store.getApproval(row.id)` and sends only when it is still `pending`; `onRunState` sends only for `blocked` and only when `store.getRun(id)?.state` is still `blocked`; `onWeekly` re-reads `store.getSetting("weekly:<id>")` and sends only when it still has the same `resetsAt` and no `answer`; the policy of Task 6 allows at most one weekly notice per harness per 24 hours).
- `server.ts`: `RpcServer` gains `notice(notice: Notice): void`: writes `{ jsonrpc: "2.0", method: "notice", params }` (an `encodeFrame` failure is dropped); under back-pressure (`output.writableNeedDrain`) up to 20 notices wait in a list and are written on `drain`, the 21st is dropped; after `done` it does nothing. The `event` path is not changed.
- `run-process.ts`: `createNoticeSink(): { send(notice: Notice): void; attach(server: Pick<RpcServer, "notice">): void }` holds up to 20 notices raised before the server exists (the 21st is dropped) and writes them in order on `attach`; after `attach`, `send` goes straight to `server.notice`. `runProcess` creates one sink, passes `notify: sink.send` to `createRunnerService` and calls `sink.attach(server)` right after `serveRpc`. (A notice raised during `service.start()` is not lost, and the policy has already marked it sent, so it would never be repeated.)

- [ ] **Step 1: Write the failing tests:**
  1. (`notify-wiring.test.ts`, in-memory store, a fake `send`, a manual `await Promise.resolve()` for the microtask) "a pending approval made by the engine sends one approval notice with the flow's name"
  2. "an approval created inside a transaction that then throws sends nothing"
  3. "a run that ends blocked sends one blocked notice; running, checking, done and failed send none"
  4. "a flood event sends one notice and a second the same local day sends none; a paused event sends one trigger_paused notice"
  5. "a send that throws, a hook that reads a missing run and a store that throws in a hook never break the store call"
  6. "a flow name with control and bidi characters is cleaned in the notice"
  7. "a putSetting of a new weekly window (`resetsAt` in seconds) sends one weekly notice naming the weekday; the same value again, the owner's answer (a value with `answer`), the `weekly-index` setting and a reset time that moves by a minute inside 24 hours send none"
  8. (`server.test.ts`) "a notice is written as a notice frame; under back-pressure 20 wait and are written on drain and the 21st is dropped; after the end nothing is written; event frames still coalesce"
  9. (`run-process.test.ts`) "a notice sink holds up to 20 notices raised before the server is attached, writes them in order on attach and sends later ones directly; the 21st early notice is dropped"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/service/notify-wiring.test.ts`. Expected: FAIL ("Cannot find module ./notify-wiring.ts").
- [ ] **Step 3: Implement** the three source files.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner/src/service`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/service
git commit -m "Send notices for approvals, blocked runs, floods, pauses and the weekly limit through a notice frame" -m "Assisted-by: Codex"
```

---

### Task 11: Wiring: the operations, the service start and the trigger on a run

**Files:**
- Create: `packages/runner/src/service/trigger-wiring.ts`, `packages/runner/src/service/map-trigger.ts`, `packages/runner/src/service/trigger-wiring.test.ts`
- Modify: `packages/runner/src/service/handlers.ts`, `service.ts`, `map-run.ts`, `map-flow.ts` (export `triggerSummary`)

**Interfaces:**
- `ServiceOptions` gains `notify?: (notice: Notice) => void` and `triggers?: { every?: Every; watch?: (path: string, onSignal: () => void) => (() => void) | undefined; dayOf?: (date: Date) => string }`.
- `trigger-wiring.ts`: `wireTriggers(o: { store: Store; engine: Engine; now: () => Date; projectDir: string; every?: Every; watch?; dayOf?; onFlood?: (e: FloodEvent) => void; onPaused?: (e: PausedEvent) => void }): TriggerService`. Default `every`: `setInterval(fn, ms)` with `unref`, cancelled by the returned function. Default `watch`: `fs.watch(path, { recursive: true, persistent: false }, () => onSignal())` inside `try` (a throw returns `undefined`); the watcher's `error` event closes it; the returned function closes it.
- `map-trigger.ts`: `toTriggerStatus(view: TriggerView): TriggerStatus` (ISO times, `TriggerStatus.parse`).
- `map-run.ts`: `toRunSummary(run, flowName, reportFirstLine?, waiting?, trigger?)` where `trigger` is `{ kind, words }`; `runs.list` and `flows.run` and `toRunDetail` pass `triggerWords(run.trigger.kind, run.trigger.payload, flowNameOf)` (Task 5) when the run has a non-manual trigger; no trigger field for a manual run. `toRunDetail(view, harnessIdOf)` gains a third parameter `flowNameOf: (id: string) => string | undefined`; the handlers build `flowNameOf` as `(id) => { const name = store.getFlow(id)?.manifest.name; return typeof name === "string" ? name : undefined; }`.
- `handlers.ts`: `HandlerContext` gains `triggers: TriggerService`; `"triggers.list": ({ flowId })` (`flow(flowId)` first, so an unknown flow is `not_found`) returns `triggers.list(flowId).map(toTriggerStatus)`; `"triggers.setEnabled": ({ flowId, index, enabled, hash })` throws `RunnerError("not_allowed", "Triggers stay off in the demo.")` when `enabled && mode === "demo"`, else returns `toTriggerStatus(triggers.setEnabled(...))`. These two are the only code that calls `triggers.setEnabled`.
- `service.ts`: `dayOf = options.triggers?.dayOf ?? localDay` goes to `createEngine({ dayOf })` and to the trigger service, so both use one day. Order: `notifier = createNotifier({ store, now, send: (n) => options.notify?.(n) })`; `store` becomes `observeStore(options.store, { onApproval: notifier.onApproval, onRunState: (id, state) => { notifier.onRunState(id, state); if (state === "done" || state === "failed" || state === "blocked") triggers.poke(); } })` (the closure reads `triggers` lazily); the observer's `onWeekly` is `notifier.onWeekly` (`createWeekly` is not changed); the engine is built; `triggers = wireTriggers({ ..., onFlood: notifier.onFlood, onPaused: notifier.onPaused })`. `start()`: in live mode `triggers.start()` is called right after `engine.beginRecover()` returns (not after its `settled`; with a harness service it runs inside the `hs.start().settled.then(...)` callback before awaiting `beginRecover().settled`); demo mode never starts it. `stop()`: `triggers.stop()` first, then the present stops.

- [ ] **Step 1: Write the failing tests** (`trigger-wiring.test.ts`, `createRunnerService` in live mode with an injected harness, so a fire ends `blocked` with "No harness is connected yet." and that is enough to prove it started; injected `every`, `watch`, `now`; `notify` collects notices; **no test fires one trigger more than twice**, because three blocked runs in a row pause it (Task 9b), and the pause itself is proved in Tasks 9b and 15):
  1. "triggers.list shows each non-manual trigger of a flow with its state, its reason and its next run"
  2. "triggers.setEnabled switches on with the current hash, refuses a stale hash with not_allowed, refuses new_item as not available yet, and switches off"
  3. "in demo mode triggers.list works and setEnabled(true) is not_allowed; switching off is allowed"
  4. "an unknown flow and an index that does not exist are not_found; a malformed hash is invalid_input"
  5. "a fire appears in runs.list with its trigger in words, a run the owner starts has no trigger field, and runs.status carries the words too"
  6. "a fired run that ends blocked sends one blocked notice through notify, and a flood sends one flood notice" (`limits.max_runs_per_day: 1` and two fires, so one run starts and one is dropped)
  7. "start() starts the repeating job once and ticks at once; stop() cancels it and closes the watchers; demo mode never starts it"
  8. "the audit log holds trigger_enabled with the flow id, the index and the hash and no payload text"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/service/trigger-wiring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the stub handlers of Task 1.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner packages/contracts`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/service
git commit -m "Wire the trigger service, the trigger operations and the notices into the runner service" -m "Assisted-by: Codex"
```

### Task 12: Electron: the notice becomes a macOS notification

**Files:**
- Create: `apps/desktop/electron/notifier.ts`, `apps/desktop/electron/notifier.test.ts`
- Modify: `apps/desktop/electron/runner-link.ts`, `runner-link.test.ts`, `runner-bridge.ts`, `runner-bridge.test.ts`, `main.ts`

**Interfaces:**
- `runner-link.ts`: `RunnerLinkOptions.onNotice?: (params: Record<string, unknown>) => void`. In the frame loop, before the final `else` that fails the link (`:150-155`), a frame with no `id`, `method === "notice"` and an object `params` calls `onNotice?.(params)` (and does nothing when there is no handler). Any other notification method still fails the link.
- `runner-bridge.ts`: `RunnerBridgeOptions.onNotice?: (value: unknown) => void`, passed to the link. A notice is never sent to a window.
- `notifier.ts` (no import of `@flowdriven/contracts`; the shape is mirrored on purpose, because main does not trust the runner's text): `type ParsedNotice = { id: string; kind: "approval_waiting" | "run_blocked" | "weekly_limit" | "flood_cap" | "trigger_paused"; title: string; body: string; target: { screen: "inbox"; approvalId?: string } | { screen: "run"; runId: string } | { screen: "builder"; flowId: string } }`; `parseNotice(value: unknown): ParsedNotice | undefined` (exact keys; `id` 1 to 200 characters; `title` 1 to 80 and `body` 1 to 240 with no control characters; `kind` from the list; target ids match `^[A-Za-z0-9:._-]{1,100}$`; anything else is `undefined`); `hashFor(target: ParsedNotice["target"]): string` (`/inbox`, `/inbox/<encodeURIComponent(id)>`, `/runs/<id>`, `/builder/<id>`, no leading `#`); `createNoticeHandler(o: { show: (notice: { title: string; body: string }, onClick: () => void) => void; windowFocused: () => boolean; open: (hash: string) => void }): (value: unknown) => void` (invalid values are ignored; a notice is not shown while `windowFocused()` is true; the same `id` is shown once per app run, remembering the last 200; a throwing `show` is swallowed; the click calls `open(hashFor(target))`); `electronNoticeHandler(o: { Notification: NotificationCtor; windows: () => { isFocused(): boolean }[]; open: (hash: string) => void }): (value: unknown) => void` where `NotificationCtor` is the minimal structural type of Electron's `Notification` (`isSupported()`, a constructor taking `{ title, body }`, `on("click", fn)`, `show()`); it keeps a reference to each shown notification until it is clicked or closed, so it is not collected early.
- `main.ts`: build the handler with the real `Notification` and `BrowserWindow`, with `open(hash)`: take the first window; if there is one, restore it when minimised, `show()` and `focus()` it and call `loadURL(`${APP_ORIGIN}/index.html#${hash}`)` (a change of the fragment only, so no reload); if there is none, `createMainWindow({ preloadPath, show: true, runner: true, hash })`. Pass the handler as `onNotice` to `startRunnerBridge`. The preload is not changed.

- [ ] **Step 1: Write the failing tests:**
  1. (`notifier.test.ts`) "parseNotice accepts a notice of each of the five kinds with its target"
  2. "parseNotice refuses an extra key, a 300 character body, an unknown kind, a screen that is not allowed, a target id with a slash, a title with a control character and a non-object"
  3. "hashFor gives the route of each target and encodes the colon of a weekly item"
  4. "the handler shows a valid notice once per id and ignores an invalid one"
  5. "it shows nothing while a window is focused"
  6. "a click opens the hash of the target"
  7. "a show that throws is swallowed and the next notice still shows"
  8. "electronNoticeHandler does nothing when notifications are not supported, and keeps the notification alive until it is clicked" (fake `Notification`)
  9. (`runner-link.test.ts`) "a notice frame reaches onNotice and an event frame still reaches onEvent; a notice with no handler is ignored; a notification with any other method still fails the link"
  10. (`runner-bridge.test.ts`) "a notice frame goes to onNotice and is not sent to the windows"
- [ ] **Step 2: Run:** `pnpm vitest run apps/desktop/electron/notifier.test.ts`. Expected: FAIL ("Cannot find module ./notifier").
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run apps/desktop/electron`. Expected: PASS (the `preload` tests are unchanged and still pass).
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS (this includes `tsc -p apps/desktop/tsconfig.electron.json --noEmit`, which type-checks `main.ts`).
- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/electron
git commit -m "Show a macOS notification for a runner notice and open its item on click" -m "Assisted-by: Codex"
```

---

### Task 13: Fixtures: sample triggers and a triggered run

**Files:**
- Create: `packages/fixtures/src/story/triggers.ts`, `packages/fixtures/src/triggers.test.ts`
- Modify: `packages/fixtures/src/state.ts`, `client.ts`, `story/looped.ts`

**Interfaces:**
- `state.ts`: `FixtureState` gains `triggerSwitches: Record<string, { hash: string } | undefined>` (key `<flowId>#<index>`; the value is the flow hash the owner switched the trigger on for); every builder (`buildStory`, `buildEmpty`, `buildLong`, `buildLooped`) sets it to `{}`.
- `story/looped.ts`: the looped flow's manifest `triggers` becomes `[manual, { kind: "schedule", summary: "Every 1h" }, { kind: "file_change", summary: "Files change in inbox" }, { kind: "webhook", summary: "Called by a webhook" }]`; the run `run-0008` gets `trigger: { kind: "schedule", words: "Started by its schedule" }`. `triggerSwitches` starts with the file change on, stored with the flow's current hash.
- `story/triggers.ts`: `triggerStatuses(flow: FlowRecord, switches: Record<string, { hash: string } | undefined>, nowIso: string): TriggerStatus[]` (a trigger whose stored hash differs from `flow.hash` is `needs_ok` with the reason of the runner; manual entries left out; `schedule` and `file_change` and `flow_done` supported; `new_item`, `link`, `webhook` are `unavailable` with reason `Not available yet.`; an `on` schedule has `nextAt` one hour after `nowIso`; the `on` file change has `last: { at, outcome: "started", runId: "run-0008" }`; `dailyCap` 24; counts 0 except `firesToday: 3`, `droppedToday: 2` on the file change).
- `client.ts`: `"triggers.list"` returns `triggerStatuses(...)` (an unknown flow is `not_found`); `"triggers.setEnabled"`: unknown flow or index `not_found`; a `hash` that differs from the flow's is `not_allowed` with the runner's words; an unavailable kind `not_allowed` ("Not available yet."); otherwise it stores `{ hash }` (or clears it when switching off) and returns the status. These replace the stubs of Task 1.

- [ ] **Step 1: Write the failing tests** (`triggers.test.ts`, through `createFixtureRunnerClient({ scenario: "looped" })` as the other fixture tests do):
  1. "the looped flow lists a schedule, a file change and a webhook, and no manual entry"
  2. "a webhook is unavailable with its reason and cannot be switched on"
  3. "switching the schedule on stores the switch, returns an on status with a next run, and a later list shows it"
  4. "a stale hash is not_allowed; an unknown flow and an unknown index are not_found"
  5. "every status and the triggered run still validate against the contracts"
  6. "a trigger switched on for an older hash shows needs_ok, and switching it on again with the current hash makes it on" (set `client.state.triggerSwitches` to a different hash)
- [ ] **Step 2: Run:** `pnpm vitest run packages/fixtures/src/triggers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** If a present fixture test asserts the looped flow's old `triggers` (one manual entry), change that line to the new list; it is the same assertion for the new data.
- [ ] **Step 4: Run** `pnpm vitest run packages/fixtures packages/contracts`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/fixtures
git commit -m "Add sample triggers and a triggered run to the fixtures" -m "Assisted-by: Codex"
```

---

### Task 14: The app: triggers on the flow's screen and the trigger on a run

**Files:**
- Create: `apps/desktop/src/screens/builder/TriggersPanel.tsx`, `apps/desktop/src/screens/builder/Triggers.module.css`, `apps/desktop/src/screens/builder/Triggers.test.tsx`
- Modify: `apps/desktop/src/screens/builder/BuilderScreen.tsx`, `apps/desktop/src/screens/runs/RunsTable.tsx`, `apps/desktop/src/screens/runs/RunDetailScreen.tsx`, `apps/desktop/electron/screens.json`, `apps/desktop/src/screens.test.ts`

**Interfaces:**
- `BuilderScreen` runs `useRunnerQuery("triggers.list", { flowId: id ?? "" }, { skip: !id })` beside its other queries and includes it in `loading`, `queryError` and `reload`, so the screen is not "ready" before the triggers are in (the capture waits for ready). It renders `<TriggersPanel flowId hash={detail.hash} triggers={triggers.data ?? []} reload={triggers.reload} />` between `<Playback />` and the divider, only when the list is not empty.
- `TriggersPanel({ flowId, hash, triggers, reload })`: a `<section aria-label="Triggers">` with `<h2>Triggers</h2>`, the honest line "Triggers fire only while FlowDriven is open. On a Mac you can close the window and leave the app open; quitting the app stops them.", and one row per status: the kind in words (`Schedule`, `File change`, `After another flow`, `New item`, `Link`, `Webhook`), its summary, and a `<button type="button" role="switch" aria-checked>` whose icon plus words are `check` "On", `dash` "Off", `alert` "Needs your OK again" (`needs_ok`) or `circle-slash` "Not available yet" (`unavailable`); the switch is disabled while busy, for an unavailable kind, and when the state is `off` and `canEnable` is false. Pressing it calls `action("triggers.setEnabled", { flowId, index, enabled: !on, hash })` then `reload()`; for `needs_ok` it turns it on again. A failure shows `error.message` in a `role="alert"` line with the `alert` icon and leaves the switch as it was. Under each row, as plain lines: `Next run: <formatDateTime(nextAt)>` when `on` and set; `Last: <words> <formatDateTime(at)>` with an `AppLink` to the run when `runId` is set (words: `started` "Started", `skipped_overlap` "Skipped: an earlier run was still open", `dropped_cap` "Dropped: the daily limit was reached", `dropped_queue_full` "Waited: too many runs are queued", `duplicate` "Skipped: already handled", `needs_ok` "Stopped: needs your OK again", `refused` "Refused: <detail>", `missed` "Missed while FlowDriven was closed", `depth` "Stopped: the chain is too long", `error` "Error"); `Today: <firesToday> of <dailyCap> runs` plus `, <droppedToday> dropped` when above 0; the `reason` line when set (`alert` icon, muted). Status is always icon plus words.
- `RunsTable`: under the flow name, when `run.trigger` is set, `<div className={styles.muted}>{run.trigger.words}</div>`. `RunDetailScreen`: one line `Started by: <words>` next to the state, only for a triggered run.
- `screens.json`: a new entry `{ "name": "builder-triggers", "hash": "/builder/dev.example.job-review", "scenario": "looped" }` (capture becomes 22 screens).
- **Present assertion that changes** (`screens.test.ts:8-9`): `expect(screens).toHaveLength(10)` and `expect(new Set(screens.map((s) => s.name)).size).toBe(10)` become `11` and `11`.

- [ ] **Step 1: Write the failing tests** (`Triggers.test.tsx` through `renderApp("#/builder/dev.example.job-review", { scenario: "looped" })`):
  1. "lists the schedule, the file change and the webhook with icon plus words, and no manual row"
  2. "the webhook says Not available yet and its switch is disabled"
  3. "turning the schedule on calls triggers.setEnabled with the flow's hash, then shows On and a Next run line"
  4. "a refusal shows its reason in an alert and the switch stays Off"
  5. "a trigger that needs its OK again says so and offers to turn it on again" (set `client.state.triggerSwitches["dev.example.job-review#2"] = { hash: "sha256:" + "1".repeat(64) }` before rendering, so the fixture reports `needs_ok`)
  6. "the honest line about FlowDriven being open is on the screen"
  7. "the last fire shows its words and a link to the run; today's counts show the dropped number only when it is above 0"
  8. "the Runs table shows the trigger in words for a triggered run and nothing for a manual run; the run detail shows Started by"
- [ ] **Step 2: Run:** `pnpm vitest run apps/desktop/src/screens/builder/Triggers.test.tsx`. Expected: FAIL ("Cannot find module ./TriggersPanel").
- [ ] **Step 3: Implement.** Reuse `Icon`, `Button`, `AppLink`, `formatDateTime`; plain CSS with the tokens; read `BuilderScreen.tsx`, `RunDetailScreen.tsx` and the present builder and runs tests first and change no present assertion except the one named.
- [ ] **Step 4: Run** `pnpm vitest run apps/desktop`. Expected: PASS (`layout-guards.test.ts` and `screens.test.ts` included).
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop packages/fixtures
git commit -m "Show triggers with a switch on the flow's screen and the trigger on each run" -m "Assisted-by: Codex"
```

---

### Task 15: R-rule proofs: off until the owner says so, R4, R6, R7, no outside text in notices

**Files:**
- Create: `packages/runner/src/review-04-r.test.ts`

**Interfaces:** none new. The file builds a live service as `review-03b-r19.test.ts` does (fake `claude` through the real adapter, a mocked `createKeeper` that exposes the keeper, an injected `now` object, an injected `every` whose jobs the test calls, an injected `watch`, `notify` collecting notices; copy `liveRig` and adapt it). All assertions are on the real service, store and fake `claude`.

- [ ] **Step 1: Write the failing tests:**
  1. "only triggers.setEnabled switches a trigger on: both trigger operations are mcp no, `.setEnabled(` is called only from `service/handlers.ts`, and a row with `enabled: true` is written only from `triggers/service.ts`" (a source scan of `runner/src` that skips `*.test.ts` **and `test-helpers/`** (the rig's `enable()` calls `setEnabled(`), with the exact needles `.setEnabled(` and `enabled: true`, as the R19 test scans for `putSetting("keeper"`)
  2. "a flow, a worker's text, a memory-like text, a skill-like text and a job post that say to enable every trigger change nothing: after runs of fake workers that print `triggers.setEnabled {...}` and a `file_change` payload file named like a call, `store.listTriggers()` has no enabled row and no run has a trigger"
  3. "an enabled trigger stops when the flow's content hash changes and resumes when the old hash is back" (real service, `engine.registerFlow` with two hashes)
  4. "a stored row whose spec is not the manifest's trigger does not fire"
  5. "R4 at enable and at run start: a flow with a send tool before its first ask cannot be enabled (the reason is `This flow cannot run unattended: unattended prefix at steps.0`; the flow is stored with `store.putFlow`, because `registerFlow` refuses it, Fact 14), a stored enabled row for it starts nothing and records refused, and `engine.beginStart(..., { trigger: { kind: "schedule" } })` throws `not_allowed`"
  6. "a triggered run is class 2: with the weekly window at 0.95 a schedule fire waits at the keeper with reason quota while an owner run goes on, and runs after the owner answers keep" (`keeper.noteLimits`, `approvals.resolve`)
  7. "counting is the runner's: three fires against a cap of 2 start 2 runs while the worker prints `runs today: 0`, a file is named `runs-today-0.txt`, and `trigger.payload` says `count 0`; `runs:<flow>` is 2 and `dropped:<flow>` is 1"
  8. "R7 end to end: 40 schedule fires against a cap of 3 give 3 runs, 37 dropped, one audit milestone pair (1 and 10) and exactly one flood notice on the notify wire"
  9. "no notice text carries step output, a payload value or a file name: worker output `SECRET-OUT`, a file named `PAYLOAD-NAME.txt` and a flow named with bidi and control characters are run through blocked, approval, flood, paused and weekly events; every notice parses with `Notice`, none contains those strings, and the flow name appears cleaned"
  10. "file_change cannot reach outside the project: `..`, an absolute path elsewhere, a symlink to another folder and a folder that is swapped for a link after enabling are each refused with a reason and fire nothing"
  11. "a fire reaches the same checks as a manual run: a flow whose readiness is not ready (no consent) ends `blocked` and notifies once, and with consent it runs" (`harnesses.setConsent`)
  12. "three blocked runs in a row pause the trigger: with no consent three schedule fires end blocked, the trigger is then off with `pausedAt`, one `trigger_paused` notice is on the wire, the view says Paused, nothing fires on the next slots, and after the owner turns it on (and gives consent) it fires again"
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/review-04-r.test.ts`. Expected: tests of the earlier tasks make most of them pass; any that fail show a real gap. A failing test is fixed in the owning source (not in the test) and the fix is named in the Done line.
- [ ] **Step 3: Fix** what the tests show, in the smallest change in `triggers/` or `service/`. If a fix needs the approvals code, the sandbox limits, the hashing code or a dependency, stop and write `Blocked:`.
- [ ] **Step 4: Run** `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src
git commit -m "Prove that triggers are off until the owner says so, and R4, R6 and R7 for them" -m "Assisted-by: Codex"
```

---

### Task 16: The evidence script: an hourly trigger with no window, and a capped flood

**Files:**
- Create: `packages/runner/src/test-helpers/trigger-demo-run.ts`, `packages/runner/src/test-helpers/trigger-demo.ts`, `packages/runner/src/service/trigger-demo.test.ts`

**Interfaces:**
- `trigger-demo-run.ts`: `runTriggerDemo(): Promise<string[]>` builds a live service as `keeper-demo-run.ts` does (fake `claude`, in-memory store, injected `now` over a clock object starting `2026-11-12T00:00:00.000Z`, injected `every` that stores its job, an injected `watch` that stores its signal, fake keeper probes, `notify` collecting notices). No RPC client is attached after the owner's one switch, which is the "window closed". Steps: register `local.hourly` (`schedule every 1h`, `catch_up: once`) and `local.flood` (`file_change` on `inbox`, `limits.max_items: 1`); `harnesses.setConsent`; `triggers.setEnabled` for both (the owner's only calls); then (1) two hourly ticks: advance one hour, call the job, await the run; (2) one tick after `5 hours 30 minutes` of "sleep"; (3) 500 files written into `inbox`, then 500 rounds of `signal`, advance 10 seconds, tick, await. It returns these lines:

```
schedule on: every 1h, next run 2026-11-12T01:00:00.000Z
no window open: 01:00 fired, run-1 done
no window open: 02:00 fired, run-2 done
slept 5 hours 30 minutes: catch_up once started 1 run for 5 missed fires, run-3 done
flood: 500 file changes, daily cap 24 -> 24 runs, 476 dropped, 1 notification
notification: Too many runs - Flood flow reached its limit of 24 runs today. More fires are dropped until tomorrow.
```
  The run ids come from the injected `newId`; the numbers in the lines are read from `runs.list`, `triggers.list` (`droppedToday`) and the collected notices, never typed in. Hours print as UTC `HH:MM`. The `local.flood` flow is named `Flood flow`.
- `trigger-demo.ts`: the executable (`#!/usr/bin/env node`), prints each line with `process.stdout.write`, like `keeper-demo.ts`.

- [ ] **Step 1: Write the failing test** (`trigger-demo.test.ts`, timeout 60,000 ms, as `keeper-demo.test.ts`): `lines[0]` equals the first line exactly; `lines[1]` and `lines[2]` match `/^no window open: 0[12]:00 fired, run-\d+ done$/`; `lines[3]` matches `/^slept 5 hours 30 minutes: catch_up once started 1 run for 5 missed fires, run-\d+ done$/`; `lines[4]` equals the flood line; `lines[5]` equals the notification line; and `lines` has length 6.
- [ ] **Step 2: Run:** `pnpm vitest run packages/runner/src/service/trigger-demo.test.ts`. Expected: FAIL ("Cannot find module").
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command and `node packages/runner/src/test-helpers/trigger-demo.ts`. Expected: PASS; the script prints the six lines and exits 0.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src
git commit -m "Add the trigger evidence script: an hourly fire with no window and a capped flood" -m "Assisted-by: Codex"
```

---

### Task 17: The trigger walk script

**Files:**
- Create: `apps/desktop/electron/trigger-walk-steps.ts`, `apps/desktop/electron/trigger-walk-steps.test.ts`, `apps/desktop/electron/trigger-walk.ts`

**Interfaces:**
- `trigger-walk-steps.ts` (pure, in the style of `claude-walk-steps.ts`): `triggerWalkPaths(root: string): { output: string; dataDir: string; flowDir: string }` (under `.workflow/scratch/plan-04/walk/`), `TRIGGER_WALK_STEPS: { name: string; hash: string; waitFor: string[]; shot: boolean }[]` (the builder with the trigger off, the builder with it on, the Runs screen with `Started by its schedule`), `isTriggeredRunDone(runs: unknown): boolean` (true when `runs` is an array that holds an object with `trigger.kind === "schedule"` and a `state` of `done`, `blocked` or `failed`).
- `trigger-walk.ts` (run by the chair, not by a test; it mirrors `claude-walk.ts`): starts the runner bridge on the scratch data folder with the real runner (`FLOWDRIVEN_DEMO` removed), passes `onNotice: electronNoticeHandler({ Notification, windows, open })` (the handler of Task 12), imports the flow in `flowDir`, opens a window on the flow, clicks "Turn on" for the schedule, takes a picture, **closes the window**, polls `link.call("runs.list", {})` with `isTriggeredRunDone` for at most 4 minutes (a `setTimeout` loop is allowed here: it is a chair script, not a test), prints `run <id> started by schedule: <state>`, re-opens a window on `#/runs`, takes a picture and prints where the files are. It exits non-zero on a timeout.

- [ ] **Step 1: Write the failing test** (`trigger-walk-steps.test.ts`): `triggerWalkPaths` returns three distinct paths under the scratch folder; `TRIGGER_WALK_STEPS` names are unique and every `hash` parses with `parseRoute`; `isTriggeredRunDone` is true for a done schedule run, true for a blocked one, false for a manual run, for a running schedule run, for `[]`, for `null` and for a non-array.
- [ ] **Step 2: Run:** `pnpm vitest run apps/desktop/electron/trigger-walk-steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files. `pnpm build:electron` (inside the gate through `tsc -p apps/desktop/tsconfig.electron.json --noEmit`) must type-check `trigger-walk.ts`; the executor does not run it.
- [ ] **Step 4: Run** `pnpm vitest run apps/desktop/electron`. Expected: PASS.
- [ ] **Step 5: Gate** `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/electron
git commit -m "Add the trigger walk script for the real app" -m "Assisted-by: Codex"
```

---

### Task 18: Chair steps: the evidence, the pictures and the real walk

**Files:** none in the repository except what the owner's review asks for. The executor skips this task and leaves it unticked. Results go to `.workflow/LEDGER-plan-04.md` and `.workflow/scratch/plan-04/` (git-ignored).

- [ ] **Step 1: Chair step (GUI): the evidence.** `node packages/runner/src/test-helpers/trigger-demo.ts`. Expected: the six lines of Task 16. Paste them in the ledger.
- [ ] **Step 2: Chair step (GUI): the pictures.** `pnpm build && pnpm capture`. Expected: `captured 22 screens`; look at `builder-triggers` in light and dark (icon plus words on every switch, the honest line, the reason line for the webhook), `runs` and `run-looped` (the trigger words).
- [ ] **Step 3: Chair step (GUI): the real walk.** Put a copy of the check flow of `claude-walk` (see `claude-walk-steps.ts`) in `.workflow/scratch/plan-04/walk/flow/` and add `triggers: [{ kind: schedule, every: 1m, catch_up: none }]` and `limits: { max_runs_per_day: 3 }` to its manifest (three blocked runs in a row would pause the trigger, Task 9b; that is expected if the real harness is not ready). Allow notifications for "Electron" in System Settings (the owner does this once; the agent does not change system settings). Run `pnpm build && pnpm --filter @flowdriven/desktop exec electron dist-electron/trigger-walk.js`. Expected output: the trigger turns on, the window closes, `run <id> started by schedule: done` (or `blocked`) appears within 4 minutes with the window still closed, the window re-opens on the Runs screen and shows `Started by its schedule`. Make a run wait for approval (the walk flow's `user` check) and see a real macOS notification "Waiting for you"; click it with the window closed and see the window come back on the Inbox. Record what happened, including whether the click on an existing window changed its page without a reload (Known limits).
- [ ] **Step 4: Chair step (GUI): the long observation.** Leave the real app open with its window closed and an hourly schedule (`every: 1h`, `catch_up: none`, `limits.max_runs_per_day: 3`) on a flow that needs no approval, for two real slots (a little over two hours). Expected: two triggered runs, started within a minute or two of their slots; if a slot shows `Missed while FlowDriven was closed` instead, macOS App Nap delayed the runner's timer by more than 2 minutes (Known limits), and the owner decides about `catch_up: once` or a longer grace. Write the times in the ledger.
- [ ] **Step 5: Chair step (GUI): the stop.** Quit the app from the menu and confirm no run starts afterwards (the honest line). Write the result in the ledger.
- [ ] **Step 6: Chair step (commit)** the review fixes, if any, and the ledger note.

---

## Handover to plan 04b (and later)

What it finds ready:
- **The service does not know where its clock, timer or watcher come from.** `createTriggerService` takes `now`, `every`, `watch`, `begin` and `dayOf`; a launch-agent runner supplies the same five, so moving the runner out of the app changes nothing in `triggers/`. The tick already treats a long gap as "missed" and applies `catch_up`, which is what a runner that was asleep needs.
- **The notice path is a runner-to-main frame.** It assumes the app is the runner's parent. A runner that the app did not start has no parent to receive a `notice` frame: plan 04b must choose between the app subscribing over the socket and the runner posting the notification itself. Until then nothing posts a notification when the app is quit.
- **Open decisions for the owner in 04b:** (1) the socket is mode 0600 but any process of the same user (including a harness the runner starts) could connect and call `approvals.resolve`, which spec 15.2 item 10 forbids for a model; that needs a decision before any socket exists; (2) installing a launch agent is a permanent change on the owner's Mac; (3) whether wake-from-sleep and keep-awake are wanted.
- **The pause is the hook for plan 05.** A challenge page or a missing login (R5) ends the run `blocked`; plan 05 can switch the trigger off at once through the same `trigger_paused` path (`pausedAt`, audit line, notice) instead of waiting for three blocked runs.
- **Gaps carried forward:** extra-folder grants (spec 9.4) for `file_change`; R1 taint marks for file names in a payload; `new_item`, `link` and `webhook` triggers; `LoopStep.parallel` and its R19 case; the macOS notification for a run that finishes with something that "needs a look" (spec 10.6 lists none, so none is built).
- **Spec 21.2 rewording** (two sentences, from the 03b handover) is not part of this plan's tasks; the chair edits the spec.
