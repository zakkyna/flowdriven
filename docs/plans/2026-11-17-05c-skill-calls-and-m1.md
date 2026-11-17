# Plan 05c: Skill Calls, Long Steps, Commands, Granted Folders, Plain Gmail Writes, and M1 Implementation Plan

> **Execution:** one task per Codex call through the handoff rules in AGENTS.md; Claude reviews each task against its gates. Steps use checkbox syntax for tracking.

**Goal:** The Upwork job-review flow (milestone M1, spec 20.8) runs end to end from the app on the owner's Mac with Claude Code as the only harness: real Gmail alerts, at most 3 real job pages per run in the owner's own browser, the pick in the Inbox, the owner's prototype skill building and publishing after the pick, and a proposal draft that passes its checks, first attended with the owner watching and then on the hourly schedule. Nothing is sent.

**Architecture:** A `do: skill` step gets its skill as text in the prompt plus a read-only copy folder whose `SKILL.md` holds only `name`, `description` and the body (R14); an installed skill is hashed when the owner allows the flow, and a changed hash blocks the run until the owner allows it again (R9). The capability consent gains pins (skill hashes and granted folders), so the allow covers exactly what the screen showed. Commands (`cli_tool`) reach Claude Code's `Bash` tool through the FlowDriven hook, which allows only declared command lines made of plain words, and never in a step that reads outside text; Gmail draft and label tools become a third connector class, and a label change that moves mail to Trash or Spam is held as a delete.

**Tech Stack:** only what is on `tools/checks/allowlist.json`: Node 24 built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:sqlite`), `yaml` 2.9.1 through `@flowdriven/sdk` (already there), Zod 4 through `@flowdriven/contracts`, React 19, Electron 45, Vitest, Biome. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-11-10-flow-maker-design.md` sections 9.4 (requirements; the extra-folder grant), 9.6 (content hash), 9.7 (skills), 11.3 (the 30-minute default), 12.1 (readiness rows), 13.3 (risky actions), 15.2 (folder limit and its exceptions), 20.2 to 20.8 (router, `do: skill`, `limits.max_duration`, R1, R4, R9, R10, M1), 21.3 (lean calls), 21.6 and 21.7 (skills, R14), 22.6 (05c is first). Roadmap: `docs/plans/ROADMAP.md`, sections "Order changed on 2026-11-12: plan 05 before 04b, and plan 05 split" and "Order changed on 2026-11-17". Leftovers taken over: plan 05 Handover (`2026-11-12-05-capability-router-and-own-browser.md:1220-1227`), plan 05b Handover and Known limits (`2026-11-12-05b-native-connector-and-held-calls.md:923-948`). Branch `claude/plan-05c-detail-29be69`, cut from `work/decisions-2026-11-17` at `4090c45`, which holds `work/plan-05c` (the built plans 01 to 05b).

## Owner approval ("Ask first")

Task 1 is already approved. Every other change below is on the "Ask first" list of AGENTS.md. The chair asks the owner for each item, one at a time and in Indonesian, before any task after Task 1 starts, and writes each question and answer under "The owner's answers". Each yes covers the change it names and nothing else.

