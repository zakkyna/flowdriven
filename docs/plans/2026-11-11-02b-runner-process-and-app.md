# Plan 02b: The Runner Process and the App on the Real Engine Implementation Plan

> **Execution:** one task per Codex call through the handoff rules in AGENTS.md; Claude reviews each task against its gates. Steps use checkbox syntax for tracking.

**Goal:** With `FLOWDRIVEN_DEMO=1 pnpm start` the desktop app opens with the demo flow in the sidebar; "Run now" starts a real run in the runner process against the scripted harness; the choice "Which jobs get a prototype?" appears in the Inbox; picking a job lets the run go on; the proposal sign-off appears; approving it finishes the run; Run detail shows the loop items and the full report; a second run skips the jobs seen before.

**Architecture:** The runner (`packages/runner/src/main.ts`) is a Node process that the app starts as its only client. They speak JSON-RPC 2.0, one JSON object per line, over the runner's standard input and output. The wire schemas live in `@flowdriven/contracts` (pure, no `node:` import), which now loads under plain Node. The runner validates every input and output with the contract's schemas and maps engine rows to the contract's read models. The engine gains "begin" variants that answer as soon as their own write is committed and let the walk go on in the background. Electron main is a relay that knows no schema; the renderer validates everything again through `IpcRunnerClient`. The Unix socket and the launch agent move to plan 04.

**Tech Stack:** only what is on `tools/checks/allowlist.json`: Node 24 built-ins (`node:sqlite`, `node:child_process`, `node:stream`, `node:fs`), Zod 4 (through `@flowdriven/contracts` only), Electron 45, React 19, Vitest, Biome. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-11-10-flow-maker-design.md` (sections 8.2 to 8.4, 8.7, 13.1 to 13.5, 15.2, 20.4, 20.6). Roadmap: `docs/plans/ROADMAP.md` ("Order changed on 2026-11-11", plan 02b). Plan 02 (`docs/plans/2026-11-11-02-flow-format-and-engine-core.md`) built the SDK and the engine this plan wires up.

## Needs the owner's yes before the task starts

Nothing. No task adds a dependency or touches `tools/checks`, `pnpm-lock.yaml`, a root script, CI, release or packaging configuration, or an instruction file (`AGENTS.md`, `CLAUDE.md`). Consequences, stated again under "Known limits" and in the handover:
- `@flowdriven/contracts` stays a `devDependency` of `@flowdriven/runner` although the runner now imports it at run time. It resolves inside the workspace (checked, see "Facts"). Moving it to `dependencies` changes `pnpm-lock.yaml` and its pinned hash in the allowlist, so it waits for the next pinned-file change the owner approves.
- The runner uses only schemas and types that the contracts export and never imports `zod` itself (the runner's manifest does not list it).
- `tsconfig.base.json` is not a pinned file; Task 1 edits it.

## Facts proved on this Mac before the plan was written (restated; the tasks rely on them)

1. Inside the executor's sandbox `listen` fails with EPERM for a Unix domain socket (in the workspace and in the temp folder) and for TCP on 127.0.0.1; writing outside the workspace fails. Spawning a child process works, and so do its pipes. Therefore nothing in this plan binds a socket or opens a window, and every test of the process uses pipes.
2. Before this plan, from `packages/runner`, `node -e "import('@flowdriven/contracts')"` fails with `ERR_MODULE_NOT_FOUND` for `packages/contracts/src/config`: the contracts use relative imports without an extension, and `RunnerError` uses a parameter property, which Node's type stripping refuses. Node is v24.14.0. After the change of Task 1 (tried in a scratch clone) the same command loads 83 exports, `pnpm typecheck` passes for all six programs, `pnpm build:web` passes and the emitting program `tsc -p apps/desktop/tsconfig.electron.json` still emits.
3. Electron 45.1.0 started with `ELECTRON_RUN_AS_NODE=1` is Node 24.22.1. It runs a `.ts` ES-module entry with `node:sqlite`, talks over stdin and stdout pipes, and runs the engine demo to the end.
4. `tools/checks/allowlist.json` pins the root scripts exactly and the sha256 of `pnpm-lock.yaml`. Any change to a manifest's dependencies changes the lockfile.
5. The engine of plan 02: `startRun`, `answerAsk`, `decide` and `resumeRun` each resolve only when the walk stops (done, failed, blocked or waiting for a person). The engine and `exec/` hold no module-level or per-engine in-memory state shared across runs; what runs share is the store (SQLite, synchronous, no `await` inside a transaction), the one harness object and, per flow, the seen store.
6. SQLite `PRAGMA locking_mode = EXCLUSIVE` with WAL, tried with two processes on one file: the second process fails at its first locking statement (`PRAGMA journal_mode = WAL`) after its 250 ms busy timeout with `database is locked`; after the holder is killed with SIGKILL the next process opens at once.
7. A child `node` process that reads `stdin` as UTF-8 and writes one JSON object per line to `stdout` works; when the parent is killed the child sees end of input; a 2 MB frame written with a callback and then `process.exit(0)` is delivered whole. `process.stdout.write(text, callback)` is therefore the way to flush before exit.
8. `duplexPair` from `node:stream` works on Node 24.14 and is typed in `@types/node` 24.19.2. The server takes two separate streams (stdin and stdout are two), so its tests use two `PassThrough` streams.
9. Electron API names in `apps/desktop/node_modules/electron/electron.d.ts`: `ipcMain.handle(channel, listener)` with `event.senderFrame` (a `WebFrameMain` with `url` and `parent`), `ipcMain.removeHandler`, `ipcRenderer.invoke`, `ipcRenderer.on`, `ipcRenderer.removeListener`, `webContents.send`, `webContents.mainFrame`, `app.getPath("appData")`, `webPreferences.additionalArguments`, `contextBridge.exposeInMainWorld`, `app.on("before-quit")`.
10. Zod 4.6.7: `.superRefine` then `.extend` on an object keeps the refinement; `jitless` is on.
11. A prototype of the engine begin variants (a per-flow chain, `begin*` methods, the four old methods delegating) passed all 140 present runner tests; the only failing test was the vocabulary test that Task 2 changes. Two runs of one flow queued behind each other and a run of another flow overlapped, on a harness with gates.
12. A `.ts` file in the contracts that Node loads must not use `enum`, `namespace` or parameter properties. With `erasableSyntaxOnly` in `tsconfig.base.json` (Task 1) every program of `pnpm typecheck` already passes.

## Global Constraints

- Node `>=24.14.0`, pnpm `10.9.0`; English everywhere, ASCII only in this plan and in any file it creates; branch `work/plan-02b`, cut from the tip of `work/plan-02`.
- **Plain-Node rule.** Code that Node runs directly (`packages/contracts/src`, `packages/sdk/src`, `packages/runner/src`) uses relative imports that end in `.ts` and only erasable TypeScript: no `enum`, no `namespace`, no parameter properties (write the field and assign it in the body). After Task 1 the three flags `allowImportingTsExtensions`, `rewriteRelativeImportExtensions` and `erasableSyntaxOnly` sit in `tsconfig.base.json`, so the rule holds for every package, `apps/desktop/electron` included.
- Contracts import: only `packages/runner/src/service/`, `packages/runner/src/main.ts` and `packages/runner/src/test-helpers/` may import `@flowdriven/contracts` (Task 9 rewrites the rule of `source-rules.test.ts`). The engine, `exec/`, `checks/` and the store never do. No runner source other than a test spawns `process.execPath` (Task 13 pins it).
- stdout of the runner carries frames only; logs go to stderr. A frame is one JSON object on one line (UTF-8, `\n`), at most 1,048,576 bytes without the newline.
- Electron keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, loads no remote content, and `pnpm capture` never passes `--flowdriven-runner=on`. A preload file cannot `require` a sibling file under `sandbox: true`, so `preload.ts` imports only `electron`.
- Names, states and fields are the spec's: run states (13.1), `waiting_approval`, `needs_login`; the manifest read model mirrors the format and keeps its snake_case (`for_each`, `on_item_fail`, `max_pick`); run read models are camelCase.
- No `any`; `noUncheckedIndexedAccess` is on, so `calls[0].x` is written `calls.at(0)?.x`; a bare `!` needs a comment that says why. Time and ids are injected (`now`, `newId`). Hidden characters in tests are built with `String.fromCodePoint`.
- UI: plain CSS modules with the tokens of `apps/desktop/src/styles/tokens.css`; status is icon plus words, never colour alone; every new CSS file keeps `overflow-wrap: anywhere` and `min-width: 0` where `layout-guards.test.ts` requires them (only existing files are listed there; Task 4, 6 and 7 edit existing CSS modules).
- Tests that start the real runner, spawn a child or wait for a timer pass `{ timeout: 20_000 }` as their options argument. Tests: temporary folders come from `mkdtempSync(join(tmpdir(), "flowdriven-"))` and are removed in `afterEach`. No network, no real harness, no socket, no window. Vitest prints Node's SQLite ExperimentalWarning once per file; that is expected.
- The executor never commits. Steps marked "Chair step (commit)", "Chair step (GUI)" or "Chair step (network)" are skipped and left unticked. After every task that touches `apps/desktop/electron` the chair runs `pnpm capture` before the commit.
- After two failed attempts write `Blocked: <short reason>` under the task and stop.

## Gates

| Gate | Command | Passes when | Who |
|---|---|---|---|
| Task gate | `pnpm format && pnpm check` | exit 0 | executor |
| One test file | `pnpm vitest run <path>` | the named tests pass | executor |
| Web build | `pnpm build:web` | exit 0 (Tasks 1, 2, 3, 4, 6, 7, 12, 16) | executor |
| Capture | `pnpm capture` | prints `captured N screens` (N is 16 until Task 17, then 20), exit 0 | **Chair step (GUI)**, Tasks 14, 15, 17 |
| Demo walk | `pnpm build && FLOWDRIVEN_DEMO=1 TZ=UTC pnpm --filter @flowdriven/desktop exec electron dist-electron/demo-walk.js` | exit 0, one PNG per stage and `walk.log` in `.workflow/scratch/demo-walk/` | **Chair step (GUI)**, Task 17 |
| Commit | `git add ... && git commit ...` | commit created | **Chair step (commit)**, end of every task |

`pnpm check` runs Biome, the six `tsc` programs, Vitest (project `node` includes `packages/*/src/**/*.test.ts` and `apps/desktop/electron/**/*.test.ts`; project `ui` includes `apps/desktop/src/**/*.test.{ts,tsx}`), the hidden-character scan and the dependency gate. New test files need no configuration.

## Dependency changes

None.

## Decisions fixed by the chair (2026-11-11; the tasks follow them)

1. **Transport: JSON-RPC 2.0 over the runner's standard input and output.** One JSON object per line. The app starts the runner as its child process and is its only client. Reasons: only the process that started the runner can reach it, so no other process of the user can approve anything; the executor cannot bind a socket, so socket code could not be tested by the one who writes it; the server core takes any pair of streams, so the socket is one small task in plan 04. Rejected: the socket now; Electron `utilityProcess` (no stdin pipe, so a second transport). Errors use the JSON-RPC `error` member with `data.code` set to a `RunnerErrorCode`; an unknown method is -32601; a bad frame is -32600; events are notifications `{"jsonrpc":"2.0","method":"event","params":<RunnerEvent>}`; every request with an `id` gets exactly one answer. End of stdin means the app is gone: the runner starts no new walk, closes the store and exits 0 (a run that was walking is found by `recoverAfterCrash` at the next start).
2. **Who validates.** The wire schemas live in `@flowdriven/contracts` (Task 12). The runner validates every input with the operation's input schema and parses every output with the output schema before it leaves; an output that does not parse becomes `unavailable` "Internal error" plus an audit entry. The renderer validates every output and event again (Task 16). Electron main knows no schema; it checks shape and size only (Tasks 14 and 15).
3. **Contracts load under plain Node** (Task 1).
4. **Contract 1.1** (Tasks 2, 3, 4). `CONTRACT_VERSION` becomes 1.
5. **The engine answers at once** (Task 8): begin variants return `{ run, settled }` after the synchronous part; `settled` never rejects; the four present methods become "begin, then await settled" and the present tests pass unchanged.
6. **The runner process** (Tasks 9 to 13). Started as `node packages/runner/src/main.ts --stdio --data-dir <path> [--demo]`; order at start: arguments, data folder (mode 0700, owned by the user, not writable by group or others), `flowdriven.sqlite`, the one-runner guard (SQLite's own exclusive lock; a second runner exits 3 with one line on stderr), `recoverAfterCrash`, the demo flow if `--demo`, serve. `ELECTRON_RUN_AS_NODE` is removed from `process.env` at start. Expired approvals are swept every 60 seconds. One coalesced `changed` event per turn of the event loop. One handler table keyed by operation name. Not built yet (answer `unavailable` with one plain sentence): `flows.build`, `flows.update`, `readiness.install`, `harnesses.rescan`, `harnesses.setConsent`, `settings.update`. Live mode has no harness: the readiness hook answers "No harness is connected yet.".
7. **Electron main** starts the runner with `child_process.spawn(process.execPath, [entry, "--stdio", "--data-dir", dir, ...], { env: { ELECTRON_RUN_AS_NODE: "1", PATH, HOME, TMPDIR, LANG }, stdio: ["pipe", "pipe", "pipe"] })` (Tasks 14, 15). Data folder: `FLOWDRIVEN_DATA_DIR`, else `<appData>/FlowDriven`, else with `FLOWDRIVEN_DEMO=1` `<appData>/FlowDriven-demo`. At most 3 starts in 60 seconds. On quit: end stdin, wait 3 seconds, kill.
8. **Renderer**: `IpcRunnerClient`, `createRunnerClient` picks it when `flowdrivenShell.runner` exists (Task 16).
9. **Screens** for format 1.1, read-only for the new kinds except the choice (Tasks 4, 6, 7).
10. **Evidence for the owner**: `apps/desktop/electron/demo-walk.ts` (Task 17).
11. **Nothing in this plan needs the owner's yes** (see above).
12. **ROADMAP.md**: Task 18.

## Decisions made in this plan

Spec 18.4 leaves these to the builder; the chair's list above is not repeated. Each can change in a later plan.
1. **Walks of one flow run first in first out; walks of different flows overlap.** The engine holds no in-memory state shared across runs (Fact 5), but the seen store is shared by all runs of a flow and is read when a loop starts: two overlapping runs of one flow would both find a job unseen and process it twice (a double send in a real flow). So the chain key is the flow id, which also gives the per-run chain the brief asks for. Different flows share only the store, whose transactions are synchronous, so they overlap; Task 8 proves both with a gated harness.
2. **The contract's loop is a `Step` with `do: "loop"` and a `loop` object**, and an ask is a `Step` with `do: "ask"` and an `ask` object, not new union members. Every present consumer keeps `Step[]`. A refinement requires the object exactly for its `do` and at least one check for every step except `ask` and `loop`; the mapper gives nothing a fake check.
3. **`runner.info.mode` has a third value, `"sample"`**, answered by the fixtures client, so the sidebar reads one source for its notice (sample, demo, live) and `createRunnerClient` needs no second signal.
4. **The fixtures get a new scenario `looped`** (the story plus one flow, one waiting run and one pending choice) instead of a change to the default story, because about a dozen present tests pin its counts (five flows, five waiting decisions, "Inbox, 5 waiting").
5. **`Store.listFlows()`** is added (the newest registration of each flow id, ordered by id); the interface had no way to list flows.
6. **The requirement state `unchecked`** ("Not checked yet") is added to the contract: none of `ok`, `missing`, `needs_login`, `failed` is neutral. `isReady` and `attentionCount` count it as needing attention for a required item.
7. **Error numbers**: `invalid_input` -32602, `not_found` -32001, `not_allowed` -32002, `unavailable` -32003; every error also carries `data.code`. The runner exits 0 at end of input, 2 for bad arguments or a refused data folder, 3 when another runner holds the folder, 4 after a protocol error, 1 for a crash.
8. **Run ids and approval ids are short**: `<prefix>-<12 hex characters of a random UUID>` instead of the full UUID, so the screens stay readable. A collision is impossible in practice and the primary key would refuse it.
9. **`approvals.answer` is `restricted` over MCP**: "Over MCP, an answer only opens the item in the app; picks are never sent over MCP." (spec 15.2 item 10).
10. **`Approval` gains `itemKey` and `picks`**; `StepRun` gains `picks` and `items`; the report is attached to every run detail and `runs.report` answers for every state (a run that has not ended gets the line "Not finished: ..." of plan 02).
11. **The demo harness picks the job batch from the run's position among the runs of its flow**, read from the store, so the order (j1 to j4, then j3 to j5, then from the start) survives a restart of the app.
12. **The engine gains `sweepExpired()` and `shutdown()`**; the sweep goes through the flow's chain, and after `shutdown()` the begin variants refuse new work and queued walks that have not begun are dropped.
13. **`flows.import` registers a valid folder** (it writes the `flows` topic) and returns its issues; a folder with errors is not registered and returns `flow` and `hash` absent.
14. **Callable shape of the IPC reply**: the main process never throws across `invoke`; it answers `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.

## Review Focus