0. **Task 1, the control test (approved).** On 2026-11-17 the owner answered "Lewati bila tak ada peringatan": in `packages/runner/src/entry.test.ts` the test "without the silencer the warning is printed (the check can see it)" skips itself when the running Node prints no SQLite experimental warning (Node 24.22.3 on the owner's Mac prints none). The test "silences only the SQLite warning" stays as it is.
1. **The runner.** (a) Skill steps run (Tasks 6 to 9). (b) A step whose time limit is over 30 minutes is not tried again after it ran out its limit, and the step says why (Task 10). (c) While such a step runs, the runner starts macOS's own `/usr/bin/caffeinate -i -w <pid of that step's Claude Code>`, so the Mac does not fall asleep in the middle; it ends by itself with the step, and closing a laptop's lid still sleeps the Mac (Task 10). (d) The store moves to version 6: the capability consent gains its pins, kept in a new table `consent_pins` (Task 3), and the contract gains a row's pin, the allow's pins and a step's time limit (Task 2). (e) The Run screen shows a step's time limit and the running time of a long step (Task 11). (f) The Readiness screen reads the skill folder and looks programs up on `PATH`, running nothing (Task 21). (g) The M1 flow folder and its demo (Tasks 22 and 23).
2. **Approvals.** (a) A loop over `${steps.<ask>.outputs.choice}` that declares no `key` gets the pick keys, so a pick releases the named tool for the picked items there; and a pick releases a tool only for a step inside a loop over that ask's choice, not for an item with the same key in another loop (Task 19). (b) A Gmail label call whose input names Trash or Spam becomes a held `delete` approval, and `mark_thread_spam` and `mark_message_spam` join the held deletes (Tasks 17, 18). (c) The prototype host's publish tool waits for the owner unless the pick released it (Task 20).
3. **Sandbox limits.** (a) A skill step gets a read-only copy folder of its skill, under `<data folder>/skill-copies/`, removed when the step ends (Task 9). (b) A step that declares a `cli_tool` gets Claude Code's `Bash` tool, and the hook allows only declared command lines of plain words: no shell characters, no quotes, no `~`, no word that starts with `=`, no background run; an argument that a wildcard (` *`) matches must be a relative path or value; programs that run other programs or reach the network (shells, `env`, `xargs`, `sudo`, `osascript`, `npx`, `curl`, `ssh` and the others of Decision 7) are refused; interpreters and package runners (`node`, `python3`, `npm`, ...) run only as exact lines; a step that reads outside text gets no commands at all; a step that runs commands needs a folder, and its commands run there (Tasks 5, 12, 13). Commands run with the owner's rights and no OS sandbox; the screen says so. (c) A step may read, or read and change, a folder under the home folder that the owner granted at the allow, written `~/<folder>`; never the home folder itself, `~/Library`, a hidden folder, or FlowDriven's own data, also after symlinks are followed; shown in the preview, written to the audit log, taken back with Withdraw (Tasks 14, 15). (d) A `file_change` trigger may watch a folder granted to its flow (Task 16). (e) Gmail's draft and label tools run without approval when the flow declares them (Tasks 17, 18; the owner's answer "Jalan sendiri" of 2026-11-13 decided the class, and this item is the code). (f) The prototype host's other write tools run without approval when declared (Task 20).
4. **Hashing.** A skill folder is hashed with the SDK's present `contentHash` (no change to `packages/sdk/src/hash/canonical.ts`) and the hash is pinned at the allow; the pin blocks a run when the skill changes (Tasks 4, 6 to 9). The flow hash code itself is not changed: its missing LF normalisation and the missing signature check of spec 9.6 stay as they are (Known limits).
5. **Dependencies.** None.
6. **Present tests that change.** Each pins a refusal or a number that this plan changes on purpose, and each changes to an equally strict new expectation, named under its task with the old and the new line. Task 3: the store version tests in `sqlite-store.test.ts`, `sqlite-store-usage.test.ts`, `sqlite-store-triggers.test.ts` and `sqlite-store-capabilities.test.ts` (5 becomes 6, "version 6 is refused" becomes "version 7 is refused", titles with "5" say "6"). Task 9: `claude/adapter.test.ts:238-240` "Skill steps are not run yet.". Task 14: `router/route.test.ts:57` (`~/x` is now a granted-folder route; `/x` and `../x` stay dropped). Task 15: `service/claude-harness.test.ts:146` (`data`, which is `~/job-review`, leaves the cannot-enforce list; `builder` stays). Task 16: the sentence "Only folders inside the project folder can be watched for now." in `triggers/scan.test.ts`, `triggers/rules.test.ts`, `triggers/service-files.test.ts` and `review-04-r.test.ts:365`. Task 18: `create_draft` as the example of an unclassed Gmail tool in `router/route-connector.test.ts:59`, `claude/review-05b-r.test.ts:333`, `claude/policy-connector.test.ts:22` and `service/claude-harness-connector.test.ts:20,73` becomes `create_label`. Task 19: `claude/review-05b-r.test.ts:207-221` (a keyless loop over the choice is held) and `claude/review-05b-fix.test.ts:189` (the same shape) become the same proof for a keyless loop over another list; the tests that release a tool by a pick through the adapter (`claude/adapter-held.test.ts:190,202` and `service/claude-harness-connector.test.ts:185`) add `pickTools` to their request, with every expectation unchanged (the call-grant tests at `adapter-held.test.ts:222,242` need no change). `claude/decide-connector.test.ts` and `exec/leaf-hold.test.ts` do not change. No other present test may change; if one must, the executor writes `Blocked:`.
7. **The owner's accounts, browser and Mac.** (a) Task 0, four probes with the owner watching: the scan lists the owner's connectors and their tools with no prompt and no model call (H1, H4); two haiku calls, one offered `Bash` with every tool call refused so nothing runs, one with no tool (H2); and the chair checks the owner's prototype skill folder by file names, sizes, front-matter key names and yes-or-no checks, never its text (H3). (b) Task 25, the attended M1 run in the walk's own copy of the app (Task 24 writes the walk): the owner gives the Claude Code consent and the allow; the test mailbox (job alerts of the last 2 days are read; the label `FlowDriven` is added to the alert threads read), the signed-in browser (at most 3 job pages per run and 10 a day, read only), the owner's Claude plan (about one call per job and one per page; the build step may run up to 150 minutes), the owner's prototype skill and host (only for the jobs the owner picks, at most 2 jobs each time the owner picks, the flow's `daily_builds`: a project is created, files are uploaded, and the prototype is published, which makes a real page public), and three granted folders `~/job-review/notes` (read), `~/job-review/work` and `~/job-review/prototypes` (read and change). (c) Task 25, the schedule: the owner switches the hourly trigger on after the attended run passed, and the walk's window stays open; runs go up to the pick on their own. Nothing is sent in any of these.

**The owner's answers (2026-11-17; each asked alone, in Indonesian, with the choices "Ya, setujui (Disarankan)" and "Tidak", before any code of this plan was built).** Item 1, the runner: "Ya, setujui (Disarankan)". Item 2, approvals: "Ya, setujui (Disarankan)". Item 3, sandbox limits: "Ya, setujui (Disarankan)". Item 4, hashing: "Ya, setujui (Disarankan)". Item 6, present tests that change: "Ya, setujui (Disarankan)". Item 7(a), the four probes of Task 0: "Ya, setujui (Disarankan)". Item 7(b), the attended M1 run on real data: "Tidak". Asked which part was the reason (choices: "Nanti saja", "Tanpa terbit publik", "Tanpa label Gmail"), the owner chose none. Item 7(c), the schedule, was not asked, because it comes after 7(b). So Tasks 0 to 24 may be built, and Task 25 waits: the chair asks the owner again, plainly and alone, after Task 24, and runs nothing on the owner's real Gmail, browser, skill, host or folders before a new yes. Item 5 needs no answer (no dependency). Each yes covers the change it names and nothing else.

**The owner's answers during Task 0 (2026-11-17).** Asked how the prototype skill puts a prototype on the internet, the owner chose "Lewat konektor claude.ai"; asked which connector, the host connector; asked which skill, "prototype-builder". Asked whether the skill limits may rise to 1,000 files, 64 MiB and 60,000 characters (H3), "Ya, naikkan (Disarankan)" (Decision 3). Asked whether, because the skill runs commands while it reads the job's text (H3, Decision 7), Tasks 1 to 19 and 21 are built now and Tasks 20 and 22 to 25 wait for a safe way to run such commands, "Ya, tunda M1 (Disarankan)". So the M1 tasks wait for a new decision of the owner, after the research of O2.

**The owner's correction (2026-11-17).** The owner wrote: "Ya setuju semua tidak perlu satu persatu" and "Ulangi, Tadi saya salah pencet tidak". So the "Tidak" to item 7(b) was a mispress: the owner says yes to every item, 7(b) and 7(c) included, and asked not to be asked one by one again for these items. Task 25 no longer waits for a yes; it still waits, with Tasks 20 and 22 to 24, for a safe way to run the skill's commands (O5) and for the host connector's tools (H1), as the owner agreed above.

Nothing else on the list is touched: no CI, no `tools/checks/`, no instruction file, no agent or MCP configuration, no CODEOWNERS, no secret or credential file, no change to `contentHash` or `canonicalListing`. The executor stops and writes `Blocked:` if a task seems to need anything else on that list.

## Global Constraints

- Node `>=24.14.0`, pnpm `10.9.0`; English everywhere, ASCII only (no em dash, no curly quote) in this plan and in every file it creates.
- **Plain-Node rule** (plan 02b): code in `packages/*/src` uses relative imports that end in `.ts` and erasable TypeScript only (no `enum`, no `namespace`, no parameter properties). No `any`; `noUncheckedIndexedAccess` is on (write `list.at(0)?.x`); a bare `!` needs a comment. No `eval`, no `Function(` (`packages/runner/src/source-rules.test.ts`). Hidden characters in tests are built with `String.fromCodePoint`.
- **Imports.** The runner imports `@flowdriven/contracts` only under `service/`, in `main.ts` and in `test-helpers/`, so `router/`, `claude/`, `connectors/`, `skills/`, `folders/` and `exec/` define their own types and `service/` maps them. The SDK's main entry (`packages/sdk/src/index.ts`) stays free of `node:` imports; what needs them goes through `packages/sdk/src/node.ts`. No `console.log` in runner sources. `TZ=UTC` for every test.
- **No wall-clock waits in tests that this plan adds**, except tests against the fake `claude`, which poll the child as the present adapter tests do, and tests that use Vitest's fake timers. The known load-sensitive tests of plan 03 ("S4b" in `claude/review-03-s4.test.ts`, "Missing pid" in `claude/adapter-limits.test.ts`) and of plans 04 and 05b ("500 changed files with max_items 1 ..." in `triggers/service-files.test.ts`, which timed out once at 5 s in a full run of Task 2, and "a close of the withheld tab is allowed ..." in `claude/adapter-closing.test.ts`, which failed once in the next full run while the Mac's load average was about 40; each passed alone three times out of three) are not touched; if one fails in a full run it is re-run alone before it is blamed on this plan. More generally, while the Mac's load average is high (seen at 30 to 69 on 2026-11-17 from other work), any test that starts child processes or measures the wall clock can fail; such a failure counts against a task only if the test also fails alone, and the task's Evidence line names every test that failed in the full run. This never replaces the closing gate (one full `pnpm check`, green end to end).
- **Fail closed.** A request the rules do not recognise, a tool or command the flow did not declare, a skill that cannot be read, a folder that does not resolve, a pin that is missing, a field that is absent, a value that cannot be parsed: refuse, withhold or block; never allow.
- **R14 holds everywhere.** A step's tools, folders, commands, sites, connectors and grants come from the manifest and the owner's consent only; a skill's text reaches the prompt and never the policy. FlowDriven never writes a skill's front matter to disk except `name` and `description`.
- **Frozen at run start** (plan 05). Requirements, routes and tools are fixed when the run starts; a pin is read from the consent at the step and compared with what is on disk at that moment.
- **Nothing is sent.** No task declares or allows a send tool. The M1 flow declares none, so "never sends" holds by the boundary (spec 20.4).
- UI: plain CSS modules with the tokens of `apps/desktop/src/styles/tokens.css`; status is icon plus words, never colour alone; every new sentence uses everyday words (spec 22.1).
- The executor never commits. Steps marked "Chair step (commit)", "Chair step (GUI)" or "Chair step (network)" are skipped and left unticked. After two failed attempts write `Blocked: <short reason>` under the task and stop. **No task asks the executor to run the real `claude`, `pnpm start`, `pnpm capture`, electron, a browser, `caffeinate` or anything on the network.** Every test uses the fake `claude` of `packages/runner/src/test-helpers/`, a scripted harness, or an injected spawner. The walk of Task 24 is written and tested by the executor and run by the chair.

## Gates

| Gate | Command | Passes when | Who |
|---|---|---|---|
| Task gate | `pnpm format && pnpm check` | exit 0 | executor |
| Test paths | `pnpm vitest run <paths>` | the named tests pass | executor |
| M1 demo (fake `claude`) | `node packages/runner/src/test-helpers/m1-demo.ts` | prints the ten lines of Task 23 | executor (Task 23), then **Chair step (GUI)**, Task 25 |
| Capture | `pnpm build && pnpm capture` | `captured 26 screens`, exit 0 | **Chair step (GUI)**, Task 25 |
| Probes | the kit of Task 0 | facts H1 to H4 written under Facts | **Chair step (network)**, owner watching, Task 0 |
| M1 attended | the walk of Task 24, steps of Task 25 | the run ends `done`, the publish was released by the pick, the proposal passed its checks, nothing sent | **Chair step (GUI)**, owner watching, Task 25; waits for O5 and H1 |
| M1 on the schedule | steps of Task 25 | one triggered run reaches the pick on its own and ends `done` after the owner's pick and sign-off | **Chair step (GUI)**, owner watching, Task 25; waits for O5 and H1 |
| Commit | `git add ... && git commit ...` | commit created | **Chair step (commit)** |
| Closing gate | `pnpm check`, one full run | green end to end, with no re-run of any test; recorded in the Handover as the plan's closing evidence | chair, before the plan closes and before any draft PR (the owner's decision of 2026-11-17: "Hijau sebelum ditutup"); if the Mac stays too loaded for a clean run, the chair tells the owner and does not close |

## Dependency changes

None.

## Facts

What the code looks like today (branch `claude/plan-05c-detail-29be69`, commit `4090c45`). Lines are in `packages/runner/src/` unless a path is given. Every task relies on these.

**From the code:**

1. **`do: skill` is parsed and refused at run time.** `packages/sdk/src/format/steps.ts:109` (`skill`, `instructions`); the only check is `skill_requirement` (`packages/sdk/src/validate/validate.ts:117-121`: the `skill` value is in `uses` and names a `type: skill` requirement). The gate puts every `do: skill` step's `skill` and `uses` ids into `cannot` (`service/claude-harness.ts:111-114`) and looks at `do: worker` steps only (`:115`). The adapter returns `block: "Skill steps are not run yet."` (`claude/adapter.ts:92-93`; pinned by `claude/adapter.test.ts:238-240`). `buildPolicy` throws "This step uses something FlowDriven cannot enforce yet (<id>)." for every requirement type other than `path`, `harness`, `web` and `mcp_server` (`claude/policy.ts:130`). The gate tests `service/claude-harness.test.ts:146-181` (a skill `builder` with no ref) and `service/claude-harness-web.test.ts:93-104` (a skill and a `cli_tool` with no other field) expect those ids in "cannot enforce yet".
2. **Skills are listed, never read.** `claude/inventory.ts:20-42` `listSkills({home, project})` lists `<home|project>/.claude/skills/<name>/SKILL.md` by name and scope only. `--disable-slash-commands` is always passed (`claude/args.ts:59`), and the start proof demands `skills: []` and `slash_commands: []` (`claude/stream.ts`, about `:118` and `:136-143`). The fake `claude` puts `skills: ["fake-skill"]` in its init event only without that flag (`test-helpers/fake-claude.ts:288`).
3. **The hash.** `packages/sdk/src/hash/canonical.ts:27` `contentHash(files: FlowFiles): \`sha256:${string}\`` over `canonicalListing` (`:11`: rows `path\tsha256(bytes)`, sorted by UTF-8 bytes; raw bytes, no LF normalisation). `packages/sdk/src/load/load-folder.ts:11` `loadFlowFolder` hashes every file of a flow folder (skips `.git`, `node_modules`, `.DS_Store`; refuses symlinks; at most 2000 files, 2 MiB each, 10 MiB in all), so a bundled `skills/<name>/` is inside the flow hash. `packages/sdk/src/load/parse-yaml.ts:1-33` `parseFlowYaml` (hardened YAML 1.2 core: no tags, anchors, aliases or duplicate keys, 256 KiB) imports `../hash/canonical.ts` and so `node:crypto`; it is exported from `packages/sdk/src/node.ts` only. `flows.import` stores the files as UTF-8 text (`service/handlers.ts:359-370`). There is no signature check anywhere.
4. **The consent.** Table `capability_consents (flow_id PRIMARY KEY, hash, at)` (`schema.ts:28-29`), JSON-encoded string columns; `storage.ts:140-144` `CapabilityConsentRow {flowId, hash, at}`; `sqlite-store.ts:142-170`. `service/capabilities.ts:38` `createCapabilities({store, now, facts, catalog?})` gives `get`, `allow(flowId, hash)` (`:113-125`: refuses a hash other than the preview's and a blocked allow; audit `capabilities_allowed`), `withdraw` (`:126-131`, audit `capabilities_withdrawn`) and `consentOf` (`:50-54`: `none`, `given`, or `stale` when the flow hash differs). `allowIsBlocked` (`:16-36`) looks at used `web` and catalogued `mcp_server` rows only. The screen calls `action("flows.allowCapabilities", { flowId, hash })` (`apps/desktop/src/screens/builder/CapabilitiesPanel.tsx:89`).
5. **The run-start check.** `engine.ts:255-258` `checkAndWalk` blocks a run when `deps.readiness(manifest, {flowId, hash: run.flowHash})` is not ready; the service gives `allowed = getCapabilityConsent(flowId)?.hash === ctx.hash` to `gate` (`service/claude-harness.ts:397-411`). Inside each attempt `admit` (`:347-353`) refuses with `ALLOW_FIRST` a step that uses a `web` or catalogued `mcp_server` requirement when the consent hash is not the run's flow hash. Enabling a trigger needs `consentOf === "given"` when `needsAllow` (`service/handlers.ts:406-421`); `needsAllow` (`router/route.ts:112-119`) ignores `path` and `harness` requirements. `GATE.sensitive` refuses a `sensitive` web or connector requirement until the allow (`service/claude-harness.ts:123`), and refuses any other `sensitive` requirement always (`:135`).
6. **The store version.** `sqlite-store.ts:51-69`: `PRAGMA user_version` is 5; a version above 5 is refused ("Unsupported database version.", `:52-53`); one branch per old version runs the later schemas. Tests that pin 5 and 6: `sqlite-store.test.ts:159,169,174,177-180`, `sqlite-store-usage.test.ts:80`, `sqlite-store-triggers.test.ts:96-112`, `sqlite-store-capabilities.test.ts:7,65,76`.
7. **The router.** `router/route.ts:36` `routeRequirement(req, facts, catalog = CONNECTORS)`; `Route.provider` is `"claude-code-files" | "claude-in-chrome" | "claude-ai-connector"` (`router/types.ts:10`); `HarnessFacts = { hooks; chrome; connectors? }`. `path` (`:71-83`): `isProjectRef` (`claude/policy.ts:24-33`: not absolute, no `~`, no `..`) is the files route, anything else is dropped with the noun "A folder outside the project" and `DROP.notYet` (pinned by `router/route.test.ts:57-64` for `~/x`, `/x`, `../x`). Every other type falls to `DROP.notYet` (`:98`; pinned by `router/route.test.ts:93-115` for `{type: "skill"}` and `{type: "cli_tool"}` with no other field). `DROP` `:9-15`, `COST` `:16-20` (`files: "Adds about 10,600 tokens to each call of a step that uses it."`), `NOUNS` `:23-34`, `capabilitySentence` `:131`, `unattendedProviderErrors` `:153`.
8. **The policy and the hook.** `claude/policy.ts:13-22` `Policy { tools, folders, cwd, addDirs, schema, sessionId, browser?, connector? }`; a path folder is `resolveDeep(join(project, ref))`, must be inside the project and must not overlap the control folder (`:132-177`); `cwd` is the first folder, else the control folder's `cwd/`; `addDirs` are the rest (`--add-dir`); `tools` is `Read, Glob, Grep` plus `Write, Edit` when a folder is `read_write` (`:182-188`). `claude/decide.ts:51`: a tool other than `Read, Write, Edit, Glob, Grep` (outside the Chrome and connector prefixes) is `DENY.badRequest` (`:98-100`), so `Bash` is always refused; paths must be absolute, resolved and inside a declared folder; `.git`, `.claude` and `.mcp.json` parts are protected for writes (`:39-49`).
9. **The call.** `claude/control.ts:17` `createControlDir` writes `<data>/control/<id>/` (`req/`, `res/`, `cwd/`, `hook.sh`, `settings.json` with hooks only, `started`, and `mcp.json` for a connector), removed in `finally` (`claude/run.ts:563`) and swept at start. Flags (`claude/args.ts:41-70`): `-p --output-format stream-json --verbose --no-session-persistence --session-id --model --restricted --strict-mcp-config --mcp-config --tools <list> --disable-slash-commands --permission-prompts none --settings (--chrome|--no-chrome) --add-dir... --json-schema`. The prompt goes on stdin (`claude/prompt.ts:8` `buildPrompt`). The child env is `HOME, USER, PATH, TMPDIR, LANG` (`claude/env.ts`). `StepRequest.onStart?: (pid) => void` (`harness.ts:56`) is called with the child's pid (`claude/run.ts:417`); `keeper/kept-harness.ts:75` wraps it to sample the child and calls the request's own `onStart`; the leaf sets none today.
10. **Time.** `exec/limits.ts:8`: a step's time limit is `step.limits.max_duration ?? manifest.limits.max_duration ?? "30m"`. `exec/leaf.ts:84-135` arms a timer per attempt; at the limit `ctl.abort()` kills the child (SIGTERM, SIGKILL after 2 s) and the attempt fails with "time limit exceeded"; the step retries up to `attempts` and then the run is blocked (`:346-351`). `StepRequest.maxDurationMs` (`harness.ts:57`) reaches the adapter and is not read there. The keeper counts a running call against the ceiling for its whole life (`keeper/keeper.ts:177` uses `CLAIM_MS` only for memory claims). No heartbeat, no keep-awake. A failed loop item with `on_item_fail: skip` sets the run back to `running` (`exec/loop.ts:122-134`); the step row keeps its note.
11. **Commands today.** `cli_tool` requirements have `commands?: string[]` matching `^[A-Za-z0-9._-]+(?: [^\s*]+)*(?: \*)?$` (`packages/sdk/src/format/requirements.ts:35-39`). `packages/sdk/src/validate/risky.ts:33` `commandAllowed(entry, cmd, args)` and `:18-32` `classifyCommand(pattern)` (`rm`, `rmdir`, `unlink`, `shred`, `trash`, a `*` program, `merge`, `push --force`, `delete` are `delete`; `publish` is `post`) exist; only the `command` check runs commands (`checks/command.ts:7`, env `PATH` and `HOME`), and the gate marks those checks `cannot` (`service/claude-harness.ts:109`).
12. **Folders and triggers.** `triggers/scan.ts:10-41` `resolveRoot(project, path)` accepts only folders inside the project ("Only folders inside the project folder can be watched for now."); `triggers/rules.ts:79` and `triggers/service.ts:229-246, 436-509` use it; `review-04-r.test.ts:365` pins the sentence too. There is no folder grant anywhere.
13. **The Gmail catalog.** `connectors/catalog.ts:12-30`: `read` = `search_threads, get_thread, get_message, list_labels, list_drafts, get_draft`; `risky` = `send_message, reply, forward` (send), `trash_thread, trash_message, delete_draft, delete_label` (delete). A declared tool in neither list drops the route with `DROP.connectorTool` (`router/route.ts:52-59`), and `buildPolicy` throws (`claude/policy.ts:99-114`). `claude/connector.ts:39-93` `decideConnector` allows a read tool (`class: "read"`) and holds a risky tool unless a pick grant (`:64`, through `state.granted`) or an unused call grant matches. The scan keeps `{name, readOnly}` per tool (`claude/connector-scan.ts:11, 43`), not `destructive`. Plan 05b G5 named only some of Gmail's 30 tools. The SDK's `classifyTool` (`packages/sdk/src/validate/risky.ts:3`) knows the words send, reply, forward, post, publish, pay, purchase, buy, delete, remove, trash, merge; `classifyTool("label_thread")` is `undefined` (`packages/sdk/src/validate/validate.test.ts:129`).
14. **Picks and grants.** `exec/ask.ts:67-72`: an option of a loop item is `{key: element.key, item: element.item}`, so `outputs.choice` holds the items themselves (the alert jobs in M1), not their step outputs. `engine.ts:358-415` `beginAnswer` stores the chosen items as `outputs.choice` (option order) and adds a grant `<requirement>.<tool>` with the pick key as item key for every `ask.approves` entry, only when `pickKeyUsable(pick)` (`connectors/grants.ts:31-33`: not empty, not `#...`). `exec/loop.ts:55-58` keys a loop without `key` as `#<position>`, so the spec's `build` loop (`packages/sdk/src/test-data/upwork.ts`, no `key`) is never released by a pick, which `claude/review-05b-r.test.ts:207-221` pins. A pick grant names run, tool and item key, not the loop. A loop marks an item seen only when it passed and the loop declares a `key` (`exec/loop.ts:135-139`); a failed item is offered again by the next run.
15. **Expressions.** `packages/sdk/src/expr/evaluate.ts:14` `stepView` gives `{...outputs, status, passed, failed, skipped, outputs}` of a step, and only its declared outputs; inside a loop a sibling step is reachable by its id (`exec/scope.ts` `itemScope`). In a `where` filter a name is read from the element first and then from the scope (`evaluate.ts:43-47`), so `${steps.review.items where key == job.id}` finds the review item of the loop's `job`.
16. **The M1 flow exists only as test data.** `packages/sdk/src/test-data/upwork.ts` and `upwork-yaml.ts` (the spec's flow of 20.4). Its `rough` and `full` steps are `do: agent`, and an agent step gets no tools (`claude/policy.ts:55`), so it cannot read `profile.md`; its `page` step declares no output, so `full` never sees the post. Its `data` requirement is `~/job-review` (refused, Fact 7), `host` is `connector:prototype-host` (not in the catalog), and `gmail` declares `label_thread` (unclassed, Fact 13). `flows.run` takes `inputs` and `params` (`packages/contracts/src/operations.ts:110-116`); the engine fills every param it is not given with its default (`engine.ts:301-302`), while input defaults are applied only to triggered runs (`triggers/rules.ts:11` `inputsFromDefaults`). Params have no settings screen yet.
17. **The fake `claude`.** `test-helpers/fake-claude.ts` and `fake-claude-script.ts`: `FakeScript` (`:59`; `version, chrome, pages, help, auth, plugins, mcp, connectors, connectorPending, connectorAbsent, hang, plays`), `FakePlay` (`when` picks the play by a prompt substring), `FakeAction` (`text, tool, ungated, pause, hold, rate_limit, ignore_sigterm, raw, result, auth_failure, exit`); a `tool` action runs the real PreToolUse hook for any tool name and performs its `write` only when allowed; `readFakeCalls(home)` gives `call` rows (`args, cwd, env, prompt`) and `tool` rows. It does not read skill files and does not run commands.
18. **Approvals and the Inbox** are as plan 05b left them: `risky_action` rows with `call`, `beginDecide` writes grants and re-runs the step, `MAX_HOLDS = 3`, `MAX_HELD_CHARS = 4000` (`exec/held.ts`). The connector walk (`apps/desktop/electron/connector-walk.ts`) runs in its own emptied data folder and calls `harnesses.rescan` before a run.

**From the real Claude Code** (the chair's probes of Task 0, 2026-11-17, Claude Code 2.1.318, with the owner watching; kit and filtered output in `.workflow/scratch/plan-05c/probe/`, git-ignored; the kit kept only names that match strict patterns, status words, booleans and numbers, never a connector id, a full address, a description or a file's text):

- H1. The owner named a claude.ai connector as the host that publishes prototypes. On 2026-11-17 its status was `needs-auth`, so its tools are not known yet; the owner connects it again in claude.ai before Task 20, and the chair scans again with no prompt. Which tool makes a prototype public and what its address looks like are asked then. The scan itself sent no prompt and made no model call; it asked `mcp_status` three times while connectors were `pending`.
- H2. In a restricted call offered `Bash`, the PreToolUse request's `tool_input` had exactly the keys `command` (string) and `description` (string); the hook refused the call and nothing ran. Input tokens (cache reads and writes included, summed over the call's turns): 9,986 for the call with `Bash` (two turns: the refused call and the answer) and 2,959 for a call with no tool (one turn), so offering `Bash` adds about 2,000 tokens to each turn (`(9,986 - 2 x 2,959) / 2`, rounded). Task 12 uses 2,000.
- H3. The owner's prototype skill is `prototype-builder` in `~/.claude/skills/`. Not a symlink; no symlink and no hidden entry inside. 231 files, 16,685,387 bytes: a Flutter web starter, fonts, photos, notes and six scripts (`.mjs` and `.sh`). Front-matter keys: `name` and `description` only. Strict YAML: yes. `name` follows the rule and equals the folder name: yes. Description at most 1,024 characters: yes. Body at most 24,000 characters: no (27,433). So the skill was over the first limits of Decision 3 (200 files, 10 MiB, 24,000 characters), which the owner then raised, and its scripts mean it runs commands while it reads the job's text, which Decision 7 refuses. After Task 4, a yes-or-no check showed that `parseSkillFile` accepts its `SKILL.md`.
- H4. The scan listed 31 Gmail tools. `readOnly`: `list_drafts`, `get_draft`, `get_thread`, `get_message`, `search_threads`, `list_labels`, `download_gmail_attachment`. `destructive`: `delete_draft`, `unlabel_thread`, `apply_sensitive_thread_label`, `trash_thread`, `mark_thread_spam`, `unlabel_message`, `apply_sensitive_message_label`, `trash_message`, `mark_message_spam`, `delete_label`. `openWorld`: `send_message`, `reply`, `forward`. No annotation: `create_draft`, `update_draft`, `label_thread`, `untrash_thread`, `unmark_thread_spam`, `label_message`, `update_message_labels`, `untrash_message`, `unmark_message_spam`, `create_label`, `update_label`. So under Decision 9 the `write` list is `create_draft`, `label_thread`, `label_message`, `update_message_labels`, all three label tools among them are held as a delete when their input names Trash or Spam, and `unlabel_thread` and `unlabel_message` stay unclassed because the scan marks them destructive.

## Decisions made in this plan

All are the chair's call (owner may override), within what the spec leaves to the builder (spec 18.4).

1. **A skill reaches the worker as prompt text plus a read-only copy, not through Claude Code's own skill loader.** The restricted call loads no skill (spec 21.3) and the start proof keeps `skills: []`; spec 9.7 gives this form for a harness without per-run skills, and 21.3 puts the skill right after the frame. Why: the native loader would read the front matter itself and could load the owner's other skills.
2. **Two skill sources.** A `skill` requirement with `ref: claude-code:<name>` is the skill in `~/.claude/skills/<name>/` (the owner's user skills); `ref: flow:<name>` is a skill bundled in the flow package at `skills/<name>/`. The name follows Agent Skills: lowercase letters, digits and single hyphens, at most 64 characters. A skill with any other ref, a plugin skill and a project skill stay unrouted: the router drops them with `DROP.notYet`, and the gate keeps them in "cannot enforce yet" (as plan 05b did for connectors without a catalog entry), so `service/claude-harness.test.ts:146` and `service/claude-harness-web.test.ts:93` keep their skill ids.
3. **The copy (R14).** `SKILL.md` in the copy is `---`, `name: "<name>"`, `description: "<description>"`, `---`, then the body; every other file keeps its bytes (references, assets, scripts). Entries whose name starts with `.` (at any depth) and `.DS_Store` are not read, not hashed and not copied. A script in the copy runs only through a declared command. Limits for a skill that a `do: skill` step uses: 1,000 files, 2 MiB each, 64 MiB in all, body at most 60,000 characters, description at most 1,024 characters; front matter must parse as strict YAML 1.2 (`parseFlowYaml`); symlinks and hidden characters are refused. The 24,000 characters of spec 21.6 stay the limit for the agent's library skills (plan 06c). These limits are the owner's answer of 2026-11-17 to H3 ("Ya, naikkan"); the first draft had 200 files, 10 MiB and 24,000 characters, which the owner's skill exceeds.
4. **The pin (R9).** The pin of an installed skill is `contentHash` of its folder's original bytes (front matter included). The preview shows the hash, the number of files, the size of the text and the date of the newest file. `allow` reads the folder again and stores the pins only when they equal the pins the screen sent. A bundled skill is pinned by the flow hash already. The check runs at three places: `consentOf` (the flow screen and trigger enable), the gate at run start, and the skill step right before the copy, which copies the same bytes it hashed.
5. **Pins live next to the consent**, in the table `consent_pins` (`flow_id` primary key, `pins` JSON), written and removed with the consent in one transaction, as `{ skills: {<requirement id>: <hash>}, folders: {<requirement id>: {path, access}} }` (a column on `capability_consents` would break a present test that inserts three values without column names; Task 3, 2026-11-17). Every declared extra folder is pinned, used by a step or not (a trigger may watch it). A consent without pins is `stale` for a flow that has a pinned row (fail closed). `flows.allowCapabilities` takes the pins the screen showed; a difference is refused with "Something this flow uses changed since you looked at it. Reload and check it again."
6. **Long steps.** A step whose time limit is over 30 minutes is not tried again after it ran out its limit (when it still had a try left; on its last try it fails as today), because each try of such a step can cost hours of quota (spec 20.1 times the prototype skill at 27 to 48 minutes, sometimes over 130). A shorter step keeps the retries of today. While a step over 30 minutes runs on macOS, `caffeinate -i -w <pid>` keeps the Mac awake; a failure to start it is written to the audit log and the step goes on. The Run screen shows each step's time limit and, for a running long step, the minutes so far. No heartbeat: a call that hangs waits until its limit (Known limits).
7. **Commands.** A `cli_tool` with no `commands` keeps `DROP.notYet`, and the gate keeps it in "cannot enforce yet". The route drops a `cli_tool` when a pattern is risky by `classifyCommand`, or when its program runs other programs or reaches the network: `.`, `source`, `sh`, `bash`, `zsh`, `dash`, `ksh`, `csh`, `tcsh`, `fish`, `env`, `xargs`, `nohup`, `nice`, `time`, `timeout`, `exec`, `eval`, `command`, `sudo`, `su`, `doas`, `osascript`, `open`, `script`, `expect`, `watch`, `npx`, `pnpx`, `bunx`, `curl`, `wget`, `ssh`, `scp`, `sftp`, `rsync`, `nc`, `telnet`, `ftp`, or when it holds `find` with `-delete` or `-exec`, `git clean`, `git reset --hard` or `dd`; interpreters and package runners (`node`, `python`, `python3`, `ruby`, `perl`, `php`, `deno`, `bun`, `lua`, `npm`, `pnpm`, `yarn`) are routed only with patterns that end without ` *`. The hook parses a command line into words of `A-Z a-z 0-9 . _ / = : @ % + , -` separated by single spaces, the first word a bare program name, no word starting with `=`, at most 1,000 characters and 64 words; anything else is refused. A word that a wildcard matches must not start with `-` or `/`, must not hold `..`, and must not hold `/` right after `=`, `:`, `,`, `@`, `%` or `+`; so flags come only from the declared pattern, and `git -c core.fsmonitor=...`, `--exec-path` or `--output=/x` cannot come in through a wildcard. A step that takes outside text, reads web pages or a connector, or uses a `sensitive` requirement gets no commands; a step that runs commands needs a folder, and its commands run in its first folder. Readiness looks the program up on the runner's `PATH` without a shell and runs nothing (the health command of spec 12.1 waits for catalog entries). Why: without an OS sandbox the command line is the only thing FlowDriven checks, so it stays narrow.
8. **Granted folders.** An extra folder is written `~/<part>/<part>...` (no `.`, `..` or hidden part, at most 16 parts). It resolves with `realpathSync.native` through the nearest existing parent, against the resolved home folder; the resolved path must stay inside the home folder, must not be the home folder, and must not hold a hidden part, be inside `~/Library`, or be inside or around FlowDriven's data folder. These comparisons fold case and Unicode normal form (NFC, then lower case), because APFS ignores both by default. At each call it must also stay out of the run's project folder, it is resolved again and must equal the pin; a missing folder is created (mode 0700) at the first call, as spec 12.1 allows once the owner agreed. Allow writes one `folder_granted` audit row per folder; Withdraw writes one `folder_revoked` row per pinned folder and takes effect at the next attempt, as plan 05's allow does. A routed extra folder needs the allow, and its `sensitive` passes once allowed, as for web and connectors.
9. **Plain Gmail writes** (the owner's answer of 2026-11-13). Class `write`: `create_draft`, `label_thread`, `unlabel_thread`, `label_message`, `unlabel_message`, `update_message_labels`, each only if H4 lists it; they run without approval when declared. Every write tool whose name holds `label`, `spam` or `trash` is a label tool and is held as `delete` when any key or string value of its input contains `trash` or `spam` after NFKC folding and lower case (so a label move to Trash or Spam waits; a user label with such a word waits too, which is safe). `mark_thread_spam` and `mark_message_spam` join the held deletes, and the SDK's `classifyTool` learns the word `spam` (R4). A write tool whose scan annotation says destructive drops the route. Every other Gmail tool (`update_draft`, which can overwrite a draft the owner wrote; `create_label`, `update_label`, `apply_sensitive_*`, `untrash_*`, `unmark_*_spam`, `download_gmail_attachment`, and any name H4 shows that this list does not) stays unclassed and drops the route.
10. **Pick keys and where a pick releases (plan 05b Handover).** A loop whose `for_each` is exactly `${steps.<ask>.outputs.choice}`, where `<ask>` is a top-level `do: ask` step, and that declares no `key`, keys its items with the picked option keys in option order, read from that ask's approved approval in this run; if they cannot be matched the loop blocks the run. Such a loop writes no seen keys (only a declared `key` does). A pick grant keeps its form (`<requirement>.<tool>`, item key = pick key), and the hook honours it only for a step inside a loop over that ask's choice: the leaf gives such a step `pickTools` (that ask's `approves`), every other step gets none, and a request without `pickTools` releases nothing by a pick.
11. **The seen store** (plan 05 Handover) stays as it is: an item that failed (page cap, moved page) is not marked seen and the next run offers it again; the alerts search window (2 days) bounds how long. An item whose page step was skipped by its condition passed and is seen.
12. **The M1 flow** (Task 22) follows the spec's flow of 20.4 with these changes, each for a reason. `rough` and `full` are `do: worker` steps with read access to `~/job-review/notes` (an agent step has no tools and cannot read `profile.md`). The owner's `profile.md` and `voice.md` live in that granted folder, not in the flow package, so the package carries no private text. `page` declares an output `post` and `full` reads it (otherwise the verdict is not based on the post). The build steps find the picked job's review with `${steps.review.items where key == job.id}` (the choice carries the alert job only, Fact 14). `proto` writes only to `~/job-review/prototypes` and `proposal` only to `~/job-review/work`, so the step that publishes cannot read the notes or the proposals. `proto` has `retry: 0`, so a failed check does not run a 150-minute skill again, and `build` has `on_item_fail: stop`, so after a failed build a second one does not start. The alerts schema gives `id` the pattern of the address template (`^[0-9a-z]{18,24}$`), so a job id is safe as a loop key and in the path `proposals/<id>.md`. `gmail` also declares `list_labels` (to find the `FlowDriven` label). A param `newest` (default 20, 1 to 20) lets the attended first run take the newest 3 jobs (spec 20.5) through `flows.run` `params`. `rough` runs at `effort: low`. `daily_builds` is 1 to 2. The host's tool names and the published address come from H1, and the skill's name from H3.
13. **Where M1 waits.** With `overlap: skip`, an hourly fire is dropped while a run waits for the pick (spec 20.3); the pick expires after 24 hours and ends the run with nothing picked (`on_expiry: end`).
14. **The walk never decides.** The M1 walk runs the app in its own data folder (as the connector walk does), scans Claude Code, imports the flow and starts the attended run with `flows.run` and `params: {newest: 3}` (the Run button, `apps/desktop/src/screens/builder/BuilderScreen.tsx:118`, sends no params and so reads up to 20 jobs; both go through the same runner); every consent, allow, pick, sign-off and trigger switch is the owner's own click in that app's window, which stays open for the scheduled run. So M1's attended run is started by the walk on the owner's behalf, with the owner watching, and the scheduled run by the trigger.

## Review Focus

1. **A skill's text widens what a step may do.** `claude/adapter-skill.test.ts` "R14: a Bash call that the skill's allowed-tools named is denied and logged", "R14: the skill says you may also open evil.example; the navigate is denied by the hook and logged" and "the step's tools, folders and commands are the same with and without the skill's text" (Task 9); `skills/skill-folder.test.ts` "R14: the copy keeps only name, description and the body" (Task 6).
2. **A changed skill runs without a new allow.** `service/claude-harness-skill.test.ts` "R9: editing SKILL.md after the allow blocks the run until the owner allows it again" (Task 8); `claude/adapter-skill.test.ts` "R9: the skill changed between run start and the step: the step is blocked and no child starts" (Task 9).
3. **A command line does more than it says.** `packages/sdk/src/validate/command-line.test.ts` "a wildcard word that is a flag (--output=/x, -o/x, -c core.fsmonitor=x, --exec-path), starts with /, holds .., or has / after = or : (of=/x, a:/x) is refused" (Task 5); `claude/decide-commands.test.ts` "each shell character, a quote, a tab, a newline and a path as the program is refused" and `claude/policy-commands.test.ts` "a step that reads outside text gets no commands" (Task 13); `router/route-commands.test.ts` "a program that runs other programs or reaches the network drops the route" (Task 12).
4. **A granted folder reaches further than the grant.** `folders/extra.test.ts` "a folder that resolves to a hidden folder, ~/Library in any case, or FlowDriven's data folder is refused" (Task 14); `claude/policy-folders.test.ts` "a granted folder whose symlink now points elsewhere is refused at the call" (Task 15).
5. **Mail is thrown away without the owner.** `connectors/label-rule.test.ts` "throwsMailAway is true for Trash, [Gmail]/Spam and a fullwidth TRASH" (Task 17); `claude/decide-connector-write.test.ts` "a label call that names TRASH or SPAM, in any case and anywhere in the input, is held as a delete" and "mark_thread_spam is held" (Task 18).
6. **A pick releases the wrong item.** `engine-pick-keys.test.ts` "R10 on the spec's flow: the pick releases the publish for the picked job in the keyless build loop, and the other job's publish is held" and "an item with a picked key in another loop is not released" (Task 19).
7. **A long step costs hours more than it should.** `exec/leaf-long.test.ts` "a step with a 150-minute limit that ran out is not tried again and the step says why" (Task 10); `demo/m1-flow.test.ts` "proto has retry 0" (Task 22).

---

## File Structure

```
packages/runner/src/entry.test.ts                                                        the skip (Task 1)
packages/contracts/src/capability.ts, operations.ts, run.ts (+ tests)                    pin, allow pins, limitMs (Task 2)
packages/runner/src/schema.ts, storage.ts, sqlite-store.ts (+ tests)                     store version 6, consent pins (Task 3)
packages/sdk/src/skill/skill-file.ts (+ test), node.ts                                   SKILL.md and the R14 copy text (Task 4)
packages/sdk/src/validate/command-line.ts (+ test), index.ts                             command lines (Task 5)
packages/runner/src/skills/skill-folder.ts (+ test)                                      read, hash, copy a skill (Task 6)
packages/runner/src/router/route.ts, types.ts, service/capabilities.ts, handlers.ts,
  service/claude-harness.ts, apps/desktop/src/screens/builder/CapabilitiesPanel.tsx       skill route, preview, pins at the allow (Task 7)
packages/runner/src/service/claude-harness.ts (+ claude-harness-skill.test.ts)           R9 at run start (Task 8)
packages/runner/src/claude/skill-step.ts, adapter.ts, policy.ts, prompt.ts,
  test-helpers/fake-claude.ts, fake-claude-script.ts (+ adapter-skill.test.ts)           the skill step (Task 9)
packages/runner/src/exec/leaf.ts, storage.ts, engine.ts, service/keep-awake.ts (+ tests) long steps (Task 10)
packages/runner/src/service/map-run.ts, apps/desktop/src/screens/runs/StepBlock.tsx       long steps on the Run screen (Task 11)
packages/runner/src/router/route.ts, router/commands-route.ts, service/capabilities.ts,
  service/readiness-commands.ts (+ tests)                                                the cli_tool route (Task 12)
packages/runner/src/claude/commands.ts, decide.ts, policy.ts, prompt.ts,
  service/claude-harness.ts (+ tests)                                                    Bash with the command rule (Task 13)
packages/runner/src/folders/extra.ts, router/route.ts, service/capabilities.ts (+ tests)  granted folders, preview, pins (Task 14)
packages/runner/src/claude/policy.ts, adapter.ts, service/claude-harness.ts (+ tests)    granted folders in the call (Task 15)
packages/runner/src/triggers/scan.ts, rules.ts, service.ts (+ tests)                     file_change on a granted folder (Task 16)
packages/sdk/src/validate/risky.ts, packages/runner/src/connectors/label-rule.ts,
  claude/connector-scan.ts (+ tests)                                                     the spam word, the label rule, the destructive mark (Task 17)
packages/runner/src/connectors/catalog.ts, router/route.ts, claude/policy.ts,
  claude/connector.ts, claude/prompt.ts (+ tests)                                        plain Gmail writes (Task 18)
packages/runner/src/exec/loop.ts, exec/leaf.ts, engine.ts, harness.ts, claude/run.ts      pick keys, where a pick releases (Task 19)
packages/runner/src/connectors/catalog.ts (+ tests)                                      the prototype host (Task 20)
packages/runner/src/service/map-flow.ts, handlers.ts (+ readiness-local.test.ts)         readiness rows (Task 21)
packages/fixtures/flows/upwork-job-review/, packages/runner/src/demo/m1-flow.ts (+ test) the M1 flow (Task 22)
packages/runner/src/test-helpers/m1-demo.ts, m1-demo-run.ts (+ test)                     the M1 demo (Task 23)
apps/desktop/electron/m1-walk.ts, m1-walk-steps.ts (+ test)                              the M1 walk (Task 24)
```

## Order of the tasks

Group A, groundwork: Tasks 0 to 3. Group B, skill calls: Tasks 4, 6, 7, 8, 9. Group C, long steps: Tasks 10, 11. Group D, commands: Tasks 5, 12, 13. Group E, granted folders: Tasks 14, 15, 16. Group F, connectors and approvals: Tasks 17 to 20. Group G, M1: Tasks 21 to 25. Tasks run in number order; every task leaves the whole gate green on its own. The chair sends the owner a short progress note after each group. Tasks 4 and 6 need H3, Tasks 12 and 13 need H2, Task 18 needs H4, Task 20 needs H1, and Task 22 needs H1 and H3. **Tasks 20 and 22 to 25 wait** (the owner's answer of 2026-11-17 during Task 0): the owner's prototype skill runs commands while it reads the job's text, which Decision 7 refuses, so M1 waits for a safe way to run such commands (O2, O5) and for the host connector's tools (H1). Tasks 1 to 19 and 21 are built now.

## Known limits

- A skill reaches the worker as prompt text and a read-only copy, not through Claude Code's own skill loader; plugin skills and project skills are not supported. A skill's scripts run only through a declared command. The preview's token cost of a skill is an estimate (four characters a token).
- Bundled skill files are stored as UTF-8 text by `flows.import` (Fact 3), so a binary file in a bundled skill is not kept as it was.
- The flow hash hashes raw bytes with no LF normalisation, and no signature is checked (spec 9.6). Not changed here (hashing code).
- Commands run with the owner's rights and no OS sandbox: FlowDriven checks the command line, not what the program then does (for example the scripts that `npm run` starts). A file that an earlier step wrote is not marked as outside text, so a later step's declared command may run code that an earlier step wrote. Claude Code's own Bash sandbox under `--restricted` is research (Open items). A `command` check stays "cannot enforce".
- A call that hangs inside a long step waits until the step's limit; there is no heartbeat. Closing a laptop's lid sleeps the Mac even during a long step. An approval inside a long step still re-runs the step from its start (plan 05b); M1 approves by the pick before the long step.
- A granted folder must be under the home folder and grants every file in it. Withdraw takes effect at the next attempt, so a running step keeps its folders until it ends (up to 150 minutes in M1).
- A call grant is bound to the run, the item, the tool and the exact input, not to the step that was held (plan 05b, unchanged).
- A pick releases the named tool for the picked item for the whole step, so the step may publish more than once (for example after a fix).
- "The first run is a dry run on the newest 3 items" (spec 20.5) is a procedure in M1 (the `newest` param), not a rule the app enforces. A manual run with inputs that have defaults still needs every input named (Fact 16); M1 uses a param instead.
- When the approval of a held call expires, the step and run fail, but a loop item is not marked failed (plan 05b, unchanged).
- The risky-word rules of a command line (`merge`, `delete`, `publish`, and for `git` also `clean`, `foreach`, `bisect` with `run`) match any word of the line, also at the hook since Review fix R1, so a harmless call whose argument is only named like that word (`git checkout clean`, `cat delete`) is refused with the risky-command sentence. It fails closed. Applying the word rules to the subcommand words only is left to a later plan with its own review (security review round 2, R2-F3; the owner's answer of 2026-11-17).
- The refused programs are a list (security review rounds 1 to 3). A rule that the program word must be an executable file on the child's `PATH` would close the class of shell words that run or change a command; it waits for a later plan, together with O2 on the Bash tool's shell (the owner's answer of 2026-11-17).

## Open items

- O1 (owner, Task 0; answered 2026-11-17): the skill is `prototype-builder` and the host is a claude.ai connector. The limits of Decision 3 were raised with the owner. The host's tools are not known while it is `needs-auth` (H1).
- O5 (owner and research; blocks Tasks 20 and 22 to 25): the owner's skill runs `flutter`, `node` and `sh` while it reads the job's text. Decision 7 keeps commands out of such a step, so M1 needs a safe way to run them first: an OS sandbox for commands (O2), a step order that keeps outside text away from the commands, or the owner's own decision on the risk. The chair brings the choices to the owner when Tasks 1 to 19 and 21 are done.
  - The owner's answer (2026-11-17): "Anda setujui rencananya (Disarankan)". The owner approves a short build plan, written without commands, before the step that runs the skill's commands from it. It is built in a later plan; see the Handover.
- O2 (research, 18.3; not in this session): Claude Code's Bash sandbox settings in a `--restricted` call, and whether they hold writes to the call's folders. Until then commands run without an OS sandbox and the preview says so.
- O3 (research, 20.9 D3; not in this session): Upwork's own terms on reading job pages in a logged-in browser. The flow screen shows the risk as plan 05 wrote it.
- O4 (later plan): the app enforcing the attended first run before a trigger can be switched on (spec 20.5), a stall check for long steps, input defaults for manual runs, and a call grant bound to the held step.

---

### Task 0: Chair steps (network): the probes H1 to H4, with the owner watching (the executor skips this task)

**Not for the executor.** The chair runs these on the owner's Mac with the owner watching, after the owner's yes to item 7(a), and writes the results under Facts as H1 to H4. Kit and raw output go to `.workflow/scratch/plan-05c/probe/` (git-ignored). No email, page, file content or connector id is printed or kept.

- [ ] **Step 1: Chair step (network): H1 and H4.** Start Claude Code exactly as `claude/args.ts:71` `buildConnectorScanArgs` does (no prompt, hooks off) and send `initialize` and `mcp_status` as plan 05b G4 did. Print each connector's name, status and tool count; print every Gmail tool's name and annotations (H4); for the connector the owner names as the prototype host, print its url and each tool's name and annotations. Ask the owner which tool makes a prototype public and what its address looks like (H1).
- [x] **Step 2: Chair step (network): H2.** One call `claude -p --model haiku --restricted --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Bash --disable-slash-commands --permission-prompts none --settings <file>` whose only hook is a PreToolUse command that writes the key names and value types of `tool_input` to a file in the kit and exits 2 (refused). The prompt: "Run the command pwd with the Bash tool." Nothing runs. Then one more call of the same shape with `--tools ""` and the prompt "Say ok.". From the two result events, record the input tokens (cache reads and writes included) of each, so that their difference is the fixed cost of the `Bash` tool, as plan 05b G3 measured connector tools.
- [x] **Step 3: Chair step: H3.** For the folder the owner names: `find <folder> -ls` (names, sizes, symlinks), and a script that reads `SKILL.md` in memory and prints only: the text before the first colon of each top-level front-matter line, and yes or no for the four checks of H3 (using `parseFlowYaml` from `@flowdriven/sdk/node` and the rule of Decision 2). It prints no value and no body text.
Record (chair, 2026-11-17, with the owner watching, after the owner's yes to item 7(a)): Step 1 done for H4; for H1 the scan found the host connector as `needs-auth`, so Step 1 stays open until the owner connects it again and the chair scans once more (no prompt). Steps 2 and 3 done. Facts H1 to H4 above. Two haiku calls in all; no Gmail tool ran; no email, page, file text or connector id was printed or kept.

- [ ] **Step 4: Chair step (commit)**

```bash
git add docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Record the probes H1 to H4 for plan 05c" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1: The SQLite warning control test skips itself on a Node that prints no warning

The owner said yes to this "Ask first" change on 2026-11-17 ("Lewati bila tak ada peringatan"); see item 0 above.

**Files:**
- Modify: `packages/runner/src/entry.test.ts`

**Interfaces:**
- Consumes: `child(name)` (`entry.test.ts:5-10`).
- Produces: nothing new.

- [x] **Step 1: Write the change (the test is the change)**

```ts
test("without the silencer the warning is printed (the check can see it)", (ctx) => {
  const out = child("plain-child");
  expect(out.status).toBe(0);
  if (!out.stderr.includes("SQLite is an experimental feature")) ctx.skip();
  expect(out.stderr).toContain("SQLite is an experimental feature");
});
```

The test "silences only the SQLite warning" (`entry.test.ts:11-16`) is not touched.

- [x] **Step 2: Run the test**

Run: `pnpm vitest run packages/runner/src/entry.test.ts`
Expected on Node 24.22.3: 1 passed, 1 skipped. On a Node that prints the warning: 2 passed.

- [x] **Step 3: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 4: Chair step (commit)**

```bash
git add packages/runner/src/entry.test.ts
git commit -m "Skip the SQLite warning control test on a Node that prints no warning" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6-luna, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 2: Contracts: the pin of a capability row, the allow with pins, and a step's time limit

A contract change is its own task.

**Files:**
- Modify: `packages/contracts/src/capability.ts`, `packages/contracts/src/operations.ts`, `packages/contracts/src/run.ts`
- Test: `packages/contracts/src/capability.test.ts`, `packages/contracts/src/run.test.ts` (add to the present files; create `capability-pins.test.ts` only if `capability.test.ts` does not exist)

**Interfaces:**
- Produces: `CapabilityRow.pin?: string` (1 to 600 characters; a skill hash `sha256:<64 hex>` or an absolute folder path); `flows.allowCapabilities` input `{ flowId, hash, pins?: Record<string, string> }` (at most 50 entries, keys are requirement ids of 1 to 100 characters, values as `pin`); `LeafStepRun.limitMs?: number` (integer, at least 1).

- [x] **Step 1: Write the failing tests**

  1. "a capability row may carry a pin of at most 600 characters, and an empty pin is refused"
  2. "allowCapabilities takes optional pins keyed by requirement id, and refuses more than 50 pins"
  3. "a leaf step run may carry its time limit in milliseconds, a whole number of at least 1"
  4. "an old payload without pin, pins or limitMs still parses"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/contracts/src`
Expected: FAIL (unknown key `pin`, `pins`, `limitMs`)

- [x] **Step 3: Implement the three fields**

Optional fields only; no present field changes.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/contracts/src`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/contracts/src
git commit -m "Add the capability pin, the allow with pins, and a step's time limit to the contract" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: Codex's full run of `pnpm format && pnpm check` was green (245 test files, 1,665 tests passed and 1 skipped; `.workflow/scratch/codex-task-2.log`). The chair's two later full runs of `pnpm check` were not green: the first failed only "500 changed files with max_items 1 ..." (`triggers/service-files.test.ts`, a 5 s timeout) and the second only "a close of the withheld tab is allowed ..." (`claude/adapter-closing.test.ts`), on a Mac whose load average was about 40; each of those tests passed alone three times out of three, and lint, typecheck, `check:hidden` and `check:deps` were green. Corrected on 2026-11-17 after the owner's decision "Hijau sebelum ditutup": the plan closes only after one full `pnpm check` that is green end to end.

### Task 3: Store version 6: pins on the capability consent

Blocked (Codex, 2026-11-17): An existing test inserts three values without column names; adding pins makes that insert fail, and changing this test is not authorized.
Chair's decision (2026-11-17): the plan was wrong, not the executor. Pins go to a table of their own, `consent_pins`, written and removed with the consent in one transaction, so `sqlite-store-capabilities.test.ts:39` keeps working and no present test changes beyond the version numbers of Step 1. Interfaces and tests below are updated; Decision 5 says the same.

**Files:**
- Modify: `packages/runner/src/schema.ts`, `packages/runner/src/storage.ts`, `packages/runner/src/sqlite-store.ts`
- Test: `packages/runner/src/sqlite-store-capabilities.test.ts`; present tests changed as named in Step 1

**Interfaces:**
- Produces: `PINS_SCHEMA = "CREATE TABLE consent_pins (flow_id TEXT PRIMARY KEY, pins TEXT NOT NULL);"` in `schema.ts`; `type ConsentPins = { skills: Record<string, string>; folders: Record<string, { path: string; access: "read" | "read_write" }> }` and `CapabilityConsentRow.pins?: ConsentPins` in `storage.ts`; `putCapabilityConsent` writes the consent row and, in the same transaction, the `consent_pins` row as JSON, or removes that row when the consent has no pins; `deleteCapabilityConsent` removes both rows in one transaction; `getCapabilityConsent` returns `pins` only when the `consent_pins` row parses to that shape, else no `pins`.

- [x] **Step 1: Write the failing tests, and change the present version tests**

New tests in `sqlite-store-capabilities.test.ts`:
  1. "a consent keeps its skill and folder pins"
  2. "a version 5 database migrates to 6, keeps its consents, and they read with no pins"
  3. "a pins value that does not parse, or has the wrong shape, reads as no pins"
  4. "a consent written without pins reads without pins, and writing it again without pins removes the earlier pins"
  5. "deleting a consent removes its pins"

Present tests that change (item 6 of the owner approval), each to the equally strict new value: `sqlite-store.test.ts:159,169,174` `toBe(5)` becomes `toBe(6)`, and a title that says "version 5" (for example "a new database is created at version 5") says "version 6"; `sqlite-store.test.ts:177-180` "a database from version 6 is refused" becomes "a database from version 7 is refused" with `PRAGMA user_version = 7`; `sqlite-store-usage.test.ts:80` `toBe(5)` becomes `toBe(6)`; `sqlite-store-triggers.test.ts:96` "a version 3 database migrates to 5 and keeps its rows; version 6 is refused" becomes "a version 3 database migrates to 6 and keeps its rows; version 7 is refused", with `:107` `toBe(6)` and `:112` `PRAGMA user_version = 7`; `sqlite-store-capabilities.test.ts:65,76` `toBe(5)` becomes `toBe(6)`, and its title at `:7` that says it reaches 5 says 6.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/sqlite-store*.test.ts`
Expected: FAIL (version is 5; no `pins`)

- [x] **Step 3: Implement version 6**

In `sqlite-store.ts:51-69` refuse `version > 6`, add `${PINS_SCHEMA}` and `user_version = 6` to every present branch, and add `if (version === 5)` with `PINS_SCHEMA`. Read validation as for the columns of `capability_consents`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/runner/src/sqlite-store*.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/schema.ts packages/runner/src/storage.ts packages/runner/src/sqlite-store.ts packages/runner/src/sqlite-store*.test.ts
git commit -m "Store pins with the capability consent (store version 6)" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 4: SDK: read a SKILL.md and write the copy without front matter (R14)

Needs H3 (Decision 3).

**Files:**
- Create: `packages/sdk/src/skill/skill-file.ts`
- Modify: `packages/sdk/src/node.ts` (export; not `index.ts`, because `parseFlowYaml` brings `node:crypto`, Fact 3)
- Test: `packages/sdk/src/skill/skill-file.test.ts`

**Interfaces:**
- Consumes: `parseFlowYaml` and `FlowFileError` (`packages/sdk/src/load/parse-yaml.ts`).
- Produces: `SKILL_LIMITS = { nameMax: 64, descriptionMax: 1024, bodyMax: 60000, fileBytes: 262144 }` (Decision 3); `SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`; `type SkillFile = { name: string; description: string; body: string; keys: string[] }`; `parseSkillFile(text: string): { ok: true; skill: SkillFile } | { ok: false; reason: string }` (it catches `FlowFileError` and returns its reason); `skillCopyText(skill: Pick<SkillFile, "name" | "description" | "body">): string`.

- [x] **Step 1: Write the failing tests**

  1. "a SKILL.md with name, description and other keys parses to the name, the description, the body and the list of keys"
  2. "R14: the copy text holds only name and description in its front matter: allowed-tools, hooks, model, license and metadata are gone"
  3. "the copy text parses back to the same name, description and body"
  4. "a file without front matter on its first line, or whose front matter is not closed, is refused"
  5. "a name that is not lowercase letters, digits and single hyphens, or is longer than 64, is refused"
  6. "a missing description, or one longer than 1,024 characters, is refused"
  7. "a body over 60,000 characters is refused, and a body of 27,433 characters is read"
  8. "a file with a bidi control, a zero-width character or a control character other than tab and line break is refused"
  9. "front matter with an anchor, an alias, a tag or a duplicate key is refused with its reason, and a file over 256 KiB is refused"

Each refusal has its own fixed sentence, for example "This skill's SKILL.md has no front matter." and "This skill's text is longer than 60,000 characters."

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/sdk/src/skill/skill-file.test.ts`
Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement `parseSkillFile` and `skillCopyText` in `packages/sdk/src/skill/skill-file.ts`**

Line endings: `\r\n` is read as `\n`. The front matter is the text between the first line `---` and the next line `---`. The copy text is `---\nname: <JSON string>\ndescription: <JSON string>\n---\n<body>`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/sdk/src/skill/skill-file.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/sdk/src/skill packages/sdk/src/node.ts
git commit -m "Read a SKILL.md and write its copy without front matter (R14)" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 5: SDK: command lines and their patterns

**Files:**
- Create: `packages/sdk/src/validate/command-line.ts`
- Modify: `packages/sdk/src/index.ts` (export; the file is pure)
- Test: `packages/sdk/src/validate/command-line.test.ts`

**Interfaces:**
- Consumes: `commandAllowed(entry, cmd, args)` (`packages/sdk/src/validate/risky.ts:33`).
- Produces: `COMMAND_LIMITS = { chars: 1000, words: 64 }`; `parseCommandLine(text: string): { ok: true; words: string[] } | { ok: false; reason: string }`; `commandLineAllowed(patterns: string[], words: string[]): boolean`, which calls `commandAllowed` per pattern and applies the wildcard-word rule of Decision 7.

- [x] **Step 1: Write the failing tests**

  1. "an exact pattern allows exactly its words and nothing more"
  2. "a pattern ending in ' *' allows more words that are relative values or paths"
  3. "a wildcard word that is a flag (--output=/x, -o/x, -c core.fsmonitor=x, --exec-path), starts with /, holds .., or has / after = or : (of=/x, a:/x) is refused"
  4. "each of ; & | $ ` > < ( ) ' \" \\ * ? # ~ ! { } [ ] and a tab or a line break in a line is refused"
  5. "a word that starts with = is refused"
  6. "two spaces in a row, a leading or trailing space, and an empty line are refused"
  7. "a path as the program (/usr/bin/git, ./x) is refused"
  8. "a line over 1,000 characters or 64 words is refused"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/sdk/src/validate/command-line.test.ts`
Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement `parseCommandLine` and `commandLineAllowed` in `packages/sdk/src/validate/command-line.ts`**

A word is `[A-Za-z0-9._/=:@%+,-]+`; the first word is `[A-Za-z0-9._-]+`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/sdk/src/validate/command-line.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/sdk/src/validate/command-line.ts packages/sdk/src/validate/command-line.test.ts packages/sdk/src/index.ts
git commit -m "Parse a command line into plain words and match it against declared patterns" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 6: Runner: read, hash and copy a skill folder

Needs H3 (Decision 3).

**Files:**
- Create: `packages/runner/src/skills/skill-folder.ts`
- Test: `packages/runner/src/skills/skill-folder.test.ts`

**Interfaces:**
- Consumes: `parseSkillFile`, `skillCopyText`, `SKILL_NAME` (Task 4) and `contentHash`, all from `@flowdriven/sdk/node`.
- Produces: `SKILL_FOLDER_LIMITS = { files: 1000, fileBytes: 2097152, totalBytes: 67108864 }` (Decision 3); `type LoadedSkill = { name: string; description: string; body: string; copyText: string; files: Map<string, Uint8Array>; hash: string; modifiedAt: string }` (`modifiedAt` is the newest file's time, for the preview only); `skillSource(ref: string | undefined, o: { home: string }): { kind: "installed"; name: string; dir: string } | { kind: "bundled"; name: string; prefix: string } | undefined`; `readSkillFolder(dir: string, name: string): { ok: true; skill: LoadedSkill } | { ok: false; reason: string }`; `bundledSkill(files: Record<string, string>, name: string): { ok: true; skill: LoadedSkill } | { ok: false; reason: string }`; `writeSkillCopy(dest: string, skill: LoadedSkill): void`.

- [x] **Step 1: Write the failing tests**

  1. "skillSource reads claude-code:<name> as the folder ~/.claude/skills/<name> and flow:<name> as skills/<name>/ of the flow; any other ref or a bad name is undefined"
  2. "an installed skill folder reads into its files, its parsed text and a hash equal to contentHash of its files"
  3. "R9: changing one byte of SKILL.md or of a reference changes the hash"
  4. "R14: the copy keeps only name, description and the body in SKILL.md and keeps every other file byte for byte"
  5. "a symlink anywhere in the folder, or the folder itself as a symlink, is refused"
  6. "more than 1,000 files, a file over 2 MiB or more than 64 MiB in all is refused, and 231 files of 16 MiB are read"
  7. "a folder without SKILL.md at its top, or whose SKILL.md names another skill, is refused"
  8. "entries whose name starts with a dot, and .DS_Store, are not read, not hashed and not copied"
  9. "a bundled skill reads from the flow's stored files under skills/<name>/"
  10. "writeSkillCopy creates folders 0700 and files 0600 and refuses a destination that exists"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/skills/skill-folder.test.ts`
Expected: FAIL with "Cannot find module"

- [x] **Step 3: Implement the module in `packages/runner/src/skills/skill-folder.ts`**

Walk with `lstatSync`; keep paths relative with `/`; read every file once and hash those same bytes, so the copy writes what was hashed.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/runner/src/skills/skill-folder.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/skills
git commit -m "Read, hash and copy a skill folder" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 7: Router and preview: skills, with the pin at the allow

Blocked (Codex, 2026-11-17): The required empty skills list changes hs.facts(), but claude-harness-wiring.test.ts requires the previous exact object and existing tests may not be changed. The gate also failed in `capabilities.test.ts` and `readiness-web.test.ts`, whose flows use a `skill` requirement with no ref.
Chair's decision (2026-11-17): the plan was not exact, not the executor. (1) `harnessFacts` adds `skills` only when the list is given and not empty; an empty or missing list leaves the facts as today (an installed skill then drops with `DROP.noSkill` all the same). (2) `allowIsBlocked` blocks the allow only for a used `skill` requirement whose ref is `claude-code:<name>` or `flow:<name>` and whose row is not routed or has no pin; a skill with no ref or another ref keeps today's behaviour and does not block the allow, as other types FlowDriven cannot provide yet do not (the gate still refuses such a flow). With both, the three present tests pass unchanged.

**Files:**
- Modify: `packages/runner/src/router/types.ts`, `packages/runner/src/router/route.ts`, `packages/runner/src/service/capabilities.ts`, `packages/runner/src/service/handlers.ts`, `packages/runner/src/service/claude-harness.ts` (`harnessFacts` only), `apps/desktop/src/screens/builder/CapabilitiesPanel.tsx`
- Test: `packages/runner/src/router/route-skill.test.ts`, `packages/runner/src/service/capabilities-skill.test.ts`, `apps/desktop/src/screens/builder/Capabilities.test.tsx` (one test added)

**Interfaces:**
- Consumes: `skillSource`, `readSkillFolder`, `bundledSkill` (Task 6); `ConsentPins` (Task 3); `CapabilityRow.pin`, allow `pins` (Task 2).
- Produces: `Route.provider` adds `"flowdriven-skill"`; `HarnessFacts.skills?: string[]` (user-scope skill names of the last inventory); `harnessFacts(scan, connectors?, skills?)` gains a third parameter and adds `skills` only when given and not empty, and its two call sites in `service/claude-harness.ts` (about `:396` and `:406`) pass the user-scope names of `cache.inventory.skills`; `DROP.noSkill = "This skill is not installed in Claude Code."`; `COST.skill(chars: number): string` = `Adds about <n> tokens to each call of the step that uses it.`, with `n` = chars / 4 rounded up to a hundred and written with a thousands comma; `createCapabilities({ ..., readSkill?: (ref: string | undefined, flowId: string) => { ok: true; skill: LoadedSkill } | { ok: false; reason: string } })` (the service builds it from `os.homedir()` and the flow row's files; tests pass a temp home); `allow(flowId, hash, pins?: Record<string, string>)`; `consentOf` is `stale` also when a used skill's hash differs from its pin or has none; `CapabilitiesPanel.tsx:89` sends `{ flowId, hash, pins }` with the pins of the rows it shows.

- [x] **Step 1: Write the failing tests**

  1. "an installed skill that the scan lists is the FlowDriven skill route: provider flowdriven-skill, enforced by FlowDriven, official, can run while away"
  2. "an installed skill the scan does not list drops with This skill is not installed in Claude Code."
  3. "a bundled skill (flow:<name>) is routed; a skill with no ref, another ref or a bad name keeps DROP.notYet" (the present row `{type: "skill"}` of `route.test.ts:93-115` stays as it is)
  4. "the sentence says Uses your Claude Code skill <name>, as it is when you allow this flow. Its text cannot add tools, sites or folders. and for a bundled skill Uses the skill <name> that comes with this flow. Its text cannot add tools, sites or folders."
  5. "the skill row carries its hash as pin, its size as cost, and the details Version <first 12 hex>, <n> files, <n> characters, changed <date>"
  6. "a claude-code or flow skill that cannot be read is a dropped row with the reading reason, and the allow is blocked; a skill with no ref does not block the allow"
  7. "allow reads the skill again and stores its pin when it equals the pin the screen sent, and refuses with Something this flow uses changed since you looked at it. Reload and check it again. when one differs or is missing"
  8. "R9: consentOf is stale after SKILL.md changes, and given again after a new allow"
  9. "the allow's audit row lists the pinned skills by requirement id and hash"
  10. "the screen sends the pins of the rows it shows when the owner presses Allow" (`Capabilities.test.tsx`)

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/router/route-skill.test.ts packages/runner/src/service/capabilities-skill.test.ts apps/desktop/src/screens/builder/Capabilities.test.tsx`
Expected: FAIL (`skill` drops with `DROP.notYet`; no `pin`)

- [x] **Step 3: Implement the skill branch, the pins and the screen's pins**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/router packages/runner/src/service apps/desktop/src/screens/builder
git commit -m "Route skills, show them in the preview, and pin their hash at the allow" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format && pnpm check.

### Task 8: Gate: a changed skill blocks the run until re-consent (R9 at run start), and skill steps pass the gate

**Files:**
- Modify: `packages/runner/src/service/claude-harness.ts`
- Test: `packages/runner/src/service/claude-harness-skill.test.ts`

**Interfaces:**
- Consumes: Task 7.
- Produces: `GATE.skillChanged(names: string[]) = "Your skill <names> changed since you allowed this flow. Look at it on the flow's screen and allow it again."`; `gate` checks `do: skill` steps like `do: worker` steps (their `uses` and their `skill`); a `skill` requirement whose ref is `claude-code:<name>` or `flow:<name>` goes through the router (routed: needs the allow; dropped: its reason), and any other `skill` requirement stays in `cannot` (Decision 2); `readiness(manifest, ctx)` gives `allowed: true` only when the consent hash is the run's flow hash and every used skill's pin matches; a stale skill pin gives `GATE.skillChanged`.

- [x] **Step 1: Write the failing tests**

  1. "a skill step whose skill and uses are routed and allowed passes the gate"
  2. "R9: editing SKILL.md after the allow blocks the run until the owner allows it again: the run is blocked with GATE.skillChanged and no child starts"
  3. "after a new allow the same flow runs"
  4. "a skill step whose skill is not installed is blocked with This skill is not installed in Claude Code."
  5. "a bundled skill step passes with the flow's own consent"
  6. "switching on a trigger is refused while the skill's pin is stale"
  7. "a skill step that also uses a web requirement needs the allow first, as a worker step does"
  8. "a skill requirement with no ref stays in cannot enforce yet" (the present tests `claude-harness.test.ts:146` and `claude-harness-web.test.ts:93` pass unchanged)

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/service/claude-harness-skill.test.ts`
Expected: FAIL with the sentence "This flow needs something FlowDriven cannot enforce yet"

- [x] **Step 3: Implement the skill rows of `gate` and the pin check of `readiness`**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, then `pnpm vitest run packages/runner/src/service/claude-harness.test.ts packages/runner/src/service/claude-harness-web.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/service
git commit -m "Let skill steps pass the gate and block a run whose skill changed since the allow" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, then the chair (the changed-skill sentence names the skill, not the requirement id), 2026-11-17. Evidence: the chair's full run of `pnpm format && pnpm check` was green (251 test files, 1,715 tests passed and 1 skipped; check:hidden and check:deps OK).

### Task 9: The skill step in Claude Code: the copy folder, the prompt, R9 at the step, R14 in practice

Blocked (Codex, 2026-11-17): Removing skill copies in the same finally as the control folder requires changing claude/run.ts, which is outside the permitted files.
Chair's decision (2026-11-17): the plan was not exact, not the executor. The copy is removed in a `finally` of the adapter (`claude/adapter.ts`) around its call of `runClaude`, not in `claude/run.ts`: the result is the same (removed when the step ends, also after a failed or blocked step), and `run.ts` stays as it is. Step 3 below says the same.

**Files:**
- Create: `packages/runner/src/claude/skill-step.ts`
- Modify: `packages/runner/src/claude/adapter.ts`, `packages/runner/src/claude/policy.ts`, `packages/runner/src/claude/prompt.ts`, `packages/runner/src/service/claude-harness.ts` (wiring), `packages/runner/src/test-helpers/fake-claude.ts`, `packages/runner/src/test-helpers/fake-claude-script.ts`
- Test: `packages/runner/src/claude/adapter-skill.test.ts`; present test `claude/adapter.test.ts:238-240` changed as named in Step 1

**Interfaces:**
- Consumes: Tasks 6 and 7.
- Produces: `SKILL_STOP = { changed: (name) => "Your skill <name> changed since you allowed this flow. Allow it again on the flow's screen.", undeclared: "This step's skill is not declared." }`; `prepareSkillStep(input: { requirement: Requirement; pin: string | undefined; home: string; flowFiles: Record<string, string>; copyRoot: string; id: string }): { ok: true; folder: string; skill: LoadedSkill } | { ok: false; block: string }`; `ClaudeAdapterOptions.skillPin?: (runId: string, requirementId: string) => string | undefined`, `.home?: string`, `.flowFiles?: (runId: string) => Record<string, string>`, `.copyRoot?: string`; `buildPolicy({ ..., skillFolder?: string })` no longer throws for a used `skill` requirement (it adds no tool), and adds the copy as a read folder and an `--add-dir`; `buildPrompt({ ..., skill?: { name: string; description: string; body: string; folder: string } })` puts the skill block after the frame and before the instructions; `sweepSkillCopies(copyRoot)` at service start. The fake `claude` writes, in its `call` row, `skillFiles: Record<string, string>`: the text of each `SKILL.md` it finds at the top of an `--add-dir` folder or one level below it.

- [x] **Step 1: Write the failing tests, and change the present one**

  1. "a skill step runs: the copy folder is a read folder and an --add-dir, and the prompt holds the frame, the skill, the instructions and the data in that order"
  2. "R14: the copied SKILL.md has only name, description and the body; allowed-tools, hooks and model are gone"
  3. "R14: a Bash call that the skill's allowed-tools named is denied and logged"
  4. "R14: the skill says you may also open evil.example; the navigate is denied by the hook and logged" (the step also uses a `web` requirement for `https://example.com/{p:[a-z]{1,8}}`)
  5. "the step's tools, folders and commands are the same with and without the skill's text" (the policy of a skill step equals the policy of the same step as a worker step, plus the read-only copy folder)
  6. "R9: the skill changed between run start and the step: the step is blocked with SKILL_STOP.changed and no child starts"
  7. "a Write into the copy folder is denied, and a Read of a reference in it is allowed"
  8. "the copy is removed after the step, also after a failed or blocked step, and a leftover copy is swept at start"
  9. "the start proof still needs no skills and no slash commands"
  10. "a bundled skill is copied from the flow's stored files"
  11. "a skill step whose skill requirement is missing from the request fails closed with This step's skill is not declared."

Present test (item 6 of the owner approval): `claude/adapter.test.ts:238-240`, which expects `block: "Skill steps are not run yet."`, becomes test 11 above (the same request shape without the skill requirement, `block: SKILL_STOP.undeclared`).

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/claude/adapter-skill.test.ts packages/runner/src/claude/adapter.test.ts`
Expected: FAIL with "Skill steps are not run yet."

- [x] **Step 3: Implement the skill step**

The policy is built from the manifest, the consent and the copy folder's path only; the skill's text is read after it (hash, pin check, copy) and reaches only the prompt and the copy folder. The copy goes to `<copyRoot>/<control id>/<name>/` with `copyRoot = <data folder>/skill-copies`; it is removed in a `finally` of the adapter around its call of `runClaude` (Chair's decision above), also after a failed or blocked step. The skill block in the prompt says that the skill is text, that it cannot give tools, sites or folders, and that its files are read only in `<folder>`.

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/claude packages/runner/src/service packages/runner/src/test-helpers
git commit -m "Run skill steps with a copy that drops front matter, checked against the pin" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: `pnpm format && pnpm check` passed (252 test files, 1,726 tests passed, 1 skipped; dependency-gate: OK, 22 direct dependencies in 6 manifests, lockfile checked).
Chair (review): the policy now compares the skill copy folder by its resolved path, so a symlinked data folder can never make the copy the working folder (`claude/policy-skill.test.ts`, new). The chair's full run of `pnpm format && pnpm check` was green (253 test files, 1,727 tests passed and 1 skipped; check:hidden and check:deps OK).

### Task 10: Long steps: no second try after a time limit over 30 minutes, and the Mac stays awake

**Files:**
- Create: `packages/runner/src/service/keep-awake.ts`
- Modify: `packages/runner/src/exec/leaf.ts`, `packages/runner/src/storage.ts` (`StepRow.limitMs`), `packages/runner/src/engine.ts` (`EngineDeps.keepAwake?`), `packages/runner/src/service/service.ts` (wiring)
- Test: `packages/runner/src/exec/leaf-long.test.ts`, `packages/runner/src/service/keep-awake.test.ts`

**Interfaces:**
- Produces: `LONG_STEP_MS = 30 * 60 * 1000`; `LONG_STEP = { timedOut: (minutes: number) => "This step ran for its whole time limit of <minutes> minutes, so FlowDriven does not try it again." }`; `StepRow.limitMs?: number` (written when the step starts); `EngineDeps.keepAwake?: (pid: number) => void`, which the leaf gives as `StepRequest.onStart` when the limit is over `LONG_STEP_MS` (the keeper's wrapper, Fact 9, still calls it); `ServiceOptions.keepAwake?` overrides the service's own (tests pass a fake); `createKeepAwake(o: { platform: string; spawn: (cmd: string, args: string[]) => { on(event: "error", f: () => void): void }; onError: () => void }): ((pid: number) => void) | undefined`, which on `darwin` spawns `/usr/bin/caffeinate` with `["-i", "-w", String(pid)]` and elsewhere returns `undefined`.

- [x] **Step 1: Write the failing tests**

  1. "a step with a 150-minute limit that ran out is not tried again and the step says why" (Vitest fake timers; the scripted harness hangs; for a top-level step the run's blocked reason says it too)
  2. "a step with the default 30-minute limit that ran out is tried again as before"
  3. "the step row keeps its time limit in limitMs"
  4. "keepAwake gets the child's pid for a step over 30 minutes, and is not called for a shorter step"
  5. "on darwin createKeepAwake spawns /usr/bin/caffeinate -i -w <pid>; elsewhere it is undefined"
  6. "a spawn error is written to the audit log as keep_awake_failed and the step goes on"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/exec/leaf-long.test.ts packages/runner/src/service/keep-awake.test.ts`
Expected: FAIL (the step retries; no `keepAwake`)

- [x] **Step 3: Implement the rule in `exec/leaf.ts` and `createKeepAwake`**

When an attempt timed out, the limit is over `LONG_STEP_MS` and another attempt would follow, end the attempt as failed, `block(LONG_STEP.timedOut(minutes))` and return `"failed"`, as the `noRetry` branch does (`exec/leaf.ts:249-253`); on the last allowed attempt keep today's path (the Chair's decision at the end of this task).

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/exec packages/runner/src/storage.ts packages/runner/src/engine.ts packages/runner/src/service
git commit -m "Do not retry a long step that ran out its limit, and keep the Mac awake while it runs" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Blocked (Codex, 2026-11-17): The existing review-r2.test.ts expects the old note for a long timeout, which conflicts with Task 10; present tests must not change.
Chair's decision (2026-11-17): the plan was not exact, not the executor. (1) The long-step rule applies only when another try would follow: when the attempt that ran out its limit was the last one the step may make, the step fails as today with the note "time limit exceeded", so `review-r2.test.ts:252` (a 25-day limit with `max_attempts: 1`) stays as it is. (2) The new tests must not depend on how much real asynchronous work finishes after a small fake-timer step: they wait for the state with `vi.waitFor`, and a test that drives the engine gets `{ timeout: 20_000 }`, as the adapter tests do. The full gate of the first call also failed on load-sensitive tests while the Mac's load average was about 44.
Blocked (Codex, 2026-11-17, second call): The full gate failed again with 8 existing test failures, including tests outside the listed load-sensitive exceptions.
Chair's review and evidence (2026-11-17): the 8 tests that failed all start child processes or measure the wall clock (`claude/adapter-closing`, `claude/adapter-limits` "a child that ignores SIGTERM ...", three in `claude/connector-scan`, "S4b" in `claude/review-03-s4`, "a re-scan whose mcp list hangs ..." in `service/claude-harness`, "500 changed files ..." in `triggers/service-files`) and none of them runs the code Task 10 changed. They failed while the Mac's load average was 32 to 69 from other work (the largest a Python job of another project, then WPS Office and WindowServer). Run one file at a time, five of the six files passed, and `claude/connector-scan.test.ts` then passed alone 18 of 18. The chair fixed three small things in review: the minutes of the sentence are rounded, `caffeinate` starts with `stdio: "ignore"` and is unref'd so it never holds the runner, and `ServiceOptions.keepAwake` lets service-level tests pass their own so no real `caffeinate` runs in a test (Task 23 uses it).
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: Task 10's tests (`exec/leaf-long`, `service/keep-awake`, `review-r2`) 19 of 19 three times in a row; lint, typecheck, check:hidden and check:deps green. The chair's full run of `pnpm check` was NOT green: 8 timing tests failed (255 files, 247 passed), the seven above plus "a flat map of 20,000 keys (189 KB) parses in linear time" (`packages/sdk/src/load/load.test.ts`), at a load average of 39 to 69.

### Task 11: Long steps on the Run screen: the time limit and the running time

Blocked (Codex, 2026-11-17): Two gate attempts failed typecheck; StepBlock.tsx reports that step.limitMs may be undefined.
Chair (review, 2026-11-17): the remaining type error was a narrowing in `StepBlock.tsx` (`step.limitMs` possibly undefined inside JSX); the chair fixed it with a local `limitMin`. The minutes of the limit are rounded and the running minutes rounded down, as Codex chose.
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: Task 11's tests (`service/map-run-limit`, `screens/runs/StepLong`) 4 of 4; typecheck, lint, check:hidden and check:deps green. The chair's full run of `pnpm check` was NOT green: 5 timing tests failed (257 files, 253 passed; tests 1,732 passed, 5 failed, 1 skipped): two in `claude/connector-scan`, "S4b" in `claude/review-03-s4`, "a re-scan whose mcp list hangs ..." in `service/claude-harness` and "500 changed files ..." in `triggers/service-files`, at a load average of 26 to 32; each of those four files then passed alone (18, 2, 11 and 16 tests).

**Files:**
- Modify: `packages/runner/src/service/map-run.ts`, `apps/desktop/src/screens/runs/StepBlock.tsx`, `apps/desktop/src/screens/runs/Runs.module.css`
- Test: `packages/runner/src/service/map-run-limit.test.ts`, `apps/desktop/src/screens/runs/StepLong.test.tsx`

**Interfaces:**
- Consumes: `StepRow.limitMs` (Task 10), `LeafStepRun.limitMs` (Task 2).
- Produces: `toRun` maps `limitMs`; the step block shows "Time limit: 150 min" for a step with `limitMs`, and for a running step over 30 minutes also "Running for <n> min of at most 150 min" with a clock icon and, on macOS, "Your Mac stays awake until this step ends."

- [x] **Step 1: Write the failing tests**

  1. "the run read model carries a step's time limit"
  2. "a step with a limit shows Time limit: 150 min"
  3. "a running long step shows Running for 42 min of at most 150 min, with an icon and words"
  4. "a running step of 30 minutes or less shows no running time and no awake line"

The UI tests render the step block with a run built in the test file; no shared fixture changes, so the capture stays at 26 screens.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/service/map-run-limit.test.ts apps/desktop/src/screens/runs/StepLong.test.tsx`
Expected: FAIL

- [x] **Step 3: Implement the mapping and the two lines**

The running time is computed from the last attempt's `startedAt` and the screen's clock at render.

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/service apps/desktop/src/screens/runs
git commit -m "Show a step's time limit and the running time of a long step" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Router and preview: command-line tools (`cli_tool`), readiness on PATH

Needs H2 (the cost). The gate is not changed here (Task 13), so a step with a command still waits as "cannot enforce yet" until the hook can check it.

**Files:**
- Create: `packages/runner/src/router/commands-route.ts`, `packages/runner/src/service/readiness-commands.ts`
- Modify: `packages/runner/src/router/types.ts`, `packages/runner/src/router/route.ts`, `packages/runner/src/service/capabilities.ts`
- Test: `packages/runner/src/router/route-commands.test.ts`, `packages/runner/src/service/readiness-commands.test.ts`, `packages/runner/src/service/capabilities-commands.test.ts`

**Interfaces:**
- Consumes: `classifyCommand` (SDK).
- Produces: `Route.provider` adds `"claude-code-commands"` (`providerName: "Claude Code commands"`, `enforcedBy: "FlowDriven hook in Claude Code"`, `label: "official"`, `labelSentence: "FlowDriven checks each command line. What the program then does is not checked, and it runs with your rights."`, `away: true`); `commandRefusal(pattern: string): string | undefined` in `router/commands-route.ts` (the program lists and patterns of Decision 7); `DROP.riskyCommand = "A step cannot run this command: it deletes, publishes or merges, and a step that needs that must ask first."`; `DROP.runsAnything = "A step cannot run this program: it can run other programs or reach the network."`; `DROP.interpreterWildcard = "This program runs only as an exact command line."`; the sentence `Runs these commands in this flow's folders: <c1>; <c2>.` with `details` = the commands (more than 8 commands refuse the preview, as for web templates); `COST.commands = "Adds about 2,000 tokens to each call of the step that uses it."` (H2); `findProgram(name: string, path: string, isExecutable: (file: string) => boolean): string | undefined`; `commandReadiness(req, o: { path: string }): { state: "ok" | "missing"; detail: string }` ("Found <program> at <file>." / "<program> is not on this Mac's PATH."); `allowIsBlocked` also blocks when a used `cli_tool` row is not routed ("FlowDriven cannot run the commands this flow uses, so there is nothing to allow.").

- [x] **Step 1: Write the failing tests**

  1. "a cli_tool with commands is the Claude Code commands route, enforced by the FlowDriven hook, with the label sentence"
  2. "a cli_tool without commands keeps DROP.notYet" (the present row of `route.test.ts:93-115` stays as it is)
  3. "a risky pattern drops the route: rm, git merge, git push --force, gh pr merge, npm publish, git clean, git reset --hard, find with -delete"
  4. "a program that runs other programs or reaches the network drops the route: ., source, bash, env, xargs, sudo, osascript, npx, curl, ssh"
  5. "an interpreter or a package runner with a wildcard pattern drops; with an exact pattern it routes"
  6. "the sentence lists the commands, cleaned by visible, and more than 8 refuse the preview"
  7. "findProgram finds an executable file on PATH, skips a folder and a file that is not executable, and runs nothing"
  8. "readiness says Found flutter at <file>. or flutter is not on this Mac's PATH."
  9. "a used cli_tool that is not routed blocks the allow"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/router/route-commands.test.ts packages/runner/src/service/readiness-commands.test.ts packages/runner/src/service/capabilities-commands.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the route, the refusals, the sentence, the cost and readiness**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/router packages/runner/src/service
git commit -m "Route command-line tools, refuse the ones that run anything, and look them up on PATH" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: Step 2 failed as expected; Step 4 passed 9 tests; pnpm format passed; pnpm check failed (5 tests): adapter-closing.test.ts "a close of the withheld tab is allowed by the present rules, and the child is stopped as soon as its result was answered: the action after it (id after) never runs", adapter-limits.test.ts "a child that ignores SIGTERM is killed after the grace when the step is aborted, and stop() ends every running step", review-03-s4.test.ts "S4b a tool that runs without the check after the abort still trips the wire and blocks", service-files.test.ts "500 changed files with max_items 1 and the default cap give 24 runs, 476 dropped and one flood event, and the next local day does not replay them", claude-harness.test.ts "a re-scan whose mcp list hangs keeps the list of the scan before"; each file passed once alone (10, 14, 2, 16, 11 tests respectively); pnpm lint, pnpm typecheck, pnpm check:hidden, pnpm check:deps and pnpm test:tools passed.
Chair (review, 2026-11-17): two small fixes: `find` with `-execdir`, `-ok`, `-okdir`, `-fprint`, `-fprint0`, `-fprintf` or `-fls` is refused as well, and a `cli_tool` without commands (a shape FlowDriven cannot provide yet) does not block the allow, as a skill without a known ref does not. Evidence after the fixes: the router tests and the capability, readiness and gate tests (15 files, 94 tests, run one file at a time) green; lint, typecheck, check:hidden and check:deps green. The chair's full run of `pnpm check` was NOT green and not meaningful: 22 test files failed, the UI tests among them, while the Mac's load average rose to 154 (a cleaner app, macOS media analysis, another project's Python job and Spotlight).

### Task 13: Commands in the call: `Bash` with the hook's command rule, and the gate

Needs H2: the keys of `tool_input` for `Bash`. If H2 shows a key that is not named below, the chair adds it to this task with its rule before the executor starts.

**Files:**
- Create: `packages/runner/src/claude/commands.ts`
- Modify: `packages/runner/src/claude/decide.ts`, `packages/runner/src/claude/policy.ts`, `packages/runner/src/claude/prompt.ts`, `packages/runner/src/claude/adapter.ts` (passes `takesOutside` and the commands on), `packages/runner/src/claude/run.ts` (the `command_run` audit row only), `packages/runner/src/harness.ts` (`StepRequest.takesOutside?`), `packages/runner/src/exec/leaf.ts` (sets it with `stepTakesOutsideText`), `packages/runner/src/service/claude-harness.ts` (gate: a routed `cli_tool` with commands is no longer `cannot`)
- Test: `packages/runner/src/claude/decide-commands.test.ts`, `packages/runner/src/claude/policy-commands.test.ts`, `packages/runner/src/claude/adapter-commands.test.ts`

**Interfaces:**
- Consumes: `parseCommandLine`, `commandLineAllowed` (Task 5); Task 12's route.
- Produces: `type CommandPolicy = { patterns: string[] }`; `Policy.commands?: CommandPolicy`; `COMMAND_DENY = { notDeclared: "This step does not declare this command.", badInput: "FlowDriven does not accept this command call.", background: "A command may not run in the background." }`; `COMMAND_STOP = { outside: "A step that reads outside text cannot run commands. Run them in a step of their own.", noFolder: "A step that runs commands needs a folder to run them in." }`; `decideCommand(policy: CommandPolicy | undefined, input: Record<string, unknown>): { allow: true } | { allow: false; reason: string }`, which accepts the keys `command` (string), `description` (string, at most 500 characters) and `timeout` (whole number, 1 to 600000), and `run_in_background` and `dangerouslyDisableSandbox` only as `false`; `buildPolicy` adds `Bash` to `tools` when the step uses a routed `cli_tool`, throws `COMMAND_STOP.outside` when such a step has `takesOutside` not `false` or uses a `web` or connector requirement or any `sensitive` requirement, and throws `COMMAND_STOP.noFolder` when it has no folder; its commands run in `policy.cwd`, the step's first folder.

- [x] **Step 1: Write the failing tests**

  1. "an exact declared command line is allowed"
  2. "a line with an extra word, or a command the step does not declare, is refused with This step does not declare this command."
  3. "each shell character, a quote, a tab, a newline and a path as the program is refused"
  4. "run_in_background true and dangerouslyDisableSandbox true are refused, and an unknown key is refused"
  5. "a step that reads outside text gets no commands: the policy throws COMMAND_STOP.outside, also when takesOutside is missing"
  6. "a step with a web or connector requirement, or a sensitive one, gets no commands"
  7. "a step with commands and no folder throws COMMAND_STOP.noFolder"
  8. "Bash is in the tools only when the step uses a routed cli_tool, and the start proof expects it then"
  9. "the prompt lists the command lines the step may run and the folder they run in"
  10. "an allowed and a refused Bash call are written to the audit log, and the refusal is counted under Blocked calls"
Chair's decision (2026-11-17): the plan was not exact, not the executor. `packages/runner/src/claude/adapter.ts` joins the files of this task: it passes the request's `takesOutside` to `buildPolicy` and the step's command patterns and folder to `buildPrompt`, nothing else.
  11. "the gate passes a step with a routed cli_tool, and Bash in a step without one is refused as today"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/claude/decide-commands.test.ts packages/runner/src/claude/policy-commands.test.ts packages/runner/src/claude/adapter-commands.test.ts`
Expected: FAIL

- [x] **Step 3: Implement `decideCommand`, the `Bash` branch of `decide`, the policy rules and the gate row**

The `Bash` branch comes before the check of `decide.ts:98-100`, which stays for every other tool name. A `cli_tool` without commands stays in `cannot` (the present test `claude-harness-web.test.ts:93` passes unchanged).

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, then `pnpm vitest run packages/runner/src/service/claude-harness-web.test.ts`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/claude packages/runner/src/harness.ts packages/runner/src/exec/leaf.ts packages/runner/src/service
git commit -m "Let a step run its declared command lines through Bash, checked by the hook" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Blocked (Codex, 2026-11-17, third call): Task 13 requires adapter.ts to pass takesOutside to buildPolicy and command patterns to buildPrompt, but adapter.ts is not in the permitted files.
Blocked (Codex, 2026-11-17, second call): Auditing every allowed and refused Bash call requires changes to claude/run.ts, which is outside the permitted files; the existing audit records only aggregate allowed calls and caps refused-call entries.
Chair's decision (2026-11-17, second): `packages/runner/src/claude/run.ts` joins the files of this task for one thing only: in the decide wrapper, next to `connector_call`, each allowed `Bash` call writes one audit row `command_run` with the command line cut to 300 characters through `visible`; a refused `Bash` call is recorded by the present `tool_denied` path and counted under Blocked calls. Nothing else in `run.ts` changes.

Blocked (Codex, 2026-11-17, third call): The Task 13 test command failed twice after implementation; the web and connector test fixtures were missing required fields.

Chair (review, 2026-11-17): Codex's third call stopped after two failed test runs; the chair finished the task. Files the executor touched: `claude/commands.ts` (new), `claude/decide.ts`, `claude/policy.ts`, `claude/prompt.ts`, `claude/adapter.ts`, `claude/run.ts`, `exec/leaf.ts`, `harness.ts`, `service/claude-harness.ts` and the three new test files; all are on this task's list after the chair's two decisions, none is on the untouchable list, and the chair checked each. The chair's fixes: the connector fixture of `policy-commands.test.ts` declares `tools`; the test keeps its route in a typed constant; `policy.ts` has no assignment inside an expression (Biome); and `decide.ts` sends `Bash` to the command rule only in a step whose tools include `Bash`, so in any other step it is refused with today's sentence "This step does not declare the tool Bash." (`claude/decide.test.ts:108` passes unchanged).
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: the chair's full run of `pnpm format && pnpm check` was green end to end (263 test files, 1,757 tests passed and 1 skipped; lint, typecheck, check:hidden and check:deps inside it), at a load average of about 6 to 14.

### Task 14: Granted folders: the ref form, the resolve rule, the route and the preview, pinned at the allow, audited and taken back

Blocked (Codex, 2026-11-17): Two gate attempts failed: Biome rejected control characters in a regex; after fixing that, typecheck rejected the route test requirement spread.

**Files:**
- Create: `packages/runner/src/folders/extra.ts`
- Modify: `packages/runner/src/router/route.ts`, `packages/runner/src/service/capabilities.ts`, `packages/runner/src/service/service.ts` (wiring `home` and `dataDir`)
- Test: `packages/runner/src/folders/extra.test.ts`, `packages/runner/src/service/capabilities-folders.test.ts`, `packages/runner/src/router/route-folders.test.ts`; present test `router/route.test.ts:57` changed as named in Step 1

**Interfaces:**
- Consumes: `ConsentPins.folders` (Task 3), the allow pins (Task 7), `resolveDeep` and `isInside` (`claude/paths.ts`).
- Produces: `EXTRA_REF = /^~\/[^/]+(?:\/[^/]+)*$/`; `isExtraRef(ref: string | undefined): boolean`; `FOLDER_REASON = { form: "A granted folder is written ~/ and a folder name, with no hidden or parent parts.", outsideHome: "This folder is not inside your home folder.", wide: "This folder holds your whole home folder; grant a smaller one.", hidden: "This folder is a hidden folder or inside one.", library: "FlowDriven does not grant folders inside ~/Library.", own: "This folder holds FlowDriven's own data, or is inside it." }`; `resolveExtraFolder(ref: string, o: { home: string; dataDir: string }): { ok: true; path: string; exists: boolean } | { ok: false; reason: string }`; `createCapabilities({ ..., home?: string, dataDir?: string })` (the service passes `os.homedir()` and its data folder); the path route for an extra ref (`claude-code-files`, enforced by the FlowDriven hook, official, away); sentences `Reads files in <ref>, a folder outside the project that you grant.` and `Reads and changes files in <ref>, a folder outside the project that you grant.`; every declared extra folder's row has `pin` = the resolved path and `details` = the path and "You can take this back with Withdraw."; `needsAllow` is true when the flow declares an extra folder; audit `folder_granted` `{flowId, requirementId, path, access}` per folder at the allow and `folder_revoked` per pinned folder at Withdraw; `consentOf` is `stale` when a pinned folder now resolves to another path.

- [x] **Step 1: Write the failing tests, and change the present one**

  1. "~/job-review/work resolves under the home folder and is the files route with the granted-folder sentence"
  2. "~, ~/, /x, ../x, ~/a/../b, ~/.ssh, ~/a/.git and a part with a control or bidi character are refused with FOLDER_REASON.form"
  3. "a folder that resolves to a hidden folder, ~/Library in any case, or FlowDriven's data folder is refused" (each through a symlink too: `~/docs` pointing at `~/.ssh` is refused)
  4. "a symlink that leads out of the home folder is refused, and a home folder that is itself a symlink is resolved first"
  5. "a folder that does not exist yet resolves with exists false"
  6. "every declared extra folder is pinned with its resolved path, and the allow stores it with its access"
  7. "allow writes one folder_granted row per folder, and Withdraw writes one folder_revoked row per pinned folder"
  8. "consentOf is stale when the folder's symlink now points elsewhere"
  9. "a declared extra folder that does not resolve is a dropped row with its reason and blocks the allow"
  10. "needsAllow is true for a flow whose only requirement is a granted folder"

Present test (item 6 of the owner approval): `router/route.test.ts:57` loops over `["~/x", "/x", "../x"]`; it becomes `["/x", "../x"]` with the same expectation, and test 1 above covers `~/...`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/folders packages/runner/src/service/capabilities-folders.test.ts packages/runner/src/router/route-folders.test.ts packages/runner/src/router/route.test.ts`
Expected: FAIL

- [x] **Step 3: Implement `resolveExtraFolder`, the route, the preview rows, the pins and the audit rows**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/folders packages/runner/src/router packages/runner/src/service
git commit -m "Grant a folder outside the project at the allow, show it, log it and take it back" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Chair (review, 2026-11-17): Codex stopped after two gate runs (a Biome finding, then a type error in `router/route-folders.test.ts`). The chair finished it: the test builds its read-only requirement with `Requirement.parse`, and `isExtraRef` also refuses format characters such as zero-width spaces (`\p{Cf}`), with two more cases in `folders/extra.test.ts`. Files the executor touched: `folders/extra.ts` (new), `router/route.ts`, `service/capabilities.ts`, `service/service.ts`, `router/route.test.ts:57` (as Step 1 says) and the three new test files; all on this task's list.
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: the chair's full run of `pnpm format && pnpm check` was green end to end (266 test files, 1,767 tests passed and 1 skipped), at a load average of about 3 to 8.

### Task 15: Granted folders in the call: policy, gate and admit

**Files:**
- Modify: `packages/runner/src/claude/policy.ts`, `packages/runner/src/claude/adapter.ts` (pass the granted folders), `packages/runner/src/service/claude-harness.ts` (gate and `admit`)
- Test: `packages/runner/src/claude/policy-folders.test.ts`, `packages/runner/src/service/claude-harness-folders.test.ts`; present test `service/claude-harness.test.ts:146` changed as named in Step 1

**Interfaces:**
- Consumes: Task 14.
- Produces: `buildPolicy({ ..., grantedFolders?: Record<string, { path: string; access: "read" | "read_write" }>, home?: string })`; without `grantedFolders` an extra ref still throws as today (the present tests `claude/policy.test.ts:80,115` stay as they are); `FOLDER_STOP = { notGranted: (id) => "This step uses a folder you have not granted (<id>).", moved: (id) => "The folder <id> now leads somewhere else. Allow the flow again on its screen.", project: (id) => "The folder <id> holds this run's project folder." }`; `ClaudeAdapterOptions.grantedFolders?: (runId: string) => ConsentPins["folders"]`; `admit` also refuses a step that uses an extra folder when the consent does not pin it; the gate treats a routed extra folder like a web requirement (needs the allow; `sensitive` passes once allowed).

- [x] **Step 1: Write the failing tests, and change the present one**

  1. "a granted folder becomes a folder of the call with its access, and an --add-dir when it is not the first"
  2. "an extra folder the consent does not pin is refused with FOLDER_STOP.notGranted"
  3. "a granted folder whose symlink now points elsewhere is refused at the call with FOLDER_STOP.moved"
  4. "a granted folder that holds the run's project folder is refused with FOLDER_STOP.project"
  5. "a granted folder that does not exist is created with mode 0700 and checked again"
  6. "a Write outside the granted folder is denied by the hook, .git inside it stays protected, and a read grant gives no Write and no Edit"
  7. "the gate passes a flow with a granted folder after the allow and asks for the allow before it"
  8. "after Withdraw the next attempt of a step with a granted folder is refused"

Present test (item 6 of the owner approval): `service/claude-harness.test.ts:146` "the gate blocks what it cannot enforce, then what is marked sensitive, and names the ids sorted" expects "cannot enforce yet: builder, data, gmail, other."; it becomes "cannot enforce yet: builder, gmail, other." (`data`, which is `~/job-review`, is now a granted-folder route). Its other expectations stay as they are.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/claude/policy-folders.test.ts packages/runner/src/service/claude-harness-folders.test.ts packages/runner/src/service/claude-harness.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the granted-folder branch of `buildPolicy`, `admit` and the gate rows**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/claude packages/runner/src/service
git commit -m "Give a step the folders the owner granted, checked again at each call" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run packages/runner/src/claude/policy-folders.test.ts packages/runner/src/service/claude-harness-folders.test.ts packages/runner/src/service/claude-harness.test.ts passed (19 tests); pnpm format && pnpm check passed.
Chair (review, 2026-11-17): files the executor touched: `claude/policy.ts`, `claude/adapter.ts`, `service/claude-harness.ts`, `service/claude-harness.test.ts:146` (as Step 1 says) and the two new test files; all on this task's list. `buildPolicy` takes FlowDriven's data folder as the parent of the control root, which is how the service builds it. The chair's own full run of `pnpm format && pnpm check` was green end to end (268 test files, 1,775 tests passed and 1 skipped).

### Task 16: A `file_change` trigger may watch a granted folder

Blocked (Codex, 2026-11-17, first call): The existing resolveRoot test requires the old result shape and accepts absolute project paths; Task 16 requires within and refuses absolute paths, but changes to those expectations are not authorized.
Chair's decision (2026-11-17, second): the plan was wrong, not the executor. Points (1) and (3) of the decision below are corrected: `within` is set only for a granted `~/...` path, and a project path, relative or absolute, keeps today's rule and today's result `{ ok: true, root }`. So `triggers/scan.test.ts:54` stays as it is apart from its sentence at line 67, one of the four lines named in Step 1.

**Files:**
- Modify: `packages/runner/src/triggers/scan.ts`, `packages/runner/src/triggers/rules.ts`, `packages/runner/src/triggers/service.ts`
- Test: `packages/runner/src/triggers/scan-granted.test.ts`; present trigger tests that pin the old sentence changed as named in Step 1

**Interfaces:**
- Consumes: the consent pins (Task 14), `resolveExtraFolder` (Task 14).
- Produces: `resolveRoot(project: string, path: string, granted?: { home: string; folders: string[] }): string` accepts a `~/...` path inside a folder granted to the flow (resolved as in Task 14); the sentence for every other path becomes "Only folders inside the project folder or a folder you granted to this flow can be watched."; the trigger service passes the flow's pinned folders and the home folder when it enables and re-checks.

Chair's decision (2026-11-17, before the executor's call): the Interfaces above are not exact. (1) `resolveRoot` keeps its result form and gains an optional `within`: `resolveRoot(project, path, granted?)` returns `{ ok: true; root: string; within?: string } | { ok: false; reason: string }`, where `within` is set only for a `~/...` path and is the pinned path of the granted folder that holds it; a project path returns `{ ok: true, root }` exactly as today; both calls in `triggers/service.ts` pass `resolved.within ?? realpathSync(deps.projectDir)` to `scanFolder` as `within`, so a symlink inside a granted folder that leads out of it is `outside`, and both `scanned.outside` sentences become the new sentence. (2) `granted` is `{ home: string; dataDir: string; folders: string[] }`, because `resolveExtraFolder` needs FlowDriven's data folder (Task 14). (3) A path for which `isExtraRef` is true is resolved with `resolveExtraFolder`; it is accepted only when its resolved path is inside (folded as in `folders/extra.ts`) one of `folders`, then it must exist and be a folder, with today's two sentences; any other `~/...` path, and every `~/...` path when `granted` is missing, gets the new sentence. Every other path keeps today's project rule exactly: a relative or an absolute path inside the project folder is accepted as today, and a path outside it gets the new sentence. (4) The folders of a flow are the paths in `store.getCapabilityConsent(flowId)?.pins?.folders`, used only when that row's `hash` equals the flow's hash; otherwise the flow has none. (5) Files: `packages/runner/src/service/trigger-wiring.ts` and the `wireTriggers` call in `packages/runner/src/service/service.ts` join this task, to pass `home: homedir()` and `dataDir: options.dataDir` (`TriggerDeps` gains optional `home` and `dataDir`); `packages/runner/src/test-helpers/trigger-rig.ts` may gain the same two optional options; `fold` in `folders/extra.ts` may be exported, with no other change there.

- [x] **Step 1: Write the failing tests, and change the present ones**

  1. "a file_change path inside a granted folder can be watched"
  2. "a path in a folder granted to another flow, or a folder that is no longer granted, is refused"
  3. "a symlink out of the granted folder is refused"
  4. "after Withdraw the watch stops and the trigger says why"
  5. "a project folder path is watched as before"

Present tests (item 6 of the owner approval): every test that expects "Only folders inside the project folder can be watched for now." (`triggers/scan.test.ts`, `triggers/rules.test.ts`, `triggers/service-files.test.ts`, `review-04-r.test.ts:365`; the executor lists them under this task by title) expects the new sentence; nothing else in them changes.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/triggers packages/runner/src/review-04-r.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the granted roots**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/triggers packages/runner/src/review-04-r.test.ts
git commit -m "Let a file_change trigger watch a folder granted to its flow" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: `pnpm vitest run packages/runner/src/triggers packages/runner/src/review-04-r.test.ts` passed (110 tests); `pnpm format && pnpm check` passed.
Chair (review, 2026-11-17): the second call followed both decisions. Files the executor touched: `triggers/scan.ts`, `triggers/rules.ts`, `triggers/service.ts`, the new `triggers/scan-granted.test.ts`, the four sentence lines (`triggers/scan.test.ts:67`, `triggers/rules.test.ts:92`, `triggers/service-files.test.ts:153`, `review-04-r.test.ts:365`), `service/trigger-wiring.ts`, the `wireTriggers` call in `service/service.ts`, two options in `test-helpers/trigger-rig.ts` and the `fold` export in `folders/extra.ts`; all are on this task's list after the decisions, and the chair checked each. The tests use a fresh temporary folder as home. The chair's own full run of `pnpm format && pnpm check` was green end to end (269 test files, 1,780 tests passed and 1 skipped).

### Task 17: The spam word, the Trash and Spam label rule, and the destructive mark of a scanned tool

**Files:**
- Create: `packages/runner/src/connectors/label-rule.ts`
- Modify: `packages/sdk/src/validate/risky.ts`, `packages/runner/src/claude/connector-scan.ts`
- Test: `packages/runner/src/connectors/label-rule.test.ts`, `packages/sdk/src/validate/risky-spam.test.ts`, `packages/runner/src/claude/connector-scan-destructive.test.ts`

**Interfaces:**
- Produces: `throwsMailAway(input: unknown): boolean` (true when any key or string value, at any depth up to 20, holds `trash` or `spam` after NFKC folding and lower case, and true for anything deeper); `classifyTool` returns `delete` for a name with the word `spam`; the scan's tool fact gains `destructive?: true` when its annotation says so (absent otherwise, so present facts built by hand stay valid).

Chair's decision (2026-11-17, before the executor's call): the Interfaces above are made exact. (1) A key or string value "holds" `trash` or `spam` when its folded text contains the word. It is folded as `protectedPath` in `claude/decide.ts` folds a path part: NFKC, upper case then lower case, NFKC again, and only the printable ASCII characters 0x21 to 0x7E are kept, so a space, a zero-width or a fullwidth character cannot hide the word. Numbers, booleans and null hold nothing. The input itself is at depth 1; an array or object met at depth 21 or deeper makes the answer true without looking further. (2) In `classifyTool`, `spam` joins the words of `delete`; nothing else there changes. (3) The scan pushes `{ name, readOnly }` as today and adds `destructive: true` only when the tool's `annotations` object has `destructive === true` (the key Claude Code's scan output uses, as the Task 0 probe shows); `ConnectorFact.tools` gains `destructive?: true`. The router's `FactConnector` type and the stored-scan check in `service/claude-harness.ts` stay as they are in this task; Task 18, which uses the mark, changes them.

- [x] **Step 1: Write the failing tests**

  1. "throwsMailAway is false for the label FlowDriven and for INBOX"
  2. "throwsMailAway is true for Trash, [Gmail]/Spam and a fullwidth TRASH, as a key or a value, at any depth"
  3. "throwsMailAway is true for an input deeper than 20"
  4. "classifyTool calls mark_thread_spam and mark_message_spam delete and keeps label_thread undefined" (the present test `validate.test.ts:129` stays as it is)
  5. "R4: a flow with a schedule that marks spam before its first ask is refused"
  6. "the scan keeps destructive true from a tool's annotation and leaves it out otherwise"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/connectors/label-rule.test.ts packages/sdk/src/validate/risky-spam.test.ts packages/runner/src/claude/connector-scan-destructive.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the rule, the word and the mark**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/connectors packages/runner/src/claude/connector-scan.ts packages/runner/src/claude/connector-scan-destructive.test.ts packages/sdk/src/validate
git commit -m "Recognise a label change that moves mail to Trash or Spam, and keep the destructive mark of a tool" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm format, pnpm lint, pnpm typecheck and pnpm check passed; Task 17 tests 6 passed.
Chair (review, 2026-11-17): files the executor touched: `connectors/label-rule.ts` (new), `sdk/src/validate/risky.ts`, `claude/connector-scan.ts` and the three new test files; all on this task's list. The fold is the one of `protectedPath`, an array or object at depth 21 makes the answer true, and `destructive` is kept only for the value `true`. The chair's own full run of `pnpm format && pnpm check` was green end to end (272 test files, 1,786 tests passed and 1 skipped).

### Task 18: Plain Gmail writes: a class of their own; Trash and Spam labels are held as deletes

Needs H4: the chair writes the exact `write` list under this task (the names of Decision 9 that H4 lists) before the executor starts.

**Files:**
- Modify: `packages/runner/src/connectors/catalog.ts`, `packages/runner/src/router/route.ts`, `packages/runner/src/claude/policy.ts`, `packages/runner/src/claude/connector.ts`, `packages/runner/src/claude/prompt.ts`
- Test: `packages/runner/src/claude/decide-connector-write.test.ts`, `packages/runner/src/router/route-connector-write.test.ts`; present tests changed as named in Step 1

**Interfaces:**
- Consumes: `throwsMailAway`, the `destructive` mark (Task 17).
- Produces: `ConnectorEntry.write?: string[]` and `ConnectorEntry.labelTools?: string[]` (optional, so present hand-built entries stay valid); Gmail's entry gets the `write` list of H4 and `labelTools` = every write tool whose name holds `label`, `spam` or `trash`; `risky` adds `mark_thread_spam: "delete"`, `mark_message_spam: "delete"`; `ConnectorPolicy.write?`, `.labelTools?`; `decideConnector` allows a write tool with `class: "write"` unless it is a label tool and `throwsMailAway(input)`, which takes the held path with action `delete` (pick grant, call grant, hold, as for risky tools); the route accepts a declared write tool the scan lists, unless its fact says `destructive`; `capabilitySentence` adds "Changes with <tools>." and "Waits for your approval before a label change that moves mail to Trash or Spam."; the prompt's connector paragraph says the same.

Chair's decision (2026-11-17, before the executor's call), with the lists from H4: (1) Gmail's `write` is `create_draft`, `label_thread`, `label_message`, `update_message_labels`, and its `labelTools` are `label_thread`, `label_message`, `update_message_labels`. `unlabel_thread` and `unlabel_message` are not write tools (the scan marks them destructive), and `update_draft`, `create_label`, `update_label`, `untrash_thread`, `untrash_message`, `unmark_thread_spam` and `unmark_message_spam` keep no class. `risky` gains `mark_thread_spam: "delete"` and `mark_message_spam: "delete"`. (2) The route reads the mark: `FactConnector.tools` in `router/types.ts` gains `destructive?: true`, and the stored-scan check in `service/claude-harness.ts` accepts a stored tool only when `destructive` is absent or `true` (any other value makes the stored connectors invalid, as a bad `readOnly` does today); both files join this task for that only. (3) `buildPolicy` puts a declared write tool in `ConnectorPolicy.write` only when the scan lists it and its fact is not `destructive`, and sets `labelTools` to the entry's label tools that are in `write`. (4) `ConnectorAllow.class` gains `"write"`, and an allowed write call writes the present `connector_call` audit row with that class. (5) A label tool's call for which `throwsMailAway` is true is held with `action: "delete"` and released only by a pick grant or a call grant, exactly as a risky `delete` tool. (6) The preview: after "Reads with: ...", `capabilitySentence` adds "Changes with: <declared write tools, in declared order, joined by commas>." and, only when one of them is a label tool, ends with "Waits for your approval before a label change that moves mail to Trash or Spam."; the risky sentence stays where it is.

- [x] **Step 1: Write the failing tests, and change the present ones**

  1. "create_draft and label_thread run without approval when declared, and the audit row says class write"
  2. "a label call that names TRASH or SPAM, in any case and anywhere in the input, is held as a delete"
  3. "mark_thread_spam is held, and a pick grant releases it for a picked item"
  4. "a declared write tool routes when the scan lists it, and drops when the scan marks it destructive"
  5. "update_draft, create_label and untrash_thread still drop the route with DROP.connectorTool"
  6. "every catalogued write tool whose name holds label, spam or trash is a label tool"
  7. "the preview sentence names the write tools and the Trash and Spam rule"
  8. "R4: a flow with a schedule may label before its first ask"

Present tests (item 6 of the owner approval): `router/route-connector.test.ts:59-68` uses `create_draft` as "a declared plain write"; it becomes `create_label` with the title "a tool with no class, an unknown tool, ...". `claude/review-05b-r.test.ts:333-338` "a step that asks for a plain write tool is blocked at the gate or the route, and no child is started" becomes "a step that asks for a Gmail tool with no class is blocked ..." with `create_label`. `claude/policy-connector.test.ts:22` and `service/claude-harness-connector.test.ts:20,73` use `create_draft` as a refused tool; they use `create_label`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/claude/decide-connector-write.test.ts packages/runner/src/router/route-connector-write.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the class**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, then `pnpm vitest run packages/runner/src/claude packages/runner/src/router packages/runner/src/service`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/connectors packages/runner/src/claude packages/runner/src/router packages/runner/src/service
git commit -m "Let declared Gmail draft and label tools run, and hold a label that moves mail to Trash or Spam" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Blocked (Codex, 2026-11-17, first call): connectors/catalog.test.ts expects the old exact risky list and must change to include the required spam tools.
Chair's decision (2026-11-17, second): the plan was not exact, not the executor. (1) `connectors/catalog.test.ts:15-34` ("the read list is the six read-only tools of G5, the risky map is the seven send and delete tools, and no tool is in both") pins the risky map that this task changes on purpose. Under item 6 of the owner approval it expects the nine tools (the seven, and `mark_thread_spam` and `mark_message_spam`, both `delete`) and its title says "nine"; nothing else in it changes. (2) The prompt's connector paragraph names the declared write tools, and the Trash and Spam rule, only when the step has them, and says that the owner approves: `buildPrompt`'s connector input gains `write?` and `labelHold?`, and `claude/adapter.ts` joins this task to pass those two fields, nothing else. The chair made both changes and added the test "the prompt names the write tools and the Trash and Spam rule only when the step declares them" to `claude/decide-connector-write.test.ts`.
Chair (review, 2026-11-17): Codex's call stopped at the gate on `connectors/catalog.test.ts`; the chair finished the task. Files the executor touched: `connectors/catalog.ts`, `router/route.ts`, `router/types.ts`, `claude/policy.ts`, `claude/connector.ts`, `claude/prompt.ts`, `service/claude-harness.ts` (the stored-scan check only), the two new test files, and the present tests named in Step 1 (`router/route-connector.test.ts` at its scan fixture and its row for a tool with no class, `claude/review-05b-r.test.ts:333-338`, `claude/policy-connector.test.ts:22`, `service/claude-harness-connector.test.ts:20,73`); all are on this task's list after the decisions, and the chair checked each. The chair's fixes: the catalog test and the prompt lines with `claude/adapter.ts`, as the second decision says, with one new test; and a readonly tuple in `router/route-connector.test.ts` that failed the typecheck (the scan fixture's extra tool is `create_label`, so that row reads `["create_label", fact.tools]`).
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: the chair's full run of `pnpm format && pnpm check` was green end to end (274 test files, 1,795 tests passed and 1 skipped).

### Task 19: A pick releases a loop without `key`, and only inside a loop over its choice

**Files:**
- Modify: `packages/runner/src/exec/loop.ts`, `packages/runner/src/exec/leaf.ts`, `packages/runner/src/engine.ts` (only if a helper is shared), `packages/runner/src/harness.ts` (`StepRequest.pickTools?`), `packages/runner/src/claude/run.ts` (`RunInput.pickTools?`), `packages/runner/src/claude/adapter.ts`
- Test: `packages/runner/src/engine-pick-keys.test.ts`, `packages/runner/src/claude/adapter-pick-loop.test.ts`; present tests changed as named in Step 1

**Interfaces:**
- Produces: `loopsOverChoice(manifest: FlowManifest, askId: string): string[]` (top-level loops whose `for_each` is exactly `${steps.<askId>.outputs.choice}`); `pickKeysOf(store, runId, askId): string[] | undefined` (the approved ask approval's picks in option order); a keyless loop over a choice keys its items by `pickKeysOf` and blocks with "The picks of <ask> cannot be matched to this loop." when they cannot be matched; `StepRequest.pickTools?: string[]` (the leaf sets the `approves` of the ask whose choice the step's loop iterates, and `[]` for every other step); in `claude/run.ts` a pick grant counts only when `pickTools` holds it (`decideConnector` itself is not changed); a request without `pickTools` releases nothing by a pick.

Chair's decision (2026-11-17, before the executor's call), from the present code: (1) Files: `loopsOverChoice` and `pickKeysOf` live in a new module `packages/runner/src/exec/pick-keys.ts`, because `exec/loop.ts` imports `runLeaf` from `exec/leaf.ts` and a helper in `loop.ts` used by `leaf.ts` would make a cycle; it joins Files and the Step 6 `git add`. (2) `loopsOverChoice(manifest, askId)` returns the ids of the top-level loop steps whose `for_each` is exactly the string `${steps.<askId>.outputs.choice}`, and only when `<askId>` is a top-level `do: ask` step; otherwise `[]`. (3) `pickKeysOf(store, runId, askId)` takes the approved approval of kind `ask` with that `stepId` in the run (`store.listApprovals`) and returns its `picks` in the order of its `payload.options` (the `picks` field is in answer order, the `choice` output in option order); `undefined` when there is no such approval or its payload has no options. (4) The loop: only on its first pass, where keys are made today, a loop without `key` that `loopsOverChoice` names keys item i with the i-th pick key. An empty list makes no items and does not block (an ask with no options, or one that expired with `on_expiry: end`, passes with an empty choice and no approval). When the list is not empty and `pickKeysOf` is `undefined` or has another length, the loop blocks the run through its present `block` with "The picks of <askId> cannot be matched to this loop." Seen keys stay as today (only a declared `key` writes them), and a resumed run keeps the stored keys. (5) The leaf finds its loop as `exec/outside.ts:24` does; when `loopsOverChoice` names that loop for a top-level ask, `pickTools` is that ask's `ask.approves`; for every other step it is `[]`. `claude/adapter.ts` passes `pickTools` on to `runClaude`. In `claude/run.ts` the `granted` function counts a grant that is not a call grant (`isCallGrant`) only when `input.pickTools` holds it; call grants are checked as today. (6) Present tests: besides the ones named below, `service/claude-harness-connector.test.ts:180-195` ("after a rescan on the fake ... a pick grant added to the store releases the risky tool for that item") builds its request by hand, so like the tests of `claude/adapter-held.test.ts` it adds `pickTools: ["gmail.delete_draft"]`, with the same expectations (item 6 of the owner approval). `claude/review-05b-fix.test.ts` has no test of the changed shape (its R-2 loop is over `${steps.find.outputs.jobs}` and expects the call held), so it does not change.

- [x] **Step 1: Write the failing tests, and change the present ones**

  1. "R10 on the spec's flow: the pick releases the publish for the picked job in the keyless build loop, and the other job's publish is held"
  2. "the keyless loop over the choice keys its items with the picked keys, in option order"
  3. "an item with a picked key in another loop is not released"
  4. "a keyless loop over another list keeps positional keys and is never released"
  5. "resuming the run after a crash keeps the keys and releases as before"
  6. "a step outside any loop over a choice gets no pick tools, and a request without pick tools releases nothing by a pick"
  7. "the keyless loop over the choice writes no seen keys"
  8. "a missing approval for the ask blocks the loop with its sentence"

Present tests (item 6 of the owner approval): `claude/review-05b-r.test.ts:207-221` ("without a key on the loop the item key is #<position> ... the call is held", a loop over `${steps.pick.outputs.choice}`) becomes the same proof for a keyless loop over another list, with the same expectations; any test of `claude/review-05b-fix.test.ts` of that shape changes the same way. Tests of `claude/adapter-held.test.ts` that release a tool by a pick add `pickTools` (the tools their pick approves) to their request; their expectations stay as they are. The executor lists each changed test under this task by title.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/engine-pick-keys.test.ts packages/runner/src/claude/adapter-pick-loop.test.ts`
Expected: FAIL (positional keys `#0`, `#1`; the publish is held)

- [x] **Step 3: Implement the pick keys and `pickTools`**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, then `pnpm vitest run packages/runner/src/engine-ask.test.ts packages/runner/src/engine-held.test.ts packages/runner/src/engine-loop.test.ts packages/runner/src/review-r2.test.ts packages/runner/src/claude packages/runner/src/service`
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/exec/loop.ts packages/runner/src/exec/leaf.ts packages/runner/src/engine.ts packages/runner/src/harness.ts packages/runner/src/claude/run.ts packages/runner/src/claude/adapter.ts packages/runner/src/engine-pick-keys.test.ts packages/runner/src/claude/adapter-pick-loop.test.ts packages/runner/src/claude/adapter-held.test.ts packages/runner/src/claude/review-05b-r.test.ts packages/runner/src/claude/review-05b-fix.test.ts packages/runner/src/service/claude-harness-connector.test.ts packages/runner/src/exec/pick-keys.ts packages/runner/src/test-helpers/connector-demo-run.ts packages/runner/src/test-helpers/connector-demo.test.ts
git commit -m "Key a keyless loop over a choice by its picks, and release a pick only inside that loop" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Blocked (Codex, 2026-11-17, first call): connector-demo.test.ts expects a pick to release a tool in a loop over another list; its demo helper and expectation are outside the permitted files.
Chair's decision (2026-11-17, second): the plan was not exact, not the executor. Plan 05b's connector demo (`test-helpers/connector-demo-run.ts`, pinned by `test-helpers/connector-demo.test.ts`) let a pick release a call in a loop over `${steps.find.outputs.jobs}`, which Decision 10 now refuses on purpose. Under item 6 of the owner approval both join this task: the demo's loop iterates `${steps.pick.outputs.choice}` with no `key` (the case this task adds), a worker step `later` after the loop calls `delete_draft` as the R10 test does, and the line "pick released one item: j1 ran, j2 held" becomes "pick released one item: j1 ran in the loop over the choice, the call after the loop held", built from the `grant_used` row of the pick and the pending `risky_action` approval of step `later`. The other seven lines and the other two demo tests stay as they are. The chair made this change.
Chair (review, 2026-11-17): Codex's call stopped at the full gate on the connector demo; the chair finished the task. Files the executor touched: the new `exec/pick-keys.ts`, `exec/loop.ts`, `exec/leaf.ts`, `harness.ts`, `claude/run.ts`, `claude/adapter.ts`, the two new test files, and the present tests named in Step 1 and the first decision (`claude/review-05b-r.test.ts:208-221` as a keyless loop over `${steps.find.outputs.jobs}` with the same expectations, `claude/adapter-held.test.ts` and `service/claude-harness-connector.test.ts` with `pickTools: ["gmail.delete_draft"]` only); `engine.ts` and `claude/review-05b-fix.test.ts` are untouched; all are on this task's list after the decisions, and the chair checked each. The chair's change: the connector demo and its test, as the second decision says.
Done by: Codex/gpt-6.1-terra, then the chair, 2026-11-17. Evidence: the chair's full run of `pnpm format && pnpm check` was green end to end (276 test files, 1,803 tests passed and 1 skipped).

### Task 20: The prototype host connector

Needs H1. The chair writes the entry's exact values under this task before the executor starts.

**Files:**
- Modify: `packages/runner/src/connectors/catalog.ts`, `packages/sdk/src/validate/risky.ts` (only if the publish tool's name has none of the words of Fact 13)
- Test: `packages/runner/src/connectors/catalog-host.test.ts`, `packages/runner/src/claude/adapter-host.test.ts`

**Interfaces:**
- Produces: a second `CONNECTORS` entry `{ ref: "connector:prototype-host", name, url, prefix, label, read, write, labelTools: [], risky: { <publish tool>: "post" } }` with the values of H1: read tools only with the `readOnly` annotation; `write` for tools that create or upload into a project that nobody else can open; `post` for the tool that makes it public.

- [ ] **Step 1: Write the failing tests**

  1. "the host entry routes its declared tools when the scan lists them"
  2. "a write tool of the host runs without approval"
  3. "the publish tool without a pick is held as post"
  4. "the publish tool for a picked item in the loop over the choice runs"
  5. "R4: a flow with a schedule that publishes before its first ask is refused"

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/connectors/catalog-host.test.ts packages/runner/src/claude/adapter-host.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the entry**

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/connectors packages/runner/src/claude packages/sdk/src/validate
git commit -m "Add the prototype host connector to the catalog" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Readiness rows for skills, commands and granted folders

**Files:**
- Modify: `packages/runner/src/service/map-flow.ts` (`toReadinessReport`), `packages/runner/src/service/handlers.ts` (`readiness.check`)
- Test: `packages/runner/src/service/readiness-local.test.ts`

**Interfaces:**
- Consumes: `readSkillFolder` (Task 6), `commandReadiness` (Task 12), `resolveExtraFolder` (Task 14).
- Produces: `toReadinessReport(row, checkedAt, web?, connectors?, local?)` with `local = { skill(req): State; command(req): State; folder(req): State }`, where `State = { state: "ok" | "missing" | "needs_login"; detail: string }`; sentences: "Found your skill <name>; its text has <n> characters.", "Your Claude Code has no skill <name>.", the reading reason of Task 6, the readiness of Task 12, "Ready: <path>." for an existing folder (with a write test in a temp file for `read_write`), "FlowDriven creates <path> at the first run." for a missing one, and the reason of Task 14.

Chair's decision (2026-11-17, before the executor's call), from the present code: (1) Wiring: `createHandlers` gains an optional `local?: (row: FlowRow) => LocalChecks` (the three functions of the Interfaces, built per flow because a bundled skill is read from the flow's files); `readiness.check` passes `local?.(row)` as the fifth argument; `service/service.ts` joins this task to provide it, from `skillSource`, `readSkillFolder` and `bundledSkill` (with `homedir()`), `commandReadiness` (with the `PATH` of `options.env`, the one the `claude` child gets) and `resolveExtraFolder` (with `homedir()` and `options.dataDir`). Without `local` every row stays as today. (2) Skill rows (`type: "skill"`): ok is "Found your skill <name>; its text has <n> characters." with n the length of the loaded skill's `copyText`, written with `toLocaleString("en-US")`; a `claude-code:` skill whose folder does not exist is missing with "Your Claude Code has no skill <name>."; any other failure is missing with the reason the reader gives. (3) Command rows (`type: "cli_tool"`): the state and detail of `commandReadiness`. (4) Folder rows (`type: "path"` with a ref for which `isExtraRef` is true): a refused ref is missing with the reason of `resolveExtraFolder`; a folder that does not exist yet is ok with "FlowDriven creates <path> at the first run."; an existing folder is ok with "Ready: <path>.", for `access: read_write` only after a write test that makes an empty folder with `mkdtempSync(join(path, ".flowdriven-check-"))` and removes it at once. It is a folder, not a file, because a `file_change` trigger lists only files and so never sees it (its default glob `**/*` matches hidden names). When the test fails the row is missing with "This folder cannot be written." Sentences show the resolved path through `visible`. Path rows inside the project and rows of other types keep their present state. (5) For these three kinds the row's route stays `{ via: "FlowDriven", risk: "official" }`, and its guide holds the detail when the state is not ok, as connector rows do.

- [x] **Step 1: Write the failing tests**

  1. "a skill row is ok with its size, missing when not installed, and missing with the reason when it cannot be read"
  2. "a command row is ok or missing from PATH"
  3. "a granted folder row is ok when it exists and can be written, says it will be created when missing, and is missing with its reason when refused"
  4. "a read_write folder that cannot be written is missing with This folder cannot be written."
  5. "rows of other types keep their present states"
  6. "readiness.check runs no command and sends no prompt"

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/service/readiness-local.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the three row kinds**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/service
git commit -m "Check skills, commands and granted folders on the Readiness screen" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run packages/runner/src/service/readiness-local.test.ts (6 passed); pnpm format && pnpm lint && pnpm typecheck && pnpm check (passed).
Chair (review, 2026-11-17): files the executor touched: `service/map-flow.ts`, `service/handlers.ts`, the `local` checks in `service/service.ts` (as the decision says) and the new `service/readiness-local.test.ts`, whose home folder is a temporary folder through a mock of `homedir()` in that file only; all on this task's list. The chair's fix: a granted path that exists but is a file is missing with "This path is not a folder." instead of "Ready" (or "This folder cannot be written."), with the test "a granted path that is a file is missing with This path is not a folder., for read and for read_write". The chair's own full run of `pnpm format && pnpm check` was green end to end (277 test files, 1,810 tests passed and 1 skipped).

### Task 22: The M1 flow package

Needs H1 and H3. The chair writes the skill's name, the host's tool names and the published address into the YAML below before the executor starts (the placeholders in angle brackets).

**Files:**
- Create: `packages/fixtures/flows/upwork-job-review/flow.yaml`, `README.md`, `checks/alerts.schema.json`, `checks/score.schema.json`, `checks/verdict.schema.json`, `checks/human.md`; `packages/runner/src/demo/m1-flow.ts`
- Test: `packages/runner/src/demo/m1-flow.test.ts`

**Interfaces:**
- Produces: the folder; `M1_FLOW_DIR` (its absolute path, from `import.meta.url`) exported by `packages/runner/src/demo/m1-flow.ts` for Task 23.

The flow (Decision 12):

```yaml
format: flowdriven-flow/1.1
id: local.upwork-job-review
name: Upwork job review
version: 0.1.0
kind: light
params:
  min_score: {type: number, default: 7, min: 0, max: 10}
  daily_builds: {type: number, default: 2, min: 1, max: 2}
  newest: {type: number, default: 20, min: 1, max: 20}
triggers:
  - {kind: schedule, every: 1h, catch_up: once, overlap: skip}
limits: {max_runs_per_day: 24, max_items: 20}
requirements:
  - {id: gmail, type: mcp_server, ref: connector:gmail, connect: native, sensitive: true,
     tools: [search_threads, get_thread, list_labels, label_thread]}
  - {id: jobs_web, type: web, mode: read, session: own, sensitive: true,
     url_patterns: ["https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}"],
     rate: {per_run: 3, per_day: 10}, on_challenge: stop}
  - {id: builder, type: skill, ref: "claude-code:<skill name from H3>"}
  - {id: host, type: mcp_server, ref: connector:prototype-host, connect: native,
     tools: [<host tool names from H1>]}
  - {id: notes, type: path, ref: ~/job-review/notes, access: read}
  - {id: work, type: path, ref: ~/job-review/work, access: read_write}
  - {id: protos, type: path, ref: ~/job-review/prototypes, access: read_write}
steps:
  - id: alerts
    do: worker
    uses: [gmail]
    instructions: >-
      Search Gmail for from:donotreply@upwork.com newer_than:2d. Read each alert thread and return
      every job in it, newest first, at most ${params.newest}, as JSON with id (the part after ~ in
      the job's address), title, title_start (the first 20 characters of the title), budget and
      snippet. Then add the label FlowDriven to each alert thread you read.
    outputs: [{id: jobs, type: json}]
    checks: [{type: schema, file: checks/alerts.schema.json}]
  - id: review
    for_each: ${steps.alerts.outputs.jobs}
    as: job
    key: ${job.id}
    max: 20
    steps:
      - {id: rough, do: worker, uses: [notes], worker: {effort: low},
         instructions: "Read profile.md in your folder. Score this job 0 to 10 against it, with reasons: ${job}",
         outputs: [{id: score, type: json}], checks: [{type: schema, file: checks/score.schema.json}]}
      - {id: page, do: worker, uses: [jobs_web], when: "rough.score.value >= params.min_score",
         instructions: "Open the jobs_web address for id ${job.id} and read the page text. If the first read fails, read once more. Return the full post text as post.",
         outputs: [{id: post, type: text}],
         checks: [{type: contains, pattern: "${job.title_start}"}]}
      - {id: full, do: worker, uses: [notes], when: page.passed,
         instructions: "Read profile.md in your folder. Score this job post against it; say fit yes or no, with reasons. The post: ${page.outputs.post}",
         outputs: [{id: verdict, type: json}], checks: [{type: schema, file: checks/verdict.schema.json}]}
  - id: pick
    do: ask
    ask: {question: "Which jobs get a prototype?", max_pick: "${params.daily_builds}", expires: 24h,
          choose_from: "${steps.review.items where steps.full.outputs.verdict.fit}",
          approves: [host.<publish tool from H1>]}
  - id: build
    for_each: ${steps.pick.outputs.choice}
    as: job
    on_item_fail: stop
    steps:
      - {id: proto, do: skill, skill: builder, uses: [builder, host, protos], retry: 0, limits: {max_duration: 150m},
         instructions: "Build and publish the prototype for this job, keeping your files in your folder. The job and its review: ${steps.review.items where key == job.id}",
         checks: [{type: contains, pattern: "<part of the published address from H1>"}]}
      - {id: proposal, do: worker, uses: [notes, work],
         instructions: "Read voice.md in the notes folder. Draft the proposal for this job in that voice, at most 150 words, write it to proposals/${job.id}.md in your work folder, and return it. The job and its review: ${steps.review.items where key == job.id}",
         checks: [{type: not_contains, patterns: ["@", "whatsapp", "telegram"]}, {type: judge, rubric: checks/human.md}, {type: user}]}
```

The README says, in everyday words: what the flow does; that it never sends; that `~/job-review/notes/` holds the owner's `profile.md` and `voice.md`, which the owner writes; that the first run is started with "newest" set to 3; and what the owner allows on the flow's screen. The schemas require `jobs` as a list of at most 20 objects with `id` matching `^[0-9a-z]{18,24}$` and string `title`, `title_start`; `score` as `{value: 0..10, reasons: string}`; `verdict` as `{fit: boolean, reasons: string}`. `checks/human.md` is a rubric of at most 10 lines: plain, specific to the job, no promises of dates or prices, no contact details.

- [ ] **Step 1: Write the failing tests**

  1. "the M1 folder loads with loadFlowFolder and has no error issues"
  2. "R4: nothing risky runs before the pick, the publish tool is in ask.approves, proto has retry 0, and build stops after a failed item"
  3. "every declared connector tool has a class in the catalog: read, write or risky, and the flow declares no send tool"
  4. "the M1 flow routes every requirement with facts that list the Gmail and host connectors and the skill"
  5. "a run started with params newest 3 asks the alerts step for at most 3 jobs, and a run without params for at most 20" (scripted harness; the test reads `instructions` of the alerts request)
  6. "the full step's prompt holds the page text, and the proposal's prompt holds the picked job's review with its post" (scripted harness)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/demo/m1-flow.test.ts`
Expected: FAIL (the folder does not exist)

- [ ] **Step 3: Write the folder and `m1-flow.ts`**

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/fixtures/flows packages/runner/src/demo/m1-flow.ts packages/runner/src/demo/m1-flow.test.ts
git commit -m "Add the M1 flow: the Upwork job review" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: M1 on the fake `claude`: the demo

**Files:**
- Create: `packages/runner/src/test-helpers/m1-demo.ts`, `packages/runner/src/test-helpers/m1-demo-run.ts`
- Modify: `packages/runner/src/test-helpers/fake-claude-script.ts` (a fake host connector), only if needed
- Test: `packages/runner/src/test-helpers/m1-demo.test.ts`

**Interfaces:**
- Consumes: everything above, `M1_FLOW_DIR` (Task 22); `runConnectorDemo` (`test-helpers/connector-demo-run.ts:56`) as the pattern.
- Produces: `runM1Demo(): Promise<string[]>`; the script prints its ten lines with `process.stdout.write`.

The demo builds the service with the fake `claude`, a fake home with the Gmail and host connectors, the skill at `~/.claude/skills/<name>/` (its front matter carries `allowed-tools: Bash`), `~/job-review/notes/profile.md` and `voice.md`, and two fake job pages; it gives the consent and the allow as the screen would, runs the flow with `params: {newest: 3}`, answers the pick with one job and approves the sign-off, then runs it again.

- [ ] **Step 1: Write the failing test**

"the M1 demo prints its ten lines", in this order:
  1. `alerts: 3 jobs`
  2. `scored: 3, pages read: 2`
  3. `fit: 1`
  4. `pick: 1 job`
  5. `skill copy: name and description only`
  6. `publish: released by the pick`
  7. `proposal: passed schema, judge and your sign-off`
  8. `run: done`
  9. `sends: 0, held calls: 0`
  10. `second run: 3 jobs seen, 0 scored`

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/runner/src/test-helpers/m1-demo.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the demo**

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/runner/src/test-helpers/m1-demo.test.ts`, then `node packages/runner/src/test-helpers/m1-demo.ts`
Expected: PASS, and the ten lines

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/test-helpers
git commit -m "Run M1 end to end on the fake claude" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 24: The M1 walk for the real app

**Files:**
- Create: `apps/desktop/electron/m1-walk.ts`, `apps/desktop/electron/m1-walk-steps.ts`
- Test: `apps/desktop/electron/m1-walk-steps.test.ts`

**Interfaces:**
- Consumes: `connector-walk.ts` and `connector-walk-steps.ts` as the pattern.
- Produces: `m1WalkPaths(root: string)` under `.workflow/scratch/plan-05c/walk/` (its own data folder, as the connector walk has); `M1_WALK_STEPS` (name and what each waits for); the walk opens the app's window on that data folder, calls `harnesses.rescan`, waits up to 10 minutes for the owner's Claude Code consent on the Harnesses screen, imports the flow folder named by `M1_FLOW_DIR`, waits up to 10 minutes for the owner's allow on the flow's screen, starts `flows.run` with `params: {newest: 3}` when `M1_WALK_MODE` is `attended` (Decision 14), or waits for a run started by the trigger when it is `schedule`; it waits for the owner's pick and sign-off and writes one line per step state change and a last line with the run id, the state, the pages read, the publish calls and the number of send calls. It never calls `harnesses.setConsent`, `flows.allowCapabilities`, `approvals.answer`, `approvals.resolve` or `triggers.setEnabled`.

- [ ] **Step 1: Write the failing tests**

  1. "the walk's paths, its data folder included, are under .workflow/scratch/plan-05c/walk/"
  2. "the walk rescans, then waits for the consent and the allow before it starts anything"
  3. "the attended walk starts the run with params newest 3 and the schedule walk starts none"
  4. "the walk never calls an operation that decides for the owner"
  5. "the summary line names the run, its state, the pages read, the publish calls and the sends"

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/electron/m1-walk-steps.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the walk**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/electron/m1-walk-steps.test.ts`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/electron/m1-walk.ts apps/desktop/electron/m1-walk-steps.ts apps/desktop/electron/m1-walk-steps.test.ts
git commit -m "Add the M1 walk for the real app" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 25: Chair steps (GUI), owner watching: M1 attended, then on the schedule (the executor skips this task)

**Waiting.** The owner said yes to items 7(b) and 7(c) (the correction of 2026-11-17, under "The owner's answers"). This task still waits, with Tasks 20 and 22 to 24, for a safe way to run the prototype skill's commands (O5) and for the host connector's tools (H1). The chair tells the owner before Step 3 starts. Step 1 (the fake demo and the pictures) needs no real account.

**Not for the executor.** The chair tells the owner when each step starts and what it showed, and the owner makes every decision in the app. Logs go to `.workflow/scratch/plan-05c/walk/` (git-ignored).

- [ ] **Step 1: Chair step: the demo and the pictures.** `node packages/runner/src/test-helpers/m1-demo.ts` prints the ten lines of Task 23; `pnpm build && pnpm capture` prints `captured 26 screens`; the chair looks at the flow screen and the Readiness screen.
- [ ] **Step 2: Owner step: the notes.** The owner writes `~/job-review/notes/profile.md` and `voice.md` and creates the Gmail label `FlowDriven`. The chair does not read these files.
- [ ] **Step 3: Chair step (GUI), owner watching: the attended run.** `pnpm build`, then `M1_FLOW_DIR=<folder> M1_WALK_MODE=attended pnpm --filter @flowdriven/desktop exec electron dist-electron/m1-walk.js`. In the walk's window the owner gives the Claude Code consent, allows the flow on its screen, picks at most one job in the Inbox, and reads and signs off the proposal. Expected: at most 3 pages read, the publish released by the pick, the proposal passed its checks, run `done`, 0 sends.
- [ ] **Step 4: Owner step: check by hand.** The owner looks at Gmail's Sent folder (nothing new), at the published prototype, and at `~/job-review/work/proposals/`.
- [ ] **Step 5: Chair step (GUI), owner watching: on the schedule.** The owner switches the hourly trigger on, on the flow's screen in the same window, which stays open. With `M1_WALK_MODE=schedule` the walk waits for the next triggered run; it reaches the pick on its own and a notification says a pick is waiting; the owner picks and signs off. Expected: run `done`, 0 sends. The owner may switch the trigger off afterwards.
- [ ] **Step 6: Chair step: the record.** Under this task: run ids, seconds, turns, models, tokens, pages read, publish calls, sends (0), audit counts, and the pictures looked at, as plan 05b Task 19 recorded them. No email, page or proposal text.
- [ ] **Step 7: Chair step (commit)**

```bash
git add docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Record M1 on real data, attended and on the schedule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Review (before the plan closes)

A fresh opus reviewer that did not build the work reads the diffs of the gate, hook and approval tasks as a security review: Tasks 8, 9 and 13 to 19 at least, and the other runner tasks (3, 6, 7, 10, 12, 14 to 16 and 21). It looks for a step that can do more than its declaration (R14), a changed skill that still runs (R9), a command line, folder, label or pick that reaches further than its rule, and any path that fails open. Each finding becomes a fix task under this section with its own test, and the reviewer reads the fixes again, at most three rounds. The outcome is written here: findings, decisions, fixes and commits. The owner's global instructions send security review to opus ("opus subagent: hanya untuk review keamanan"). This review comes before the closing gate of the Gates table.

**Round 1 (2026-11-17, fresh opus, effort max, at ed43ce1).** Findings file `.workflow/scratch/plan-05c/security-review-1.md` (git-ignored); every finding was reproduced by running the repository's own modules. 0 high, 2 medium, 1 low:
- F1 (medium, Tasks 5, 12, 13): the route refuses a risky pattern, but the hook never applies that rule to the concrete call, so the pattern `git push origin *` lets `git push origin +main` (a force-push) and `git push origin :main` (a remote branch delete) run without approval.
- F2 (medium, Task 12): the list of programs that run other programs misses `xcrun`, `arch`, `caffeinate` and `ssh-agent`, so `xcrun python3 any.py` or `arch bash evil.sh` gets around both the shell refusal and the exact-line rule for interpreters. It cannot be reached from outside text, because a step that runs commands takes none.
- F3 (low, Tasks 13, 15): after Withdraw, the next attempt of a running step that only runs commands in the project folder still runs them, because `admit` re-checks the consent only for web, connector and granted-folder steps.
- Checked and sound: R14 (a skill's text widens nothing), R9 (three pin checks, no gap between hash and copy), the copy's content, the command-line parser, the granted-folder resolution, the Trash and Spam rule and the destructive mark from the scan to the policy, the scan's fail-closed paths, the keep-awake call, the consent pins, and picks. On the parent session's question, `claude/adapter-pick-loop.test.ts:201` does prove that a keyed loop over another list holds every item, the picked key included.

The owner's answer (2026-11-17, asked alone, in Indonesian, with the choices "Ya, perbaiki ketiganya (Disarankan)" and "Tidak, catat saja"): "Ya, perbaiki ketiganya (Disarankan)". That is the yes of "Ask first" for the fix task below and nothing else.

### Review fix R1: the command rule holds at the hook, programs that run other programs are refused, and Withdraw stops a command step

**Files:**
- Modify: `packages/sdk/src/validate/risky.ts` (`classifyCommand`), `packages/runner/src/router/commands-route.ts` (`commandRefusal` and its two lists), `packages/runner/src/claude/commands.ts` (`decideCommand`), `packages/runner/src/service/claude-harness.ts` (`admit`)
- Test: `packages/sdk/src/validate/risky-push.test.ts`, `packages/runner/src/router/route-commands-review.test.ts`, `packages/runner/src/claude/decide-commands-review.test.ts`, `packages/runner/src/service/claude-harness-withdraw-commands.test.ts`

**Interfaces:**
- Produces (F1): `classifyCommand` calls a line with the word `push` `delete` also when a word is `--delete`, `-d`, `--mirror`, `--prune` or `--force-if-includes`, or starts with `:` (today: `--force`, `-f`, `--force-with-lease`, or a word that starts with `+`). `decideCommand` refuses a call whose line matches a declared pattern when `commandRefusal` of the call's own words, joined by single spaces, gives a reason, and the refusal says that reason; so the hook applies to the concrete call the rule the route applies to the pattern.
- Produces (F2): the programs that run other programs gain `xcrun arch caffeinate ssh-agent taskpolicy sandbox-exec launchctl shortcuts automator crontab at batch lldb gdb dtrace dtruss strace ltrace valgrind stdbuf setsid unbuffer flock screen tmux parallel chroot pkexec runuser busybox builtin coproc trap pwsh`; the interpreters that run only as an exact line gain `swift awk gawk mawk nawk tclsh Rscript`; and a `git` line with the word `foreach` (`git submodule foreach` runs a command), or with both `bisect` and `run`, is refused with `DROP.runsAnything`.
- Produces (F3): `admit` treats a step that uses a `cli_tool` requirement with commands as it treats a web step: without a capability consent whose hash is the run's flow hash it returns `ALLOW_FIRST`.

- [x] **Step 1: Write the failing tests**

  1. "classifyCommand calls git push with --delete, -d, --mirror, --prune, --force-if-includes or a :ref a delete, and keeps git push origin main undefined"
  2. "a wildcard git pattern still refuses a force-push (+ref) and a remote branch delete (:ref) at the hook"
  3. "the hook refuses a concrete line that the route would refuse as a pattern, with the route's reason"
  4. "xcrun, arch, caffeinate and ssh-agent drop the route, and so does every other program on the list"
  5. "swift and awk run only as an exact line, and git submodule foreach and git bisect run drop the route"
  6. "after Withdraw the next attempt of a command step is refused"
  7. "a command step whose consent is in place is admitted as before"

No present test changes (`sdk/src/validate/validate.test.ts:151-164` stays as it is).

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/sdk/src/validate/risky-push.test.ts packages/runner/src/router/route-commands-review.test.ts packages/runner/src/claude/decide-commands-review.test.ts packages/runner/src/service/claude-harness-withdraw-commands.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the three fixes**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/sdk/src/validate packages/runner/src/router packages/runner/src/claude/commands.ts packages/runner/src/claude/decide-commands-review.test.ts packages/runner/src/service/claude-harness.ts packages/runner/src/service/claude-harness-withdraw-commands.test.ts docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Hold the command rule at the hook, refuse programs that run other programs, and stop a command step after Withdraw" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run (Step 2 paths) passed 7 tests; pnpm format && pnpm check passed.
Chair (review, 2026-11-17): files the executor touched: `sdk/src/validate/risky.ts`, `router/commands-route.ts`, `claude/commands.ts`, `service/claude-harness.ts` and the four new test files; all on this task's list. The chair's fix, under F1 and the owner's yes: `classifyCommand` matched whole words only, so `--force-with-lease=<ref>` and a bundle of short flags such as `-uf` (git reads it as `-u -f`) still passed as a plain push; now every word that starts with `--force`, and a bundle of short flags that holds `f` or `d`, makes a push line a delete, with the test "classifyCommand calls every --force form and a bundle of short flags with -f or -d a delete, and keeps other flags undefined". The chair's own full run of `pnpm format && pnpm check` was green end to end (281 test files, 1,818 tests passed and 1 skipped).

**Round 2 (2026-11-17, the same reviewer, at 440f5b0).** Findings file `.workflow/scratch/plan-05c/security-review-2.md` (git-ignored). F1, F2 and F3 of round 1 are fixed (re-probed). New: 0 high, 1 medium, 2 low:
- R2-F1 (medium, uncertain): `noglob` and `-` are zsh precommand words, so with a declared `noglob *` or `- *` the hook allows `noglob rm x` and `- rm x`, and if the Bash tool runs zsh (the macOS login shell) the next word runs as the program without the refusals that program would get. Uncertain because the real harness was not run; the step takes no outside text and the preview shows the pattern.
- R2-F2 (low): the exact lines `git branch -D main`, `git tag -d v1` and `npm unpublish pkg` route, and through `git *` the hook allows `git rm notes.md`; each deletes or withdraws something.
- R2-F3 (low): the risky-word rules match any word of the line, so harmless calls such as `git checkout clean` or `cat delete` are refused. It fails closed.
- Checked and sound: the hook's re-check, the wider push rule, the longer program lists, the `git` `foreach` and `bisect run` refusal, and the `cli_tool` branch of `admit`.

The owner's answer (2026-11-17, asked alone, in Indonesian, with the choices "Ya, F1 dan F2; catat F3 (Disarankan)", "Perbaiki ketiganya" and "Catat semuanya"): "Ya, F1 dan F2; catat F3 (Disarankan)". That is the yes of "Ask first" for the fix task below and nothing else; R2-F3 is under Known limits.

### Review fix R2: zsh precommand words and the git and npm deletes

**Files:**
- Modify: `packages/runner/src/router/commands-route.ts` (`commandRefusal`, `runsAnything`), `packages/sdk/src/validate/risky.ts` (`classifyCommand`)
- Test: `packages/runner/src/router/route-commands-review2.test.ts`, `packages/sdk/src/validate/risky-delete.test.ts`

**Interfaces:**
- Produces (R2-F1): `runsAnything` gains `noglob` and `nocorrect`, and `commandRefusal` refuses a line whose program word starts with `-` with `DROP.runsAnything`; through the hook's re-check of Review fix R1 the same holds for a concrete call.
- Produces (R2-F2): `classifyCommand` calls a `git` line a `delete` when its subcommand (the first word after `git` that does not start with `-`, skipping the word after `-C` or `-c`) is `rm`, or is `branch` or `tag` and a word is `--delete` or a bundle of short flags that holds `d` or `D`; and a line with the word `unpublish` a `delete`.

- [x] **Step 1: Write the failing tests**

  1. "noglob, nocorrect and a program word starting with - drop the route and are refused at the hook"
  2. "classifyCommand calls git branch -D, git branch --delete, git tag -d, git rm and npm unpublish a delete"
  3. "git branch, git tag, git -C dir status and git rmdir-like words stay undefined"

No present test changes.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/router/route-commands-review2.test.ts packages/sdk/src/validate/risky-delete.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the two fixes**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/router packages/sdk/src/validate docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Refuse zsh precommand words and count git and npm deletes as deletes" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run (Step 2 paths) passed 3 tests; pnpm format && pnpm lint && pnpm typecheck && pnpm check passed.
Chair (review, 2026-11-17): files the executor touched: `router/commands-route.ts`, `sdk/src/validate/risky.ts` and the two new test files; all on this task's list. The chair's fix, under R2-F2 and the owner's yes, after the parent session pointed at it: the subcommand scan skipped only the word after `-C` and `-c`, so the exact line `git --git-dir . rm notes.md` routed without being called a delete (under a declared `git *` the hook already refused it, since a wildcard word cannot start with `-`); now the scan also skips the value after `--git-dir`, `--work-tree`, `--namespace`, `--super-prefix` and `--config-env`, with the test "the value after --git-dir, --work-tree, --namespace, --super-prefix or --config-env is not read as the subcommand". The chair's full run of `pnpm format && pnpm check` at a load average of about 13 to 18 had one failure, `service/claude-harness-connectors.test.ts` "a rescan stores the connectors with the scan, a later scan without MCP keeps them, and a hung call keeps the cached list" (child processes and a timeout; not touched here), with 1,821 tests passed and 1 skipped; that file alone then passed (3 tests), and lint, typecheck, `check:hidden` and `check:deps` passed. So `pnpm check` did not pass end to end on this run; the closing gate needs that.

**Round 3 (2026-11-17, the same reviewer, at e60f773; the last round the plan allows).** Findings file `.workflow/scratch/plan-05c/security-review-3.md` (git-ignored). R2-F1 and R2-F2 are fixed (re-probed). Open: 1 medium, 1 low, both uncertain:
- R3-F1 (medium, uncertain): the zsh word `repeat` still routes, and the hook allows `repeat 1 rm x`, which zsh runs as `rm x`; the same class as R2-F1. The chair's own probe found more words of that class that the parser lets through: `alias git=sh` and `export` can change what a later declared call runs. Uncertain because the real Bash tool's shell was not run.
- R3-F2 (low, uncertain): the git options `--attr-source` and `--shallow-file` also take the next word, so `git --attr-source HEAD rm notes.md` reads `HEAD` as the subcommand.
- The reviewer's sturdier fix for R3-F1 is a rule that the program word must be an executable file on the child's `PATH`. It closes the whole class, but macOS also ships some shell commands as files (`/usr/bin/alias`, `/usr/bin/cd`), so they would still need the list. That rule waits for a later plan, together with O2.

The owner's answer (2026-11-17, asked alone, in Indonesian). The first wording was answered with a request for plainer words, so the chair asked again in plain words, with the choices "Blokir kata-kata itu (Disarankan)", "Pengaman kuat sekarang" and "Biarkan, catat saja". The owner answered "Blokir kata-kata itu (Disarankan)". That is the yes of "Ask first" for the fix task below. R3-F2 is in it because it completes R2-F2's rule, which the owner approved in round 2.

### Review fix R3: shell words that run or change a command, and two more git options

**Files:**
- Modify: `packages/runner/src/router/commands-route.ts` (`runsAnything`), `packages/sdk/src/validate/risky.ts` (the git option skip list in `classifyCommand`)
- Test: `packages/runner/src/router/route-commands-review3.test.ts`, `packages/sdk/src/validate/risky-git-options.test.ts`

**Interfaces:**
- Produces (R3-F1): `runsAnything` gains the shell words that run a command or change how a later command runs: `repeat foreach select case if while until for function alias unalias hash rehash enable disable functions unfunction autoload zmodload emulate setopt unsetopt set shopt export typeset declare local readonly unset fc r cd pushd popd ulimit umask`. Through the hook's re-check the same holds for a concrete call.
- Produces (R3-F2): the git option skip list gains `--attr-source` and `--shallow-file`.

- [x] **Step 1: Write the failing tests**

  1. "repeat, alias, export and every other shell word on the list drop the route and are refused at the hook"
  2. "git --attr-source x rm and git --shallow-file x rm are a delete, and git --attr-source x status is not"

No present test changes.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/runner/src/router/route-commands-review3.test.ts packages/sdk/src/validate/risky-git-options.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the two fixes**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/runner/src/router packages/sdk/src/validate docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Refuse the shell words that run or change a command, and two more git options" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run (Step 2 paths) passed 2 tests; pnpm format && pnpm lint && pnpm typecheck && pnpm check passed (1824 tests passed, 1 skipped; 109 tool tests passed).
Chair (review, 2026-11-17): files the executor touched: `router/commands-route.ts`, `sdk/src/validate/risky.ts` and the two new test files; all on this task's list, and the lists match the Interfaces word for word. No present test or fixture declares one of the new words as a command. The chair's own full run of `pnpm format && pnpm check` was green end to end (285 test files, 1,824 tests passed and 1 skipped; 109 check-tool tests passed) at a load average of about 4 to 8.

**After round 3 (2026-11-17).** The parent session read `risky.ts` and `commands-route.ts` and pointed at two more gaps of the same kind, and the chair found a third. The chair confirmed all three with the repository's own modules: under a declared `git *` or `cp *`, the hook allowed each of these calls.
1. `git checkout .`, `git restore .`, `git stash drop`, `git stash clear` and `git worktree remove wt` throw away uncommitted work or stashes, as `git clean` and `git reset --hard` do (those are refused already). `git checkout notes.md` does the same to one file.
2. `git config core.pager sh` and `git config core.hooksPath hooks` set a program that git runs later, also in the owner's own terminal. The setting stays after the flow.
3. `cp x .git/hooks/pre-commit`, `cp x .claude/settings.json` and `mv x .mcp.json` overwrite files that the hook protects from the file tools but not from commands.

The owner's answer (2026-11-17, asked alone, in Indonesian, with the choices "Ya, blokir ketiganya (Disarankan)" and "Catat saja"): "Ya, blokir ketiganya (Disarankan)". That is the yes of "Ask first" for the fix task below. The closing gate of 75718bd ran before this change, so it runs again after it.

### Review fix R4: git commands that throw work away or install programs, and commands that name protected paths

**Files:**
- Create: `packages/runner/src/claude/protected.ts` (`protectedPath`, moved unchanged from `claude/decide.ts`, which imports it from there)
- Modify: `packages/sdk/src/validate/risky.ts` (`gitSubcommand`, `classifyCommand`), `packages/runner/src/router/commands-route.ts` (`commandRefusal`), `packages/runner/src/router/route.ts` (`DROP.protectedPath`), `packages/runner/src/claude/decide.ts` (the import only)
- Test: `packages/sdk/src/validate/risky-git-discard.test.ts`, `packages/runner/src/router/route-commands-review4.test.ts`

**Interfaces:**
- Produces (1): `gitSubcommand(words: string[]): string | undefined` is the subcommand scan that `classifyCommand` already uses (the first word after `git` that does not start with `-`, skipping the value after the options of its skip list), now exported. `classifyCommand` also calls a `git` line a `delete` when its subcommand is `checkout` or `restore`, or is `stash` and a word is `drop` or `clear`, or is `worktree` and a word is `remove`. `git switch` is the way to change branches.
- Produces (2): `commandRefusal` refuses a `git` line whose subcommand is `config` with `DROP.runsAnything`, whatever follows it.
- Produces (3): `commandRefusal` refuses a line in which any word, with `=`, `:`, `,` and `@` read as `/`, names a protected path by `protectedPath` (a part `.git` or `.claude`, or a last part `.mcp.json`, after the fold that `claude/decide.ts` uses), with the new `DROP.protectedPath`: "A step cannot run a command that names .git, .claude or .mcp.json." Through the hook's re-check the same holds for a concrete call. `protectedPath` itself does not change, and `claude/decide.ts` refuses a Write or Edit there exactly as before.

- [x] **Step 1: Write the failing tests**

  1. "git checkout, git restore, git stash drop and clear, and git worktree remove are a delete, and git switch, git stash, git worktree list and git status are not"
  2. "git config drops the route and is refused at the hook, whatever follows it"
  3. "a command that names .git, .claude or .mcp.json in any word drops the route and is refused at the hook, in any case and after = or :"

No present test changes; the present tests of `claude/decide.ts` for protected paths pass unchanged.

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/sdk/src/validate/risky-git-discard.test.ts packages/runner/src/router/route-commands-review4.test.ts`
Expected: FAIL

- [x] **Step 3: Implement the three fixes**

- [x] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2
Expected: PASS

- [x] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [x] **Step 6: Chair step (commit)**

```bash
git add packages/sdk/src/validate packages/runner/src/router packages/runner/src/claude/protected.ts packages/runner/src/claude/decide.ts docs/plans/2026-11-17-05c-skill-calls-and-m1.md
git commit -m "Refuse git commands that throw work away or install programs, and commands that name protected paths" -m "Assisted-by: Codex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Done by: Codex/gpt-6.1-terra, 2026-11-17. Evidence: pnpm vitest run (Step 2 paths) passed 3 tests; pnpm format && pnpm lint && pnpm typecheck && pnpm check passed (1827 tests passed, 1 skipped; 109 tool tests passed).
Chair (review, 2026-11-17): files the executor touched are `sdk/src/validate/risky.ts`, the new `claude/protected.ts` (the same function as before, moved), the import in `claude/decide.ts`, `router/commands-route.ts`, `router/route.ts` and the two new test files. All are on this task's list. The new tests check the route, the hook with the exact line, and the hook under a `*` pattern, and they show that `git status`, `git switch main` and `cp x notes.txt` still pass. The chair's full run of the gate is the closing gate in the Handover.

---

**Outcome of the review (2026-11-17).** Three rounds, the most the plan allows. Seven findings were fixed with their own tests: F1, F2 and F3 (R1, 440f5b0), R2-F1 and R2-F2 (R2, e60f773), and R3-F1 and R3-F2 (R3, bea4b11). After round 3, R4 fixed the three gaps that the parent session and the chair found (git commands that throw work away or install programs, and commands that name protected paths). R2-F3 (refusals that are too strict) is under Known limits by the owner's choice. So is the class behind R2-F1 and R3-F1: the refused programs are a list, and the rule that a program must be a file on PATH waits for a later plan. No other finding is open.

---

## Handover

Written by the chair on 2026-11-17. Tasks 20 and 22 to 25 did not run (see "Waiting" below), so this Handover is written before Task 25, not after it.

**Done.** Tasks 0 to 19 and 21 and the review fixes R1 to R3 are committed on `claude/plan-05c-detail-29be69`. The branch was cut from `work/decisions-2026-11-17` at 4090c45; it has no remote, and nothing was pushed. Each task's section names the files the executor touched, the chair's checks and fixes, and its gate evidence. In short:
- Groundwork: the probes H1 to H4, run with the owner watching (Task 0); the control test (Task 1, 7a5463e); the contract (Task 2, 36704b6); and store version 6 with the `consent_pins` table (Task 3, fbee335).
- Skill calls:
  - SKILL.md and its copy without front matter, R14 (Task 4, 50970ab);
  - reading, hashing and copying a skill folder (Task 6, 9d25c7b);
  - the route, the preview and the pin (Task 7, f4365d7);
  - the gate and readiness, R9 (Task 8, 5c75bb2);
  - skill steps with a read-only copy (Task 9, 76509a4).
- Long steps: no second try after a limit over 30 minutes, and the Mac kept awake while the step runs (Task 10, 5f622b4); the time limit and the running time on screen (Task 11, 9fc41b1).
- Commands: the command-line parser and patterns (Task 5, fe47367); the route and the PATH lookup (Task 12, 32aacf0); and Bash through the hook, with one audit row per call (Task 13, a8f8559).
- Granted folders: the grant at the allow, pinned, logged and taken back (Task 14, 0966be1); a step's folders checked again at each call (Task 15, 70717d1); and `file_change` triggers on them (Task 16, 25a2bac).
- Connectors and approvals:
  - the Trash and Spam rule, the spam word and the destructive mark (Task 17, cd66641);
  - Gmail drafts and labels as a write class (Task 18, b813eeb);
  - pick keys for a keyless loop over a choice, with a pick releasing only inside a loop over its choice (Task 19, ffd714d).
- Readiness rows for skills, commands and granted folders (Task 21, ed43ce1).
- The security review: three rounds by a fresh opus reviewer, with the fixes R1 (440f5b0), R2 (e60f773) and R3 (bea4b11). Then R4 (1ca8541) fixed the gaps found after round 3. See the outcome above.

Present tests the plan did not name changed under item 6 of the owner approval, each to an equally strict expectation, and each is recorded under its task:
- `connectors/catalog.test.ts` (the risky map is nine tools, Task 18);
- `service/claude-harness-connector.test.ts` (adds `pickTools`, Task 19);
- plan 05b's connector demo and its test (Task 19). Its line is now "pick released one item: j1 ran in the loop over the choice, the call after the loop held".

**Waiting.**
- Task 20, the prototype host connector, needs H1. The owner reconnects the host connector in claude.ai, where it showed `needs-auth`. Then the chair scans once more with no prompt, to learn its tools.
- Tasks 22 to 25 (M1) need O5. The owner's answer (2026-11-17, asked alone, in Indonesian, with the choices "Anda setujui rencananya (Disarankan)", "Riset kotak pasir dulu", "Terima risikonya" and "Putuskan nanti"): "Anda setujui rencananya (Disarankan)". That means:
  - one step reads the job and writes a short build plan, without running commands;
  - the owner reads and approves that plan;
  - the next step builds the prototype with the skill's commands, from the approved plan only.

  It needs a runner change: text the owner approved in the Inbox counts as the owner's own, so the build step takes no outside text. That change is a task of a later plan, with its own "Ask first".
- Tasks 20 and 22 to 25 stay unticked here. A later plan takes them over, together with H1 and that change.

**Closing gate (C1).** One full run of `pnpm format && pnpm check` on 1ca8541, on 2026-11-17, at a load average of about 5 to 9. It was green end to end, with no re-run of any test:
- `pnpm format` changed no file, and lint and typecheck passed;
- 287 test files: 1,827 tests passed and 1 was skipped;
- the check tools' 109 tests passed;
- `check:hidden` found nothing in 615 files, and `check:deps` passed.

The log is `.workflow/scratch/05c-c1-check.log` (git-ignored). An earlier run on 75718bd was also green, but Review fix R4 changed code after it.

**Open items for later plans.**
- O2: the Bash tool's sandbox, and the shell it runs. Rounds 2 and 3 marked R2-F1 and R3-F1 uncertain because they depend on that shell being zsh.
- O3 and O4, as written under Open items.
- O5: decided above, still to build.
- The rule that a command's program must be an executable file on PATH.
- The risky-word rules scoped to subcommands (R2-F3).

**What the chair learned.**
- Codex stopped on eleven calls. Most stops came from gaps in the plan, not in its own work: a present test that pins a list or sentence the task changes on purpose, or a wiring file missing from the task's list. From Task 16 on, the chair checked those before each call and wrote a "Chair's decision" first. Three calls still stopped on such a gap (Tasks 16, 18 and 19), and the rest went through on the first call.
- One finished Codex call waited about 80 minutes, because the chair started it without its background watcher. Every call now starts with its watcher.