The surfaces that carry the risk, most likely to bite first. Each names the test that pins it.
1. **The relay in Electron main** (a renderer must not reach the runner except through the channel, from the app's own main frame, with a plain-object input): Task 15 `refuses a call from a foreign frame, a sub-frame, a bad method name or a non-object input`.
2. **The preload bridge** (present only with the flag, frozen, no Node object leaks): Task 15 `the bridge exists only with the runner flag and exposes only call and subscribe`.
3. **The frame reader** (a long line, a line that is not an object, a split multi-byte character, many frames in one chunk): Task 12 `the line framer splits chunks, counts bytes and refuses a long line before it ends`; Task 14 `a line over the limit ends the connection and fails the waiting calls`.
4. **The data-folder checks and the one-runner guard**: Task 9 `refuses what is not a folder owned by the user and writable only by it`, `an exclusive store refuses a second process and says so`; Task 13 `a second real process on the same folder exits 3 while the first runs`.
5. **The begin variants** (the walk must not start inside the caller's turn, a refused call must not leave a half write, two walks of one flow must not overlap, nothing thrown escapes): Task 8 `walks of one flow run first in first out`, `settled never rejects`, `begin variants refuse bad input at once and write nothing`.
6. **Output that does not parse** must never leave the runner: Task 11 `an output that does not parse becomes Internal error and an audit entry`.
7. **A choice must be answered once, for the item shown**: Task 4 `a second click cannot send the choice twice and the choice sent is the one shown`.

## Known limits (stated so the reviewers do not rediscover them)

- `@flowdriven/contracts` is a `devDependency` of the runner (see "Needs the owner's yes").
- The link between app and runner is private to the app. Another process of the user, the MCP mode of spec 8.7 and the launch agent need the socket of plan 04.
- A packaged app must carry the runner's sources and Node's type stripping, and must keep the `runAsNode` fuse on or choose another way to start the runner (plan 11).
- Command checks are refused on Windows (plan 02); the process-group kill of a command check is not tested there.
- The renderer shows no live run progress beyond what the `changed` event triggers (a reload of the queries); a step that runs for minutes shows its state at the last event.
- The runner has no `bin` entry (plan 02's outline item 2): it is started as `node packages/runner/src/main.ts`; a `bin` entry changes the manifest and so the lockfile.
- A run's folder is always `<data-dir>/demo-project` or `<data-dir>/project`; `flows.run` takes no folder from the renderer yet (Task 11).

---

## File Structure

```
tsconfig.base.json                          three compiler flags (Task 1)
packages/contracts/src/                     ".ts" imports; RunnerError field (Task 1); flow.ts, run.ts, readiness.ts, common.ts (Task 2);
  operations.ts, version.ts (Task 3); approval.ts (Task 4); wire.ts (Task 12)
packages/fixtures/src/                      client.ts (Tasks 3, 4, 5), story/looped.ts, state.ts, index.ts (Task 5)
packages/runner/src/
  engine.ts, exec/recovery.ts, exec/chain.ts   begin variants, sweepExpired, shutdown (Task 8)
  storage.ts, sqlite-store.ts                  listFlows, exclusive lock (Task 9)
  service/events.ts, data-dir.ts               change events, data folder checks (Task 9)
  service/map-flow.ts, map-run.ts, map-approval.ts   engine rows to read models (Task 10)
  service/handlers.ts, service.ts, demo-harness.ts   the handler table, the dispatcher, the demo harness (Task 11)
  demo/demo-script.ts                          the demo's scripted replies, shared (Task 11)
  service/server.ts                            JSON-RPC over two streams (Task 12)
  service/args.ts, run-process.ts, main.ts     the process (Task 13)
  test-helpers/rpc-client.ts, hold-lock-child.ts   test helpers (Tasks 9, 12)
apps/desktop/electron/
  runner-link.ts, runner-paths.ts              the link class, folders and environment (Task 14)
  runner-ipc.ts, runner-bridge.ts, preload.ts, main.ts, window.ts, security.ts   the relay and wiring (Task 15)
  demo-walk.ts, demo-walk-steps.ts, screens.json, capture.ts   evidence (Task 17)
apps/desktop/src/
  screens/inbox/*                              the choice (Task 4)
  screens/builder/StepRow.tsx                  loops, asks, when lines (Task 6)
  screens/runs/*                               items, picks, full report (Task 7)
  runner/ipc-client.ts, create-client.ts, shell.ts, app-info.ts, nav/Sidebar.tsx   renderer side (Tasks 5, 16)
docs/plans/ROADMAP.md                          rows 02b and 04 (Task 18)
```

---

### Task 1: Contracts load under plain Node

Covers decision 3 and the plain-Node rule. The runner process (Tasks 9 to 13) imports the contracts at run time; today Node cannot load them.

**Files:**
- Modify: `tsconfig.base.json`
- Modify (contracts sources, relative specifiers only, except `operations.ts`): `packages/contracts/src/approval.ts`, `flow.ts`, `harness.ts`, `index.ts`, `operations.ts`, `readiness.ts`, `run.ts`, `settings.ts`
- Create: `packages/runner/src/contracts-load.test.ts`

**Interfaces:**
- `tsconfig.base.json` `compilerOptions` gains, after `"noEmit": true`: `"allowImportingTsExtensions": true, "rewriteRelativeImportExtensions": true, "erasableSyntaxOnly": true`. (`allowImportingTsExtensions` alone breaks `tsc -p apps/desktop/tsconfig.electron.json`, the one program that emits, with TS5096; `rewriteRelativeImportExtensions` lifts that. Tried: `pnpm typecheck`, `pnpm build:web` and the emit of the electron program all pass.)
- In the eight sources every relative `import ... from "./x"`, `import "./x"` and `export * from "./x"` becomes `"./x.ts"`, the `import type` ones included. `client.ts` is not touched: its only relative import is `import type ... from "./operations"`, which Node erases and never loads.
- `RunnerError` in `operations.ts` becomes: `export class RunnerError extends Error { readonly code: RunnerErrorCode; constructor(code: RunnerErrorCode, message: string) { super(message); this.name = "RunnerError"; this.code = code; } }`.

- [x] **Step 1: Write the failing tests** (`packages/runner/src/contracts-load.test.ts`, 3 tests; imports `spawnSync`, `readdirSync`, `readFileSync`, `fileURLToPath`)
```ts
const runner = fileURLToPath(new URL("..", import.meta.url));                 // packages/runner
const contracts = fileURLToPath(new URL("../../contracts/", import.meta.url));
test("the contracts load on plain Node from the runner package", () => {
  const code = "const m = await import('@flowdriven/contracts'); process.stdout.write(typeof m.operations['flows.list'] + ' ' + new m.RunnerError('not_found', 'x').code)";
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: runner, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  expect(out.stderr).not.toContain("ERR_MODULE_NOT_FOUND"); expect(out.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(out.status).toBe(0); expect(out.stdout).toBe("object not_found");
});
test("relative imports in the contracts sources name their .ts file", () => {
  // every non-test .ts file under contracts/src; a line that starts with `import ` or `export ` and has `from "./..."` (or is `import "./..."`) and is not `import type` must end its specifier in `.ts"`
  /* collect offending lines; expect(offenders).toEqual([]) */
});
test("the base compiler settings keep the contracts erasable", () => {
  const base = JSON.parse(readFileSync(new URL("../../../tsconfig.base.json", import.meta.url), "utf8")).compilerOptions;
  expect([base.allowImportingTsExtensions, base.rewriteRelativeImportExtensions, base.erasableSyntaxOnly]).toEqual([true, true, true]);
});
```
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/contracts-load.test.ts`. Expected: FAIL (the load test with `ERR_MODULE_NOT_FOUND`; the other two on the offending lines and the missing flags).
- [x] **Step 3: Make the changes above.** Then check by hand that nothing else the runner imports at run time has the same fault: `packages/runner/src/source-rules.test.ts` already loads the SDK and the runner on plain Node, and the contracts import only `zod`.
- [x] **Step 4: Run the tests, the typecheck and the web build**
  Run: `pnpm vitest run packages/runner/src/contracts-load.test.ts && pnpm typecheck && pnpm build:web`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS (every present test unchanged).
- [x] **Step 6: Chair step (commit)**
```bash
git add tsconfig.base.json packages/contracts packages/runner/src/contracts-load.test.ts
git commit -m "Let Node load the contracts" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 2: Contract 1.1: flows, runs and the readiness state

Covers decision 4 (flow, run and readiness part) and the list in plan 02's handover. Every addition is optional or additive, so the fixtures and the screens keep compiling; two screen files change only because a `Record` is exhaustive.

**Files:**
- Modify: `packages/contracts/src/common.ts`, `flow.ts`, `run.ts`, `readiness.ts`, `flow.test.ts`, `run.test.ts`, `readiness.test.ts`
- Modify: `packages/runner/src/states.test.ts`, `apps/desktop/src/screens/readiness/ReadinessRow.tsx`, `apps/desktop/src/ui/status.ts`

**Interfaces (exact; all other names stay):**
```ts
// common.ts
export const StepDo = z.enum(["worker", "agent", "builtin", "skill", "flow", "ask", "loop"]);
// flow.ts
export const Check = z.object({ type: CheckType, required: z.boolean().default(true), summary: z.string(), cmd: z.string().optional(), args: z.array(z.string()).optional(), of: z.string().optional() });
RequirementType gains "web", "desktop", "trigger" (appended, in that order);
Requirement gains: mode: z.enum(["open", "read", "act"]).optional(), apps: z.array(z.string()).optional(), kinds: z.array(z.string()).optional()
export const AskDecl = z.object({ question: z.string(), choose_from: z.string(), max_pick: z.union([z.number().int().min(1), z.string()]), approves: z.array(z.string()), expires: z.string(), on_expiry: z.enum(["end", "fail"]) }); export type AskDecl
const stepFields = { id, title, do: StepDo, instructions: z.string(), when: z.string().optional(), skill: z.string().optional(), flow: z.string().optional(), builtin: z.string().optional(), ask: AskDecl.optional(), uses, skills, connectors, worker, outputs, checks: z.array(Check).default([]), retry, risky, idempotent };  // the present fields, same rules; checks lose .min(1)
function needsChecks(step: { do: StepDo; checks: Check[] }, ctx: z.RefinementCtx): void  // issue at path ["checks"] "A step needs at least one check." unless do is "ask" or "loop"
export const LeafStep = z.object(stepFields).superRefine(needsChecks); export type LeafStep
export const LoopDecl = z.object({ for_each: z.string(), as: z.string(), key: z.string().optional(), max: z.number().int().min(1).optional(), on_item_fail: z.enum(["skip", "stop"]), steps: z.array(LeafStep).min(1) }); export type LoopDecl
export const Step = z.object({ ...stepFields, loop: LoopDecl.optional() }).superRefine((step, ctx) => { needsChecks(step, ctx); /* issue at ["loop"] unless (do === "loop") === (loop !== undefined); issue at ["ask"] unless (do === "ask") === (ask !== undefined) */ }); export type Step
export const TRIGGER_KINDS = ["manual", "schedule", "new_item", "file_change", "link", "webhook", "flow_done"] as const;
export const Trigger = z.object({ kind: z.enum(TRIGGER_KINDS), summary: z.string() }); export type Trigger
export const ParamDecl = z.object({ type: z.enum(["number", "text", "bool", "enum"]), default: z.union([z.string(), z.number(), z.boolean()]).optional(), min: z.number().optional(), max: z.number().optional(), options: z.array(z.string()).optional(), label: z.string().optional() }); export type ParamDecl
export const Limits = z.object({ max_duration: z.string().optional(), max_items: z.number().int().min(1).optional(), max_runs_per_day: z.number().int().min(1).optional(), max_attempts: z.number().int().min(1).optional() }); export type Limits
export const FLOW_FORMATS = ["flowdriven-flow/1", "flowdriven-flow/1.1"] as const;
FlowManifest: format: z.enum(FLOW_FORMATS); gains triggers: z.array(Trigger).optional(), params: z.record(z.string(), ParamDecl).optional(), limits: Limits.optional()
// run.ts
Attempt gains replan: z.boolean().optional(), worker: z.string().optional()
export const ItemState = z.enum(["pending", "running", "passed", "failed", "skipped"]);
export const SKIP_REASONS = ["seen", "duplicate", "capped", "stopped"] as const; export const SkipReason = z.enum(SKIP_REASONS);
export const LeafStepRun = z.object({ ...the present StepRun fields, picks: z.array(z.object({ key: z.string(), label: z.string() })).optional() });
export const RunItem = z.object({ key: z.string(), label: z.string(), state: ItemState, skip: SkipReason.optional(), note: z.string().optional(), steps: z.array(LeafStepRun) });
export const StepRun = LeafStepRun.extend({ items: z.array(RunItem).optional() });   // types of the same names exported
// readiness.ts
RequirementState = z.enum(["ok", "missing", "needs_login", "failed", "unchecked"])
```
`ReadinessRow.tsx` labels gain `web: "Website"`, `desktop: "Computer"`, `trigger: "Trigger"`. `status.ts` `statuses.requirement` gains `unchecked: { icon: "dash", label: "Not checked yet", tone: "neutral" }`. Tried in the scratch clone: with exactly these edits `pnpm typecheck` passes and exactly three present tests fail, the three changed below (the version stays 0 until Task 3).

Present tests that change (3): `flow.test.ts` "uses the spec's check, input and requirement words" (the requirement list gains `web`, `desktop`, `trigger`); `readiness.test.ts` "readiness states are ok, missing, needs_login and failed" (renamed "... failed and unchecked", list gains `unchecked`); `states.test.ts` "engine and SDK vocabularies equal the contract's" (the last assertion becomes `expect([...REQUIREMENT_TYPES]).toEqual(RequirementType.options)`, importing `REQUIREMENT_TYPES` from the SDK instead of `BASE_REQUIREMENT_TYPES`). `status.test.tsx` iterates `RequirementState.options` and needs no edit.

- [x] **Step 1: Write the failing tests** (9 new, 3 changed = 12 named)
  `flow.test.ts` (5 new): (1) `format 1.1 adds ask, skill, flow and loop to the step words`: `StepDo.options` equals the seven. (2) `an ask or loop step needs its object and no check, and no other step may carry one`: `Step.parse` accepts `{do:"ask", ask:{...}, checks:[]}` and `{do:"loop", loop:{... steps:[a worker step with one check]}}`; refuses `do:"ask"` without `ask`, `do:"loop"` without `loop`, a `worker` with `loop`, and a `worker` with no checks (the present rule). (3) `a step nested in a loop still needs its check`: `LoopDecl.safeParse` fails for a nested worker with `checks: []` and for `steps: []`. (4) `the manifest carries triggers, params and limits as optional read models and accepts format 1 and 1.1`: a manifest without them parses (format 1), one with `format: "flowdriven-flow/1.1"`, `triggers: [{kind:"manual", summary:"Run by hand"}]`, `params: {min_score: {type:"number", default: 7}}`, `limits: {max_items: 20}` parses; `"flowdriven-flow/2"` does not. (5) `a command check keeps its program and arguments`: `Check.parse({type:"command", summary:"s", cmd:"pnpm", args:["test"]})`.
  `run.test.ts` (3 new): (6) `a looped step run lists items with a state and a skip reason`: `StepRun.parse` with one item `{key:"j4", label:"Job four", state:"skipped", skip:"seen", note:"skipped: seen in an earlier run", steps:[]}`. (7) `an item state is one of five and a skip reason one of four`: `ItemState.options` and `SKIP_REASONS`. (8) `an attempt can say it was a re-plan and name its worker`.
  `readiness.test.ts` (1 new): (9) `an unchecked required item needs attention`: `isReady` false and `attentionCount` 1 for one required `unchecked` item, `isReady` true when it is optional.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/contracts packages/runner/src/states.test.ts`. Expected: FAIL (missing exports, `StepDo.options` of length three).
- [x] **Step 3: Implement the interfaces above** in the contracts, then `ReadinessRow.tsx` and `status.ts`.
- [x] **Step 4: Run the tests, the typecheck and the web build**
  Run: `pnpm vitest run packages/contracts packages/runner/src/states.test.ts apps/desktop/src/ui && pnpm typecheck && pnpm build:web`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS (`version.test.ts` still says 0; Task 3 raises it).
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/contracts packages/runner/src/states.test.ts apps/desktop/src
git commit -m "Add the format 1.1 flow and run read models to the contract" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 3: Contract 1.1: operations and version, and the fixtures client

Covers decision 4 (operations and version part). The contract gets the five new operations and `flows.run` gets `params`; the fixtures client implements them so the screens keep running on sample data. Approvals do not change here (Task 4).

**Files:**
- Modify: `packages/contracts/src/operations.ts`, `operations.test.ts`, `version.ts`, `version.test.ts`
- Modify: `packages/fixtures/src/client.ts`, `packages/fixtures/src/client.test.ts`

**Interfaces (exact):**
```ts
// operations.ts, after RunnerError; imports ContentHash, Id, IsoDateTime from ./common.ts
export const FlowIssue = z.object({ severity: z.enum(["error", "warning"]), code: z.string(), path: z.string(), message: z.string() }); export type FlowIssue
export const AuditRecord = z.object({ at: IsoDateTime, kind: z.string(), runId: Id.optional(), detail: z.string() }); export type AuditRecord   // detail = compact JSON text
export const RUNNER_MODES = ["sample", "demo", "live"] as const; export const RunnerMode = z.enum(RUNNER_MODES); export type RunnerMode
export const RunParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
// "flows.run" first input member: z.object({ flowId: Id, inputs: z.record(z.string(), z.string()).optional(), params: RunParams.optional() })
// new definitions, in this order, right after "approvals.resolve":
"approvals.answer": { input: z.object({ approvalId: Id, picks: z.array(z.string()) }), output: z.array(Approval), mcp: "restricted", mcpRule: "Over MCP, an answer only opens the item in the app; picks are never sent over MCP.", errors: ["invalid_input", "not_found", "not_allowed"], reads: [], writes: ["approvals", "runs"] }
"flows.import": { input: z.object({ path: z.string().min(1) }), output: z.object({ flow: FlowDetail.optional(), issues: z.array(FlowIssue), hash: ContentHash.optional() }), mcp: "no", errors: ["invalid_input", "not_found", "unavailable"], reads: [], writes: ["flows"] }
"runs.export": { input: z.object({ runId: Id }), output: z.object({ markdown: z.string() }), mcp: "no", errors: ["invalid_input", "not_found", "unavailable"], reads: ["runs"], writes: [] }
"audit.list": { input: z.object({ runId: Id.optional() }), output: z.array(AuditRecord), mcp: "no", errors: ["invalid_input", "not_found"], reads: ["runs"], writes: [] }
"runner.info": { input: z.object({}), output: z.object({ contractVersion: z.number().int().min(0), mode: RunnerMode }), mcp: "no", errors: ["invalid_input"], reads: ["settings"], writes: [] }
```
`unavailable` is appended to `errors` of `flows.update`, `readiness.install`, `harnesses.rescan`, `harnesses.setConsent` and `settings.update` (the runner answers it for them, decision 6). `version.ts`: `CONTRACT_VERSION = 1`.
Fixtures client (the `Handlers` type is exhaustive, so all five must exist): `"runner.info"` returns `{ contractVersion: CONTRACT_VERSION, mode: "sample" }`; `"audit.list"` returns `[]`; `"flows.import"` throws `RunnerError("unavailable", "Importing a flow needs the engine.")`; `"approvals.answer"` finds the approval (`not_found` "There is no approval <id>.") and then throws `RunnerError("invalid_input", "This decision is not a choice.")` (no sample approval is a choice yet; Task 4 replaces the body); `"runs.export"` returns `{ markdown }` with these lines joined by `\n` (ending with a newline): `# <flowName>: run <id>`, empty, `- State: <state with _ as spaces>`, `- Started: <startedAt>`, empty, `## Steps`, then per step `- <title>: <state>` followed by one line `  - <key>: <state>` per item of a looped step.

Present tests that change (3): `operations.test.ts` "version 0 has exactly these operations" (renamed "version 1 ...", sorted list gains `approvals.answer`, `audit.list`, `flows.import`, `runner.info`, `runs.export`), "only the operations in spec 8.7 are exposed over MCP, and the approval rule travels with the contract" (the sorted MCP list becomes `approvals.answer`, `approvals.list`, `approvals.resolve`, `flows.build`, and so on; the restricted list becomes `["approvals.resolve", "approvals.answer"]`); `version.test.ts` "runner API contract is version 0" (renamed "... version 1", expects 1).

- [x] **Step 1: Write the failing tests** (7 new, 3 changed = 10 named)
  `operations.test.ts` (4 new): (1) `approvals.answer is restricted over MCP and its rule travels with the contract`. (2) `operations the runner may refuse as not built list unavailable`: for the six of decision 6 (`flows.build`, `flows.update`, `readiness.install`, `harnesses.rescan`, `harnesses.setConsent`, `settings.update`) `operations[name].errors` contains `unavailable`. (3) `flows.run takes params next to inputs`: input with `params: {min_score: 8, fast: true, who: "Ana"}` parses; `params: {x: [1]}` does not. (4) `runner.info names the contract version and one of three modes`: the output schema accepts `{contractVersion: 1, mode: "demo"}` and refuses `mode: "other"`; `RUNNER_MODES` equals `["sample","demo","live"]`.
  `client.test.ts` (3 new): (5) `runner.info says sample data`. (6) `runs.export writes the steps and, for a looped step, its items`: export of `run-0006` contains `# Figma to Flutter: run run-0006` and `- Build the screens: failed`; after `c.state.runs[0]` gets a step with `items: [{key:"j1", label:"Job one", state:"passed", steps:[]}]` its export contains `  - j1: passed`. (7) `flows.import needs the engine, audit.list is empty and a decision that is not a choice cannot be answered`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/contracts/src/operations.test.ts packages/contracts/src/version.test.ts packages/fixtures/src/client.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement** the contract additions and the fixtures handlers.
- [x] **Step 4: Run the tests and the typecheck**
  Run: `pnpm vitest run packages/contracts packages/fixtures && pnpm typecheck`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check && pnpm build:web`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/contracts packages/fixtures
git commit -m "Add the runner operations of contract version 1" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 4: Inbox: answering a choice

Covers decision 9 (the choice) and the approval part of decision 4. A choice is an `ask` approval; the Inbox shows its question and options and calls `approvals.answer`.

**Files:**
- Modify: `packages/contracts/src/approval.ts`, `approval.test.ts`
- Modify: `packages/fixtures/src/client.ts`, `client.test.ts`
- Modify: `apps/desktop/src/screens/inbox/ApprovalList.tsx`, `ApprovalDetail.tsx`, `PayloadView.tsx`, `InboxScreen.tsx`, `Inbox.module.css`, `Inbox.test.tsx`

**Interfaces:**
```ts
// approval.ts
ApprovalKind gains "ask" (appended)
Payload gains z.object({ kind: z.literal("choice"), question: z.string(), options: z.array(z.object({ key: z.string(), label: z.string() })), maxPick: z.number().int().min(1) })
Approval gains itemKey: z.string().optional() (after stepTitle) and picks: z.array(z.string()).optional() (after resolvedAt)
```
`ApprovalList.tsx`: `actionName` gives `ask: "Choice"`, `noun` gives `ask: "choice"`, `icon` gives `ask: "list"`. `PayloadView.tsx`: its title record gains `choice: "These are the options to choose from"` and its icon record `choice: "list"`; a new prop group `picks: string[]`, `setPicks: (picks: string[]) => void`, `pickable: boolean`; for a choice it renders `<fieldset>` with `<legend>Choose up to {maxPick}. Pick none to skip them all.</legend>` and one `<label>` per option holding `<input type="checkbox">` and `<Revealed text={label} />` plus `<code>{key}</code>`; while `picks.length >= maxPick` every unchecked box is disabled; when `pickable` is false (not pending) the boxes are disabled and a picked option shows the word "Picked". `ApprovalDetail.tsx`: the note record gains `choice: "Nothing happens until you choose."`; for a pending choice the actions are one primary large button `Send choice` (no Approve, Edit or Reject), calling a new prop `answer: (picks: string[]) => void`; it keeps the picks in its own state (the component is keyed by approval id). `InboxScreen.tsx`: `answer(picks)` mirrors `resolve` (same `inFlight` and `justResolved` guards, `action("approvals.answer", { approvalId: selected.id, picks })`, status `Choice sent.`, errors in the detail). Fixtures `approvals.answer` (replaces Task 3's body), in this order: `not_found`; kind not `ask` `invalid_input` "This decision is not a choice."; expired (after `expireApprovals`) `not_allowed` "This approval expired."; not pending `not_allowed` "This decision was already made."; run not `waiting_approval` `not_allowed` "This run is no longer waiting for approval."; a pick that is not an option key or repeated, or more picks than `maxPick`, `invalid_input` "Those picks are not allowed."; then the approval becomes `approved` with `picks` and `resolvedAt`, the run's `pick`-step (the step with the approval's `stepId`) becomes `passed` with `picks` = the picked options (`{key, label}`), the run becomes `running` when no other approval of it is pending, and the list `[approval]` is returned.

- [x] **Step 1: Write the failing tests** (10 named; helper `choice(overrides)` builds a pending `ask` approval of run `run-0006` with options `j1` "Job one" and `j2` "Job two", `maxPick: 1`, pushed to `client.state.approvals` in the UI and client tests)
  `approval.test.ts` (2): (1) `a choice approval carries its question, options and limit`: valid parse; `maxPick: 0` and a missing `question` fail. (2) `an ask approval is not a risky action and may name an item and its picks`: parses without `riskyAction`; with `itemKey: "j1"`, `picks: ["j1"]`.
  `client.test.ts` (3): (3) `answering a choice approves it, records the picks and lets the run go on`. (4) `picks outside the options, too many picks and a second answer are refused`. (5) `an expired choice cannot be answered`.
  `Inbox.test.tsx` (5): (6) `a choice shows its question, its options and one Send choice button`. (7) `Send choice sends the picked keys and shows Choice sent.`: spy on `approvals.answer`, expects `{ approvalId, picks: ["j1"] }`. (8) `with maxPick 1 a second box is disabled until the first is cleared`. (9) `a second click cannot send the choice twice and the choice sent is the one shown`: two clicks give one call; switching the selection while a call is pending does not retarget it (the pattern of the present test `a second click after 400 ms cannot approve another decision`). (10) `a resolved choice lists what was picked and offers no button`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/contracts/src/approval.test.ts packages/fixtures/src/client.test.ts apps/desktop/src/screens/inbox`. Expected: FAIL.
- [x] **Step 3: Implement** the contract, the fixtures handler and the screens as described. The present Inbox tests must pass unchanged (the default story has no choice).
- [x] **Step 4: Run the tests, the typecheck and the web build**
  Run: `pnpm vitest run packages/contracts packages/fixtures apps/desktop/src/screens/inbox && pnpm typecheck && pnpm build:web`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/contracts packages/fixtures apps/desktop/src
git commit -m "Let the Inbox answer a choice" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 5: Fixtures: the looped scenario

Covers decision 4 ("the fixtures client implements every new operation, and its story gains a flow with a loop, a condition and an `ask`, a run of it with items in several states, and a pending choice in the Inbox"), as a new scenario (decision 4 of this plan's own list).

**Files:**
- Create: `packages/fixtures/src/story/looped.ts`, `packages/fixtures/src/looped.test.ts`
- Modify: `packages/fixtures/src/state.ts`, `packages/fixtures/src/index.ts`, `packages/fixtures/src/client.ts`
- Modify: `apps/desktop/src/runner/create-client.ts`, `apps/desktop/src/runner/create-client.test.ts`

**Interfaces:**
- `state.ts`: `Scenario = "story" | "empty" | "long" | "looped"`; `export function buildLooped(): FixtureState` (= `buildStory()` then `addLooped(state)`); `index.ts` exports `buildLooped`. `client.ts`: `options.scenario === "looped"` uses `buildLooped()`. `looped.ts`: `export function addLooped(state: FixtureState): void`. `create-client.ts`: `scenarioFromSearch` also returns `"looped"` for `?scenario=looped`.
- `addLooped` appends (in this order) and sets `state.nextRunNumber = 9`, `state.nextHashNumber = 8`:
  1. A flow record `dev.example.job-review`, name "Job alert review", kind `light`, version `0.1.0`, hash `sha256:` + `7` zero-padded to 64 hex digits, summary "Review new job alerts, pick the best and draft proposals.", `signOff: { state: "approved", version: "0.1.0" }`, `saved: true`, `playback`, `conversation: []`, `history: []`, `retiredStepIds: []`, a manifest with `format: "flowdriven-flow/1.1"`, `inputs: []`, `outputs: []`, `defaults: {}`, `license: "AGPL-3.0-only"`, one requirement `{ id: "worker", type: "harness", ref: "claude-code", required: true, sensitive: false, why: "Does the scoring and the drafting.", routes: [] }`, `params: { min_score: { type: "number", default: 7 } }`, `triggers: [{ kind: "manual", summary: "Run by hand" }]`. Steps (contract `Step`; every step carries `instructions`, `""` for a loop): `alerts` ("List the new alerts", worker, outputs `jobs` json, one `schema` check "The alerts are a list of jobs"); `review` ("Review every alert", `do: "loop"`, `checks: []`, `loop: { for_each: "${steps.alerts.outputs.jobs}", as: "job", key: "${job.id}", max: 20, on_item_fail: "skip", steps: [rough (agent, "Score the job", output `score`, schema check), page (worker, "Read the full post", `when: "rough.score.value >= params.min_score"`, contains check), full (agent, "Decide fit", `when: "page.passed"`, output `verdict`, schema check)] }`); `pick` ("Pick jobs", `do: "ask"`, `checks: []`, `ask: { question: "Which jobs get a prototype?", choose_from: "${steps.review.items where steps.full.outputs.verdict.fit}", max_pick: 2, approves: [], expires: "24h", on_expiry: "end" }`, `instructions` = the question); `build` ("Build and propose", `do: "loop"`, loop over `${steps.pick.outputs.choice}` as `job` key `${job.id}`, `on_item_fail: "skip"`, steps `proto` (worker, contains check) and `proposal` (worker, a `not_contains` check and a `user` check "You approve the proposal")). `playback` = `{ goal: "Review new job alerts and prototype the best ones.", touches: ["claude-code"], asksApprovalFor: ["Each proposal before it counts as done"] }`. A readiness report from `readiness([flow])` as `addLong` does.
  2. Run `run-0008` of that flow, state `waiting_approval`, started `2026-11-10T09:10:00.000Z`, project `~/Projects/jobs`, `approvalIds: ["ap-0017"]`. Steps: `alerts` passed; `review` passed with `items`: `j1` "Job one" passed (rough, page, full all passed), `j2` "Job two" passed (rough passed, page and full skipped with note `skipped: condition false`), `j3` "Job three" failed (rough failed, note "The score was missing."), `j4` "Job four" skipped with `skip: "seen"` and note `skipped: seen in an earlier run`, `j5` "Job five" skipped with `skip: "capped"` and note `skipped: over the item cap`; `pick` `waiting_approval`; `build` pending. Attempts and checks follow the shape of the story's other runs (worker `{ harnessId: "claude-code", name: "Claude Code" }` for steps that ran).
  3. Approval `ap-0017`: `kind: "ask"`, flow and run as above, `stepId: "pick"`, `stepTitle: "Pick jobs"`, summary "Which jobs get a prototype?", payload `{ kind: "choice", question: "Which jobs get a prototype?", options: [{ key: "j1", label: "Job one" }, { key: "j2", label: "Job two" }], maxPick: 2 }`, `editable: false`, `createdAt: "2026-11-10T09:28:00.000Z"`, `expiresAt: approvalExpiresAt(createdAt)`, `state: "pending"`. It is the newest waiting decision of this scenario.

- [x] **Step 1: Write the failing tests** (6 named: 5 new, 1 changed)
  `looped.test.ts`: (1) `the looped scenario adds one flow, one waiting run and one pending choice and leaves the story alone`: `buildLooped()` has six flows and eight runs and six pending approvals; `buildStory()` still has five flows. (2) `its flow validates and shows a loop, a condition and an ask`: `FlowManifest.parse`; step `do` list `["worker","loop","ask","loop"]`; the `page` step has a `when`. (3) `its run shows items in several states and the choice waiting`: `RunDetail.parse`; item states `["passed","passed","failed","skipped","skipped"]`, skip reasons `["seen","capped"]` on the last two. (4) `its choice validates and is the newest waiting decision`. (5) `runs.export of the looped run lists its items`: contains `  - j3: failed`.
  `create-client.test.ts` (1 changed): the test "the scenario query picks the sample data" gains `expect(scenarioFromSearch("?scenario=looped")).toBe("looped")` and `expect(await createRunnerClient("?scenario=looped").call("flows.list", {})).toHaveLength(6)`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/fixtures/src/looped.test.ts apps/desktop/src/runner/create-client.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement** as above.
- [x] **Step 4: Run the tests**
  Run: `pnpm vitest run packages/fixtures apps/desktop/src/runner`. Expected: PASS (the story tests are unchanged and pass).
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/fixtures apps/desktop/src/runner
git commit -m "Add a looped scenario to the sample data" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 6: Builder: loops, asks and when lines

Covers decision 9 (the Builder's flow pane). Read-only for the new kinds; the present edit buttons stay as they are.

**Files:**
- Modify: `apps/desktop/src/screens/builder/StepRow.tsx`, `Builder.module.css`, `Builder.test.tsx`

**Interfaces and copy (exact):**
- `StepRow` keeps its props. The worker line and the badge by `step.do`: `worker` and `agent` as now; `builtin` "Done by FlowDriven." with badge "FlowDriven"; `skill` "Uses the <step.skill ?? "skill"> skill." with badge "Skill"; `flow` "Runs <step.flow ?? "another flow">." with badge "Flow"; `ask` "Asks you to choose." with badge "Ask"; `loop` "Repeats for each <loop.as>." with badge "Loop".
- A step with `when` shows, under the worker line, `<div className={styles.when}>Runs only when <code>{when}</code></div>`.
- An `ask` step shows `<div className={styles.when}>Choose from <code>{ask.choose_from}</code>, up to {ask.max_pick}.</div>` and the question as `<p>`; it has no check rows (the `CheckList` is not rendered for an empty list).
- A `loop` step shows `<div className={styles.when}>For each item of <code>{loop.for_each}</code>{loop.key ? <>, keyed by <code>{loop.key}</code></> : null}{loop.max ? `, at most ${loop.max}` : ""}.</div>` and below it `<ol aria-label={`Steps in ${step.title}`} className={styles.nested}>` with one `<li className={styles.nestedStep}>` per nested step: its title (a plain `<span>`, no expand button), its worker line and badge by the same rules, its `when` line, its `uses` and its `CheckList`. Nested rows have no move, duplicate or delete buttons and no state icon.
- `Builder.module.css`: `.when { color: var(--text-muted); font-size: 12.5px; overflow-wrap: anywhere; min-width: 0; }`, `.nested { list-style: none; margin: 8px 0 0; padding: 0 0 0 20px; border-left: 1px solid var(--border); }`, `.nestedStep { padding: 8px 0; border-top: 1px solid var(--border); }` (the first nested row has no top border). Tokens only.
- The tests use `renderApp("#/builder/dev.example.job-review", { scenario: "looped" })`. The present `rows()` helper of `Builder.test.tsx` returns nested `li` too (9 for this flow), so the new tests use a local `topRows()` that keeps only the `li` whose `parentElement` is the list named "Steps"; the present helpers and tests stay unchanged.

- [x] **Step 1: Write the failing tests** (6 new)
  (1) `a loop step shows what it repeats over, its key and its nested steps one level down`: the step list has four top-level rows (`topRows()`), the second of them contains `For each item of` and the code text `${steps.alerts.outputs.jobs}`, and a list named "Steps in Review every alert" with three items. (2) `a nested step shows its worker line, its uses and its checks and has no edit buttons`: inside that list the first item has "Done by the brain, no tools." and a check row; `within(item).queryByRole("button", {name: "Delete"})` is null. (3) `a when line says when a step runs`: the nested `page` item contains `Runs only when` and `rough.score.value >= params.min_score`. (4) `an ask step shows its question, its source and the number of picks and has no check rows`. (5) `skill and flow steps say what they run`: a step edited into the looped client state with `do: "skill", skill: "prototype"` shows "Uses the prototype skill." and badge "Skill"; with `do: "flow", flow: "dev.example.other@1.0.0"` shows "Runs dev.example.other@1.0.0." (use `client.state.flows`; `renderApp` returns the client). (6) `a loop step still moves through flows.update`: clicking "Move down" in the second of `topRows()` calls `flows.update` with `{ flowId: "dev.example.job-review", edit: { kind: "move", stepId: "review", direction: "down" } }`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/src/screens/builder`. Expected: FAIL.
- [x] **Step 3: Implement** the rows and the CSS.
- [x] **Step 4: Run the tests**
  Run: `pnpm vitest run apps/desktop/src/screens/builder apps/desktop/src/layout-guards.test.ts`. Expected: PASS (all present Builder tests unchanged).
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check && pnpm build:web`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add apps/desktop/src/screens/builder
git commit -m "Show loops, asks and when lines in the flow pane" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 7: Run detail: items, picks and the full report

Covers decision 9 (Run detail). The six sections of the screen stay; the new content sits inside "Steps" and "Report".

**Files:**
- Create: `apps/desktop/src/screens/runs/ItemList.tsx`
- Modify: `apps/desktop/src/screens/runs/StepBlock.tsx`, `RunDetailScreen.tsx`, `Runs.module.css`, `Runs.test.tsx`

**Interfaces and copy (exact):**
- `ItemList.tsx`: `export function ItemList({ title, items }: { title: string; items: RunItem[] }): ReactElement` renders `<ul aria-label={`Items of ${title}`} className={styles.items}>`, one `<li>` per item: the key (`<span className={styles.mono}>`), the label, `<StateIcon domain="step" value={item.state} />` and the state word of `statusOf("step", item.state)`, then, when `item.skip` is set, the reason in words (`seen` "Seen in an earlier run", `duplicate` "Duplicate key", `capped` "Over the item cap", `stopped` "Stopped after an item failed") else `item.note` when present, then a nested `<ul aria-label={`Steps of ${item.key}`}>` with one `<li>` per item step (title, worker name when present, state word, and its `CheckList` when it has checks). Use `Revealed`-free plain text; values are rendered as text only.
- `StepBlock.tsx`: `contradiction` is `false` when `step.do` is `"loop"` or `"ask"` (they carry no checks by design), so a passed loop or ask shows its state word; for them the worker and "Attempt n of m" line is not rendered. Other steps keep today's rule and line (the present test that finds the badge exactly twice stays). After the checks, when `step.items` is present render `<ItemList title={step.title} items={step.items} />`; when `step.picks` is present render `<p>Picked: {labels joined by ", "}</p>` (or `<p>Nothing picked.</p>` when empty and the state is `passed`).
- `RunDetailScreen.tsx`, section "Report": after the `run.report ? (three lines) : (The report appears when the run ends.)` branch, outside it, so it shows for every run (`runs.export` answers for every state; run-0008 has no `report`), a `<Button size="small" onClick=...>` labelled `Show full report` (while open `Hide full report`). The first time it opens it calls `action("runs.export", { runId })`; on success it shows `<pre aria-label="Full report" className={styles.fullReport}>{markdown}</pre>` (text only); while waiting the button is disabled; on failure `<p role="alert">{error.message}</p>` and the button stays usable. The result is dropped if the run id changed meanwhile.
- `Runs.module.css`: `.items`, `.fullReport` (`white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; font-family: var(--font-mono); font-size: var(--text-mono); background: var(--surface-sunken); padding: 12px`), item rows as hairlines like `.step`. No card background, no radius on `.items`.
- Tests use `renderApp("#/runs/run-0008", { scenario: "looped" })`.

- [x] **Step 1: Write the failing tests** (8 new)
  (1) `a loop step lists its items with key, label, state word and note`: list "Items of Review every alert" has five rows; the first row has `j1`, `Job one` and `Passed`; the third has `Failed` and `The score was missing.`. (2) `an item shows its own steps`: list "Steps of j1" has three rows; "Steps of j2" shows `Skipped` twice. (3) `skip reasons are shown in words`: `Seen in an earlier run` and `Over the item cap` are on the page, and `skipped: seen in an earlier run` is not (the reason replaces the raw note). (4) `an ask step shows what was picked`: set `client.state.runs.find(r => r.id === "run-0008")` step `pick` to `state: "passed"`, `picks: [{key:"j1", label:"Job one"}]`, then the page shows `Picked: Job one`; with `picks: []` it shows `Nothing picked.`. (5) `the full report loads from runs.export when asked and is shown as text`: spy on `client.call`; click `Show full report`; `runs.export` was called once with `{ runId: "run-0008" }` and the `pre` named "Full report" contains `# Job alert review: run run-0008`; clicking `Hide full report` hides it and `Show full report` again does not call twice more than needed (two calls at most). (6) `a failed export says why and keeps the page`: make `client.call` reject `runs.export` with `new RunnerError("unavailable", "The report is not available.")`; an alert with that text appears and the Steps section is still there. (7) `Run detail keeps its six sections for a looped run`: the level-2 headings are `Report, Steps, Inputs, Outputs, Approvals, Usage`. (8) `a passed loop or ask step shows its state word and no alarm`: the block of the passed `review` step has `Passed`, no `Marked passed without a passing check` and no `Attempt`; with `pick` set as in test 4 (`passed`, picks `j1`) the same holds for its block.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/src/screens/runs`. Expected: FAIL.
- [x] **Step 3: Implement** the list, the block, the button and the CSS.
- [x] **Step 4: Run the tests**
  Run: `pnpm vitest run apps/desktop/src/screens/runs apps/desktop/src/layout-guards.test.ts`. Expected: PASS (the present Runs tests, `Run detail keeps its six sections` included, are unchanged).
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check && pnpm build:web`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add apps/desktop/src/screens/runs
git commit -m "Show loop items, picks and the full report in Run detail" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 8: Engine: begin variants, the sweep and shutdown

Covers decision 5. A prototype passed all present runner tests; this task writes it for real. Decision 1 of this plan (per-flow chain) applies.

**Files:**
- Create: `packages/runner/src/exec/chain.ts`, `packages/runner/src/engine-begin.test.ts`
- Modify: `packages/runner/src/engine.ts`, `packages/runner/src/exec/recovery.ts`

**Interfaces (exact):**
```ts
// exec/chain.ts
export type Chain = { enqueue<T>(key: string, task: () => Promise<T>, fallback: () => T): Promise<T>; stop(): void };
export function createChain(): Chain;  // tasks of one key run first in first out; a task runs only after the previous one of its key settled; the returned promise never rejects (a throw gives fallback()); after stop() a task that has not begun is not run and gives fallback(); the map entry of a key is removed when its tail settles
// engine.ts
export type Begun = { run: RunRow; settled: Promise<RunRow> };
Engine gains: beginStart(flowId: string, options: StartOptions): Begun; beginAnswer(approvalId: string, answer: { picks: string[] }): Begun; beginDecide(approvalId: string, decision: "approve" | "reject"): Begun; beginResume(runId: string): Begun; beginRecover(): { runs: RunRow[]; settled: Promise<RunRow[]> }; sweepExpired(): Promise<void>; shutdown(): void
```
Rules:
1. Each `begin*` does the synchronous part of the present method (every check, the sweep, and the one transaction that writes the run row or the decision) and returns `run` = the row as committed (`queued` after `beginStart`, `running` after `beginAnswer` and an approving `beginDecide`, `checking` after `beginResume`, the failed or rejected row after a rejecting `beginDecide`); it throws the same `EngineError` the present method rejects with, before anything is written. The walk (`checkAndWalk` or `walk`, unchanged) is queued with `chain.enqueue(run.flowId, task, fallback)` and its promise is `settled` (the fallback of rule 6). A rejecting `beginDecide` has `settled = Promise.resolve(row)`. `beginResume` keeps the present behaviour that a failure inside its synchronous part blocks the run (`blockError`) and returns that row with an already resolved `settled`.
2. The four present methods become `async` wrappers: `startRun` = `beginStart(...).settled`, and likewise `answerAsk`, `decide`, `resumeRun`; `recoverAfterCrash` = `beginRecover().settled`. Write them as local functions, not through `this`. All present engine tests pass unchanged.
3. `beginRecover` does the present loop's synchronous work per run inside the present `try` (a failure blocks that run and the loop goes on), calls `beginResume` for each safe run instead of awaiting it, and returns `{ runs, settled: Promise.all(...) }`.
4. `sweepExpired()` finds the flows of the runs whose pending approvals have expired and enqueues the present `sweep()` on each flow's chain; it resolves when they ran.
5. `shutdown()` sets a flag and calls `chain.stop()`. After it every `begin*` throws `EngineError("unavailable", "The engine is stopping.")`; `sweepExpired` and the reads still work.
6. `settled` never rejects and nothing thrown escapes (plan 02's rule): the chain's fallback covers a throw that `blockError` itself could not handle (for example a closed store). The fallback itself must not throw: it is `() => { try { return store.getRun(run.id) ?? run; } catch { return run; } }`.

- [x] **Step 1: Write the failing tests** (11 named; helper `gated()` is a small `HarnessAdapter` whose `runStep` records `"<runId>:<stepId>"` in `calls` and waits until the test calls `release(runId, result?)`; flows come from `makeFlow` of `test-helpers/review-flow.ts` with `extra: { id: "local.other", name: "Other" }` for the second flow; engines use `createEngine({ store, harness, newId })` on `:memory:` with ids `run-1`, ...)
  (1) `beginStart answers after its own write and the walk goes on in the background`: `b.run.state` is `queued`; `store.getRun("run-1")` exists at once; the harness has not been called in the same turn; after `release` `await b.settled` is `done`. (2) `begin variants refuse bad input at once and write nothing`: `beginStart("nope", ...)` throws `{ code: "not_found" }` synchronously and `listRuns()` is empty; a second `beginAnswer` on the same approval throws `not_allowed` "This decision was already made." synchronously. (3) `beginAnswer commits the decision before it returns`: the approval is `approved`, the run `running`, `answer.run.state` `running`, and the walk is not finished. (4) `beginDecide approves in the background and rejects at once`. (5) `beginResume returns the run in checking and settles when the walk ends`: a blocked run (quota exit) is fixed and resumed; `b.run.state` is `checking`, `settled` is `done`; resuming a `done` run throws `not_allowed` synchronously. (6) `beginRecover returns the interrupted runs at once and settles when the resumed walks end`. (7) `walks of one flow run first in first out`: two `beginStart` of `local.test`, one `local.other`: `calls` is `["run-1:a", "run-3:a"]` while all are held, `run-2` starts only after `release("run-1")`. (8) `walks of different flows overlap` (the same set-up asserts that `run-3` was called before `run-1` was released; write it as its own test with two flows only). (9) `settled never rejects`: a harness that throws, a readiness hook that throws, and a store closed under a walk each give a settled run, not a rejection. (10) `sweepExpired expires an approval without any read, through the flow's chain`: advance the clock 24 h + 1 ms, `await engine.sweepExpired()`, then `store.getApproval(id).state` is `expired` and the run `done` (ask with `on_expiry: end`). (11) `shutdown refuses new work and drops walks that have not begun`: a second queued run's `settled` resolves to its `queued` row and the harness is never called for it; `beginStart` throws `{ code: "unavailable", message: "The engine is stopping." }`.
  No present test changes; `engine-ask.test.ts` "refuses picks outside the options and a second answer" (two concurrent `answerAsk`) must still pass.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/engine-begin.test.ts`. Expected: FAIL (`beginStart is not a function`).
- [x] **Step 3: Implement** by the rules.
- [x] **Step 4: Run the engine tests**
  Run: `pnpm vitest run packages/runner`. Expected: PASS (all 140 present tests, one of them in `states.test.ts` already changed by Task 2).
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/runner
git commit -m "Let the engine answer at once and walk in the background" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 9: Runner storage: listing flows, the exclusive lock, change events and the data folder

Covers decision 6 (data folder, one-runner guard, events). The runner service lives in `packages/runner/src/service/`; this task adds its first modules and opens the contracts to that folder.

**Files:**
- Create: `packages/runner/src/service/events.ts`, `events.test.ts`, `data-dir.ts`, `data-dir.test.ts`, `packages/runner/src/test-helpers/hold-lock-child.ts`
- Modify: `packages/runner/src/storage.ts`, `sqlite-store.ts`, `sqlite-store.test.ts`, `source-rules.test.ts`

**Interfaces (exact):**
```ts
// storage.ts: Store gains
listFlows(): FlowRow[];   // the newest registration of each flow id (highest rowid), ordered by id
// sqlite-store.ts
export async function openSqliteStore(path: string, options?: { now?: () => Date; exclusive?: boolean }): Promise<Store>;
// exclusive (ignored for ":memory:"): before anything else run "PRAGMA busy_timeout = 250; PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = WAL;" and then "BEGIN IMMEDIATE; COMMIT;"; a failure whose message matches /locked|busy/i throws EngineError("unavailable", "Another FlowDriven runner is using this data folder."), any other failure EngineError("unavailable", "The data folder could not be opened."); then continue as today (busy_timeout 5000). listFlows SQL: SELECT data FROM flows WHERE rowid IN (SELECT MAX(rowid) FROM flows GROUP BY id) ORDER BY id
// service/events.ts (imports only the type RunnerTopic and the value RunnerTopic.options from @flowdriven/contracts)
export function createChangeEmitter(emit: (event: { type: "changed"; topics: RunnerTopic[] }) => void, schedule?: (run: () => void) => void): { mark(topic: RunnerTopic): void };  // default schedule: setImmediate; one emit per scheduled turn; topics in RunnerTopic.options order, no duplicates
export function wrapStore(store: Store, mark: (topic: RunnerTopic) => void): Store;  // every method forwards to the store; after a call that returns (not after a throw) it marks: putFlow flows; createRun, updateRun, upsertStep, upsertItem runs; createApproval, updateApproval approvals+runs; no other method marks. transaction() forwards unchanged (its callback uses the wrapped store, so its writes mark). A Proxy or an explicit object are both fine.
// service/data-dir.ts
export function prepareDataDir(path: string, options?: { uid?: number }): string;  // returns path.resolve(path); see rules
```
`prepareDataDir` rules: the path must be absolute (else `EngineError("invalid_input", "The data folder must be an absolute path.")`); a missing folder is created with `mkdirSync(path, { recursive: true, mode: 0o700 })`; an existing entry is checked with `lstatSync`: it must be a directory and not a symbolic link ("The data folder is not a folder."), owned by `options.uid ?? process.getuid?.()` when that is defined ("The data folder belongs to someone else."), and `(mode & 0o022) === 0` ("The data folder must not be writable by group or others."); all as `EngineError("invalid_input", ...)`. The same function prepares `<data-dir>/demo-project` and `<data-dir>/project` (Task 11).
`hold-lock-child.ts`: `argv[2]` is a database path; it silences the SQLite warning, opens the store with `exclusive: true`, prints `locked\n` to stdout, waits until stdin ends, closes the store and exits 0; when opening fails it prints the error message to stderr and exits 3.
`source-rules.test.ts`: the test "runner sources never import the contracts" is replaced by "only the runner service, its entry and its test helpers import the contracts": `sources("runner")` entries are taken relative to `packages/runner/src`; those that start with `service/`, `test-helpers/` or are `main.ts` may contain `@flowdriven/contracts`, all others must not.

Present test that changes (1): `source-rules.test.ts` "runner sources never import the contracts" (replaced as above).

- [x] **Step 1: Write the failing tests** (10 new, 1 changed = 11 named)
  `sqlite-store.test.ts` (3): (1) `listFlows returns the newest registration of each flow ordered by id`: put `b` h1, `a` h1, `a` h2: ids `["a","b"]`, `a`'s hash `h2`. (2) `an exclusive store refuses a second process and says so`: spawn `hold-lock-child.ts` with `process.execPath` (`NODE_OPTIONS: ""`), wait for its `locked` line, then `openSqliteStore(path, { exclusive: true })` rejects with `{ code: "unavailable", message: "Another FlowDriven runner is using this data folder." }`; end the child's stdin and expect exit 0. (3) `the lock goes away when the holder is killed`: kill the child with SIGKILL, then opening exclusive succeeds and `listFlows()` is readable.
  `events.test.ts` (3): (4) `each mutating call marks its topics`: a fake `mark` records `putFlow` -> `flows`, `createRun`/`updateRun`/`upsertStep`/`upsertItem` -> `runs`, `createApproval`/`updateApproval` -> `approvals, runs`; inside `transaction` the writes mark too. (5) `reads, counters and the audit log mark nothing, and a call that throws marks nothing`: `getRun`, `listRuns`, `markSeen`, `appendAudit`, `addGrant`, `increment` mark nothing; `updateRun` of an unknown id throws `not_found` and marks nothing. (6) `writes in one turn make one event with sorted topics`: with an injected scheduler that queues its callbacks, marking `runs`, `approvals`, `runs`, `flows` and then running the queue emits exactly one `{ type: "changed", topics: ["flows", "runs", "approvals"] }`; a later mark queues a second callback and emits a second event; with the default scheduler one `await new Promise((resolve) => setImmediate(resolve))` is enough to see the event.
  `data-dir.test.ts` (4): (7) `creates a missing folder with mode 0700`: a nested missing path; `statSync(path).mode & 0o777` is `0o700`. (8) `accepts an existing folder it owns and returns the resolved path`. (9) `refuses what is not a folder owned by the user and writable only by it`: a regular file, a symlink to a folder, a folder with `chmod 0o777`, and an `options.uid` of `(process.getuid?.() ?? 0) + 1`: each rejects with `invalid_input` and the sentence above. (10) `refuses a relative path`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/service packages/runner/src/sqlite-store.test.ts packages/runner/src/source-rules.test.ts`. Expected: FAIL (modules missing, `listFlows is not a function`).
- [x] **Step 3: Implement** the interfaces. Tried in the scratch clone: the exclusive open, the second-process refusal after about 250 ms, the release after SIGKILL and `listFlows` behave as written.
- [x] **Step 4: Run the tests**
  Run: `pnpm vitest run packages/runner`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/runner
git commit -m "Add flow listing, the exclusive lock, change events and data folder checks" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 10: Runner: read-model mappers

Covers decision 6 (handlers map engine rows to the contract) and the engine-to-contract list of plan 02's handover. Pure functions; no store access.

**Files:**
- Create: `packages/runner/src/service/map-flow.ts`, `map-flow.test.ts`, `map-run.ts`, `map-run.test.ts`, `map-approval.ts`, `map-approval.test.ts`

**Interfaces (exact; `SdkManifest`, `SdkStep`, `SdkCheck` are the SDK's `FlowManifest`, `Step`, `Check`; rows come from `storage.ts`, `RunView` from `engine.ts`; contract types from `@flowdriven/contracts`):**
```ts
// map-flow.ts
export function coreVersion(version: string): string;                       // "1.2.3-beta.1+7" -> "1.2.3"
export function describeCheck(check: SdkCheck): string;                     // command "Runs <cmd> <args joined by space>" (trimmed); files "Files exist: <paths joined by comma>"; schema "Matches <file>"; contains "Contains <patterns joined by comma>"; not_contains "Does not contain <patterns>"; judge "A reviewer approves it (<rubric>)"; user "You approve the result"; probe "<tool> answers"
export function toFlowManifest(manifest: SdkManifest): FlowManifest;        // format "flowdriven-flow/1.1"; rules below
export function toFlowSummary(row: FlowRow, runs: RunRow[]): FlowSummary;
export function toFlowDetail(row: FlowRow, runs: RunRow[], lastRunSteps: StepRow[]): FlowDetail;
export function toReadinessReport(row: FlowRow, checkedAt: string): ReadinessReport;
export function defaultSettings(now: string): Settings;
// map-run.ts
export function itemLabel(item: Value, key: string): string;               // item.title if a string, else item.label if a string, else key
export function skipReason(note: string | undefined): SkipReason | undefined;
export function toRunSummary(run: RunRow, flowName: string, reportFirstLine?: string): RunSummary;
export function toRunDetail(view: RunView, harnessIdOf: (workerName: string) => string): RunDetail;
export function toAuditRecord(entry: AuditEntry): AuditRecord;
// map-approval.ts
export function toApproval(row: ApprovalRow, run: RunRow, manifest: SdkManifest): Approval;
```
Rules:
- **toFlowManifest.** `version` through `coreVersion`; requirements get `ref: ref ?? id`, `routes: routes ?? []` and only the optional fields that exist; `defaults.worker` (a string in the SDK) becomes `{ prefer: [worker] }`; an input `default` is kept only when it is a string, number, boolean or list of strings; each trigger becomes `{ kind, summary }` with `manual` "Run by hand", `schedule` "Every <every>" or "At <at>" followed by " on <days joined by comma>" when `days` exist, `new_item` "New item from <source> every <every>", `file_change` "Files change in <path>", `link` "Opened from a link", `webhook` "Called by a webhook", `flow_done` "After <flow>"; `params`, `limits`, `outputs` are copied. A leaf step becomes `{ id, title: title ?? id, do, instructions (the SDK's, the ask's question for `ask`, `""` otherwise), when?, skill?, flow?, builtin?, ask? (copied, `max_pick` kept as given), uses, skills?, connectors?, worker?, outputs, checks, retry, risky?, idempotent? }` where each check is `{ type, required, summary: check.summary ?? describeCheck(check), cmd?, args? (command), of? }` and an `ask` step has `checks: []`. A loop becomes `{ id, title: title ?? id, do: "loop", instructions: "", when?, uses: [], outputs: [], checks: [], retry: 0, loop: { for_each, as, key?, max?, on_item_fail, steps: <the nested leaf steps as above> } }`. The result passes `FlowManifest.parse`.
- **toFlowSummary / toFlowDetail.** `saved: true`; `signOff: { state: "approved", version: <core version> }` (registered flows count as approved until plan 06); `stepCount` is the number of top-level steps; `lastRun` is the run of the flow with the greatest `startedAt` (the later entry wins a tie); `playback`: `goal` = summary or name, `touches` = requirement refs (or ids), `asksApprovalFor` = for every `ask` step its question and for every step with a `user` check `Approving the result of "<title or id>"`; `conversation: []`; `canUndo: false`; `stepStatus` maps each top-level step id to the state of its row (`itemKey` `""`) in `lastRunSteps`, else `pending`.
- **toReadinessReport.** One item per requirement, state `unchecked`, `detail: "Not checked yet. Checking requirements arrives with the readiness engine."`, `route: { via: "FlowDriven", risk: "official" }`, `autoInstall: "guided"`, `guide: { steps: ["Nothing to do yet."], commands: [], verified: false }`, `name: ref ?? id`; `ready` is `isReady(items)`. **defaultSettings:** `{ brain: { main: null, subscriptionOrder: [], apiKeyOrder: [] }, backends: [], budget: { month: now.slice(0, 7), capUsd: 0, perRunCapUsd: null, spentUsd: 0 }, offerSaveOneTime: true }`.
- **toRunDetail.** `RunSummary` fields (flow name from the manifest, `reportFirstLine` from `reportLines(view)[0]` of `report.ts`); `inputs`: the run's inputs then its params, `{ id, label: decl label or id, value }` with strings as they are and other values as compact JSON; `steps`: one `StepRun` per top-level manifest step in order (a missing row reads as `pending`): `title: title ?? id`, `do`, `state`, `worker` from the last attempt's worker name (`harnessIdOf(name)`), `attempts` as `{ number, replan, worker, startedAt, endedAt?, exit? }`, `maxAttempts` from `limits(step, manifest).attempts` of `exec/limits.ts` (1 for a loop), `checks` as `{ type, required, summary, verdict, evidence? }`, `note?`; an `ask` step has `picks` when its approval has `picks` or its row passed with `choice: []` (labels from the approval's options; `[]` when nothing was picked); a loop has `items`: the run's items of that loop in position order as `{ key, label: itemLabel(item.item, key), state: item.status, skip: skipReason(item.note), note?, steps }` where `steps` are the loop's nested steps that have a row for the item's key (none for an item whose note is `skipped: duplicate key`), mapped like leaf steps; `approvalIds`; `outputs`: for each top-level leaf step and each declared output that has a value `{ id: "<step>.<output>", type, value }` with the value as compact JSON cut to 200 characters plus `...`; `usage: []`; `estimatedCostUsd: 0`; `report: { runId, lines: reportLines(view), saveOffer: false }`; `blockedReason?`. `skipReason` maps the four notes of plan 02 (`skipped: seen in an earlier run` -> `seen`, `skipped: duplicate key` -> `duplicate`, `skipped: over the item cap` -> `capped`, `skipped: stopped after an item failed` -> `stopped`). `toAuditRecord`: `detail` is compact JSON.
- **toApproval.** `kind` as the row's; `flowId` from the run, `flowName` from the manifest, `stepTitle` from the manifest (a nested step too), `itemKey` only when not `""`, `editable: false`, `picks` when present; payload of an `ask`: `{ kind: "choice", question, options: [{ key, label }], maxPick }` (the options of the stored payload without their `item`); payload of a `result_sign_off`: `{ kind: "text", text }` where `text` is the stored string. The result passes `Approval.parse`.

- [x] **Step 1: Write the failing tests** (12; each result is also parsed with its contract schema; build inputs by hand from `demoFlow()`; the `RunView` helper is a local `view(overrides)` like the one in `report.test.ts`)
  `map-flow.test.ts` (5): (1) `toFlowManifest maps loops, asks, when lines, params, triggers and requirement defaults`: the demo flow gives four steps with `do` `["worker","loop","ask","loop"]`, a nested `page` with `when`, `params.min_score.default` 7, a requirement without `ref` gets `ref` equal to its id; `FlowManifest.parse` passes. (2) `check summaries fall back to a description`: one test row per check type of `describeCheck`. (3) `toFlowSummary and toFlowDetail show the last run, the approved sign-off and the playback`. (4) `toReadinessReport gives one unchecked row per requirement and is ready only without required ones`. (5) `defaultSettings validates against Settings and names the month`.
  `map-run.test.ts` (5): (6) `toRunDetail maps top-level steps with limits, workers and attempts`: `maxAttempts` 4 for a worker step with `retry: 2`, worker `{ harnessId, name: "Scripted harness" }`, attempt `replan` false. (7) `loop items carry label, state, skip reason and their own steps; a duplicate has none`: hand-written item rows: `j1` passed with three step rows, `j3` and `j4` skipped with the note `skipped: seen in an earlier run` (`skip: "seen"`), a repeated `j1` skipped with `skipped: duplicate key` (`steps: []`). (8) `an ask step shows its picks, or an empty list when the choice expired`. (9) `inputs, params, outputs, report lines and the blocked reason are listed`: `outputs` has `alerts.jobs`, a long value ends with `...`; `report.lines[0]` starts with `Sample job review:`. (10) `toRunSummary and toAuditRecord`: version `1.2.3-beta+7` becomes `1.2.3`; audit detail is compact JSON.
  `map-approval.test.ts` (2): (11) `an ask becomes a choice approval without the items`. (12) `a sign-off becomes a text approval with its item key and the title of a nested step; resolved states keep picks and resolvedAt`.
- [x] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/service/map-flow.test.ts packages/runner/src/service/map-run.test.ts packages/runner/src/service/map-approval.test.ts`. Expected: FAIL (modules missing).
- [x] **Step 3: Implement** the three modules by the rules.
- [x] **Step 4: Run the tests**
  Run: `pnpm vitest run packages/runner/src/service`. Expected: PASS.
- [x] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [x] **Step 6: Chair step (commit)**
```bash
git add packages/runner/src/service
git commit -m "Map engine rows to the contract read models" -m "Assisted-by: Codex"
```

Done by: Codex/gpt-6.1-terra, 2026-11-11. Evidence: pnpm format && pnpm check.

---

### Task 11: Runner: the handler table, the dispatcher, the demo harness and the service

Covers decision 6 (handlers, not-built answers, live and demo modes) and decision 2 (the runner validates inputs and outputs).

**Files:**
- Create: `packages/runner/src/service/handlers.ts`, `handlers.test.ts`, `service.ts`, `demo-harness.ts`, `demo-harness.test.ts`, `packages/runner/src/demo/demo-script.ts`
- Modify: `packages/runner/src/demo/demo.ts`

**Interfaces (exact):**
```ts
// demo/demo-script.ts (no contracts import)
export const DEMO_TITLES: Record<string, string>;   // j1 "Job one" ... j5 "Job five"
export const DEMO_SCORES: Record<string, number>;   // j1 9, j2 4, j3 8, j4 6, j5 8
export const DEMO_FIT: string[];                    // ["j1", "j3", "j5"]
export function demoScript(ids: string[]): Script;  // the `steps` that runDemo built inline: alerts (outputs { jobs: ids as { id, title } }, text ""), rough, page, full, proto, proposal; the job id is read from the instructions with /"id":"(j\d)"/ and an unknown id throws "Unknown demo job."
// demo/demo.ts: runDemo builds `scriptedHarness(demoScript(ids))` instead of the inline table; its behaviour and its test are unchanged
// service/demo-harness.ts
export const DEMO_BATCHES: readonly [readonly string[], readonly string[]];   // [["j1","j2","j3","j4"], ["j3","j4","j5"]]
export function createDemoHarness(options: { runIndex: (runId: string) => number }): HarnessAdapter;  // id "scripted", name "Scripted harness"
// the first call of a run creates scriptedHarness(demoScript([...DEMO_BATCHES[runIndex(runId) % 2]])) for that run id and later calls of the run use it; replan returns undefined; judge and probe throw Error("The demo harness has no judge.") and Error("The demo harness has no probe.")
// service/handlers.ts
export type HandlerContext = { engine: Engine; store: Store; mode: "demo" | "live"; projectDir: string; now: () => Date; harnessIdOf: (workerName: string) => string };
export type Handlers = { [N in OperationName]: (input: OperationInput<N>) => OperationOutput<N> | Promise<OperationOutput<N>> };
export function createHandlers(context: HandlerContext): Handlers;   // exhaustive by type: one entry per operation of the contract
export function createDispatcher(handlers: Handlers, audit: (kind: string, detail: Value) => void): (name: string, input: unknown) => Promise<unknown>;
// service/service.ts
export type ServiceOptions = { store: Store; dataDir: string; mode: "demo" | "live"; now?: () => Date; newId?: (prefix: string) => string; harness?: HarnessAdapter };
export type RunnerService = { engine: Engine; call(name: string, input: unknown): Promise<unknown>; knows(name: string): boolean; start(): { settled: Promise<unknown> }; stop(): void };
export const DEMO_HASH: string;   // "sha256:" followed by 63 zeros and a 1
export function createRunnerService(options: ServiceOptions): RunnerService;
```
**Dispatcher rules** (`createDispatcher`): an unknown name throws `RunnerError("not_found", "There is no operation <name>.")`; the input is parsed with `operations[name].input` (a failure is `RunnerError("invalid_input", <first issue message or "Invalid input.">)`); the handler's result is parsed with `operations[name].output` and the parsed value is returned; a thrown `RunnerError` or `EngineError` (any error whose `code` is one of the four codes) is rethrown as `RunnerError(code, message)`; any other throw, and an output that does not parse, call `audit("internal_error", { method: name, message })` (never throwing) and throw `RunnerError("unavailable", "Internal error")`.
**Service rules** (`createRunnerService`): the engine gets `store`, `now`, `newId` (default `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`), `harness` (default: demo `createDemoHarness({ runIndex })` with `runIndex = (runId) => store.listRuns({ flowId: store.getRun(runId)?.flowId }).findIndex((run) => run.id === runId)`, live a harness whose methods throw `Error("No harness is connected yet.")`) and `readiness` (demo `() => ({ ready: true })`, live `() => ({ ready: false, reason: "No harness is connected yet." })`). `projectDir` is `<dataDir>/demo-project` in demo mode and `<dataDir>/project` in live mode. `harnessIdOf` returns `"scripted"` for `"Scripted harness"` and otherwise the name lower-cased with runs of non-alphanumeric characters replaced by `-`. `call` is the dispatcher (its `audit` appends `{ at, kind, detail }` to the store, ignoring a failure). `start()` calls `prepareDataDir(projectDir)`, then `engine.beginRecover()` (not awaited), then in demo mode `engine.registerFlow(demoFlow().manifest, DEMO_HASH, demoFlow().files)`, and returns `{ settled }` of the recovery. `stop()` is `engine.shutdown()`. `knows(name)` is `Object.hasOwn(operations, name)`.
**Handler rules** (the contract's names; errors are the engine's unless stated):
- `flows.list`: `store.listFlows()` through `toFlowSummary` with the flow's runs. `flows.get`: `not_found` "There is no flow <id>." else `toFlowDetail` with the newest run's steps. `readiness.check`: same lookup, `toReadinessReport(row, now)`.
- `flows.run`: `{ description }` is `unavailable` "One-time flows arrive with the agent."; otherwise unknown flow `not_found` "There is no flow <id>."; `project` is always `projectDir` (the renderer cannot name a folder yet; an input called `project` is an ordinary input), the inputs and the params go to `engine.beginStart`; the answer is `toRunSummary(begun.run, flowName)` (state `queued`).
- `runs.list` (filters flowId, project, state; newest first by `startedAt`, ties by later start; each row is `toRunSummary(run, flowName, reportLines(view)[0])`, and when reading the view or its report lines throws for one run, that row leaves `reportFirstLine` out and the list still answers), `runs.status` (`not_found` "There is no run <id>."), `runs.report` (`{ runId, lines: reportLines(view), saveOffer: false }`), `runs.export` (`{ markdown: renderRunReport(view) }`), `runs.resume` (`engine.beginResume`, answer `toRunSummary(begun.run, ...)`).
- `approvals.list` (state filter; newest first by `createdAt`, ties by later creation) with `toApproval`. `approvals.answer`: `engine.beginAnswer`, answer `[toApproval(updated row)]`. `approvals.resolve`: unknown id `not_found` "There is no approval <id>."; `applyToSimilar` `not_allowed` "Nothing here can be approved as a batch."; a choice `invalid_input` "This is a choice. Pick from its options."; `edit` `invalid_input` "Only text can be edited."; else `engine.beginDecide(id, decision)` and `[toApproval(updated row)]`.
- Not built, all `RunnerError("unavailable", ...)`: `flows.build` "Building a flow from chat arrives with the agent."; `flows.update` "Editing a flow in the app arrives with the agent."; `readiness.install` "Installing a requirement arrives with the readiness engine."; `harnesses.rescan` "Looking for harnesses arrives with the harness adapters."; `harnesses.setConsent` "Harness consent arrives with the harness adapters."; `settings.update` "Changing settings arrives with the agent." `harnesses.list` returns `[]`; `settings.get` returns `defaultSettings(now)`; `runner.info` returns `{ contractVersion: CONTRACT_VERSION, mode }`; `audit.list` maps `store.listAudit(runId)` through `toAuditRecord` (`not_found` for an unknown `runId`).
- `flows.import`: the path must be absolute (`invalid_input` "The flow folder must be an absolute path."); `loadFlowFolder(path)` from `@flowdriven/sdk/node`; a missing folder is `not_found` "There is no folder at that path."; a `FlowFileError` is `invalid_input` with its message; when the issues contain an error (`hasErrors`) the answer is `{ issues }` and nothing is registered; otherwise the manifest is registered with `engine.registerFlow(manifest, hash, files)` (file bytes decoded as UTF-8) and the answer is `{ flow: toFlowDetail(...), issues, hash }` (the warnings).

- [ ] **Step 1: Write the failing tests** (12 named; `handlers.test.ts` builds a service on `openSqliteStore(":memory:")`, a temp data folder, a fixed clock and counter ids, and polls with a small helper `until(check)` that retries every 5 ms for up to 2 s; `demo-harness.test.ts` has no store)
  `handlers.test.ts` (10): (1) `flows.list and flows.get show the demo flow as approved, with four steps and no run yet`. (2) `flows.run answers at once with a queued run and the run reaches the choice`: the answer's `state` is `queued`; soon `approvals.list` has one pending `ask` approval whose `payload.options` hold the fit jobs `j1` and `j3`; a second `flows.run` with `inputs: { project: "/etc" }` gives a run whose `project` is still `<dataDir>/demo-project`. (3) `the demo story end to end`: run 1: answer `["j1"]`, wait for the pending `result_sign_off`, `approvals.resolve` approve, `runs.status` is `done`, its `review` step has four passed items (`j1` to `j4`) and its `build` step one (`j1`); run 2 picks `["j5"]`, approves, is `done`, and its `review` items `j3` and `j4` have `skip: "seen"`; `runs.report` line 2 of run 2 is `Items: 2 processed, 2 skipped as seen, 0 failed.`. (4) `approvals.resolve refuses a choice, an edit and a batch, and approvals.answer shows the engine's refusals`: `invalid_input` "This is a choice. Pick from its options.", `invalid_input` "Only text can be edited.", `not_allowed` "Nothing here can be approved as a batch."; picks outside the options `invalid_input`; a second answer `not_allowed` "This decision was already made.". (5) `live mode blocks a run with No harness is connected yet. and resume checks again`: a live service with the demo flow registered by hand; `runs.status.blockedReason` is that sentence, `runs.resume` answers a summary and the run is blocked again; in demo mode `runs.resume` of a `done` run is `not_allowed` "This run cannot be resumed."; a run written to the store by hand as `blocked` with no `blockedReason` still appears in `runs.list`, without `reportFirstLine`. (6) `the six not-built operations answer unavailable with their sentences`: a table of the six. (7) `harnesses.list is empty, settings.get has the defaults and readiness.check has one unchecked row per requirement`: a flow with one `mcp_server` requirement registered by hand. (8) `input that does not validate is invalid_input and an unknown operation is not_found`: `runs.status` with `{}`; `call("nope.x", {})`; `service.knows("runs.status")` true, `knows("nope.x")` false. (9) `an output that does not parse becomes Internal error and an audit entry`: `createDispatcher` over a handler table cast from `{ "runner.info": () => ({ mode: "other" }) }` rejects with `{ code: "unavailable", message: "Internal error" }` and the fake `audit` got `internal_error`; a handler that throws `new Error("boom")` gives the same. (10) `flows.import registers a valid folder, reports the issues of an invalid one and refuses a relative path`: write `flow.yaml` (format `flowdriven-flow/1.1`, id `local.import-test`, kind `build`, one worker step `a` with a `contains` check) and `README.md` into a temp folder; a second folder whose step carries an unknown field gives `issues` with an error and no `flow`; `flows.list` has the imported flow only after the first.
  `demo-harness.test.ts` (2): (11) `the first run uses the first batch, the next the second, and then it starts over`: with `runIndex` answers 0, 1, 2 the `alerts` outputs list `j1..j4`, `j3..j5`, `j1..j4`. (12) `replies like the engine demo`: for `j1` `rough` gives `{ score: { value: 9 } }`, `page` the text `Full post: Job one`, `full` `{ verdict: { fit: true } }`, `proto` `Published at /p/j1`, `proposal` `Hello, here is my plan for Job one.`.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/service packages/runner/src/demo`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** by the rules. Extract `demoScript` first and re-run `packages/runner/src/demo` to see `demo.test.ts` still pass.
- [ ] **Step 4: Run the tests**
  Run: `pnpm vitest run packages/runner`. Expected: PASS.
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**
```bash
git add packages/runner
git commit -m "Add the runner's handlers, dispatcher, demo harness and service" -m "Assisted-by: Codex"
```

---

### Task 12: Wire frames and the JSON-RPC server

Covers decision 1 (frames, errors, events) and decision 2 (the wire schemas live in the contracts, pure). The server takes any pair of streams, so the socket of plan 04 is one small task later.

**Files:**
- Create: `packages/contracts/src/wire.ts`, `packages/contracts/src/wire.test.ts`
- Create: `packages/runner/src/service/server.ts`, `packages/runner/src/service/server.test.ts`, `packages/runner/src/test-helpers/rpc-client.ts`
- Modify: `packages/contracts/src/index.ts` (adds `export * from "./wire.ts";`)

**Interfaces (exact):**
```ts
// contracts/src/wire.ts: imports only zod, ./config.ts, ./client.ts, ./operations.ts; no node: import and no TextEncoder
export const MAX_FRAME_BYTES = 1_048_576;
export const RpcId = z.union([z.string().min(1), z.number().int()]);
export const RpcRequest = z.object({ jsonrpc: z.literal("2.0"), id: RpcId.optional(), method: z.string().min(1), params: z.record(z.string(), z.unknown()).optional() }); export type RpcRequest
export const RpcErrorBody = z.object({ code: z.number().int(), message: z.string(), data: z.object({ code: z.enum(RUNNER_ERROR_CODES) }) });
export const RpcResult = z.object({ jsonrpc: z.literal("2.0"), id: RpcId, result: z.unknown() }).refine((value) => "result" in value);
export const RpcFailure = z.object({ jsonrpc: z.literal("2.0"), id: RpcId.nullable(), error: RpcErrorBody });
export const RpcAnswer = z.union([RpcResult, RpcFailure]); export type RpcAnswer
export const RpcNotification = z.object({ jsonrpc: z.literal("2.0"), method: z.literal("event"), params: RunnerEvent }); export type RpcNotification
export const RPC_INVALID_REQUEST = -32600; export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_ERROR_NUMBERS: Record<RunnerErrorCode, number>;  // invalid_input -32602, not_found -32001, not_allowed -32002, unavailable -32003
export function rpcResult(id: string | number, result: unknown): { jsonrpc: "2.0"; id: string | number; result: unknown };
export function rpcFailure(id: string | number | null, code: RunnerErrorCode, message: string, number?: number): { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data: { code: RunnerErrorCode } } };  // number defaults to RPC_ERROR_NUMBERS[code]
export class FrameError extends Error { code: "too_long" | "bad_json" | "not_object"; constructor(code: FrameError["code"], message: string) }   // field assigned in the body
export function utf8Length(text: string): number;           // bytes of the text in UTF-8, counted by code point (a lone surrogate counts 3)
export function encodeFrame(value: unknown, maxBytes?: number): string;   // JSON.stringify(value) + "\n"; throws FrameError("too_long") when the JSON text is over maxBytes (default MAX_FRAME_BYTES)
export function parseFrame(line: string): Record<string, unknown>;        // JSON.parse; FrameError("bad_json") on a syntax error, ("not_object") for null, arrays and scalars
export class LineFramer { constructor(maxBytes?: number); push(text: string): string[] }
// push: text is already decoded UTF-8; returns the complete lines (without "\n"; empty lines skipped); keeps the unfinished tail; throws FrameError("too_long") as soon as a complete line or the unfinished tail is over maxBytes (the tail is counted incrementally, so a long line is refused before its end arrives); a text that ends in a high surrogate (0xD800 to 0xDBFF) holds that one code unit back and puts it before the next push's text, so a pair split across pushes counts 4 bytes, not 6 (tried)
// runner/src/service/server.ts (imports the contracts)
export type RpcServerOptions = { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; call: (method: string, params: Record<string, unknown>) => Promise<unknown>; knows: (method: string) => boolean; maxFrameBytes?: number; endWaitMs?: number };
export type RpcServer = { notify(event: RunnerEvent): void; done: Promise<"end" | "protocol_error"> };
export function serveRpc(options: RpcServerOptions): RpcServer;
// runner/src/test-helpers/rpc-client.ts
export function connectRpcClient(streams: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): RunnerClient & { close(): void; closed: Promise<void> };
// input is what the client reads (the runner's stdout), output what it writes (the runner's stdin)
```
**Server rules.** `input.setEncoding("utf8")`; chunks go through a `LineFramer(maxFrameBytes ?? MAX_FRAME_BYTES)`; every line goes through `parseFrame`. A `FrameError` (too long, bad JSON, not an object) is a protocol error: write one `rpcFailure(null, "invalid_input", "Invalid frame", RPC_INVALID_REQUEST)`, stop reading, resolve `done` with `"protocol_error"` after the write's callback. An object that is not a valid `RpcRequest` is answered with `rpcFailure(null, "invalid_input", "Invalid request", RPC_INVALID_REQUEST)` and the server goes on. A request without an `id` is ignored. A method for which `knows` is false is answered `rpcFailure(id, "not_found", "Method not found", RPC_METHOD_NOT_FOUND)`. Otherwise `call(method, params ?? {})` runs without blocking the reader (requests are concurrent and answered as they finish; each id gets exactly one answer); its result is answered with `rpcResult`; a rejection whose `code` is one of the four codes becomes `rpcFailure(id, code, message)`, any other rejection `rpcFailure(id, "unavailable", "Internal error")`; an answer whose frame is over the limit is replaced by `rpcFailure(id, "unavailable", "The answer is too large.")`. End of input stops the reading, waits for the requests in flight to be answered (at most `endWaitMs`, default 2,000 ms, so a piped shell command still gets its answers) and then resolves `done` with `"end"`. `notify` writes `{ jsonrpc: "2.0", method: "event", params: event }` and does nothing once `done` has resolved. A write error on `output` is swallowed (an error listener is attached).
**Client rules.** Numeric ids from 1; an answer is parsed with `RpcAnswer`; a failure rejects with `new RunnerError(data.code, message)`; notifications that parse as `RpcNotification` reach `subscribe` listeners; when `input` ends every pending call rejects with `RunnerError("unavailable", "The engine stopped.")` and `closed` resolves; `close()` ends `output`.

- [ ] **Step 1: Write the failing tests** (11 named; server tests use two `PassThrough` streams, `toServer` and `fromServer`, and `connectRpcClient({ input: fromServer, output: toServer })`; raw frames are written with `toServer.write(...)`)
  `wire.test.ts` (4): (1) `a frame is one JSON object on one line and at most 1,048,576 bytes`: `encodeFrame({a:1})` is `{"a":1}\n`; `MAX_FRAME_BYTES` is 1,048,576; a value whose JSON is 21 bytes with `maxBytes` 20 throws `too_long`; a 4-byte emoji counts 4. (2) `the line framer splits chunks, counts bytes and refuses a long line before it ends`: `push("a\nb")` gives `["a"]`, then `push("c\n\n")` gives `["bc"]`; with `maxBytes` 4, an emoji built with `String.fromCodePoint(0x1f600)` pushed as its first code unit, then its second plus `\n`, gives `[]` and then the emoji line (counted 4 bytes, no throw); with `maxBytes` 8, `push("123456789")` (no newline yet) throws `too_long`; a complete 9-byte line throws too; two frames in one chunk give two lines. (3) `a frame that is not a JSON object is refused`: `parseFrame` throws `bad_json` for `{`, `not_object` for `[1]`, `null`, `1`, `"x"`. (4) `the request, answer and notification schemas`: a request without `id` parses; `id: null` does not; `RpcAnswer` accepts a result (including `result: null`) and a failure with `data.code`, refuses a failure without it; `RpcNotification` accepts `{method:"event", params:{type:"changed", topics:["runs"]}}`; `RPC_ERROR_NUMBERS` has the four numbers.
  `server.test.ts` (7): (5) `a request gets one answer with its result`: also when the request, whose params hold `String.fromCodePoint(0xe9, 0x1f600)` (a two-byte and a four-byte character), is written to `toServer` one byte at a time as `Buffer`s; the handler gets the same text. (6) `errors carry their code in data and a number`: a `RunnerError("not_found", "x")` rejection is `-32001`, `data.code` `not_found`; `new Error("boom")` gives `unavailable`, "Internal error", `-32003`, and `boom` is not in the frame. (7) `an unknown method is -32601 and an invalid request is -32600 with a null id, and the server goes on`: afterwards a valid call still works. (8) `a line that is not a JSON object, or is too long, is answered once with -32600 and ends the connection`: with `maxFrameBytes: 64`; `done` resolves `"protocol_error"` and nothing more is written. (9) `events are notifications and the end of input ends the server after the answers in flight`: `notify({ type: "changed", topics: ["runs"] })` reaches a subscribed client; a request written and followed at once by `toServer.end()` is still answered, then `done` is `"end"`, and a later `notify` writes nothing; with `endWaitMs: 20` and a call that never settles `done` still resolves. (10) `requests run concurrently and each id gets exactly one answer`: a slow call and a fast call, the fast answer arrives first, both ids answered once. (11) `an answer over the limit becomes unavailable`.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/contracts/src/wire.test.ts packages/runner/src/service/server.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** by the rules. `wire.ts` keeps the plain-Node rule (relative imports end in `.ts`, no parameter property).
- [ ] **Step 4: Run the tests**
  Run: `pnpm vitest run packages/contracts packages/runner/src/service packages/runner/src/contracts-load.test.ts`. Expected: PASS.
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check && pnpm build:web`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**
```bash
git add packages/contracts packages/runner/src
git commit -m "Add the wire frames and the JSON-RPC server" -m "Assisted-by: Codex"
```

---

### Task 13: The runner process

Covers decision 6 (the process, its order at start, the guard, recovery, the sweep, exit) and decision 1 (end of stdin). The process is `node packages/runner/src/main.ts --stdio --data-dir <path> [--demo]`.

**Files:**
- Create: `packages/runner/src/main.ts`, `packages/runner/src/service/args.ts`, `args.test.ts`, `run-process.ts`, `run-process.test.ts`, `packages/runner/src/main.test.ts`
- Modify: `packages/runner/src/source-rules.test.ts`

**Interfaces (exact):**
```ts
// service/args.ts (no contracts import)
export type ProcessOptions = { dataDir: string; demo: boolean };
export function parseArguments(argv: string[]): { ok: true; options: ProcessOptions } | { ok: false; message: string };
// argv is process.argv.slice(2). Required: --stdio and --data-dir <absolute path>; optional: --demo. Anything else, a repeated flag or a missing value gives ok false with message "Usage: main.ts --stdio --data-dir <absolute path> [--demo]"
export function scrubEnvironment(env: NodeJS.ProcessEnv): void;   // delete env.ELECTRON_RUN_AS_NODE, nothing else
// service/run-process.ts
export const EXIT = { ok: 0, crash: 1, usage: 2, locked: 3, protocol: 4 } as const;
export type RunProcessOptions = { dataDir: string; demo: boolean; input: NodeJS.ReadableStream; output: NodeJS.WritableStream; errors: (line: string) => void; now?: () => Date; newId?: (prefix: string) => string; sweepEveryMs?: number };
export async function runProcess(options: RunProcessOptions): Promise<number>;   // returns the exit code; never calls process.exit
export function guardProcess(proc: Pick<NodeJS.Process, "on">, errors: (line: string) => void): void;   // listens to "uncaughtException" and "unhandledRejection"; each writes `Internal error: <message cut to 200 characters>` with errors and goes on: nothing thrown may end the process
```
**`runProcess` order (the brief's order):** (1) `prepareDataDir(dataDir)`; a refusal writes its message with `errors` and returns `EXIT.usage`. (2) `openSqliteStore(<dir>/flowdriven.sqlite, { now, exclusive: true })`; the lock refusal writes `Another FlowDriven runner is using this data folder.` (one line) and returns `EXIT.locked`; any other failure writes its message and returns `EXIT.crash`. (3) `createChangeEmitter` whose emit calls `server.notify` (late bound), `wrapStore(store, emitter.mark)`. (4) `createRunnerService({ store: wrapped, dataDir: dir, mode: demo ? "demo" : "live", now, newId })` and `service.start()` (this is the one-runner guard already passed, then `recoverAfterCrash`, then the demo flow). (5) `serveRpc({ input, output, call: service.call, knows: service.knows })`. (6) a `setInterval` every `sweepEveryMs ?? 60_000` ms, with `unref()`, whose callback calls `service.engine.sweepExpired()` and attaches a `.catch` that writes `The sweep failed: <message>` with `errors` (a rejected sweep is logged, never left unhandled). (7) `await server.done`; then clear the timer, `service.stop()`, `store.close()`, wait for `output.write("", callback)`, and return `EXIT.ok` for `"end"` and `EXIT.protocol` for `"protocol_error"`. Any unexpected throw closes the store when open, writes its message with `errors` and returns `EXIT.crash`. Nothing else writes to `output`.
**`main.ts`** (never re-exported from `index.ts`, like `demo/main.ts`): `silenceSqliteWarning()`, `scrubEnvironment(process.env)`, `guardProcess(process, (line) => process.stderr.write(`${line}\n`))`, `parseArguments(process.argv.slice(2))` (on failure write the message and a newline to stderr and `process.exit(2)`), then `process.exit(await runProcess({ ...options, input: process.stdin, output: process.stdout, errors: (line) => process.stderr.write(`${line}\n`) }))`.

- [ ] **Step 1: Write the failing tests** (12 new tests, the last one in the changed file `source-rules.test.ts`; `run-process.test.ts` uses two `PassThrough` streams, `connectRpcClient` of Task 12 and a temp data folder; ids are counters)
  `args.test.ts` (2): (1) `parseArguments accepts --stdio, an absolute --data-dir and --demo and refuses everything else`: a relative path, a missing flag, an unknown argument, a repeated flag and a missing value each give `ok: false` with the usage message. (2) `scrubEnvironment removes ELECTRON_RUN_AS_NODE and nothing else`.
  `run-process.test.ts` (7): (3) `the crash guard writes one line per uncaught error and does not rethrow`: a fake `proc` records its two listeners; calling each with an `Error` and with a string writes `Internal error: ...` once each, the message cut at 200 characters. (4) `serves runner.info and the demo flow and returns 0 when its input ends, with the store closed`: `runner.info` is `{ contractVersion: CONTRACT_VERSION, mode: "demo" }`, `flows.list` has `local.sample-job-review`; after `toServer.end()` the promise is `0` and `openSqliteStore(path, { exclusive: true })` succeeds. (5) `a second runner on the same folder returns 3 with one line on stderr`: the second call gets `errors` called once with the sentence and returns 3 while the first runs. (6) `a protocol error returns 4`: write `not json\n`. (7) `a refused data folder returns 2`: a path that is a regular file. (8) `a run that was walking is found at the next start`: write, with a plain store, the demo flow, a run in state `running` with its `alerts` row `running`, close; `runProcess` in demo mode; `runs.status` shows the run `interrupted`. (9) `the sweep runs on its timer and sends a changed event`: `sweepEveryMs: 20`, a clock the test moves; start a demo run, wait for the pending choice, move the clock 24 h + 1 ms and wait for a `changed` event that carries `approvals` without any request in between; then `approvals.list` shows it `expired`.
  `main.test.ts` (2; spawns `process.execPath` with `main.ts`, `--stdio --data-dir <tmp> --demo`, env `{ ...process.env, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "1" }` and pipes): (10) `the real process answers runner.info over its pipes, prints nothing else on stdout and exits 0 when stdin ends`: every stdout line parses with `parseFrame`; stderr is empty (the SQLite warning is silenced); exit code 0. (11) `a second real process on the same folder exits 3 while the first runs`: its stderr is exactly the one sentence and a newline.
  `source-rules.test.ts` (1): (12) `nothing in the runner spawns process.execPath`: no runner source outside `*.test.ts` and `test-helpers/` contains `process.execPath`.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run packages/runner/src/service packages/runner/src/main.test.ts packages/runner/src/source-rules.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** by the rules above.
- [ ] **Step 4: Run the tests, then the process by hand**
  Run: `pnpm vitest run packages/runner`, then `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"runner.info","params":{}}' | node packages/runner/src/main.ts --stdio --data-dir "$PWD/.workflow/scratch/runner-try" --demo`. Expected: PASS; one answer line `{"jsonrpc":"2.0","id":1,"result":{"contractVersion":1,"mode":"demo"}}`, exit 0, nothing on stderr. (Remove `.workflow/scratch/runner-try` afterwards; the folder is created with mode 0700.)
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**
```bash
git add packages/runner
git commit -m "Add the runner process" -m "Assisted-by: Codex"
```

---

### Task 14: Electron: the runner link

Covers decision 7 (the link class, restart limit, stderr, quit) and decision 2 (the relay knows no schema). The class imports no Electron module and gets `spawn` injected.

**Files:**
- Create: `apps/desktop/electron/runner-paths.ts`, `runner-paths.test.ts`, `runner-link.ts`, `runner-link.test.ts`

**Interfaces (exact; no parameter properties, no `electron` import; the file compiles to CommonJS under `tsconfig.electron.json`):**
```ts
// runner-paths.ts
export function isDemo(env: Record<string, string | undefined>): boolean;                       // env.FLOWDRIVEN_DEMO === "1"
export function dataDirFor(env: Record<string, string | undefined>, appData: string): string;    // path.resolve(env.FLOWDRIVEN_DATA_DIR) when non-empty (the runner needs an absolute path), else join(appData, isDemo(env) ? "FlowDriven-demo" : "FlowDriven")
export function runnerEntry(dirname: string): string;                                           // path.resolve(dirname, "../../../packages/runner/src/main.ts"); the one place that knows where the entry lives (a packaged app is plan 11)
export function runnerEnv(env: Record<string, string | undefined>): Record<string, string>;     // { ELECTRON_RUN_AS_NODE: "1" } plus PATH, HOME, TMPDIR, LANG where defined; nothing else
// runner-link.ts
export const MAX_FRAME_BYTES = 1_048_576;      // the contract's wire limit, copied because main cannot import the contracts
export const ALL_TOPICS_EVENT: { type: "changed"; topics: string[] };   // flows, runs, approvals, readiness, harnesses, settings
export class LinkError extends Error { code: string; constructor(code: string, message: string) }
export type ChildLike = { stdin: Writable; stdout: Readable; stderr: Readable; on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown; on(event: "error", listener: (error: Error) => void): unknown; kill(signal?: "SIGTERM" | "SIGKILL"): boolean };   // tried: `(command, args, options) => spawn(command, args, options)` from node:child_process is assignable to SpawnFn under tsconfig.electron.json; a plain `kill(signal?: string)` is not
export type SpawnFn = (command: string, args: string[], options: { env: Record<string, string>; stdio: ["pipe", "pipe", "pipe"] }) => ChildLike;
export type RunnerLinkOptions = { spawn: SpawnFn; execPath: string; entry: string; dataDir: string; demo: boolean; env: Record<string, string | undefined>; onEvent: (event: unknown) => void; log?: (line: string) => void; now?: () => number; stopWaitMs?: number };
export class RunnerLink { constructor(options: RunnerLinkOptions); start(): void; call(method: string, params: Record<string, unknown>): Promise<unknown>; stop(): Promise<void> }
```
**Link rules.**
- A start runs `spawn(execPath, [entry, "--stdio", "--data-dir", dataDir, ...(demo ? ["--demo"] : [])], { env: runnerEnv(env), stdio: ["pipe", "pipe", "pipe"] })`. `start()` does nothing when a child is alive. Start times are kept; times older than 60,000 ms (by `now()`, default `Date.now`) are dropped; with three left a start is refused and `call` rejects `LinkError("unavailable", "The engine stopped and cannot be restarted. Restart FlowDriven.")`, until the app restarts.
- `call` starts the runner when none is alive, writes one frame `{"jsonrpc":"2.0","id":<n>,"method":<method>,"params":<params>}` and a newline (ids from 1) and resolves with the answer's `result` or rejects `LinkError(error.data.code, error.message)`. A write failure or a missing child rejects `LinkError("unavailable", "The engine stopped.")`. Size first (decision 2): `call` builds the frame text, and when its UTF-8 length without the newline (`Buffer.byteLength`) is over `MAX_FRAME_BYTES`, or `JSON.stringify` throws, it rejects `LinkError("invalid_input", "The request is too large.")` (or "The request cannot be sent." for a throw) before it starts a runner and before it writes, so it uses no start of the budget.
- At spawn the link attaches an `error` listener to `child.stdin`, `child.stdout` and `child.stderr` (a write after the runner closed its end gives `EPIPE`, and without a listener Node throws "Unhandled 'error' event", tried). A stream error is handled like the child's `error` event below: `kill()`, every waiting call rejects, at most one `ALL_TOPICS_EVENT` per child.
- stdout is read as bytes: chunks are joined, split at byte 0x0A, and a line (or an unfinished tail) over `MAX_FRAME_BYTES` is a protocol failure. Each line must parse as a JSON object with `jsonrpc === "2.0"` and be either an answer (`id` is a string or number, and `result` is present or `error` is an object with a string `message` and `data.code` a string) or a notification (`method === "event"` and `params` an object, passed to `onEvent`). Anything else is a protocol failure: the child is killed (`kill()`), every waiting call rejects `LinkError("unavailable", "The engine stopped.")`. An answer for an unknown id is ignored. The link never reads a schema: it does not look inside `result` or `params`.
- When the child exits (or its `error` event fires) every waiting call rejects `LinkError("unavailable", "The engine stopped.")` and, unless `stop()` was called, `onEvent(ALL_TOPICS_EVENT)` is called once so the screens reload and the next call restarts the runner.
- stderr is split into lines; each goes to `log` (default: write to the app's stderr) as `[runner] ` plus the line cut to 4,096 bytes.
- `stop()`: no child resolves at once; otherwise end the child's stdin, wait up to `stopWaitMs` (default 3,000) for its exit, then `kill("SIGKILL")` and resolve after the exit (or at once after the kill when no exit comes within a further 1,000 ms). After `stop()` no start happens. `stop()` never rejects: a throw of `end()` or `kill()` is caught and it still resolves.

- [ ] **Step 1: Write the failing tests** (12 named; link tests 1 and 2 spawn the real runner: `spawn` from `node:child_process`, `execPath: process.execPath`, `entry` from `new URL("../../../packages/runner/src/main.ts", import.meta.url)`, a temp data folder, `demo: true`, and stop the link in `afterEach`; the others use a fake child made of three `PassThrough` streams, a recorded `kill`, and listeners the test triggers)
  `runner-paths.test.ts` (3): (1) `the data folder is FLOWDRIVEN_DATA_DIR, else FlowDriven, else FlowDriven-demo with FLOWDRIVEN_DEMO=1`: a relative `FLOWDRIVEN_DATA_DIR` of `"rel/data"` gives `path.resolve("rel/data")`, which is absolute. (2) `the runner's environment is ELECTRON_RUN_AS_NODE and the five named variables only`: a parent env with `SECRET`, `ELECTRON_RUN_AS_NODE: "0"`, `PATH`, `HOME`, `TMPDIR`, `LANG`, `NODE_OPTIONS` gives exactly `{ ELECTRON_RUN_AS_NODE: "1", PATH, HOME, TMPDIR, LANG }`; undefined ones are left out. (3) `the entry is found from the compiled folder`: `runnerEntry("/r/apps/desktop/dist-electron")` is `/r/packages/runner/src/main.ts`; `isDemo` is true only for `"1"`.
  `runner-link.test.ts` (9): (4) `a call round-trips to the real runner and a failure keeps its code`: `flows.list` has the demo flow; `runs.status` with `{ runId: "nope" }` rejects with `{ code: "not_found" }`; `MAX_FRAME_BYTES` equals the contract's. (5) `events from the runner reach onEvent`: after `flows.run` of the demo flow an event with topic `runs` arrives. (6) `a start passes the entry, the flags and the exact environment to spawn`. (7) `when the runner exits, waiting calls fail with The engine stopped. and the next call starts it again`: also one all-topics event; and an `error` emitted on the fake child's stdin while a call waits does not throw, fails that call with `unavailable` and calls `kill`. (8) `at most three starts in 60 seconds, then unavailable until the app restarts`: with an injected clock, children that exit at once. (9) `stderr lines are prefixed and cut at 4,096 bytes`. (10) `a line over the limit ends the connection and fails the waiting calls`: 1,048,577 bytes without a newline; the fake child's `kill` was called. Outgoing: a fresh link whose `call` has params with a string of 1,048,576 characters rejects `{ code: "invalid_input", message: "The request is too large." }`, `spawn` was never called and nothing was written. (11) `a frame that is not a JSON-RPC object ends the connection`: `[1]\n` and `{"id":1}\n`. (12) `stop ends stdin, waits for the exit and kills a runner that does not leave in 3 seconds`: fake timers; a second case where the child exits after the stdin end resolves without `kill`.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/electron/runner-paths.test.ts apps/desktop/electron/runner-link.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** by the rules. The wrapper `(command, args, options) => spawn(command, args, options)` is what the callers pass as `SpawnFn`; if it does not compile, adjust `ChildLike`, not the callers.
- [ ] **Step 4: Run the tests and the electron program**
  Run: `pnpm vitest run apps/desktop/electron && pnpm typecheck && pnpm build:electron`. Expected: PASS (`dist-electron/runner-link.js` exists; it is git-ignored).
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (GUI)**
  Run: `pnpm capture`. Expected: `captured 16 screens to .workflow/scratch/screens`, exit 0 (the new files are not wired yet).
- [ ] **Step 7: Chair step (commit)**
```bash
git add apps/desktop/electron
git commit -m "Add the link between the app and the runner process" -m "Assisted-by: Codex"
```

---

### Task 15: Electron: the relay, the preload bridge and the wiring

Covers decision 7 (IPC, the preload flag, quit). Main is a relay: it checks the sender, the method name and the input's shape, forwards to the link and returns the answer; it never throws across `invoke` and never reads a schema.

**Files:**
- Create: `apps/desktop/electron/runner-ipc.ts`, `runner-ipc.test.ts`, `runner-bridge.ts`, `runner-bridge.test.ts`, `preload.test.ts`
- Modify: `apps/desktop/electron/preload.ts`, `main.ts`, `window.ts`, `security.ts`, `security.test.ts`

**Interfaces (exact; neither `runner-ipc.ts` nor `runner-bridge.ts` imports `electron`; tried: `ipcMain` is assignable to `IpcLike` and `BrowserWindow.getAllWindows()` to `WindowLike[]` under `tsconfig.electron.json`):**
```ts
// runner-ipc.ts
export const RUNNER_CALL_CHANNEL = "runner:call";
export const RUNNER_EVENT_CHANNEL = "runner:event";
export const METHOD_PATTERN = /^[a-z]+\.[A-Za-z]+$/;
export type FrameLike = { url: string; parent: unknown } | null;
export type RunnerReply = { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };
export function isOwnMainFrame(frame: FrameLike): boolean;                     // frame !== null && frame.parent === null && isAllowedNavigation(frame.url) (security.ts)
export function isPlainObject(value: unknown): value is Record<string, unknown>; // typeof "object", not null, not an array, prototype Object.prototype or null
export type IpcLike = { handle(channel: string, listener: (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown): void };
export function registerRunnerIpc(options: { ipc: IpcLike; link: { call(method: string, params: Record<string, unknown>): Promise<unknown> } }): void;
export type WindowLike = { isDestroyed(): boolean; webContents: { mainFrame: { url: string }; send(channel: string, ...args: unknown[]): void } };
export function broadcastRunnerEvent(windows: WindowLike[], event: unknown): void;   // webContents.send(RUNNER_EVENT_CHANNEL, event) for each window that is alive and whose mainFrame.url is allowed navigation
// runner-bridge.ts
export type RunnerBridgeOptions = { ipc: IpcLike; spawn: SpawnFn; env: Record<string, string | undefined>; appData: string; dirname: string; windows: () => WindowLike[]; execPath?: string; log?: (line: string) => void; now?: () => number };
export function startRunnerBridge(options: RunnerBridgeOptions): { link: RunnerLink; dataDir: string; stop(): Promise<void> };
// security.ts: secureWebPreferences(preloadPath: string, options?: { runner?: boolean }) adds additionalArguments: ["--flowdriven-runner=on"] only when options?.runner is true; with one argument its result is exactly what it is today
// window.ts: createMainWindow options gain runner?: boolean, passed to secureWebPreferences
```
**Relay rules.** The `runner:call` handler takes `(event, method, input)` and answers a `RunnerReply`: not exactly two arguments after the event, or a sender that is not `isOwnMainFrame(event.senderFrame)`, is `{ ok: false, error: { code: "not_allowed", message: "This window cannot call the engine." } }`; a `method` that is not a string matching `METHOD_PATTERN` is `invalid_input` "Invalid method name."; an `input` that is not a plain object is `invalid_input` "The input must be an object."; otherwise `link.call(method, input)` and `{ ok: true, result }`; a rejection with a string `code` and `message` (a `LinkError`) is `{ ok: false, error: { code, message } }` and anything else `unavailable` "The engine stopped.". `startRunnerBridge` builds `new RunnerLink({ spawn, execPath: execPath ?? process.execPath, entry: runnerEntry(dirname), dataDir: dataDirFor(env, appData), demo: isDemo(env), env, onEvent: (event) => broadcastRunnerEvent(windows(), event), log, now })`, calls `registerRunnerIpc` and `link.start()`, and returns `stop: () => link.stop()`.
**Preload (a single self-contained file; the sandbox cannot load a sibling).** `preload.ts` defines the two channel names as literals equal to `runner-ipc.ts`'s, and exposes `flowdrivenShell` as `Object.freeze({ kind: "electron" })` when `process.argv` lacks `--flowdriven-runner=on`, else `Object.freeze({ kind: "electron", runner })` where `runner = Object.freeze({ call: (method, input) => ipcRenderer.invoke(CALL, method, input), subscribe: (listener) => { const handler = (_event, event) => listener(event); ipcRenderer.on(EVENT, handler); return () => { ipcRenderer.removeListener(EVENT, handler); }; } })`. The Electron event object never reaches the page.
**Main.** `main.ts` keeps its present code and in `whenReady` adds: `const bridge = startRunnerBridge({ ipc: ipcMain, spawn: (command, args, options) => spawn(command, args, options), env: process.env, appData: app.getPath("appData"), dirname: __dirname, windows: () => BrowserWindow.getAllWindows() })` before the first window, and `createMainWindow({ preloadPath, show: true, runner: true })` in both places that open a window. A `before-quit` listener uses one module-level flag `stopping`: when it is set the listener returns at once (the quit goes on); otherwise it sets it, calls `event.preventDefault()`, then `void bridge.stop().then(() => app.quit())` (end stdin, wait up to 3 seconds, kill; `stop()` never rejects, Task 14), so the second `before-quit` passes through and the handler cannot loop. The size of an outgoing frame is checked in the link (Task 14), so the relay checks shape only. `capture.ts` is not changed and does not pass `runner`.

- [ ] **Step 1: Write the failing tests** (11 named; the fake `ipc` records the handler, the fake `link` is `{ call: vi.fn() }`, windows are plain objects; `preload.test.ts` mocks `electron` with `vi.mock`, sets `process.argv` and imports the module with `vi.resetModules()` and a dynamic `import("./preload")`)
  `runner-ipc.test.ts` (4): (1) `a call from the app's own main frame is forwarded and answered with its result`: `isOwnMainFrame({ url: "app://flowdriven/index.html#/runs", parent: null })` is true. (2) `refuses a call from a foreign frame, a sub-frame, a bad method name or a non-object input`: frames `https://example.com`, `{ url: app url, parent: {} }`, `null`; methods `"flows.list; x"`, `"../x"`, `42`, `"Flows.list"`; inputs `[]`, `null`, `"x"`, a class instance; extra or missing arguments; `link.call` is never called. (3) `a failure keeps its code and message and anything else becomes unavailable`. (4) `events go only to live windows on the app origin`: a destroyed window and a window on another origin get nothing.
  `runner-bridge.test.ts` (3): (5) `uses the data folder, the demo flag and the runner entry of its environment`: with `FLOWDRIVEN_DEMO: "1"` and `appData: "/a"` the fake `spawn` got `--data-dir /a/FlowDriven-demo` and `--demo`, and the entry ends in `packages/runner/src/main.ts`. (6) `registers the call handler and forwards runner events to the windows`. (7) `stop ends the runner`.
  `preload.test.ts` (3): (8) `the bridge exists only with the runner flag and exposes only call and subscribe`: `Object.keys` of the exposed object are `["kind", "runner"]` and of `runner` `["call", "subscribe"]`, both frozen; without the flag only `["kind"]`. (9) `call invokes the channel with the method and the input and subscribe returns an unsubscribe`: the listener gets the event payload and not the Electron event. (10) `the channel names equal those of runner-ipc.ts`: read the source text of `preload.ts` and compare the two literals.
  `security.test.ts` (1): (11) `web preferences carry the runner flag only when asked`: `secureWebPreferences("/x/preload.js", { runner: true })` equals the present object plus `additionalArguments: ["--flowdriven-runner=on"]`; `contextIsolation`, `nodeIntegration`, `sandbox` unchanged. The present test "web preferences keep the secure defaults" passes unchanged.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/electron`. Expected: FAIL.
- [ ] **Step 3: Implement** by the rules.
- [ ] **Step 4: Run the tests and the electron program**
  Run: `pnpm vitest run apps/desktop/electron && pnpm typecheck && pnpm build:electron`. Expected: PASS.
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (GUI)**
  Run: `pnpm capture`. Expected: `captured 16 screens`, exit 0, the screenshots still on sample data (no flag is passed). Then `FLOWDRIVEN_DEMO=1 pnpm start`: the window opens; open the developer tools only if the sidebar still says "Sample data" (the bridge did not arrive: see open point 4 of the handover) and quit with Cmd+Q; `pgrep -f packages/runner/src/main.ts` prints nothing afterwards.
- [ ] **Step 7: Chair step (commit)**
```bash
git add apps/desktop/electron
git commit -m "Wire the runner into the app through a relay and a preload bridge" -m "Assisted-by: Codex"
```

---

### Task 16: Renderer: `IpcRunnerClient`, the client choice and the notices

Covers decision 8. The renderer still talks only to `RunnerClient`; this task adds the second implementation and the sidebar notice that follows `runner.info`.

**Files:**
- Create: `apps/desktop/src/runner/ipc-client.ts`, `ipc-client.test.ts`, `apps/desktop/src/screens/not-built.test.tsx`
- Modify: `apps/desktop/src/runner/create-client.ts`, `create-client.test.ts`, `apps/desktop/src/shell.ts`, `app-info.ts`, `nav/Sidebar.tsx`, `App.test.tsx`

**Interfaces (exact):**
```ts
// shell.ts: keeps shellKind(); adds
export type RunnerBridge = { call(method: string, input: unknown): Promise<unknown>; subscribe(listener: (event: unknown) => void): () => void };
export function runnerBridge(): RunnerBridge | undefined;   // window.flowdrivenShell?.runner when it has call and subscribe functions, else undefined
// runner/ipc-client.ts
export class IpcRunnerClient implements RunnerClient { constructor(bridge: RunnerBridge); call<N extends OperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>; subscribe(listener: (event: RunnerEvent) => void): () => void }
// create-client.ts: createRunnerClient(search?) returns new IpcRunnerClient(bridge) when runnerBridge() exists, else the fixtures client as today
// app-info.ts: keeps SAMPLE_DATA_NOTE; adds
export const DEMO_ENGINE_NOTE = "Demo engine. A script plays the steps.";
export function runnerNote(mode: RunnerMode): string | undefined;   // sample -> SAMPLE_DATA_NOTE, demo -> DEMO_ENGINE_NOTE, live -> undefined
```
**Client rules.** `call`: a name that is not in `operations` rejects `RunnerError("not_found", "There is no operation <name>.")`; the input is parsed with the operation's input schema and a failure rejects `invalid_input` (first issue message) without calling the bridge; `bridge.call(name, parsedInput)` rejecting (or throwing) is `RunnerError("unavailable", "The engine is not reachable.")`; the reply must be an object with a boolean `ok`: `{ ok: false, error }` rejects `RunnerError(code, message)` where `code` is one of `RUNNER_ERROR_CODES` (else `unavailable`) and `message` is the string sent (else "Unknown error"); `{ ok: true, result }` is parsed with the output schema and a failure rejects `unavailable` "The engine sent an answer the app cannot read."; anything else is the same `unavailable`. `subscribe` wraps `bridge.subscribe`: each raw event is parsed with `RunnerEvent` and delivered only when it parses; the unsubscribe function of the bridge is returned. **Sidebar.** The footer shows the note of `runnerNote(info.data.mode)` from `useRunnerQuery("runner.info", {})` when it is defined (nothing while loading, on an error, or for `live`), then the existing "Desktop app" or "Browser preview" line.

Present test that changes (1): `App.test.tsx` "the rail lists five destinations, New flow and the inbox count" ends with `expect(await screen.findByText("Sample data. Nothing here runs yet.")).toBeTruthy();` (the notice now arrives with a query).

- [ ] **Step 1: Write the failing tests** (12 named: 11 new, 1 changed)
  `ipc-client.test.ts` (5; a fake bridge records calls and returns what the test says): (1) `a valid input is sent and the parsed answer is returned`: `runner.info` round-trip. (2) `an invalid input never leaves the renderer`: `runs.status` with `{}` rejects `invalid_input` and the bridge is not called. (3) `a failure keeps its code and message, and an unreadable answer becomes unavailable`: `{ ok: false, error: { code: "not_found", message: "x" } }`, an `ok: true` result that fails the schema, a reply `42`, and an error with an unknown code. (4) `a bridge that rejects or throws is unavailable`. (5) `events are validated and unsubscribe reaches the bridge`: a malformed event is dropped, `{ type: "changed", topics: ["runs"] }` is delivered.
  `create-client.test.ts` (2 new): (6) `createRunnerClient uses the bridge when flowdrivenShell.runner exists`: set `window.flowdrivenShell = { kind: "electron", runner: fakeBridge }` (removed in `afterEach`); `call("runner.info", {})` reaches the bridge. (7) `without a bridge it is the sample data`: `runner.info` says `sample`.
  `App.test.tsx` (1 changed, 1 new): (8) the changed test above. (9) `the notice follows runner.info`: a `RunnerProvider` with the fixtures client wrapped so `runner.info` answers `demo` shows "Demo engine. A script plays the steps."; answering `live` shows neither note and still the "Browser preview" line.
  `not-built.test.tsx` (3; a local `render` helper wraps `createFixtureRunnerClient({ scenario: "empty" })` so that `harnesses.list` answers `[]`, `settings.get` answers the defaults of `defaultSettings`-shaped data written inline, and `flows.build` rejects `RunnerError("unavailable", "Building a flow from chat arrives with the agent.")`): (10) `Harnesses shows its empty state for an empty list`. (11) `Settings shows the defaults without breaking`: the heading renders and no alert is present. (12) `the Builder chat shows the not-built sentence and keeps the draft`.
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/src/runner apps/desktop/src/App.test.tsx apps/desktop/src/screens/not-built.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** by the rules.
- [ ] **Step 4: Run the tests and the web build**
  Run: `pnpm vitest run apps/desktop/src && pnpm build:web`. Expected: PASS.
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (commit)**
```bash
git add apps/desktop/src
git commit -m "Read the runner through IpcRunnerClient and show which engine runs" -m "Assisted-by: Codex"
```

---

### Task 17: The evidence walk and two capture screens

Covers decision 10 and the capture part of decision 9. The executor cannot open a window, so everything that can be a pure function is one, with tests; the walk itself is run by the chair.

**Files:**
- Create: `apps/desktop/electron/demo-walk-steps.ts`, `demo-walk-steps.test.ts`, `demo-walk.ts`
- Modify: `apps/desktop/electron/screens.json`, `capture.ts`, `apps/desktop/src/screens.test.ts`

**Interfaces (exact; `demo-walk-steps.ts` imports nothing from `electron`):**
```ts
export type WalkAction = { kind: "go"; hash: string } | { kind: "click"; role: "button" | "link"; name: string } | { kind: "pick"; label: string } | { kind: "firstRun" };
export type WalkStep = { name: string; action: WalkAction; waitFor: string[]; shot: boolean };
export const WALK_STEPS: WalkStep[];
export function actionScript(action: WalkAction): string;   // JavaScript text for webContents.executeJavaScript; evaluates to true when it acted and false when it found nothing. Texts are embedded with JSON.stringify.
export function pageHasAll(body: string, texts: string[]): boolean;
export function stepFileName(index: number, name: string): string;   // index is 0-based: (0, "sidebar") is "01-sidebar.png"
export function formatStepFailure(step: string, url: string, body: string): string;   // `walk step ${step} failed; URL: ${url}; body: ${body cut to 300 characters, line breaks as spaces}`
```
`actionScript` rules: `go` sets `location.hash`; `click` looks at `button, [role="button"]` or `a`, first for an element whose trimmed text equals `name`, else the first whose text includes it, and clicks it; `pick` finds the checkbox inside the `<label>` whose text includes `label` and clicks it; `firstRun` clicks the first `a` in the Runs table whose text starts with `run-`.
`WALK_STEPS` (`name`: action; waits; `*` marks `shot: true`), in this order:
```
sidebar*          go #/builder/local.sample-job-review    "Sample job review", "Demo engine. A script plays the steps.", "Run now"
run-waiting*      click button "Run now"                   "Waiting for you"
choice*           go #/inbox                               "Which jobs get a prototype?", "Send choice", "Job one"
pick-one          pick "Job one"                           "Job one"
send-choice       click button "Send choice"               "Choice sent."
show-waiting      click button "Waiting"                   "Approve the result of"
sign-off*         click button 'Approve the result of "proposal"'   "Approve the result of", "Approve"
approved*         click button "Approve"                   "Approved."
runs              go #/runs                                "Sample job review", "Done"
run-done*         firstRun                                 "Show full report", "Job one", "Passed"
full-report*      click button "Show full report"          "# Sample job review: run", "Items: 5 processed, 0 skipped as seen, 0 failed."
second-run        go #/builder/local.sample-job-review     "Run now"
second-waiting    click button "Run now"                   "Waiting for you"
second-choice*    go #/inbox                               "Job five", "Send choice"
second-pick       pick "Job five"                          "Job five"
second-send       click button "Send choice"               "Choice sent."
second-waiting-tab click button "Waiting"                  "Approve the result of"
second-sign-off   click button 'Approve the result of "proposal"'   "Approve"
second-approved   click button "Approve"                   "Approved."
second-runs       go #/runs                                "Done"
second-report*    firstRun                                 "Show full report", "Seen in an earlier run"
second-full*      click button "Show full report"          "Items: 2 processed, 2 skipped as seen, 0 failed."
```
Why `show-waiting` and `second-waiting-tab`: after `Send choice` the Inbox keeps the answered choice pinned and shows the Resolved tab (`InboxScreen.tsx`: `activeTab` follows the pinned item), so the new sign-off sits in the Waiting tab. The tab's text is `Waiting (n)`; `click` finds it by the "includes" rule (no other button text on the Inbox contains `Waiting`), and clicking it clears the selection, so the sign-off is selected as soon as it arrives.
`screens.json` gains `{ "name": "choice", "hash": "/inbox/ap-0017", "scenario": "looped" }` and `{ "name": "run-looped", "hash": "/runs/run-0008", "scenario": "looped" }` (ten entries). `capture.ts`: the final message becomes `` `captured ${screens.length * 2} screens to .workflow/scratch/screens` `` (20 now). `demo-walk.ts` is modelled on `capture.ts` (same scheme, security and session set-up, `app.on("window-all-closed", () => {})`): it deletes and recreates `<repo>/.workflow/scratch/demo-walk/`, takes the data folder `<that>/data` (so the runner starts fresh), builds `env = { ...process.env, FLOWDRIVEN_DEMO: "1", FLOWDRIVEN_DATA_DIR: <that>/data }`, calls `startRunnerBridge({ ipc: ipcMain, spawn: (c, a, o) => spawn(c, a, o), env, appData: app.getPath("appData"), dirname: __dirname, windows: () => BrowserWindow.getAllWindows() })`, opens one window with `createMainWindow({ preloadPath, show: process.env.FLOWDRIVEN_CAPTURE_SHOW === "1", runner: true, theme: "light" })` and, for each step, runs `actionScript` (repeated every 100 ms for up to 10 s until it answers true), polls `document.body.innerText` with `pageHasAll` for up to 10 s, saves a PNG named `stepFileName(index, name)` when `shot` is set, and appends `<ISO time> <step> ok` to `walk.log`. A step that does not appear in time prints `formatStepFailure(...)` to stderr and to `walk.log`, stops the runner and exits 1; console errors of the window are recorded like `capture.ts` does and fail the walk at the end. A clean walk ends with `await bridge.stop()`, the line `runner stopped` in `walk.log` and `app.exit(0)`.

Present tests that change (2): `src/screens.test.ts` "every captured screen is a real route, once" (8 becomes 10 in both counts) and "every captured screen becomes ready and never shows Loading once ready" (the cast becomes `"long" | "looped" | undefined`).

- [ ] **Step 1: Write the failing tests** (7 named: 5 new, 2 changed)
  `demo-walk-steps.test.ts` (5): (1) `the walk steps have unique names, at least one wait each and routes that exist`: every `go` hash parses with `parseRoute` of `src/nav/route.ts` to a screen other than `not_found`; at least eight steps take a screenshot. (2) `actionScript embeds the searched text escaped`: for a name with a double quote, a backslash and `</script>` the script includes `JSON.stringify(name)`; the five kinds of action each give a non-empty string. (3) `pageHasAll needs every text`. (4) `stepFileName numbers from 01 and keeps the name`. (5) `formatStepFailure keeps the step, the URL and 300 characters of the page on one line`.
  `screens.test.ts` (2 changed).
- [ ] **Step 2: Run the tests to verify they fail**
  Run: `pnpm vitest run apps/desktop/electron/demo-walk-steps.test.ts apps/desktop/src/screens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure module, the two screens, the capture message and `demo-walk.ts`.
- [ ] **Step 4: Run the tests and the programs**
  Run: `pnpm vitest run apps/desktop && pnpm typecheck && pnpm build`. Expected: PASS (`dist-electron/demo-walk.js` exists).
- [ ] **Step 5: Run the gate**
  Run: `pnpm format && pnpm check`. Expected: PASS.
- [ ] **Step 6: Chair step (GUI): the captures and the walk**
  Run: `pnpm capture`. Expected: `captured 20 screens to .workflow/scratch/screens`; the new `choice-*.png` and `run-looped-*.png` look right in both themes. Then run: `pnpm build && FLOWDRIVEN_DEMO=1 TZ=UTC pnpm --filter @flowdriven/desktop exec electron dist-electron/demo-walk.js`. Expected: exit 0; one PNG per starred step in `.workflow/scratch/demo-walk/` and `walk.log` ending with `runner stopped`; `pgrep -f packages/runner/src/main.ts` prints nothing. The chair looks at the PNGs and then runs `FLOWDRIVEN_DEMO=1 pnpm start` once by hand for the owner.
- [ ] **Step 7: Chair step (commit)**
```bash
git add apps/desktop
git commit -m "Add the evidence walk and the choice and looped-run captures" -m "Assisted-by: Codex"
```

---

### Task 18: ROADMAP (chair step)

Covers decision 12. Not an executor task: no file of the code changes. The chair edits `docs/plans/ROADMAP.md` (a plan document, not an instruction file) with this exact text and commits it with the plan.

- [x] **Step 1: Chair step: edit the two rows and add one sentence under the table of "Order changed on 2026-11-11"**
  Row 02b becomes: `| 02b | The runner process, a link over its standard input and output, the contract for format 1.1, and the app reading the runner instead of sample data (detailed: `2026-11-11-02b-runner-process-and-app.md`) | The sample flow runs from the app; the pick appears in the Inbox |`
  Row 04 becomes: `| 04 | The local socket (mode 0600) and the launch agent, so a runner that the app did not start can run, then the trigger service (`schedule`, `flow_done`, `file_change`), the limit keeper and notifications | The hourly trigger fires while the window is closed; a flood is capped |`
  The sentence, as a new paragraph right after the table: `In plan 02b the app starts the runner as its child and talks to it over the runner's standard input and output, so only the app can reach it and no other process of the user can approve anything; the socket and the launch agent are needed only once a runner exists that the app did not start, which is plan 04.`
- [x] **Step 2: Chair step (commit)**
```bash
git add docs/plans/ROADMAP.md docs/plans/2026-11-11-02b-runner-process-and-app.md
git commit -m "Record plan 02b and move the socket to plan 04" -m "Assisted-by: Claude"
```

Done by: Claude Code (chair), 2026-11-11. Evidence: pnpm format && pnpm check.

---

## Handover to plan 03 (the Claude Code adapter)

What plan 03 finds ready:
- `HarnessAdapter` (plan 02) is unchanged. `createRunnerService({ ..., harness })` takes any adapter; live mode today passes an adapter whose methods throw "No harness is connected yet." and a readiness hook that blocks every run with that sentence. Plan 03 replaces both in `service/service.ts`, and `harnessIdOf` there (it maps the attempt's worker name to the id the screens show).
- The handlers for `harnesses.list`, `harnesses.rescan`, `harnesses.setConsent`, `readiness.check` (rows are `unchecked`), `readiness.install`, `settings.get` and `settings.update` are the places to fill in; the contract and the screens already exist.
- Progress reaches the app through store writes: the store is wrapped, so every step, item and approval write marks its topics and one `changed` event goes out per turn. An adapter needs no event path of its own.
- The walk runs in the background (begin variants), so a harness call of many minutes does not block any request. Walks of one flow are chained first in first out, so an adapter sees one run of a flow at a time and may see runs of different flows at once.
- stdout of the runner carries frames only. A harness child process must be spawned with its stdout and stderr piped (never `inherit` for stdout) and with an explicit environment; the runner's own environment no longer holds `ELECTRON_RUN_AS_NODE` (scrubbed at start), and nothing in the runner may spawn `process.execPath` (Task 13 pins it): a fake `claude` for tests is a script reached through a named command or a configured path.
- The test helper `test-helpers/rpc-client.ts` speaks the wire from Node; plan 03's tests can reuse it.
- A run's folder (the cwd of harness work and of `files` and `command` checks) is always `projectDir`; `flows.run` takes no folder from the renderer. Plan 03 or 06 adds a chosen project folder, checked like `prepareDataDir` checks (absolute, a real folder, owned by the user).
- The runner has no `bin` entry; it is started as `node packages/runner/src/main.ts`.

Open points, each decided by a later plan or by the owner:
1. **The socket and who may connect (plan 04).** `serveRpc` takes any pair of streams; the socket is one `net.createServer` whose connection streams go to it. Plan 04 decides the folder and mode (0600), a peer check, the launch agent, and what a second runner does when a first one holds the data folder (today it exits 3; with a launch agent it should attach instead).
2. **The runtime dependency.** `@flowdriven/contracts` is a `devDependency` of the runner. Move it to `dependencies` (and the runner's use of `zod` stays indirect) at the next pinned-file change the owner approves.
3. **The `runAsNode` fuse and the packaged entry (plan 11).** `runnerEntry` in `runner-paths.ts` is the one place that knows where `main.ts` lives. A packaged app must ship the runner's and the SDK's sources and their runtime dependencies (`zod`, `yaml`), and must keep the `runAsNode` fuse on, or start the runner another way (a bundled Node). `utilityProcess` stays rejected: no stdin pipe.
4. **The flag in the sandboxed preload.** Tried on 2026-11-11 with Electron 45.1.0: a `sandbox: true` preload sees a flag passed through `webPreferences.additionalArguments` in `process.argv`. The GUI step of Task 15 shows it again in the app itself.
5. **Command checks on Windows** are refused (plan 02) and the process-group kill has no Windows path; end of stdin as "the app is gone" is the same on Windows, but the link's `kill("SIGKILL")` is not tested there.
6. **Sign-off of registered flows.** Every registered flow shows as approved (the engine has no flow sign-off yet); plan 06 brings the real one.
7. **`flows.import`** has no screen; it registers a valid folder at once. Plan 06 decides where import sits in the app.
8. **Frame size.** A run detail over 1 MiB answers `unavailable` "The answer is too large." There is no paging yet; loop items are capped at 20 for non-manual runs and the demo is far below the limit.
9. **`runs.list` reads each run's view** to get its first report line; fine for tens of runs, an index when it is not.
10. **No trigger input.** Plan 02's handover listed a `trigger` payload for `flows.run`; by decision 1 of the brief triggers live in the runner (plan 04), so `flows.run` only gets `params` here.
11. **The folder loader** skips `.git`, `node_modules` and `.DS_Store` at any depth, so skipped files are not covered by the content hash (plan 02's review). `flows.import` inherits this; decide in plan 04 or 06 whether the loader refuses `node_modules` instead.
12. **From plan 02's outline,** items 3 (the socket server) and 7 (the launch agent and its installer) are not built here: the app starts the runner as its child (decision 1), so they move to plan 04 (Task 18 records it in the roadmap). Item 5 is `IpcRunnerClient` instead of `SocketRunnerClient`.
13. **Not built, by design:** `flows.build`, `flows.update`, `readiness.install`, `harnesses.rescan`, `harnesses.setConsent`, `settings.update` answer `unavailable` with one sentence each; the screens already show any such answer.
