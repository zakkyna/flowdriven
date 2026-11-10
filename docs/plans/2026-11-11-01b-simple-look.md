# Plan 01b: The Simple Look Implementation Plan

> **Execution:** one task per Codex call through the handoff rules in AGENTS.md; Claude reviews each task against its gates. Steps use checkbox syntax for tracking.

**Goal:** Every screen of the app has the approved simple look: a sidebar with the flows, the conversation in the centre, the work pane on the right, hairlines instead of shadows, colour only for state, an ink primary button, the system font, a light and a dark theme. Behaviour stays as plan 01 left it, except "New flow" (decision 11).

**Architecture:** A new token set (the "UI design" section below replaces the one in plan 01) drives restyled shared parts (icons, state marks, buttons, check lines, dialog), then a new frame (sidebar with a flows list, no "Builder" destination), then one screen per task. The flows list comes from the existing `flows.list` operation, so no contract change is needed. Every task leaves the app working and `pnpm check` green.

**Tech Stack:** Only what plan 01 installed. Plain CSS with variables and CSS modules, React 19, Vitest with happy-dom and Testing Library, Biome. No new dependency, no CSS framework, no icon package.

**Spec:** `docs/superpowers/specs/2026-11-10-flow-maker-design.md` (sections 8.2, 9.3, 12, 13.2, 13.3, 15.3; the look is the owner's decision recorded in section 5 on 2026-11-10 and in 18.4, and its values are carried by this plan). Roadmap: `docs/plans/ROADMAP.md`. Builds on plan 01 (branch `work/plan-01`, commit 26b70b7 "Reset the real scroller, focus the Builder heading and typecheck the Electron tests"). Every path, name and test this plan cites was checked against that commit. The tip of `work/plan-01` (422f30b) adds only documents above it. Before Task 1 the chair re-verifies the base: `git diff --stat 26b70b7 work/plan-01 -- apps packages tools` prints nothing, and `pnpm check` passes on the tip with 36 test files and 236 tests. If it prints a file, the chair re-checks the "Tests this plan changes or replaces" table against that change. Then the chair cuts `work/plan-01b` from the tip of `work/plan-01`.

## Global Constraints

- English everywhere: code, UI copy, documents, commit messages. UI copy stays as plan 01 wrote it unless a task names the change.
- A state is always icon plus words, never colour alone. Colour goes on the icon (and on a tint or a count badge), not on the words.
- Plain CSS with the variables in `apps/desktop/src/styles/tokens.css` and CSS modules. No colour literal (`#...`, `rgb(...)`, `rgba(...)`) outside `tokens.css`. No CSS framework, router, state library or icon package.
- Renderer code reads and writes only through `RunnerClient` (spec 8.2). This plan changes no contract and no fixture.
- Electron keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and loads no remote content. Only Task 1 touches `apps/desktop/electron/`, and only the window background colour.
- Every screen root keeps its `data-screen` and `data-screen-ready` attributes, and no sidebar or screen shows a `role="status"` element with the text "Loading" except `ScreenState`. `pnpm capture` waits on exactly these.
- Minimum window 1100 by 720. Nothing may need horizontal scrolling at that size.
- No network inside a task. No GUI inside a task. The executor never commits.
- Nothing in this plan edits CI, `tools/checks/`, `AGENTS.md`, `CLAUDE.md`, `package.json` or the lockfile.
- Temporary output goes to `.workflow/scratch/` (git-ignored) and is never committed.

## Gates

| Gate | Command | Passes when | Who |
|---|---|---|---|
| Task gate | `pnpm format && pnpm check` | exit 0 (36 test files and 236 tests pass at 26b70b7 before Task 1; the numbers only grow) | executor |
| Single test file | `pnpm vitest run <path>` | the named tests pass | executor |
| Web build | `pnpm build:web` | exit 0 and `apps/desktop/dist/index.html` exists | executor (Tasks 6 and 16) |
| Commit | `git add ... && git commit ...` | commit created on branch `work/plan-01b`, which the chair cuts from the tip of `work/plan-01` before Task 1 | **Chair step (commit)**, end of every task |
| Screen capture | `pnpm capture` | exit 0; 16 PNGs in `.workflow/scratch/screens/` (eight screens, two themes); no screen stays unready; no console error | **Chair step (GUI)**, after Tasks 1, 6 and 16 |
| Owner preview | `pnpm build:web && pnpm preview:web`, open `http://127.0.0.1:4173/` | the owner sees the screen in light and dark (`?theme=light`, `?theme=dark`) | **Chair step (GUI)**, after each screen task |

The executor skips every step marked "Chair step" and leaves it unticked.

## Dependency changes

None.

## Decisions made in this plan

The chair's decisions (1 to 10) and the builder's choices (11 to 25). Spec 18.4 leaves these open; a later plan can change them.

1. Scope: every screen gets the look: the frame, Builder, Inbox, Runs, Run detail, Readiness, Harnesses, Settings, and the shared parts (buttons, state marks, tags, dialog, form controls, links, focus ring). No new feature.
2. Sidebar, 256 px: the product mark and name; "New flow"; the destinations Inbox (with its count), Runs, Readiness, Harnesses, Settings; the list "Flows" (name on the first line, state as icon plus word on the second, the open flow marked); at the bottom the sample-data note in today's wording. "Builder" is no longer a destination; it opens when a flow is chosen or "New flow" is pressed. Choosing a flow today is a `<select>` in the Builder that navigates to `#/builder/<flowId>`, and `#/builder` opens the first flow of `flows.list`. The new controls keep exactly that. "New flow" has no behaviour today: see decision 11.
3. The flows list and its states come through `RunnerClient`: `flows.list` already returns `FlowSummary` with `lastRun` (`runId`, `state`, `startedAt`), so no contract change is made.
4. Builder: the conversation in the centre (reading width 720 px, anchored to the bottom, composer docked at the bottom) and the flow in a 460 px pane on the right. Suggested answers stay directly under the question they belong to, restyled as chips. They are not docked above the composer, and neither the chips nor the questions carry numbers: with each chip under its own question a number has no job, and the app today shows plain questions (question Q2 below). No one-line activity rows: the conversation data has no such entries.
5. Check lines: icon, check text (wraps with a hanging indent), result word in its own right-aligned column aligned to the first line. Only the icon carries the state colour.
6. Inbox: list 368 px, reading column at most 640 px. Everything that would be sent stays above the buttons. Approve is the only filled button; Edit and Reject are equal outlined buttons; "Approve all N similar for this run" is a text button under a hairline with its explanation below. Every Inbox protection stays (wrong-item guards, hidden-character display, expiry rules); no Inbox test is weakened.
7. Themes follow the system. The override is the query `?theme=light|dark` (plan 01 decision 18). `src/theme.ts` reads only the query, and Settings has no theme control today; this plan adds none (a control would be a new feature, decision 1). See Q4. Both themes use the values below. The window background that Electron paints before the page loads equals `--surface-app` of each theme and is pinned by a test (Task 1).
8. Type: `system-ui` for everything, Menlo where a fixed width helps (ids, counts, step numbers, paths). Inputs, text areas, selects and buttons take the app font and the theme colours (Task 3).
9. Unchanged rules: a state is icon plus words; plain CSS, tokens and CSS modules; no new dependency; Electron security options untouched.
10. `pnpm capture` is a chair step. It must pass after Tasks 1 (shell), 6 (frame) and 16 (end).
11. **Question for the chair: "New flow".** Plan 01 has no "new flow" behaviour; the Builder shows an empty conversation only when `flows.list` is empty. The smallest honest behaviour: "New flow" opens `#/builder/new`, the Builder in the state it already supports for an empty install (no flow, an empty conversation, the composer). A message sent there calls `flows.build` without a `flowId`, exactly as the empty install does today, and the reply is shown. The sample client does not create a flow, so nothing is saved. No flow named "new" can exist (flow ids contain a dot), so the route cannot clash. Pressing "New flow" again while it is open does nothing (the route does not change, so the draft stays); leaving it drops the draft. Task 5 builds this; say no and drop Task 5 and the "New flow" link in Task 6.
12. Runs, Readiness and Harnesses keep their routes and structure (a table; a flow select with a checklist; a list of harness articles) and get the look inside one reading column under a 52 px bar. The sketch of list-plus-pane for these three would change navigation and behaviour, which decision 1 forbids.
13. The tone `accent` becomes `wait` ("Waiting for you", "Needs login", "Changed since approval"). `--accent` is now the quiet violet of the product: the mark, the focus ring and the current-row marker. It never means "waiting".
14. Check lines show only the verdict words the contract has: "Passed", "Failed", "Not run yet". A plain `Check` (no run result yet) reads "Not run yet". The contract has no running check verdict (`CheckVerdict` is passed, failed or pending), so a check line never says "Running"; "Running" appears on the step row (from `StepRunState`). See Q5.
15. A suggestion chip has no chosen state: pressing it sends the answer at once, as today.
16. Chat messages show no author names or times; each message starts with a visually hidden "You, 10 Nov, 08:30:" (or "FlowDriven, ...") so the information stays available to screen readers.
17. `Button` gains `size` ("small" 28 px, "default" 32 px, "large" 36 px) and the variant "text". Styling uses `data-variant` and `data-size` attribute selectors, which tests can read.
18. The Builder pane shows "Latest run run-0006" as a link to that run, from the `lastRun` that `flows.list` already returns. It is hidden when the flow has no run.
19. The Dialog loses its shadow and gets a 1 px `--border` edge; its scrim is `--overlay` (light `rgba(0, 0, 0, 0.4)`, dark `rgba(0, 0, 0, 0.6)`).
20. The Inbox no longer shows the line "Decisions waiting for you. Nothing risky happens until you approve it." once loaded (it stays on the loading and error states). Screens built on `Page` keep their description line under the bar.
21. The "Approve all N similar" explanation reads "You see all N sends before anything is approved. This covers this run only." (the noun follows the action: sends, posts, changes, and so on). It matches what the confirmation dialog already does.
22. A "Latest run" link, the "Nothing is sent until you choose." line and the fixed strip text above the payload are the only new strings; each is named in its task.
23. Scroll reset follows the zones. Plan 01 resets the scroll of `section[data-screen]` on every route change (commit 26b70b7). Once each zone scrolls on its own, every zone that should start at the top carries `data-scroll="top"` (the `Page` body, the Builder pane body, the Inbox decision), and `App` resets every `[data-scroll="top"]` inside `main` on a route change (Task 7). The chat thread carries `data-scroll="bottom"`: `ChatPanel` keeps it at the newest message, as today. The Inbox list carries neither: choosing a decision must not move the list away from the row just clicked; it starts at the top whenever the Inbox is opened, because it is mounted anew.
24. Headings keep their focus and title. Every screen's `h1` keeps `tabIndex={-1}`; after a screen loads, its `h1` takes focus and sets `document.title` to "<h1 text> - FlowDriven", as plan 01 does. The Builder keeps its `headingRef` effect (commit 26b70b7) on whichever `h1` it shows ("New flow", "Builder" or the flow name); the Inbox, which leaves `Page` in Task 10, gets the same effect on its own `h1`.
25. The selected Inbox tab is marked by more than a fill: a 2 px `--accent` bar under its label, like the current-row marker. A fill alone would mark it by shade only.

Questions for the chair (the plan goes ahead with the stated default unless the chair says otherwise before the named task):
- Q1, before Task 5: "New flow" as decision 11 describes. No: drop Task 5 and the "New flow" link in Task 6.
- Q2, before Task 8: questions without number badges (decision 4). Yes to badges: add a 20 px outlined circle (Menlo 11, `--text-muted`, 1 px `--border-strong`, `margin-top: 2px`) in a 20 px column with a 10 px gap before each question text, and assert `within(first).getByText("1")`.
- Q3, before Task 12: Runs, Readiness and Harnesses keep their single-column structure (decision 12) rather than a list-plus-pane.
- Q4, before Task 1: the theme override stays the query `?theme=light|dark` only. The chair's words were "the override that Settings already has", but Settings has none. A Settings control for the theme would be a new feature and its own plan; say so if it is wanted.
- Q5, before Task 4: check lines carry only the contract's words (decision 14), so "Running" is not a check word. A running check would need a contract change (its own task, before Task 4).

Chair's answers (2026-11-11): the stated default stands for all five. Q1: "New flow" as decision 11 describes. Q2: no number badges. Q3: the three screens keep their single-column structure. Q4: the query stays the only override; the app follows the system theme. Q5: check lines carry only the contract's words.

## Tests this plan changes or replaces

Nothing is deleted. Each row names the test, the task, and what happens. "Equal" means the new assertion proves the same behaviour; "stronger" means it also proves more.

| Test (file) | Task | Change | Why it is not weaker |
|---|---|---|---|
| `uses the agreed words` (`ui/status.test.tsx`) | 2 | the expected tone `"accent"` becomes `"wait"` | equal: same state, same icon and words; only the tone name changes (decision 13) |
| `the rail lists the six screens in order with the inbox count` (`App.test.tsx`) | 6 | replaced by `the rail lists five destinations, New flow and the inbox count` | stronger: it also asserts that no "Builder" link exists, where "New flow" points, and the tab order (skip link, New flow, Inbox) |
| `route changes reset scroll, title and focus` (`App.test.tsx`) | 7, then 10 | Task 7: the scroller is `[data-scroll="top"]` inside the screen section instead of the section itself (the section no longer scrolls; decision 23); Task 10: it opens `#/inbox/ap-0011`, waits for the decision `h2` instead of the description line (gone, decision 20), and reads the decision scroller again after the click | equal: still sets a real scroller to 200, changes the route, expects 0, then checks the Settings title, focus and `tabindex` unchanged |
| `chat shows the conversation and the preview reply`, `chat suggestions send as messages, and Cmd+Enter sends`, `chat guards submissions and preserves a draft when choosing a suggestion` (`Builder.test.tsx`) | 8 | `findByRole("complementary", { name: "Chat" })` becomes `findByRole("region", { name: "Chat" })` | equal: the chat is now the centre of the page, so it is a labelled region, not a side landmark; every other assertion in those tests is unchanged |
| `chat scrolls to the newest message after an update` (`Builder.test.tsx`) | 8 | `region` as above; the scroll box is `message.closest('[data-scroll="bottom"]')` instead of `message.parentElement?.parentElement`, with an added `expect(box).not.toBeNull()` | equal: the same assertion that the real scroller ends at `scrollHeight`; the box is found by its role in the layout, not by its depth |
| `the flow picker and the default flow` (`Builder.test.tsx`) | 9 | replaced by `choosing a flow in the sidebar opens it, and the first flow is the default` | stronger: it also asserts the Builder has no picker and that the chosen link is marked current |
| `does not repeat a summary equal to the flow name` (`Builder.test.tsx`) | 6, then 9 | Task 6: the count is taken inside `main` (the sidebar now holds the flow name too) and stays 2 (heading and select option); Task 9: it becomes 1 because the select is gone | equal: still proves the summary is not repeated |
| `shows harness names, singular count, and clears errors on flow switch` (`Builder.test.tsx`) | 9 | `fireEvent.change(getByLabelText("Flow"), ...)` becomes a click on the sidebar link | equal: same flow switch, same error clearing |
| `clears a failed update when leaving and returning to the flow` (`Builder.test.tsx`) | 9 | both `fireEvent.change(getByLabelText("Flow"), ...)` lines become clicks on the sidebar links (Email triage, then Figma to Flutter) | equal: same two flow switches, same `queryByRole("alert")` null at the end |
| `focuses the flow heading after loading and changing flows` (`Builder.test.tsx`) | 9 | the `fireEvent.change(getByLabelText("Flow"), ...)` line becomes a click on the sidebar link "One source into many social posts" | equal: same focus assertions on both headings and `tabIndex` -1 |
| `frame and screens own their scroll regions` (`review-b.test.ts`) | 7 | the regex that pins the `Page` scroll region and padding is updated to the new body (`overflow-y: auto`, padding `24px 32px 32px`) | equal: it still pins who scrolls and the padding, with the new numbers |
| `layout-guards.test.ts` | 16 | the file list gains `nav/Sidebar.module.css` and `ui/Page.module.css` | stronger |

Every Inbox test, every Runs, Readiness, Harnesses and Settings test, `Dialog.test.tsx`, `CheckList.test.tsx` (all six existing tests) and the electron tests stay as they are and must keep passing. The Inbox protections named in decision 6 stay pinned by `shows hidden characters and caps long recipient lists`, `edit preview reveals hidden characters and sends the previewed text`, `expands recipients and reveals line breaks in single-line fields`, `reveals summary metadata and places errors inside the dialog`, `approve all sends only the ids shown in its dialog`, `simultaneous clicks resolve once while the request is in flight`, `a second click after 400 ms cannot approve another decision`, `new arrivals do not replace the selected editor`, `expired decisions have no actions`, `resolved decisions have no decision actions and feedback is in the detail panel`, `batch cannot be dismissed while approvals are running`, `approve cannot be repeated before a delayed change event` (and its `edit` and `reject` cases), `a pending decision does not change a newer selection` and `a failed plain approval shows an alert in the detail`. Tasks 10 and 11 change only JSX and CSS in the Inbox: the `justResolved`, `previousSelection`, `inFlight` and `cancelDisabled` code in `InboxScreen.tsx` stays as it is.

## Review Focus

The five conditions most likely to bite a person using the restyled app that the plan 01 tests do not exercise, most likely first. Each is pinned in the task that owns the code.

1. Unreadable text in one theme: a muted word on the dark selected row, a state colour on the tinted running step, a control border below 3:1. Test: Task 1 `every text pair keeps its contrast in both themes` (the pairs and thresholds are in "UI design: Colour").
2. State shown by colour or motion alone: a spinner that is the only sign of "Running", a sidebar flow with an icon but no word, a spinner that keeps turning under reduced motion. Tests: Task 2 `a state mark is an icon plus a word and only a ring spins`; Task 6 `every flow in the sidebar has an icon and a state word`; the existing reduced-motion pin in `review-b.test.ts` stays.
3. A flash of the old colour when a window opens, because the Electron window paints its own background before the page: Task 1 `the window is painted with the page colour of each theme` (plus the chair's capture).
4. Keyboard and screen-reader users losing their place: a restyled control that sets `outline: none`, a composer whose focus ring is lost when the text area loses its own, or a screen heading that no longer takes focus once the Inbox leaves `Page` or the Builder heading moves into the pane bar. Tests: Task 3 `no stylesheet removes the focus ring except the composer, which replaces it`; Task 10 `the Inbox has one h1 and, with a decision open, one h2`; Task 5 `New flow opens an empty conversation ...`; the existing `focuses the flow heading after loading and changing flows`.
5. Three zones that do not fit the minimum window, or a long flow name that is cut off in the sidebar: Task 8 `rail, pane and the smallest chat fit the minimum window`; Task 6 `a long flow name wraps in the sidebar and is never cut off`.

---

## File Structure

New files are marked (new). Everything else exists at commit 26b70b7.

```
apps/desktop/electron/
  window-colors.ts                  WINDOW_BACKGROUND, windowBackground(dark) (new, Task 1)
  window-colors.test.ts             the colours equal the token values (new, Task 1)
  window.ts                         uses windowBackground (Task 1)
apps/desktop/src/
  styles/tokens.css                 the token set of "UI design" (Tasks 1, 3, 8)
  styles/base.css                   body, links, focus ring, form controls, motion (Tasks 1, 2, 3)
  styles/tokens.test.ts             token values, contrast, every var() resolves, no colour literals (new, Task 1)
  ui/icons.tsx                      16 px grid, new paths, spin (Task 2)
  ui/status.ts, status.test.tsx     tone "wait" (Task 2)
  ui/StatusBadge.tsx, .module.css   ToneIcon, StateIcon, StatusBadge as a state mark, Badge as a tag (Task 2)
  ui/Button.tsx, Button.module.css  variants and sizes (Task 3)
  ui/Button.test.tsx                (new, Task 3)
  ui/Dialog.module.css              no shadow, hairline edge (Task 3)
  ui/CheckList.tsx, .module.css, .test.tsx   check lines (Task 4)
  nav/route.ts, route.test.ts       the route #/builder/new (Task 5)
  ui/flow-state.ts, flow-state.test.ts       state of a flow for the sidebar (new, Task 6)
  nav/Sidebar.tsx, Sidebar.module.css        (new, Task 6)
  App.tsx, App.module.css, App.test.tsx      the frame (Tasks 5, 6), the scroll reset (Task 7), the Inbox case of the reset test (Task 10)
  ui/Page.tsx, Page.module.css      the 52 px bar and the reading column (Task 7)
  ui/Page.test.tsx                  (new, Task 7)
  screens/builder/                  BuilderScreen, ChatPanel, Playback, StepList, StepRow, Builder.module.css, Builder.test.tsx (Tasks 5, 8, 9)
  screens/inbox/                    InboxScreen, ApprovalList, ApprovalDetail, PayloadView, Inbox.module.css, Inbox.test.tsx (Tasks 10, 11)
  screens/runs/                     RunsScreen, RunsTable, RunDetailScreen, StepBlock, UsageTable, Runs.module.css, Runs.test.tsx (Task 12)
  screens/readiness/                ReadinessScreen, ReadinessRow, FixGuide, Readiness.module.css, Readiness.test.tsx (Task 13)
  screens/harnesses/                HarnessesScreen, HarnessCardView, Harnesses.module.css, Harnesses.test.tsx (Task 14)
  screens/settings/                 SettingsScreen, the three sections, Settings.module.css, Settings.test.tsx (Task 15)
  layout-guards.test.ts, styles guards      (Task 16)
```

---

## UI design

This section replaces the "UI design" section of plan 01 (`2026-11-10-01-foundation-and-screens.md`). Direction: three quiet zones, hairlines only, plain-text agent replies, one composer, an ink primary button. Colour means state and nothing else. One violet hue marks the product, the focus ring and the current row.

### Layout

Window 1280 by 800 by default, minimum 1100 by 720. Every zone scrolls on its own; the page itself never scrolls.

| Screen | Columns |
|---|---|
| Frame | sidebar 256 (`--rail-width`) then `main` |
| Builder | sidebar 256, conversation (flexible), flow pane 460 (`--pane-width`). At 1100 the conversation is 384 wide |
| Inbox | sidebar 256, list 368 (`--list-width`), decision (flexible, reading column at most 640 `--decision-width`) |
| Runs, Run detail, Readiness, Harnesses, Settings, loading, error, not found | sidebar 256, one column under a 52 px bar; the column is 640 (narrow), 720 (medium) or 960 (wide) at most |

Bars are 52 px (`--bar-height`) with a 1 px `--border` bottom edge and a 12 px gap between their items, in every zone that has one, so the lines align across zones. Conversation: thread at most 720 (`--reading-width`), dock at most 768 (`--dock-width`).

### Colour

Variables are in `tokens.css`. Light values go in `:root`; dark values go in both `:root:not([data-theme="light"])` inside `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]`, with the same list in both (the existing `review-b.test.ts` pins this). `:root[data-theme="light"]` keeps only `color-scheme: light`. Dark is tuned by hand, not inverted.

| Variable | Role | Light | Dark |
|---|---|---|---|
| `--surface-app` | page, flow pane, window background | #ffffff | #212121 |
| `--surface-rail` | sidebar | #f5f5f5 | #181818 |
| `--surface-panel` | composer, chips, cards, controls | #ffffff | #2a2a2a |
| `--surface-sunken` | tags, mail strip, fix guide | #f4f4f4 | #1a1a1a |
| `--surface-hover` | row hover (new) | #ececec | #272727 |
| `--surface-selected` | current row, active tab, disabled primary (new) | #e3e3e3 | #323232 |
| `--surface-bubble` | user message (new) | #f0f0f0 | #2e2e2e |
| `--border` | hairline | #e4e4e4 | #353535 |
| `--border-strong` | control border (3:1) | #8c8c8c | #767676 |
| `--text` | text | #171717 | #ececec |
| `--text-muted` | secondary text | #5c5c5c | #a9a9a9 |
| `--ink` | primary button, send (new) | #171717 | #ececec |
| `--ink-hover` | primary hover (new) | #343434 | #ffffff |
| `--on-ink` | text on ink (new) | #ffffff | #161616 |
| `--accent` | product hue: mark, focus ring, current marker | #5b46c8 | #a597ff |
| `--accent-text` | same hue as text | #5b46c8 | #a597ff |
| `--accent-soft` | soft hue fill | #eeebfb | #2d2850 |
| `--on-accent` | text on accent | #ffffff | #16113a |
| `--ok`, `--ok-soft` | passed, done, approved (icon only) | #1b7440, #e4f2ea | #6fcf97, #1d3326 |
| `--info`, `--info-soft` | running (icon; tint of the running step) | #1b5cab, #e4edf9 | #7db4f5, #1e2d42 |
| `--wait`, `--wait-soft` | waiting for you (new) | #8f5307, #faefd9 | #e8b04a, #392d16 |
| `--bad`, `--bad-soft` | failed, blocked | #bd2f27, #fbe8e6 | #ff8f86, #3b2220 |
| `--overlay` | dialog scrim | rgba(0, 0, 0, 0.4) | rgba(0, 0, 0, 0.6) |

Not themed (same in both): `--font-ui: system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`; `--font-mono: Menlo, Monaco, monospace`; `--text-xs` 12px, `--text-s` 13px, `--text-m` 14px, `--text-read` 14.5px (new), `--text-title` 15px (new), `--text-xl` 18px (was 20), `--text-mono` 12px; `--space-1..6` 4, 8, 12, 16, 24, 32 px and `--space-7` 48 px (as today); `--radius-s` 6px, `--radius-m` 8px, `--radius-l` 10px, `--radius-bubble` 16px (new), `--radius-composer` 18px (new); `--rail-width` 256px, `--pane-width` 460px (new), `--list-width` 368px (new), `--bar-height` 52px (new), `--reading-width` 720px (new), `--dock-width` 768px (new), `--decision-width` 640px (new), `--wide-width` 960px (new, Task 7). Removed: `--accent-hover` and `--shadow-dialog` and `--text-l` (Task 3), `--chat-width` (Task 8).

Contrast pairs the test checks in both themes (minimum ratio): `--text` and `--text-muted` on `--surface-app`, `--surface-rail`, `--surface-selected`, `--surface-hover`, `--surface-bubble`, `--surface-panel`, `--surface-sunken` (4.5); `--ok` on app, rail, selected, sunken (4.5); `--bad` on app, rail, selected (4.5); `--info` on app, rail, selected (4.5); `--wait` on app, rail, selected, `--wait-soft` (4.5); `--accent` on app, rail, selected, `--accent-soft`, panel (3); `--text`, `--text-muted`, `--info`, `--ok` on `--info-soft` (4.5); `--text` on `--accent-soft` (4.5); `--text` and `--text-muted` on `--ok-soft`, `--wait-soft`, `--bad-soft` (4.5, banners and the blocked reason); `--ok` on `--ok-soft` and `--bad` on `--bad-soft` (4.5, the ready banner icon, hidden-character marks, the vendor warning); `--on-ink` on `--ink` (4.5); `--on-accent` on `--accent` (3); `--border-strong` on app, panel, rail (3).

A control on hover (chip, outlined button) keeps its `--border-strong` edge on `--surface-hover`; that edge is 2.85:1 against the hover fill in light (3.29 dark) but 3.3:1 or more against the page around it, which is the boundary that identifies the control, so it is accepted and not tested.

### Type, space, radii

- `system-ui` everywhere; Menlo for ids, versions in run lists, counts, step numbers, paths and commands. Weights 400, 500, 600 only. Body 400 14px, line height 1.5, antialiased.
- Sizes: 12 (counts, state words in the sidebar, rail head), 12.5 (check lines, helper text, tags, table header), 13 (secondary text, chips, small buttons), 13.5 (rows, buttons), 14 (step titles, body), 14.5 with line height 1.6 (reading text, composer, mail body 1.65), 15 weight 600 (zone and bar titles, section titles), 18 weight 600 (decision title).
- Space on the 4 px scale (4, 8, 12, 16, 20, 24, 32). Padding: conversation 24, pane 20, decision 32, Page body 24 by 32.
- Radii: 6 tags, 8 buttons and rows, 10 list rows and cards, 16 user bubble, 18 composer, 15 chip pill, 50% send button.
- Icons are inline SVG, 16 px (14 px in check lines), stroke 1.5, round caps and joins. Click targets are 28 px or more. Focus ring: 2 px `--accent`, offset 2 px, on every focusable element; nothing removes it.

### Icons (`ui/icons.tsx`, 16 by 16 grid)

`Icon({ name, size = 16, spin = false })` draws one `<path d>` in `viewBox="0 0 16 16"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, round caps and joins, `aria-hidden="true"`, `focusable="false"`. The name `dash` also sets `strokeDasharray="2.2 2.4"` (a dashed circle). `spin` adds `data-spin="true"` and nothing else; `base.css` turns that attribute into a 1.1 s linear rotation that `prefers-reduced-motion` removes. `ICON_NAMES` lists every key. Names kept from plan 01 keep their meaning; `tick`, `list` and `mark` are new; `builder` is now the branch glyph, `runs` a play triangle, `readiness` a clipboard, `harnesses` a plug, `settings` sliders.

```ts
const paths = {
  builder: "M4.5 2.4a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM4.5 10.8a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM11.5 4.6a1.4 1.4 0 1 0 0 2.8a1.4 1.4 0 1 0 0-2.8zM4.5 5.2v5.6M11.5 7.4c0 2.4-2.2 2.9-5.6 3.4",
  inbox: "M2.5 9.5L4.2 4.6a1 1 0 0 1 .95-.68h5.7a1 1 0 0 1 .95.68L13.5 9.5V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM2.5 9.5h3.2l.8 1.6h3l.8-1.6h3.2",
  runs: "M5 3.5v9l7.5-4.5z",
  readiness: "M5 3h6a1.5 1.5 0 0 1 1.5 1.5V12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 12V4.5A1.5 1.5 0 0 1 5 3zM6 3V2.2h4V3M6 8.6l1.5 1.5L10.2 7",
  harnesses: "M6 2.5v3M10 2.5v3M4.5 5.5h7v2.2a3.5 3.5 0 0 1-7 0zM8 11.2v2.3",
  settings: "M2.5 5h5.5M11.5 5h2M2.5 11h1.5M7 11h6.5M10 3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM5.5 9.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z",
  check: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM5.3 8.2l1.9 1.9 3.5-3.7",
  tick: "M3.5 8.4l3 3 6-6.4",
  cross: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM6 6l4 4M10 6l-4 4",
  clock: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM8 4.8V8l2.1 1.3",
  hand: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM5.3 8h.2M7.9 8h.2M10.5 8h.2",
  ring: "M8 2a6 6 0 1 0 6 6",
  pause: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM6.7 6.2v3.6M9.3 6.2v3.6",
  dash: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12z",
  alert: "M8 2.5L14 13H2zM8 6.8v2.8M8 11.3h.01",
  send: "M14 2L7.2 8.8M14 2l-4.3 12-2.5-5.2L2 6.3z",
  post: "M4.5 2.5h7A1.5 1.5 0 0 1 13 4v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12V4a1.5 1.5 0 0 1 1.5-1.5zM5.5 6h5M5.5 8.5h5M5.5 11H8",
  undo: "M5.5 3.5L3 6l2.5 2.5M3 6h6.2a3.3 3.3 0 0 1 0 6.6H6.5",
  "arrow-up": "M8 13V3.5M4 7.3l4-3.8 4 3.8",
  "arrow-down": "M8 3v9.5M4 8.7l4 3.8 4-3.8",
  list: "M3 4.5h10M3 8h10M3 11.5h6",
  mark: "M4 6.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM12 2.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM12 10.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2zM5.5 7.3L10.5 4.7M5.5 8.7l5 2.6",
  plus: "M8 3v10M3 8h10",
  retry: "M13.33 5.33a5.33 5.33 0 1 0 0.67 4M13.33 2v3.33h-3.33",
  stop: "M4.67 2.67h6.67l2 2v6.67l-2 2H4.67l-2-2V4.67z",
  key: "M5.33 9.33a3.33 3.33 0 1 1 2.67-2.67l5.33 5.33-1.33 1.33-1.33-1.33-1.33 1.33-1.33-1.33 1.33-1.33-1.33-1.33",
  "circle-slash": "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM3.73 3.73l8.53 8.53",
  shield: "M8 2l5.33 2v3.33c0 3.33-2 5.33-5.33 6.67-3.33-1.33-5.33-3.33-5.33-6.67V4z",
  half: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM8 2v12M5.33 3.33v9.33M3.33 5.33v5.33",
  "arrow-left": "M13.33 8H2.67M6.67 4l-4 4 4 4",
  copy: "M5.33 5.33h8v8H5.33zM10.67 5.33V2.67H2.67v8h2.67",
  duplicate: "M5.33 5.33h8v8H5.33zM10.67 5.33V2.67H2.67v8h2.67M9.33 7.33v4M7.33 9.33h4",
  trash: "M2.67 4.67h10.67M6 4.67V2.67h4v2M4 4.67l.67 8.67h6.67l.67-8.67M6.67 7.33v3.33M9.33 7.33v3.33",
  coin: "M8 2a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM10 5.33H6.67a1.33 1.33 0 0 0 0 2.67h2.67a1.33 1.33 0 0 1 0 2.67H6M8 4v8",
  lock: "M3.33 6.67h9.33v6.67H3.33zM5.33 6.67V4.67a2.67 2.67 0 0 1 5.33 0v2M8 9.33v1.33",
} as const;
```

### Shared parts (Tasks 2 to 4)

- **Tone**: `ok`, `bad`, `info`, `wait`, `neutral`. The tone colours the icon only: `--ok`, `--bad`, `--info`, `--wait`, `--text-muted`.
- **State mark** (`StatusBadge`): icon (16 px, tone colour) then the word (13px, weight 500, `--text`). No pill, no fill. The icon `ring` spins. The word is `--text-muted` when the tone is `neutral` and the value is one of `pending`, `skipped`, `queued`, `none` ("Not started", "Not run yet", "Skipped", "Queued", "Not approved yet"); every other word, "Interrupted" and "Expired" included, is `--text`.
- **Tag** (`Badge`): 22 px high, padding 0 8, radius 6, 1 px `--border`, `--surface-sunken`, 12.5px text in `--text`; an icon is 14 px in the tone colour. Tone `bad` uses `--bad-soft` and no border.
- **Buttons** (`Button`): radius 8, 1 px `--border-strong`, weight 500. Sizes: small 28 px (13px, padding 0 10), default 32 px (13.5px, padding 0 14), large 36 px (14px, padding 0 16, minimum width 96). `primary` is ink (`--ink` fill and border, `--on-ink` text, `--ink-hover` on hover). `secondary` is transparent with `--text`; hover `--surface-hover`. `quiet` has no border, `--text-muted`, hover text `--text`. `text` has no border, underline (1 px, offset 3), padding 0 10 and margin-left -10 so the text aligns with the edge. `danger` is outlined with `--bad` border and text, hover `--bad-soft`. A disabled primary is `--surface-selected` with `--text` text and no border; any other disabled button has opacity 0.5. An icon-only quiet button is 28 by 28.
- **Form controls** (`base.css`): `button, input, select, textarea` use `font: inherit`. Inputs, selects and text areas: `--surface-panel`, `--text`, 1 px `--border-strong`, radius 6, padding 5 8. Checkboxes and radios use `accent-color: var(--accent)`. Placeholders are `--text-muted`.
- **Links**: `--text`, underlined, offset 2 (unchanged). Sidebar rows and nav links are not underlined.
- **Dialog**: scrim `--overlay`; panel 480 wide, `--surface-panel`, 1 px `--border`, radius 10, padding 24, no shadow; title 15 weight 600; actions at the right, gap 8; a body that scrolls (unchanged).
- **Check line** (`CheckList`): grid `14px minmax(0, 1fr) auto`, column gap 8, `align-items: start`; the icon is 14 px in the tone colour with `margin-top: 1px`; lines are 3 px apart. Text 12.5/1.45 in `--text`, wrapping with the icon column as hanging indent; the check type (Menlo 12, `--text-muted`) follows the text; "(optional)" is muted. The result word (Passed, Failed, Not run yet) is 12.5 weight 500 in `--text`, right-aligned in its own column, aligned to the first line, no wrapping. A line with no result yet is muted in both text and word and uses the `clock` icon. Evidence is a `--surface-sunken` block (radius 6, Menlo 12) under the text, indented past the icon.
- **Row hover and current**: hover `--surface-hover`; current `--surface-selected` plus a 2 px `--accent` bar at the left edge (top and bottom 9 px in the sidebar, 12 px in the Inbox list), `aria-current` set.
- **Scrolling zones**: a zone that scrolls has `flex: 1; min-height: 0; overflow-y: auto` inside a flex column and carries `data-scroll="top"` (reset on a route change) or `data-scroll="bottom"` (the chat thread) as decision 23 says. Properties inside a rule keep the order this plan writes them in: the CSS tests read them in that order (for example `.thread` has `max-width` before `margin`, `.body` has `overflow-y` before `padding`), so a lint fix must not reorder them.

### Frame (Task 6)

- Sidebar `--surface-rail`, 1 px `--border` right edge, a column: brand row 52 px (padding 0 16, gap 10; mark 22 by 22, radius 6, `--accent` fill, `--on-accent` icon `mark` at 14 px, then "FlowDriven" 15/600); "New flow" link (34 px, radius 8, 1 px `--border-strong`, `--surface-panel`, 13.5/500, icon `plus`, gap 8, padding 0 10) with 8 px side margin; hover `--surface-hover`; when current (`aria-current="page"`) it takes the `--surface-selected` fill and keeps its border, with no accent bar (it is a button-like link, not a row); main nav starts 12 px below. The nav is a column with 2 px between rows. Nav rows 34 px, padding 0 10, radius 8, 10 px between the icon and the label, icon 16 px muted (text colour when current), label 13.5.
- Inbox count: Menlo 12 weight 600, `--wait` on `--wait-soft`, min width 22, height 20, padding 0 7, radius 10, pushed right, `aria-hidden`; the link's `aria-label` says "Inbox, 5 waiting".
- "Flows": a 12px weight 500 muted label (not a heading), padding 0 10, 20 px above and 4 px below. The list scrolls and its rows are 2 px apart. A flow row is at least 44 px, padding 7 10, 10 px between the icon and the text, a 16 px state icon (2 px down) and two lines: the name 13.5/500 (wraps, balanced, never truncated) and the state word 12/400 muted. A flow with no run reads "No runs yet" with the `dash` icon.
- Foot: 1 px top edge, padding 12 16 14, 12px muted, the sample-data note and, on a second line, "Desktop app" or "Browser preview" (as today).
- `main` is the remaining width and clips; each screen owns its scrolling.

### Page bar (Task 7)

`Page` is the shell of every single-column screen: a 52 px bar (padding 0 32, gap 12, bottom hairline) with the optional `before` link, the `h1` (15/600) and the `actions` at the right; then a scrolling body (`.body { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 32px 32px; }`, `data-scroll="top"`) holding the optional description (13.5 muted, 640 at most) and the children in a column of at most 640, 720 or 960 (`size="narrow" | "medium" | "wide"`, default `"medium"`). Loading and error text from `ScreenState` and the not-found page sit in the same body.

### Builder (Tasks 5, 8, 9), routes `#/builder`, `#/builder/<flowId>`, `#/builder/new`

- Root `<section data-screen="builder" data-screen-ready>` is a grid `minmax(0, 1fr) var(--pane-width)`, full height, no gap.
- **Conversation** (`<section aria-label="Chat">`): bar with "Chat" (an `h2`, 15/600). Thread scroll area padding 16 24; the thread (at most 720, centred) is anchored to the bottom (`margin: auto auto 0`). User message: right-aligned bubble, `--surface-bubble`, radius 16, at most 88%, padding 10 14, 14.5/1.6, in a row `display: flex; justify-content: flex-end; margin-bottom: 20px`. Agent message: plain text 14.5/1.65, no bubble, no avatar, 20 px below it. Each message starts with a visually hidden "You, 10 Nov, 08:30:" or "FlowDriven, ...", in its own span, a sibling of the element that holds the message text (tests find the text by an exact match). Questions are an `ol` with no list marker (`list-style: none`, padding 0, `margin-top: 8px`, a column with gap 12): each `li` is the question text (14.5/1.65) and directly under it, 6 px down, its suggestion chips (a wrapping row with gap 8; a chip is 30 px, radius 15, 1 px `--border-strong`, `--surface-panel`, 13px, padding 0 12, hover `--surface-hover`). No number badge, no chosen state.
- Thread scroll area: `.threadScroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; padding: 16px 24px; }` with `data-scroll="bottom"`; it is what makes `margin: auto auto 0` on `.thread` pin a short conversation to the bottom. `.chat` itself is `display: flex; flex-direction: column; min-width: 0` at full height. Chat bar: 52 px, padding 0 24, bottom hairline.
- **Composer** (dock: `flex: none`, width 100%, at most 768, `margin: 0 auto`, padding 0 24 24): `--surface-panel`, 1 px `--border-strong`, radius 18, padding 14 12 10 16. The text area is on top (display block, width 100%, height 44 px, borderless, transparent, no resize, 2 rows, `font: 400 14.5px / 1.5` UI font, padding 0, placeholder muted). Under it a row (`display: flex; justify-content: flex-end; margin-top: 4px`) holds the send button at the right end: 32 px circle, no border, `--ink` fill, `--on-ink` icon `arrow-up`, hover `--ink-hover`, `aria-label="Send"`; disabled is `--surface-selected` with `--text-muted` icon. The composer shows the focus ring when the text area has focus (`:focus-within`, 2 px `--accent`, offset 2).
- **Pane** (`<section aria-label="Flow details">`, `--surface-app`, left hairline): a flex column at full height. Bar (padding 0 12 0 20, space between) with the flow name as the page's `h1` (15/600, one line, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, `min-width: 0`; the `h1` carries `title` with the full name so a pointer shows it, and the full name is also in the sidebar), then Undo (quiet, small, icon `undo`) and Run now (primary, small), gap 4, `flex: none`. While a run starts, Run now is disabled and reads "Running" with a spinning `ring` icon. Body: `.paneBody { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px 16px; }`, `data-scroll="top"`.
- Pane body, in order: meta line (13 muted, flex, wraps, gap 4 16, 16 below; each item is inline-flex with gap 6; the sign-off mark is `--text` 500 with its icon in the tone colour; the "Latest run" link has `min-height: 28px; margin: -2px 0`): "Build flow" or "Light flow", "Version 1.0.0", the sign-off state mark ("Approved for version 1.0.0", or "Changed since approval" with its sentence, or "Not approved yet"), and "Latest run" plus a Menlo link when the flow has a run. Then "What this flow does" (`h2`, 14/600, in a title row: flex, space between, `min-height: 28px`, 8 below): a two-column list (88 px labels in 13 muted, values 13.5/1.5, row gap 6, column gap 12) with Goal (text), It will touch (tags, a wrapping row with gap 6), It asks before (plain list, or "Nothing risky."). A hairline (`height: 1px`, `--border`, margin 14 0 8). Then the "Steps" title row (same title row; `h2` 14/600, "5 steps" in 13 muted 8 px after it, an "Add step" small secondary button at the right).
- **Step list**: the `ol` has `margin: 0 -12px` so the row padding lines the text up with the pane edge.
- **Step row**: 9 12 padding, radius 8, `position: relative`, a grid of a 24 px number column (Menlo 12, muted, line height 20) and the body, column gap 4. Body line one is a flex row (gap 8, `min-height: 20px`, centred): the state icon (16), the title as a button (14/500, `flex: 1; min-width: 0`, first button in the row), the state word at the right (12.5/500, `flex: none`, `--text`; muted for "Not started" and "Skipped", as the state-mark rule says). Line two (13 muted): the worker line ("Any worker.", "Prefers Codex. Effort: medium.", "Done by the brain, no tools.", "Done by FlowDriven.") with its tag ("Worker", "Agent" or "FlowDriven"), then the four quiet 28 px icon buttons (Move up, Move down, Duplicate, Delete) at the right. "Uses" chips are Menlo tags on the next line. Then the check lines, `margin: 5px 0 0 24px`, so they start under the title, not under the state icon. Rows are separated by an inset 1 px hairline (left and right 12). The row whose state is `running` has `--info-soft` fill, radius 8, no hairline above or below it, and its title weight 600. `li[data-state]` carries the step state.
- **Empty states**: the pane for "no flow" shows the bar with the `h1` ("New flow" for `#/builder/new`, "Builder" when the install has no flows), then an `h2` and one sentence: "No flows yet." for an empty install, "Nothing drafted yet." for `#/builder/new`, then "Describe work you repeat, and the agent turns it into a flow."

### Inbox (Tasks 10, 11), routes `#/inbox`, `#/inbox/<approvalId>`

- Root `<section data-screen="inbox" data-screen-ready>`: grid `var(--list-width) minmax(0, 1fr)`.
- **List** (a flex column at full height, 1 px `--border` right edge): bar with the page's `h1` "Inbox" (padding 0 20; the `h1` has `tabIndex={-1}`, takes focus and sets the title once loaded, decision 24). Tabs (`flex: none`, a row with gap 4, padding 10 8 6): 28 px, padding 0 10, radius 8, no border, transparent, 13/500, muted, hover `--surface-hover`; the selected tab is `--surface-selected` and `--text`, with a 2 px `--accent` bar under the label (`::after`, left and right 10, bottom 0, radius 2; decision 25); the label is the word, a space, then the count with its parentheses in a span (Menlo 12 weight 400), so the visible text and the accessible name are the same, "Waiting (5)", with no `aria-label`. Rows: `.items { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 8px 16px; }` (no `data-scroll`, decision 23) holding the `ul` (a column with gap 2): the row is a button, `position: relative`, grid of a 16 px icon and the text with column gap 12; padding 10 12, radius 10; icon muted, 2 px down; title 13.5/500, line height 1.4, balanced, two lines at most; then the flow (and step) 12.5 muted on one line with ellipsis, 2 px below; then, 2 px below, the expiry with a 13 px `clock` icon (gap 5), 12.5 muted ("Expires 11 Nov, 09:05"), or for a resolved row the state mark. Hover `--surface-hover`; current `--surface-selected`, `aria-current="true"`, 2 px `--accent` bar. Rows are not equal height.
- **Decision** (a flex column at full height): bar (padding 0 32, space between) with the state mark at the left (the approval state: "Waiting for you", "Approved", ...; 13/500) and at the right "Expires 11 Nov, 09:05" (pending) or "Resolved 10 Nov, 09:40" (13 muted, inline-flex, gap 6). Body: `.detailScroll { flex: 1; min-height: 0; overflow-y: auto; padding: 24px 32px 32px; }`, `data-scroll="top"`; column `.col` at most 640. `h2` 18/600/1.35. Facts grid (72 px labels in 13 muted, values 13.5/1.5, row gap 4, column gap 12, margin 14 0 22): Action, Flow, Step, Run (Menlo link, underlined 1 px with offset 2, inline-flex, `min-height: 28px; margin: -6px 0`). The payload card: 1 px `--border`, radius 10, `--surface-panel`, overflow hidden. Its strip (`h3`, flex, centred, gap 8, 12.5 muted, `--surface-sunken`, bottom hairline, padding 9 16, with an icon): "This is the email that would be sent", "This is the post that would be published", "These are the changes you are approving", "This is the amount you are approving", "This is the text you are approving". Email rows: To, Subject (grid 64 px labels in 13 muted, column gap 8, values 14/1.5, padding 9 16, hairline between). The body is 14.5/1.65, pre-wrap, padding 16, in the UI font. Then, 20 px below the card, a 13 muted line with 10 px under it ("Nothing is sent until you choose."; post: "Nothing is posted until you choose."; amount: "Nothing is paid until you choose."; changes: "Nothing changes until you choose."; text: "Nothing happens until you choose."). Then the buttons (large, gap 8): Approve (primary), Edit and Reject (secondary, same size). Then the similar block (a column, items at the start, gap 4): a 1 px hairline, 20 above and 12 below, the text button "Approve all 3 similar for this run" and under it the explanation (12.5 muted, 1.45). Status, error and the 24-hour note follow, as today; the `role="status"` and `role="alert"` paragraphs and the 24-hour paragraph stay direct children of `.col`, siblings of the `h2` (existing tests read `status.parentElement` and `alert.parentElement`).
- Hidden characters stay a `mark` showing `<U+202E>` in Menlo on `--bad-soft` with `--bad` text; diff lines keep `.patch` (Menlo, `white-space: pre-wrap`, `> div { min-height: 1em }`), added lines `--ok`, removed lines `--bad`.

### Runs and Run detail (Task 12), routes `#/runs`, `#/runs/<runId>`

- Runs: `Page` wide. Filters in one row: label above its select (12.5 muted), selects 32 px. The table: fixed layout, header 12.5/500 muted, rows 44 px with a bottom hairline and no cell borders, run id in Menlo as a link, the state as a state mark, the one-time tag, the project in Menlo. Empty copy unchanged.
- Run detail: `Page` medium. The bar holds "All runs" (arrow-left, quiet link) before the `h1` (the flow name) and the Resume and Save buttons at the right. Under it a meta line (13 muted): the run id (Menlo), version, start, end, tag, state mark. A blocked reason is a row with the `stop` icon on `--bad-soft`, radius 10. Sections have an `h2` (15/600, 24 above, 8 below). Steps are rows like the Builder step rows: number (Menlo), state icon, title (`h3`, 14/500), state word at the right, then "Worker: Codex, attempt 4 of 4" (13 muted), the note, and the check lines. Inputs are a two-column list (120 px labels). Outputs and Approvals are hairline rows. Usage is the same table style as Runs.

### Readiness (Task 13), routes `#/readiness`, `#/readiness/<flowId>`

`Page` medium. A toolbar row (flow select, "Check again" secondary, "Last checked ..." 12 muted). The banner is a row (radius 10, padding 12 16, icon plus text, 13.5): ready on `--ok-soft`, attention on `--wait-soft`; `data-state="ready" | "attention"`. The requirement list has no card: rows with a bottom hairline, padding 16 0; the name 14/500 and the type muted, the reason muted, the route line with its risk mark, enforcement, detail and the install command (Menlo); the state mark at the right; the actions (Install for me secondary, Show me how quiet) below. The fix guide is a `--surface-sunken` block (radius 8, padding 12).

### Harnesses (Task 14), route `#/harnesses`

`Page` medium, "Re-scan" in the bar. One column of articles separated by a hairline (no cards, no grid): the name as an `h2` (15/600) with the risk mark at the right, the path (Menlo), "Version 1.2.3" (13 muted), the vendor warning (`alert` icon, `--bad` text kept, because it is a warning), the facts list (80 px labels), the consent button, the inventory details. "Not found on this Mac" is a section with a hairline above it.

### Settings (Task 15), route `#/settings`

`Page` narrow. Plain sections, no cards: each section is an `h2` (15/600) and its content, with a 1 px `--border` rule between sections and 24 px of space. Radios and the checkbox sit in 32 px rows. The budget meter is an 8 px track (`--surface-sunken`, radius 6) with a `--text-muted` fill; a warning fill is `--wait`, a stopped fill is `--bad`. Fields are labelled inputs in the shared form style.

---

### Task 1: Tokens, base styles and the window colour

**Files:**
- Modify: `apps/desktop/src/styles/tokens.css`, `apps/desktop/src/styles/base.css`, `apps/desktop/electron/window.ts`
- Create: `apps/desktop/src/styles/tokens.test.ts`, `apps/desktop/electron/window-colors.ts`, `apps/desktop/electron/window-colors.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the token set of "UI design: Colour" and "Type, space, radii" (names exactly as listed there); `export const WINDOW_BACKGROUND: { readonly light: string; readonly dark: string }` and `export function windowBackground(dark: boolean): string` in `electron/window-colors.ts`.
- Transitional tokens kept until their last user is restyled: `--accent-hover` (value of `--ink-hover` in each theme; removed in Task 3), `--shadow-dialog` and `--text-l` (removed in Task 3), `--chat-width: 380px` (removed in Task 8). The old screens keep working with the new values: the primary button turns violet and waiting states turn violet until Tasks 2 to 3 re-tone them.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/styles/tokens.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const SRC = "apps/desktop/src";
const tokens = readFileSync(`${SRC}/styles/tokens.css`, "utf8");
const hex = (css: string) =>
  Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const lightBlock = tokens.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const darkBlock = tokens.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
const light = hex(lightBlock);
const dark = { ...light, ...hex(darkBlock) };
const cssFiles = () =>
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".css"))
    .map((f) => [f, readFileSync(`${SRC}/${f}`, "utf8")] as const);

const ROLES: [string, string, string][] = [
  ["surface-app", "#ffffff", "#212121"],
  ["surface-rail", "#f5f5f5", "#181818"],
  ["surface-panel", "#ffffff", "#2a2a2a"],
  ["surface-sunken", "#f4f4f4", "#1a1a1a"],
  ["surface-hover", "#ececec", "#272727"],
  ["surface-selected", "#e3e3e3", "#323232"],
  ["surface-bubble", "#f0f0f0", "#2e2e2e"],
  ["border", "#e4e4e4", "#353535"],
  ["border-strong", "#8c8c8c", "#767676"],
  ["text", "#171717", "#ececec"],
  ["text-muted", "#5c5c5c", "#a9a9a9"],
  ["ink", "#171717", "#ececec"],
  ["ink-hover", "#343434", "#ffffff"],
  ["on-ink", "#ffffff", "#161616"],
  ["accent", "#5b46c8", "#a597ff"],
  ["accent-text", "#5b46c8", "#a597ff"],
  ["accent-soft", "#eeebfb", "#2d2850"],
  ["on-accent", "#ffffff", "#16113a"],
  ["ok", "#1b7440", "#6fcf97"],
  ["ok-soft", "#e4f2ea", "#1d3326"],
  ["info", "#1b5cab", "#7db4f5"],
  ["info-soft", "#e4edf9", "#1e2d42"],
  ["wait", "#8f5307", "#e8b04a"],
  ["wait-soft", "#faefd9", "#392d16"],
  ["bad", "#bd2f27", "#ff8f86"],
  ["bad-soft", "#fbe8e6", "#3b2220"],
];
test("the colour tokens have the approved values in both themes", () => {
  for (const [name, l, d] of ROLES) {
    expect(light[name], `light ${name}`).toBe(l);
    expect(dark[name], `dark ${name}`).toBe(d);
  }
  expect(Object.keys(hex(darkBlock)).sort()).toEqual(Object.keys(light).sort());
});
test("the size tokens have the approved values", () => {
  const px: [string, string][] = [
    ["rail-width", "256px"], ["pane-width", "460px"], ["list-width", "368px"], ["bar-height", "52px"],
    ["reading-width", "720px"], ["dock-width", "768px"], ["decision-width", "640px"],
    ["text-read", "14.5px"], ["text-title", "15px"], ["text-xl", "18px"],
    ["radius-s", "6px"], ["radius-m", "8px"], ["radius-l", "10px"], ["radius-bubble", "16px"], ["radius-composer", "18px"],
  ];
  for (const [name, value] of px) expect(tokens, name).toMatch(new RegExp(`--${name}:\\s*${value}\\s*;`));
  expect(tokens).toMatch(/--font-ui:\s*system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;/);
  expect(tokens).toMatch(/--font-mono:\s*Menlo, Monaco, monospace;/);
});
const lum = (h: string) => {
  const w = [0.2126, 0.7152, 0.0722];
  const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  return c.reduce((sum, v, i) => sum + (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * (w[i] ?? 0), 0);
};
const ratio = (a: string, b: string) => {
  const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const TEXT_ON = ["surface-app", "surface-rail", "surface-selected", "surface-hover", "surface-bubble", "surface-panel", "surface-sunken"];
const PAIRS: [string, string[], number][] = [
  ["text", TEXT_ON, 4.5],
  ["text-muted", TEXT_ON, 4.5],
  ["ok", ["surface-app", "surface-rail", "surface-selected", "surface-sunken"], 4.5],
  ["bad", ["surface-app", "surface-rail", "surface-selected"], 4.5],
  ["info", ["surface-app", "surface-rail", "surface-selected"], 4.5],
  ["wait", ["surface-app", "surface-rail", "surface-selected", "wait-soft"], 4.5],
  ["accent", ["surface-app", "surface-rail", "surface-selected", "accent-soft", "surface-panel"], 3],
  ["text", ["info-soft", "accent-soft"], 4.5],
  ["text-muted", ["info-soft"], 4.5],
  ["info", ["info-soft"], 4.5],
  ["ok", ["info-soft"], 4.5],
  ["text", ["ok-soft", "wait-soft", "bad-soft"], 4.5],
  ["text-muted", ["ok-soft", "wait-soft", "bad-soft"], 4.5],
  ["ok", ["ok-soft"], 4.5],
  ["bad", ["bad-soft"], 4.5],
  ["on-ink", ["ink"], 4.5],
  ["border-strong", ["surface-app", "surface-panel", "surface-rail"], 3],
  ["on-accent", ["accent"], 3],
];
test("every text pair keeps its contrast in both themes", () => {
  for (const [name, theme] of [["light", light], ["dark", dark]] as const)
    for (const [fg, backgrounds, minimum] of PAIRS)
      for (const bg of backgrounds) {
        const r = ratio(theme[fg] ?? "#000000", theme[bg] ?? "#000000");
        expect(r, `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(minimum);
      }
});
test("every var() in a stylesheet is defined, and colours live only in tokens.css", () => {
  const defined = new Set([...tokens.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  for (const [file, css] of cssFiles()) {
    if (file === "styles/tokens.css") continue;
    const local = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
    for (const m of css.matchAll(/var\(--([\w-]+)/g))
      expect(defined.has(m[1]) || local.has(m[1]), `${file}: --${m[1]}`).toBe(true);
    expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  }
});
test("the body uses the UI font at 14px with a 1.5 line height", () => {
  expect(readFileSync(`${SRC}/styles/base.css`, "utf8")).toMatch(
    /body\s*\{[^}]*font:\s*400 var\(--text-m\)\s*\/\s*1\.5 var\(--font-ui\)/,
  );
});
```

`apps/desktop/electron/window-colors.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { WINDOW_BACKGROUND, windowBackground } from "./window-colors";

const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const surfaceApp = (selector: RegExp) => selector.exec(tokens)?.[1]?.toLowerCase();

test("the window is painted with the page colour of each theme", () => {
  expect(WINDOW_BACKGROUND.light.toLowerCase()).toBe(surfaceApp(/:root\s*\{[^}]*--surface-app:\s*(#[0-9a-f]{6})/i));
  expect(WINDOW_BACKGROUND.dark.toLowerCase()).toBe(
    surfaceApp(/:root\[data-theme="dark"\]\s*\{[^}]*--surface-app:\s*(#[0-9a-f]{6})/i),
  );
  expect(windowBackground(false)).toBe(WINDOW_BACKGROUND.light);
  expect(windowBackground(true)).toBe(WINDOW_BACKGROUND.dark);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/styles apps/desktop/electron/window-colors.test.ts`
Expected: FAIL (`expected '#f3f4f2' to be '#ffffff'`; `Failed to resolve import "./window-colors"`)

- [ ] **Step 3: Rewrite `tokens.css`**

Keep the three-block structure of plan 01: `:root` (light values, `color-scheme: light dark`), `:root[data-theme="light"] { color-scheme: light; }` (only that), `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and `:root[data-theme="dark"] { ... }`, the last two with the identical list of dark values (colour tokens and `--overlay`). Use the names and values of "UI design: Colour" and "Type, space, radii". `--overlay` is light `rgba(0, 0, 0, 0.4)`, dark `rgba(0, 0, 0, 0.6)`. Keep the transitional tokens listed under Interfaces: `--accent-hover` takes the `--ink-hover` value of each theme (hex, so the light and dark lists stay equal), and `--shadow-dialog` and `--text-l` keep their plan 01 values.

- [ ] **Step 4: Update `base.css`**

`body`: `font: 400 var(--text-m) / 1.5 var(--font-ui)`, `-webkit-font-smoothing: antialiased`, `margin: 0`, `color: var(--text)`, `background: var(--surface-app)`. `:focus-visible`: `outline: 2px solid var(--accent); outline-offset: 2px`. Leave the `select, textarea, input` rule, the link rule, `pre` and the reduced-motion block exactly as they are (`review-b.test.ts` pins them).

- [ ] **Step 5: Create `electron/window-colors.ts` and use it**

```ts
export const WINDOW_BACKGROUND = { light: "#ffffff", dark: "#212121" } as const;
export function windowBackground(dark: boolean): string
```

In `window.ts`, import it and replace the `backgroundColor: dark ? "#161918" : "#F3F4F2"` expression with `backgroundColor: windowBackground(dark)`. Change nothing else in that file.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src/styles apps/desktop/electron/window-colors.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 8: Chair step (GUI)**: `pnpm capture`. It must exit 0 and write 16 PNGs to `.workflow/scratch/screens/`. Open one light and one dark file and check the window edge has no old-colour flash line.

- [ ] **Step 9: Chair step (commit)**

```bash
git add apps/desktop/src/styles apps/desktop/electron/window.ts apps/desktop/electron/window-colors.ts apps/desktop/electron/window-colors.test.ts
git commit -m "Add the simple look tokens and paint the window with the page colour" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 2: Icons and state marks

**Files:**
- Modify: `apps/desktop/src/ui/icons.tsx`, `apps/desktop/src/ui/status.ts`, `apps/desktop/src/ui/StatusBadge.tsx`, `apps/desktop/src/ui/StatusBadge.module.css`, `apps/desktop/src/ui/status.test.tsx`, `apps/desktop/src/styles/base.css`

**Interfaces:**
- Consumes: the `paths` table, the Icon rules and the shared-parts rules of "UI design".
- Produces:
  - `Icon({ name, size?: number, spin?: boolean }): ReactElement`, default size 16; `ICON_NAMES`; `IconName` now includes `"tick" | "list" | "mark"`.
  - In `status.ts`: `type Tone = "ok" | "bad" | "info" | "neutral" | "wait"`. Every `"accent"` tone in `statuses` becomes `"wait"` (run and step `waiting_approval`, requirement and connection `needs_login`, approval `pending`, signOff `stale`).
  - In `StatusBadge.tsx`: `ToneIcon({ icon: IconName; tone: Tone; size?: number }): ReactElement` (a span that colours the icon; spins when `icon === "ring"`), `StateIcon({ domain: StatusDomain; value: string; size?: number }): ReactElement` (the icon of `statusOf(domain, value)`), `StatusBadge({ domain, value })` (icon plus word, no pill) and `Badge({ tone, icon?, children })` (a tag). Signatures of `StatusBadge` and `Badge` are unchanged.
  - `base.css` gains `[data-spin="true"] { animation: fd-spin 1.1s linear infinite; transform-origin: 50% 50%; }` and `@keyframes fd-spin { to { transform: rotate(360deg); } }`.

- [ ] **Step 1: Write the failing tests** (add to `status.test.tsx`, merging the imports with the existing ones; also change `tone: "accent"` to `tone: "wait"` in `uses the agreed words`)

```tsx
import { readFileSync } from "node:fs";
import { ICON_NAMES, Icon } from "./icons";
import { Badge, StateIcon, StatusBadge, ToneIcon } from "./StatusBadge";

test("a state mark is an icon plus a word and only a ring spins", () => {
  for (const [domain, values] of domains)
    for (const value of values) {
      const { unmount, container } = render(<StatusBadge domain={domain} value={value} />);
      const presentation = statusOf(domain, value);
      const svg = container.querySelector("svg[aria-hidden='true']");
      expect(svg, `${domain}.${value}`).not.toBeNull();
      expect(screen.getByText(presentation.label)).toBeTruthy();
      expect(svg?.getAttribute("data-spin") === "true", `${domain}.${value}`).toBe(presentation.icon === "ring");
      unmount();
    }
});
test("ToneIcon and StateIcon draw only an icon", () => {
  const a = render(<ToneIcon icon="check" tone="ok" />);
  expect(a.container.textContent).toBe("");
  expect(a.container.querySelector("svg")).not.toBeNull();
  a.unmount();
  const b = render(<StateIcon domain="run" value="running" />);
  expect(b.container.textContent).toBe("");
  expect(b.container.querySelector("svg")?.getAttribute("data-spin")).toBe("true");
});
test("icons use the 16 px grid with a 1.5 stroke, and the dash icon is dashed", () => {
  const { container } = render(<Icon name="check" />);
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
  expect(svg?.getAttribute("width")).toBe("16");
  expect(svg?.getAttribute("stroke-width")).toBe("1.5");
  expect(svg?.hasAttribute("data-spin")).toBe(false);
  const dash = render(<Icon name="dash" size={14} />);
  expect(dash.container.querySelector("path")?.getAttribute("stroke-dasharray")).toBe("2.2 2.4");
  expect(dash.container.querySelector("svg")?.getAttribute("width")).toBe("14");
  expect(ICON_NAMES).toEqual(expect.arrayContaining(["tick", "list", "mark", "builder", "arrow-up"]));
});
test("a tag shows its label and an optional icon", () => {
  const { container } = render(<Badge tone="bad" icon="alert">Marked passed without a passing check</Badge>);
  expect(screen.getByText("Marked passed without a passing check")).toBeTruthy();
  expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});
test("the spin rule exists once and the reduced-motion rule still removes it", () => {
  const base = readFileSync("apps/desktop/src/styles/base.css", "utf8");
  expect(base).toMatch(/\[data-spin="true"\]\s*\{[^}]*animation:\s*fd-spin 1\.1s linear infinite/);
  expect(base).toMatch(/@keyframes fd-spin/);
  expect(base).toMatch(/animation:\s*none !important/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/ui/status.test.tsx`
Expected: FAIL (`ToneIcon` is not exported; `expected "accent" to be "wait"`)

- [ ] **Step 3: Implement**

`icons.tsx`: replace `paths` with the table of "UI design: Icons" and rewrite `Icon` as described there (default size 16, `viewBox="0 0 16 16"`, `strokeWidth={1.5}`, `spin` sets `data-spin="true"`, `dash` sets `strokeDasharray="2.2 2.4"` on the path). `status.ts`: rename the tone. `StatusBadge.tsx` and its CSS module: `ToneIcon` wraps `Icon` in a span whose colour is the tone colour (`ok` `--ok`, `bad` `--bad`, `info` `--info`, `wait` `--wait`, `neutral` `--text-muted`) and passes `spin={icon === "ring"}`; `StatusBadge` renders the `ToneIcon` and the label in a span (13px, 500, `--text`; `--text-muted` when the tone is `neutral` and the value is one of `pending`, `skipped`, `queued`, `none`); `Badge` renders the tag of "UI design: Shared parts". `base.css`: add the spin rule.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src/ui`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src/ui apps/desktop/src/styles/base.css
git commit -m "Redraw the icons and turn status badges into plain state marks" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 3: Buttons, form controls and the dialog

**Files:**
- Modify: `apps/desktop/src/ui/Button.tsx`, `apps/desktop/src/ui/Button.module.css`, `apps/desktop/src/ui/Dialog.module.css`, `apps/desktop/src/styles/base.css`, `apps/desktop/src/styles/tokens.css`, `apps/desktop/src/styles/tokens.test.ts`
- Create: `apps/desktop/src/ui/Button.test.tsx`

**Interfaces:**
- Consumes: the Buttons, Form controls, Links and Dialog rules of "UI design: Shared parts".
- Produces: `Button({ variant?: "primary" | "secondary" | "quiet" | "text" | "danger"; size?: "small" | "default" | "large"; icon?: IconName; ...ButtonHTMLAttributes })`. It renders `<button type="button" data-variant data-size>` (defaults `secondary`, `default`) and adds `data-icon-only="true"` when it is a quiet button with an icon and no children. `Dialog` is unchanged in its props and keeps `data-dialog-confirm` on the confirm button.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.button` (`Button.module.css`) and `.panel` (`Dialog.module.css`), with the attribute selectors `[data-size]`, `[data-variant]` and `[data-icon-only]` on `.button`.

- [ ] **Step 1: Write the failing tests**

`Button.test.tsx`:

```tsx
import { readdirSync, readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./Button";

const css = (file: string) => readFileSync(`apps/desktop/src/${file}`, "utf8");

test("a button is type=button with a variant, a size and its icon before its label", () => {
  render(
    <Button variant="primary" size="large" icon="plus">
      Add
    </Button>,
  );
  const button = screen.getByRole("button", { name: "Add" });
  expect(button.getAttribute("type")).toBe("button");
  expect(button.getAttribute("data-variant")).toBe("primary");
  expect(button.getAttribute("data-size")).toBe("large");
  expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
});
test("the defaults are secondary and default, and a quiet icon button is marked icon-only", () => {
  render(<Button>Plain</Button>);
  expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-variant")).toBe("secondary");
  expect(screen.getByRole("button", { name: "Plain" }).getAttribute("data-size")).toBe("default");
  render(<Button variant="quiet" icon="trash" aria-label="Delete" />);
  expect(screen.getByRole("button", { name: "Delete" }).getAttribute("data-icon-only")).toBe("true");
});
test("button styles follow the approved rules", () => {
  const button = css("ui/Button.module.css");
  expect(button).toMatch(/\.button\s*\{[^}]*height:\s*32px/);
  expect(button).toMatch(/\[data-size="small"\]\s*\{[^}]*height:\s*28px/);
  expect(button).toMatch(/\[data-size="large"\]\s*\{[^}]*height:\s*36px/);
  expect(button).toMatch(/\[data-variant="primary"\]\s*\{[^}]*background:\s*var\(--ink\)[^}]*color:\s*var\(--on-ink\)/s);
  expect(button).toMatch(/\[data-variant="primary"\]:disabled\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(button).toMatch(/\[data-variant="text"\]\s*\{[^}]*text-decoration:\s*underline/s);
  expect(button).not.toMatch(/accent-hover/);
});
test("form controls take the app font and the theme colours", () => {
  const base = css("styles/base.css");
  expect(base).toMatch(/(?:^|\n)button,\s*input,\s*select,\s*textarea\s*\{[^}]*font:\s*inherit/);
  expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  expect(base).toMatch(/accent-color:\s*var\(--accent\)/);
});
test("the dialog has a hairline edge and no shadow", () => {
  const dialog = css("ui/Dialog.module.css");
  expect(dialog).not.toMatch(/box-shadow/);
  expect(dialog).toMatch(/\.panel\s*\{[^}]*border:\s*1px solid var\(--border\)/s);
});
test("no stylesheet removes the focus ring except the composer, which replaces it", () => {
  const files = (readdirSync("apps/desktop/src", { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));
  for (const file of files) {
    const text = css(file);
    if (!/outline:\s*(none|0)\b/.test(text)) continue;
    expect(file).toBe("screens/builder/Builder.module.css");
    expect(text).toMatch(/:focus-within\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
  }
});
```

Add to `tokens.test.ts`:

```ts
test("the transitional tokens of Task 1 are gone once Button and Dialog stop using them", () => {
  expect(tokens).not.toMatch(/--accent-hover|--shadow-dialog|--text-l\b/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/ui/Button.test.tsx apps/desktop/src/styles`
Expected: FAIL (`expected null to be 'primary'`)

- [ ] **Step 3: Implement**

`Button.tsx` as in Interfaces. `Button.module.css`: one `.button` class (32 px, radius `--radius-m`, `font: 500 13.5px / 20px var(--font-ui)`, inline-flex, gap 6, cursor pointer) and attribute selectors `.button[data-variant="..."]`, `.button[data-size="..."]`, `.button[data-icon-only="true"]` with the values of "UI design: Shared parts"; `.button:disabled { cursor: default; }` and `opacity: 0.5` for every variant except `primary`. `Dialog.module.css`: drop `box-shadow`, add `border: 1px solid var(--border)`, title `font-size: var(--text-title)`, keep every other rule (the existing test `keeps dialog actions visible around a scrolling body` pins them). `base.css`: add `button, input, select, textarea { font: inherit; }`, `input, select, textarea { padding: 5px 8px; }` as a separate rule (do not touch the existing rule: `review-b.test.ts` pins its properties and their order), `input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); padding: 0; }`, `::placeholder { color: var(--text-muted); opacity: 1; }`; keep the existing `select, textarea, input` rule intact. `tokens.css`: delete `--accent-hover`, `--shadow-dialog`, `--text-l` from every block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src/ui apps/desktop/src/styles
git commit -m "Restyle buttons, form controls and the dialog" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 4: Check lines

**Files:**
- Modify: `apps/desktop/src/ui/CheckList.tsx`, `apps/desktop/src/ui/CheckList.module.css`, `apps/desktop/src/ui/CheckList.test.tsx`

**Interfaces:**
- Consumes: `ToneIcon`, `Badge` (Task 2), `statusOf("check", ...)`, `Button` (Task 3).
- Produces: `CheckList({ checks }: { checks: (Check | CheckResult)[] }): ReactElement` (signature unchanged). Each check is `<div className=row data-verdict="passed" | "failed" | "pending">` whose first three children are, in order, the icon span (a `ToneIcon`, 14 px), the text block (the summary, then the check type in Menlo, then "(optional)" when not required) and the result span (the verdict word). Evidence (`pre`), "No evidence recorded" and the "Show all N lines" button follow as further children of the row and are placed under the text column. A `Check` without a `verdict` is rendered as `pending` ("Not run yet", `clock` icon). "Judged, not verified" stays a `Badge` after the rows.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.row`, `.result` and the attribute selector `[data-verdict="pending"]` in `CheckList.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `CheckList.test.tsx`; the six existing tests, including `whitespace-only evidence has no evidence block`, stay unchanged; add `import { readFileSync } from "node:fs";` at the top of the file)

```tsx

test("a check line is an icon, the check text and the result word in its own column", () => {
  const { container } = render(
    <CheckList checks={[{ type: "command", required: true, summary: "flutter analyze exits 0", verdict: "passed" }]} />,
  );
  const row = container.querySelector("[data-verdict]") as HTMLElement;
  expect(row.getAttribute("data-verdict")).toBe("passed");
  const [icon, text, result] = Array.from(row.children) as HTMLElement[];
  expect(icon?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(text?.textContent).toContain("flutter analyze exits 0");
  expect(text?.textContent).toContain("command");
  expect(result?.textContent).toBe("Passed");
});
test("a check without a run result reads Not run yet, and a failed one reads Failed", () => {
  const { container } = render(
    <CheckList
      checks={[
        { type: "files", required: true, summary: "Report exists" },
        { type: "schema", required: true, summary: "Schema valid", verdict: "failed" },
      ]}
    />,
  );
  const rows = Array.from(container.querySelectorAll("[data-verdict]"));
  expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["pending", "failed"]);
  expect(rows.map((r) => (r.children[2] as HTMLElement).textContent)).toEqual(["Not run yet", "Failed"]);
});
test("check line styles: three columns, word right-aligned to the first line, pending muted", () => {
  const css = readFileSync("apps/desktop/src/ui/CheckList.module.css", "utf8");
  expect(css).toMatch(/\.row\s*\{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\) auto/s);
  expect(css).toMatch(/\.row\s*\{[^}]*align-items:\s*start/s);
  expect(css).toMatch(/\.result\s*\{[^}]*text-align:\s*right[^}]*white-space:\s*nowrap/s);
  expect(css).toMatch(/\[data-verdict="pending"\][^{]*\{[^}]*color:\s*var\(--text-muted\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/ui/CheckList.test.tsx`
Expected: FAIL (`TypeError: Cannot read properties of null (reading 'getAttribute')` in the first new test: there is no `[data-verdict]` row yet; the CSS test fails on its first `toMatch`)

- [ ] **Step 3: Implement** the structure in Interfaces and the "Check line" rule of "UI design: Shared parts". Keep the type word, "(optional)", the evidence block (12 lines then a button), the "No evidence recorded" line and the `rawEvidence?.trim()` rule that treats whitespace-only evidence as none (commit 26b70b7).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS (the Builder and Runs tests that look at check words still pass: "Passed" and "Failed" are unchanged)

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src/ui
git commit -m "Show checks as lines with an icon and a result column" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 5: New flow: the route and the empty Builder state

**Files:**
- Modify: `apps/desktop/src/nav/route.ts`, `apps/desktop/src/nav/route.test.ts`, `apps/desktop/src/screens/builder/BuilderScreen.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/screens/builder/Builder.test.tsx`

**Interfaces:**
- Consumes: `flows.build` (unchanged), the existing empty-install state of `BuilderScreen` (`emptyMessages`).
- Produces: `Route` builder variant becomes `{ screen: "builder"; flowId?: string; isNew?: true }`. `parseRoute("#/builder/new")` returns `{ screen: "builder", isNew: true }`; `routeToHash` of that returns `"#/builder/new"`. `BuilderScreen({ flowId?: string; isNew?: boolean })`. With `isNew`, the screen asks for no flow: it shows the `h1` "New flow", the `h2` "Nothing drafted yet." and the sentence "Describe work you repeat, and the agent turns it into a flow.", with the chat and its composer. `App` renders `<BuilderScreen key={route.isNew ? "new" : "flow"} .../>` so a draft conversation is dropped when the user leaves. The empty install keeps its `h1` "Builder" and `h2` "No flows yet.".

- [ ] **Step 1: Write the failing tests**

In `route.test.ts`:

```ts
test("#/builder/new is the new-flow state and round-trips", () => {
  expect(parseRoute("#/builder/new")).toEqual({ screen: "builder", isNew: true });
  expect(routeToHash({ screen: "builder", isNew: true })).toBe("#/builder/new");
  expect(parseRoute(routeToHash({ screen: "builder", isNew: true }))).toEqual({ screen: "builder", isNew: true });
  expect(parseRoute("#/builder/new/extra")).toEqual({ screen: "not_found", hash: "#/builder/new/extra" });
  expect(parseRoute("#/readiness/new")).toEqual({ screen: "readiness", flowId: "new" });
});
```

In `Builder.test.tsx` (new tests; nothing existing changes in this task):

```tsx
test("New flow opens an empty conversation even when flows exist, and sends without a flow", async () => {
  const { client } = renderApp("#/builder/new");
  const heading = await screen.findByRole("heading", { level: 1, name: "New flow" });
  expect(heading.tabIndex).toBe(-1);
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.title).toBe("New flow - FlowDriven");
  expect(screen.getByText("Nothing drafted yet.")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Steps" })).toBeNull();
  const spy = vi.spyOn(client, "call");
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Weekly report from my notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(PREVIEW_AGENT_REPLY)).toBeTruthy();
  expect(spy).toHaveBeenCalledWith("flows.build", { flowId: undefined, message: "Weekly report from my notes" });
  expect(window.location.hash).toBe("#/builder/new");
  expect(client.state.flows).toHaveLength(5);
});
test("leaving New flow drops the draft conversation", async () => {
  renderApp("#/builder/new");
  fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(PREVIEW_AGENT_REPLY);
  const go = (hash: string) =>
    act(() => {
      window.location.hash = hash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  go(FIGMA);
  await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
  go("#/builder/new");
  await screen.findByRole("heading", { level: 1, name: "New flow" });
  expect(screen.queryByText(PREVIEW_AGENT_REPLY)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/nav apps/desktop/src/screens/builder`
Expected: FAIL (`expected { screen: 'builder', flowId: 'new' } to equal { screen: 'builder', isNew: true }`)

- [ ] **Step 3: Implement** the route change in `route.ts` (check `id === "new"` for the builder before the general two-part rule), the `isNew` branch in `BuilderScreen` (`const id = isNew ? undefined : (flowId ?? list.data?.[0]?.id)`, the two texts above) and the `App` case. The "New flow" `h1` is `<h1 ref={headingRef} tabIndex={-1}>`, the same `headingRef` that the flow and "Builder" headings use, so the existing `useLayoutEffect` on `[id, loading, queryError]` gives it focus and the title. Leave the `previousId` guard and the `useLayoutEffect` as they are. Do not change what the empty install shows.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src/nav apps/desktop/src/App.tsx apps/desktop/src/screens/builder
git commit -m "Add the New flow route that opens an empty Builder conversation" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 6: The frame: sidebar with the flows list

**Files:**
- Create: `apps/desktop/src/nav/Sidebar.tsx`, `apps/desktop/src/nav/Sidebar.module.css`, `apps/desktop/src/ui/flow-state.ts`, `apps/desktop/src/ui/flow-state.test.ts`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/App.module.css`, `apps/desktop/src/App.test.tsx`, `apps/desktop/src/screens/builder/Builder.test.tsx`

**Interfaces:**
- Consumes: `useRunnerQuery("approvals.list", { state: "pending" })`, `useRunnerQuery("flows.list", {})`, `AppLink`, `Route`, `ToneIcon`, `Icon`, `statusOf`, `APP_NAME`, `SAMPLE_DATA_NOTE`, `shellKind`.
- Produces:
  - `flowState(flow: Pick<FlowSummary, "lastRun">): StatusPresentation` in `ui/flow-state.ts`: the `statusOf("run", lastRun.state)` presentation, or `{ icon: "dash", label: "No runs yet", tone: "neutral" }` when there is no run.
  - `Sidebar({ route }: { route: Route }): ReactElement`: the whole rail as a `div` (not an `aside`; the existing test forbids a `complementary` landmark). Inside, in order: the brand (not a link, not focusable); the "New flow" `AppLink` (class `newFlow`) to `{ screen: "builder", isNew: true }`; `<nav aria-label="Main" aria-busy={approvalsLoading}>` with five `AppLink`s (Inbox, Runs, Readiness, Harnesses, Settings) and the count; the label "Flows" (`id`, not a heading); `<nav aria-label="Flows" aria-busy={flowsLoading}>` with a `ul` labelled by it and one `AppLink` per flow to `{ screen: "builder", flowId }`; the foot. Current marks: a destination gets `aria-current="page"` as today (Runs also for a run route); a flow link gets it when the route is `builder`, not new, and its id equals `route.flowId ?? firstFlowId`; "New flow" gets it when `route.isNew`. The Inbox link keeps `aria-label` "Inbox, N waiting". With no flows the list area shows the muted text "Flows you make appear here." (not "No flows yet.", which the Builder owns).
  - `App` keeps the skip link first, the route-change effect and `<main id="main-content" tabIndex={-1}>`; it renders `<Sidebar route={route} />` and no longer queries approvals itself.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.frame` in `App.module.css`; `.newFlow` and the `[aria-current="page"]` selectors in `Sidebar.module.css`.

- [ ] **Step 1: Write the failing tests**

`flow-state.test.ts`:

```ts
import { expect, test } from "vitest";
import { flowState } from "./flow-state";
import { statusOf } from "./status";

test("a flow shows the state of its last run, or that it has no runs", () => {
  expect(flowState({ lastRun: { runId: "run-0006", state: "blocked", startedAt: "2026-11-10T08:40:00.000Z" } })).toEqual(
    statusOf("run", "blocked"),
  );
  expect(flowState({})).toEqual({ icon: "dash", label: "No runs yet", tone: "neutral" });
});
```

`App.test.tsx`: replace `the rail lists the six screens in order with the inbox count` with the first test below; add the others.

```tsx
const flowIds = ["documents-and-reports", "figma-to-flutter", "email-triage", "lead-follow-up", "social-posts"];
const flowsNav = () => screen.getByRole("navigation", { name: "Flows" });

test("the rail lists five destinations, New flow and the inbox count", async () => {
  renderApp("#/runs");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
    "#/inbox", "#/runs", "#/readiness", "#/harnesses", "#/settings",
  ]);
  expect(within(nav).queryByRole("link", { name: "Builder" })).toBeNull();
  expect(await within(nav).findByRole("link", { name: "Inbox, 5 waiting" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "New flow" }).getAttribute("href")).toBe("#/builder/new");
  const stops = Array.from(document.querySelectorAll("a[href], button")).slice(0, 3);
  expect(stops.map((el) => el.getAttribute("href"))).toEqual(["#main-content", "#/builder/new", "#/inbox"]);
  expect(screen.getByText("Sample data. Nothing here runs yet.")).toBeTruthy();
  expect(screen.getByText("Browser preview")).toBeTruthy();
});
test("every flow in the sidebar has an icon and a state word", async () => {
  renderApp("#/builder/dev.example.figma-to-flutter");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links.map((l) => l.getAttribute("href"))).toEqual(flowIds.map((id) => `#/builder/dev.example.${id}`));
  const words = ["Done", "Blocked", "Waiting for you", "Interrupted", "Waiting for you"];
  links.forEach((link, i) => {
    expect(link.textContent, flowIds[i]).toContain(words[i]);
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(link.getAttribute("aria-current")).toBe(i === 1 ? "page" : null);
  });
});
test("the first flow is current at #/builder, and nothing is current on other screens", async () => {
  const first = renderApp("#/builder");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links[0]?.getAttribute("aria-current")).toBe("page");
  first.unmount();
  renderApp("#/settings");
  const others = await within(flowsNav()).findAllByRole("link");
  expect(others.every((l) => !l.hasAttribute("aria-current"))).toBe(true);
});
test("New flow is current at #/builder/new and no flow is", async () => {
  renderApp("#/builder/new");
  expect(screen.getByRole("link", { name: "New flow" }).getAttribute("aria-current")).toBe("page");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links.every((l) => !l.hasAttribute("aria-current"))).toBe(true);
});
test("choosing a flow opens it in the Builder", async () => {
  renderApp("#/settings");
  fireEvent.click(await within(flowsNav()).findByRole("link", { name: /Email triage and draft replies/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/builder/dev.example.email-triage"));
  expect(await screen.findByRole("heading", { level: 1, name: "Email triage and draft replies" })).toBeTruthy();
});
test("a long flow name wraps in the sidebar and is never cut off", async () => {
  renderApp("#/builder", { scenario: "long" });
  const links = await within(flowsNav()).findAllByRole("link");
  const last = links.at(-1) as HTMLElement;
  expect(last.textContent).toMatch(/^Quarterly supplier compliance .* northern distribution network/);
  expect(last.textContent).toContain("No runs yet");
  const css = readFileSync("apps/desktop/src/nav/Sidebar.module.css", "utf8");
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
  expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
});
test("with no flows the list says where they will appear", async () => {
  renderApp("#/inbox", { scenario: "empty" });
  expect(await screen.findByText("Flows you make appear here.")).toBeTruthy();
});
test("the frame styles follow the approved layout", () => {
  const app = readFileSync("apps/desktop/src/App.module.css", "utf8");
  const sidebar = readFileSync("apps/desktop/src/nav/Sidebar.module.css", "utf8");
  expect(app).toMatch(/\.frame\s*\{[^}]*grid-template-columns:\s*var\(--rail-width\) minmax\(0, 1fr\)/s);
  expect(sidebar).toMatch(/background:\s*var\(--surface-rail\)/);
  expect(sidebar).toMatch(/\[aria-current="page"\][^{]*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(sidebar).toMatch(/\[aria-current="page"\]::before[^{]*\{[^}]*background:\s*var\(--accent\)/s);
  expect(sidebar).toMatch(/\.newFlow\[aria-current="page"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(`${app}${sidebar}`).not.toMatch(/box-shadow/);
});
```

(Add `import { readFileSync } from "node:fs";` at the top of `App.test.tsx`; it imports only Testing Library, Vitest and `renderApp` today. The other existing tests there stay.)

In `Builder.test.tsx`, change `does not repeat a summary equal to the flow name` to count inside `main`: `expect(within(screen.getByRole("main")).getAllByText("Figma to Flutter")).toHaveLength(2);` (the heading and the select option; the sidebar now also shows the name).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/App.test.tsx apps/desktop/src/ui/flow-state.test.ts`
Expected: FAIL (`Failed to resolve import "./flow-state"`; the rail still lists six links)

- [ ] **Step 3: Implement** `flow-state.ts`, `Sidebar.tsx` and its CSS per "UI design: Frame", `App.tsx` and `App.module.css` (`.frame` is a grid `var(--rail-width) minmax(0, 1fr)` at `height: 100vh`; keep `.skip` and `.main { min-width: 0; overflow: hidden }`; delete the rail, link and count rules that moved to the Sidebar module; no `box-shadow`). The flow list rows use `ToneIcon` for the icon and `flowState` for the word. Where the Sidebar CSS needs an `overflow-wrap: anywhere` and `min-width: 0` on its text, use exactly those spellings.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate and the build**

Run: `pnpm format && pnpm check && pnpm build:web`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: `pnpm capture` must exit 0 (16 PNGs). Open `builder-light.png` and `inbox-dark.png`: the sidebar shows the five destinations, the flows with their state words and the sample-data note. Then `pnpm preview:web` and look at the app in both themes.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src
git commit -m "Replace the navigation rail with a sidebar that lists the flows" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 7: The page bar for single-column screens

**Files:**
- Modify: `apps/desktop/src/ui/Page.tsx`, `apps/desktop/src/ui/Page.module.css`, `apps/desktop/src/screens/inbox/InboxScreen.tsx`, `apps/desktop/src/screens/runs/RunsScreen.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/App.test.tsx`, `apps/desktop/src/review-b.test.ts`, `apps/desktop/src/styles/tokens.css`, `apps/desktop/src/styles/tokens.test.ts`
- Create: `apps/desktop/src/ui/Page.test.tsx`

**Interfaces:**
- Consumes: the Page bar rules of "UI design", decision 23.
- Produces: `Page({ screen, ready, title, description?, actions?, before?, size?, children? })` with `size?: "narrow" | "medium" | "wide"` (default `"medium"`). Markup: `<section data-screen data-screen-ready class=page>` (a flex column, `height: 100%`, `overflow: hidden`) containing `<header class=bar>` (the `before` node, the `h1` with `ref` and `tabIndex={-1}`, then `actions`) and `<div class=body data-scroll="top">` that holds `<div data-size=...>` (the column) with the description paragraph first, then the children. Tokens: `--wide-width: 960px` is added. `RunsScreen` passes `size="wide"` (its final value, Task 12 keeps it) and `InboxScreen` passes `size="wide"` to its `Page` until Task 10 removes `Page` from the Inbox, so that neither screen is squeezed into 720 px in the commits between. The other callers keep the default `medium`; their tasks set the size they need.
- `App`'s route-change `useLayoutEffect` resets every scroller that should start at the top: `for (const zone of main.querySelectorAll<HTMLElement>('[data-scroll="top"]')) zone.scrollTop = 0;` in place of the single `section[data-screen]` reset of commit 26b70b7. The title and focus part of that effect is unchanged.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.bar` and `.body` and the `[data-size]` selectors in `Page.module.css`.

- [ ] **Step 1: Write the failing tests**

`Page.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Page } from "./Page";

test("a page has a bar with the title and actions, and a body with the description and the content", () => {
  const { container } = render(
    <Page screen="demo" ready title="Settings" description="Some words" actions={<button type="button">Go</button>} before={<a href="#/x">Back</a>}>
      <p>Content</p>
    </Page>,
  );
  const root = container.querySelector("[data-screen='demo']") as HTMLElement;
  expect(root.getAttribute("data-screen-ready")).toBe("true");
  const bar = root.querySelector("header") as HTMLElement;
  const heading = within(bar).getByRole("heading", { level: 1, name: "Settings" });
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(within(bar).getByRole("button", { name: "Go" })).toBeTruthy();
  const back = within(bar).getByRole("link", { name: "Back" });
  expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(bar).queryByText("Some words")).toBeNull();
  const column = root.querySelector("[data-size]") as HTMLElement;
  expect(within(column).getByText("Some words")).toBeTruthy();
  expect(within(column).getByText("Content")).toBeTruthy();
});
test("size picks the column: medium by default", () => {
  const a = render(<Page screen="a" ready title="A">x</Page>);
  expect(a.container.querySelector("[data-size]")?.getAttribute("data-size")).toBe("medium");
  a.unmount();
  const b = render(<Page screen="b" ready title="B" size="narrow">x</Page>);
  expect(b.container.querySelector("[data-size]")?.getAttribute("data-size")).toBe("narrow");
  expect(screen.getByRole("heading", { level: 1, name: "B" })).toBeTruthy();
});
test("page styles: a 52 px bar with a hairline, a body that scrolls, three column widths", () => {
  const css = readFileSync("apps/desktop/src/ui/Page.module.css", "utf8");
  expect(css).toMatch(/\.bar\s*\{[^}]*height:\s*var\(--bar-height\)[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  expect(css).toMatch(/\.body\s*\{[^}]*overflow-y:\s*auto[^}]*padding:\s*24px 32px 32px/s);
  expect(css).toMatch(/\[data-size="narrow"\][^{]*\{[^}]*max-width:\s*var\(--decision-width\)/s);
  expect(css).toMatch(/\[data-size="medium"\][^{]*\{[^}]*max-width:\s*var\(--reading-width\)/s);
  expect(css).toMatch(/\[data-size="wide"\][^{]*\{[^}]*max-width:\s*var\(--wide-width\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
```

In the first test above, also assert that the column sits in the zone that resets: `expect(root.querySelector('[data-scroll="top"]')?.contains(column)).toBe(true);`.

In `review-b.test.ts`, test `frame and screens own their scroll regions`, change the `Page.module.css` line to:

```ts
expect(read("./ui/Page.module.css")).toMatch(/overflow-y:\s*auto;[\s\S]*padding:\s*24px 32px 32px/);
```

In `App.test.tsx`, test `route changes reset scroll, title and focus`, the section no longer scrolls, so the test sets and reads the real scroller. Replace its body with:

```tsx
renderApp("#/inbox");
await screen.findByText("Decisions waiting for you. Nothing risky happens until you approve it.");
const page = document.querySelector<HTMLElement>('section[data-screen="inbox"]');
if (!page) throw new Error("Missing inbox page");
const zone = page.querySelector<HTMLElement>('[data-scroll="top"]');
if (!zone) throw new Error("Missing inbox scroller");
zone.scrollTop = 200;
const item = within(page).getAllByRole("button", { name: /expires/i })[1];
if (!item) throw new Error("Missing inbox item");
fireEvent.click(item);
await waitFor(() => expect(zone.scrollTop).toBe(0));
fireEvent.click(screen.getByRole("link", { name: "Settings" }));
await screen.findByRole("heading", { level: 1, name: "Settings" });
await waitFor(() => {
  const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
  expect(document.querySelector<HTMLElement>('section[data-screen="settings"] [data-scroll="top"]')?.scrollTop).toBe(0);
  expect(document.title).toBe("Settings - FlowDriven");
  expect(document.activeElement).toBe(heading);
  expect(heading.getAttribute("tabindex")).toBe("-1");
});
```

The `Page` body persists while the Inbox selection changes, so `zone` is the same element before and after the click: this is the case where only the `App` effect can reset it.

In `tokens.test.ts` add `["wide-width", "960px"]` to the `px` list of `the size tokens have the approved values`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/ui/Page.test.tsx apps/desktop/src/review-b.test.ts apps/desktop/src/App.test.tsx apps/desktop/src/styles`
Expected: FAIL (`expected null to be 'medium'`; `Missing inbox scroller`)

- [ ] **Step 3: Implement** `Page` and its CSS per "UI design: Page bar", and the `App` effect change of Interfaces. The `h1` focus and `document.title` effect of `Page` stay as they are. Add `--wide-width` to `tokens.css`. `InboxScreen` and `RunsScreen` get `size="wide"`; nothing else changes in them in this task.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src
git commit -m "Give single-column screens a 52 px bar and a reading column, and reset each scrolling zone" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 8: Builder: the conversation

**Files:**
- Modify: `apps/desktop/src/screens/builder/ChatPanel.tsx`, `apps/desktop/src/screens/builder/BuilderScreen.tsx`, `apps/desktop/src/screens/builder/Builder.module.css`, `apps/desktop/src/screens/builder/Builder.test.tsx`, `apps/desktop/src/styles/tokens.css`, `apps/desktop/src/styles/tokens.test.ts`

**Interfaces:**
- Consumes: `Icon` (`arrow-up`), the Builder "Conversation" and "Composer" rules of "UI design".
- Produces: `ChatPanel({ messages, send })` (props unchanged) renders `<section aria-label="Chat">`: a bar with the `h2` "Chat"; the scroll area `<div class=threadScroll data-scroll="bottom" ref={messagesBox}>` holding `<div class=thread>`; the dock with the composer. Messages: a user message is a right-aligned bubble; an agent message is plain text. Each message is `<div class=message>` whose first child is a visually hidden `<span>` "You, 10 Nov, 08:30: " or "FlowDriven, 10 Nov, 08:31: " (author, `formatDateTime`), and whose next child is the element holding the text (`.bubble` or `.agent`); the span never wraps the text. Questions are `<ol class=questions>` of `<li>` (the question text, then `<div role="group" aria-label="Answers to <question>">` holding one `<button class=chip type=button>` per suggestion); no number badge (decision 4). The text area keeps `aria-label="Message"`, the placeholder, `rows={2}` and Cmd+Enter. The send control is a single `<button type="button" aria-label="Send">` with the `arrow-up` icon, disabled while busy or empty. With no messages the thread shows "Describe changes in your own words." Behaviour (`submit`, `inFlight`, draft clearing, scroll to newest) is unchanged.
- `BuilderScreen`'s root becomes a grid of the conversation and a pane `<section aria-label="Flow details">` that, in this task, wraps the existing toolbar, header, playback, steps and error line unchanged (Task 9 restyles them). `--chat-width` is removed from `tokens.css`.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.layout`, `.threadScroll`, `.thread`, `.dock`, `.bubble`, `.composer`, `.chip` and `.send` in `Builder.module.css`.

- [ ] **Step 1: Write the failing tests**

In `Builder.test.tsx`, add `import { readFileSync } from "node:fs";` at the top (the file does not import it today; `act`, `vi`, `waitFor`, `within` and `PREVIEW_AGENT_REPLY` are already imported). Change `findByRole("complementary", { name: "Chat" })` to `findByRole("region", { name: "Chat" })` in `chat shows the conversation and the preview reply`, `chat suggestions send as messages, and Cmd+Enter sends`, `chat guards submissions and preserves a draft when choosing a suggestion` and `chat scrolls to the newest message after an update`. In the last one, also replace `const box = message.parentElement?.parentElement;` with:

```tsx
const box = message.closest<HTMLElement>('[data-scroll="bottom"]');
expect(box).not.toBeNull();
```

(its `if (!box) throw ...` line and every later line stay). Add:

```tsx
test("each message is announced with its author and time, and shows neither", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  expect(within(chat).getByRole("heading", { level: 2, name: "Chat" })).toBeTruthy();
  expect(await within(chat).findByText("You, 10 Nov, 08:30:")).toBeTruthy();
  expect(within(chat).getByText("FlowDriven, 10 Nov, 08:31:")).toBeTruthy();
});
test("a question shows its suggestions directly under it", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const items = await within(chat).findAllByRole("listitem");
  expect(items).toHaveLength(2);
  const first = items[0] as HTMLElement;
  const second = items[1] as HTMLElement;
  expect(within(first).getByText("Which project folder holds the Flutter app?")).toBeTruthy();
  expect(within(first).getByRole("group", { name: "Answers to Which project folder holds the Flutter app?" })).toBeTruthy();
  expect(within(first).getAllByRole("button").map((b) => b.textContent)).toEqual(["Use the last folder", "Choose another folder"]);
  expect(within(second).getAllByRole("button").map((b) => b.textContent)).toEqual(["Yes, list every mismatch", "No, skip visual review"]);
  expect(within(chat).queryByRole("button", { pressed: true })).toBeNull();
});
test("the composer is a text area and an icon-only Send button that waits for text", async () => {
  renderApp(FIGMA);
  const chat = await screen.findByRole("region", { name: "Chat" });
  const send = within(chat).getByRole("button", { name: "Send" });
  expect(send.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(send.textContent).toBe("");
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(within(chat).getByLabelText("Message"), { target: { value: "Hello" } });
  expect(send).toHaveProperty("disabled", false);
});
test("an empty conversation says how to start", async () => {
  renderApp("#/builder/new");
  expect(await screen.findByText("Describe changes in your own words.")).toBeTruthy();
});
test("a new flow's pane says nothing has been drafted", async () => {
  renderApp("#/builder/new");
  const pane = await screen.findByRole("region", { name: "Flow details" });
  expect(within(pane).getByRole("heading", { level: 1, name: "New flow" })).toBeTruthy();
  expect(within(pane).getByText("Describe work you repeat, and the agent turns it into a flow.")).toBeTruthy();
});
test("conversation styles follow the approved layout", () => {
  const css = readFileSync("apps/desktop/src/screens/builder/Builder.module.css", "utf8");
  expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--pane-width\)/s);
  expect(css).toMatch(/\.threadScroll\s*\{[^}]*overflow-y:\s*auto[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  expect(css).toMatch(/\.thread\s*\{[^}]*max-width:\s*var\(--reading-width\)[^}]*margin:\s*auto auto 0/s);
  expect(css).toMatch(/\.dock\s*\{[^}]*max-width:\s*var\(--dock-width\)/s);
  expect(css).toMatch(/\.bubble\s*\{[^}]*background:\s*var\(--surface-bubble\)[^}]*border-radius:\s*var\(--radius-bubble\)/s);
  expect(css).toMatch(/\.composer\s*\{[^}]*border-radius:\s*var\(--radius-composer\)/s);
  expect(css).toMatch(/\.composer:focus-within\s*\{[^}]*outline:\s*2px solid var\(--accent\)/s);
  expect(css).toMatch(/\.chip\s*\{[^}]*height:\s*30px[^}]*border-radius:\s*15px/s);
  expect(css).toMatch(/\.send\s*\{[^}]*background:\s*var\(--ink\)/s);
});
```

`an empty conversation says how to start` already passes before this task (the line sits in today's chat header); it pins that the line survives its move into the empty thread. In `tokens.test.ts` add:

```ts
test("rail, pane and the smallest chat fit the minimum window", () => {
  const security = readFileSync("apps/desktop/electron/security.ts", "utf8");
  const minimum = Number(/MIN_WINDOW = \{ width: (\d+)/.exec(security)?.[1]);
  const px = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1]);
  expect(minimum).toBe(1100);
  expect(px("rail-width") + px("pane-width") + 360).toBeLessThanOrEqual(minimum);
  expect(tokens).not.toMatch(/--chat-width/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/builder apps/desktop/src/styles`
Expected: FAIL (`Unable to find role="region" and name "Chat"`; `Unable to find role="region" and name "Flow details"`; `--chat-width` still defined)

- [ ] **Step 3: Implement** `ChatPanel`, the `BuilderScreen` shell and the CSS (`.layout`, `.chat`, `.bar`, `.threadScroll`, `.thread`, `.message`, `.user`, `.bubble`, `.agent`, `.questions`, `.chips`, `.chip`, `.dock`, `.composer`, `.composerRow`, `.send`, plus a visually hidden class for the author prefix), with the values of "UI design: Builder". `ChatPanel`'s scroll-to-newest effect keeps writing `scrollTop = scrollHeight` on the `data-scroll="bottom"` element. Keep every pane class still used by the old content; Task 9 removes them. Every box with user text keeps `overflow-wrap: anywhere` and every grid or flex child `min-width: 0`. The composer text area sets `outline: 0` and the composer carries the focus ring through `:focus-within`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src
git commit -m "Move the Builder chat to the centre and restyle the composer" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 9: Builder: the flow pane

**Files:**
- Modify: `apps/desktop/src/screens/builder/BuilderScreen.tsx`, `apps/desktop/src/screens/builder/Playback.tsx`, `apps/desktop/src/screens/builder/StepList.tsx`, `apps/desktop/src/screens/builder/StepRow.tsx`, `apps/desktop/src/screens/builder/Builder.module.css`, `apps/desktop/src/screens/builder/Builder.test.tsx`

**Interfaces:**
- Consumes: `Button` (sizes), `StatusBadge`, `ToneIcon`, `StateIcon`, `Badge`, `CheckList`, `AppLink`, `statusOf`, `useRunnerQuery("flows.list")` for `lastRun.runId`.
- Produces: the pane of "UI design: Builder". Pane bar (`<header class=bar>`): `<h1 ref={headingRef} tabIndex={-1} title={name}>` with the flow name (the "Builder" and "New flow" headings of the empty states move into the same bar and keep `ref={headingRef}` and `tabIndex={-1}`; the `useLayoutEffect` on `[id, loading, queryError]` and the `previousId` guard of commit 26b70b7 stay exactly as they are), Undo (quiet, small, `undo`), Run now (primary, small; while a run starts: disabled, a spinning `ring` icon and the word "Running"). The flow picker is removed. Meta line: "Build flow" or "Light flow", "Version X", the sign-off mark (approved: a `check` `ToneIcon` and the single text "Approved for version X"; stale: the `StatusBadge` "Changed since approval" plus the existing sentence; none: the `StatusBadge` "Not approved yet"), and "Latest run" with an `AppLink` to the run when `lastRun` exists. `StepRow` renders `<li data-state={status}>`: the number; line one is the `StateIcon` (domain `step`), the title button (still the first button of the row), the state word; line two is the worker line with its tag, then the four quiet icon buttons (aria-labels unchanged: Move up, Move down, Duplicate, Delete); the Uses chips; the `CheckList`; the expanded instructions as today. `Playback` renders the Goal text, the touches as tags and the asks as a plain list or "Nothing risky.". The `Steps` list stays an `ol` with `aria-label="Steps"` and no nested lists. The pane body is `<div class=paneBody data-scroll="top">`.
- Unchanged: edit, run and error behaviour, the dialogs, `Add step` (now a small secondary button in the Steps title row), the error `role="alert"` line.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.pane`, `.paneBody` and `.step` (with `[data-state="running"]`) in `Builder.module.css`.

- [ ] **Step 1: Write the failing tests**

Replace `the flow picker and the default flow` with:

```tsx
test("choosing a flow in the sidebar opens it, and the first flow is the default", async () => {
  renderApp("#/builder");
  expect(await screen.findByRole("heading", { level: 1, name: "Documents and reports" })).toBeTruthy();
  expect(screen.queryByLabelText("Flow")).toBeNull();
  const nav = screen.getByRole("navigation", { name: "Flows" });
  fireEvent.click(await within(nav).findByRole("link", { name: /Email triage and draft replies/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/builder/dev.example.email-triage"));
  expect(await screen.findByRole("heading", { level: 1, name: "Email triage and draft replies" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: /Email triage and draft replies/ }).getAttribute("aria-current")).toBe("page");
});
```

In `does not repeat a summary equal to the flow name` change the expected count to `1`. Add a helper next to `rows`: `const openFlow = (name: RegExp) => fireEvent.click(within(screen.getByRole("navigation", { name: "Flows" })).getByRole("link", { name }));`. Then replace each `fireEvent.change(screen.getByLabelText("Flow"), ...)` line, keeping every other line of those tests:
- `shows harness names, singular count, and clears errors on flow switch`: `openFlow(/Email triage and draft replies/);`
- `clears a failed update when leaving and returning to the flow`: `openFlow(/Email triage and draft replies/);`, then `openFlow(/Figma to Flutter/);`
- `focuses the flow heading after loading and changing flows`: `openFlow(/One source into many social posts/);`

Add:

```tsx
test("the pane bar holds the name, Undo and Run now, then the kind, version, sign-off and latest run", async () => {
  renderApp(FIGMA);
  const pane = await screen.findByRole("region", { name: "Flow details" });
  const bar = pane.querySelector("header") as HTMLElement;
  const heading = within(bar).getByRole("heading", { level: 1, name: "Figma to Flutter" });
  expect(heading.getAttribute("title")).toBe("Figma to Flutter");
  expect(pane.querySelectorAll('[data-scroll="top"]')).toHaveLength(1);
  expect(within(bar).getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(within(bar).getByRole("button", { name: "Run now" })).toBeTruthy();
  expect(within(pane).getByText("Build flow")).toBeTruthy();
  expect(within(pane).getByText("Version 1.0.0")).toBeTruthy();
  expect(within(pane).getByText("Approved for version 1.0.0")).toBeTruthy();
  expect(within(pane).getByText("Latest run")).toBeTruthy();
  expect(within(pane).getByRole("link", { name: "run-0006" }).getAttribute("href")).toBe("#/runs/run-0006");
});
test("a flow with no run shows no Latest run link", async () => {
  renderApp("#/builder/dev.example.quarterly-compliance-review", { scenario: "long" });
  const pane = await screen.findByRole("region", { name: "Flow details" });
  await within(pane).findByText("Version 1.0.0");
  expect(within(pane).queryByText("Latest run")).toBeNull();
});
test("a step row shows its number, state icon, title, state word and actions", async () => {
  renderApp(FIGMA);
  await waitFor(() => expect(rows()).toHaveLength(5));
  const third = row(2);
  expect(third.getAttribute("data-state")).toBe("failed");
  expect(within(third).getByText("3")).toBeTruthy();
  expect(third.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(third).getAllByRole("button")[0]?.textContent).toBe("Build the screens");
  expect(within(third).getAllByText("Failed").length).toBeGreaterThan(0);
  for (const name of ["Move up", "Move down", "Duplicate", "Delete"])
    expect(within(third).getByRole("button", { name })).toBeTruthy();
});
test("the running step is tinted, and check words stay in their own column", async () => {
  const { client } = renderApp(FIGMA);
  const step = client.state.runs.find((r) => r.id === "run-0006")?.steps[2];
  if (!step) throw new Error("Fixture step missing");
  step.state = "running";
  await waitFor(() => expect(row(2).getAttribute("data-state")).toBe("running"));
  expect(within(row(2)).getAllByText("Running").length).toBeGreaterThan(0);
  const css = readFileSync("apps/desktop/src/screens/builder/Builder.module.css", "utf8");
  expect(css).toMatch(/\.step\[data-state="running"\]\s*\{[^}]*background:\s*var\(--info-soft\)/s);
  expect(css).toMatch(/\.pane\s*\{[^}]*border-left:\s*1px solid var\(--border\)/s);
  expect(css).toMatch(/\.paneBody\s*\{[^}]*overflow-y:\s*auto/s);
});
```

The New flow pane test moved to Task 8, where the pane is made; it must keep passing here with the `h1` in the new bar.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/builder`
Expected: FAIL. In `the pane bar holds the name, Undo and Run now, ...` the first failing line is `expect(heading.getAttribute("title"))` (`expected null to be 'Figma to Flutter'`: the old pane already has a header with the `h1`, but no `title`). `a step row shows its number, ...` fails with `expected null to be 'failed'` (rows have no `data-state`); `choosing a flow in the sidebar opens it, ...` fails on `queryByLabelText("Flow")` (the picker is still there). `a flow with no run shows no Latest run link` passes at once and is kept as a pin.

- [ ] **Step 3: Implement** the pane per "UI design: Builder" and the Interfaces above. Delete the old toolbar (select), `flowHeader`, `panel` and `sectionHeading` rules that no longer apply. Run now shows "Running" while `running` is true (the existing guard test expects the text to contain "Running").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: `pnpm build:web && pnpm preview:web`, open `http://127.0.0.1:4173/#/builder/dev.example.figma-to-flutter` in light and dark (`?theme=...`) and `#/builder/new`; show the owner.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/builder
git commit -m "Restyle the Builder flow pane and its step rows" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 10: Inbox: the list column and the screen shell

**Files:**
- Modify: `apps/desktop/src/screens/inbox/InboxScreen.tsx`, `apps/desktop/src/screens/inbox/ApprovalList.tsx`, `apps/desktop/src/screens/inbox/ApprovalDetail.tsx`, `apps/desktop/src/screens/inbox/Inbox.module.css`, `apps/desktop/src/screens/inbox/Inbox.test.tsx`, `apps/desktop/src/App.test.tsx`

**Interfaces:**
- Consumes: `ToneIcon`, `Icon`, `StatusBadge`, `Revealed`, `formatDateTime`, the Inbox "List" rules of "UI design", decisions 23 to 25.
- Produces: once loaded, `InboxScreen` renders `<section data-screen="inbox" data-screen-ready="true" class=layout>` (grid `var(--list-width) minmax(0, 1fr)`) with no `Page`: the list zone (a bar holding the page's only `h1`, "Inbox"; the tabs; the tabpanel) and the decision zone. Loading and error states still use `ScreenState` (and so `Page`). The tablist keeps `role="tablist"`, `aria-label="Decisions"`, the ids, `aria-controls`, roving `tabIndex` and arrow keys; each tab shows `Waiting` or `Resolved`, a space, and `(N)` in `<span className={styles.count}>`; the accessible name is therefore still "Waiting (N)" / "Resolved (N)" and the tab has no `aria-label`. `ApprovalList` rows stay `<button>`s inside `<ul aria-label="Decisions">`; the selected row has `aria-current="true"`; a row shows the icon, the title (`Revealed`, two lines at most), the flow and step line, and either "Expires ..." with a 13 px `clock` icon (pending) or the approval `StatusBadge` (resolved). `ApprovalDetail`'s root becomes `<div class=detail><div class=detailScroll data-scroll="top"><div class=col>` around today's content (Task 11 restyles it). The list rows sit in `<div class=items>` (the list scroller, no `data-scroll`, decision 23).
- The `h1` is `<h1 ref={headingRef} tabIndex={-1}>Inbox</h1>`. `InboxScreen` declares `const headingRef = useRef<HTMLHeadingElement>(null)` and, before its early returns, `useLayoutEffect(() => { if (!loaded || !headingRef.current) return; document.title = "Inbox - FlowDriven"; headingRef.current.focus({ preventScroll: true }); }, [loaded])` with `const loaded = !query.loading && !query.error`. This replaces what `Page` did for the loaded Inbox (decision 24); the `App` effect still focuses it on later route changes.
- Only JSX and CSS change in `InboxScreen.tsx`: the `justResolved`, `previousSelection`, `inFlight`, `pinned` and `cancelDisabled` code, the `resolve` function and the two dialogs stay as they are, and `ApprovalDetail` keeps receiving `busy={busy || justResolved.current.has(selected.id)}`.
- The description "Decisions waiting for you. ..." is not shown once loaded (decision 20).

- The CSS tests below read these class names, so the CSS module must use them exactly: `.layout`, `.item`, `.summary`, `.tab`, `.items`, `.detailScroll` and `.count` in `Inbox.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Inbox.test.tsx`; every existing Inbox test stays unchanged)

```tsx
test("the Inbox has one h1 and, with a decision open, one h2", async () => {
  renderApp("#/inbox/ap-0011");
  await screen.findByRole("heading", { level: 2, name: "Send a reply to Priya Shah about invoice 1042" });
  expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Inbox"]);
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  const heading = screen.getByRole("heading", { level: 1, name: "Inbox" });
  expect(heading.tabIndex).toBe(-1);
  await waitFor(() => expect(document.activeElement).toBe(heading));
  expect(document.title).toBe("Inbox - FlowDriven");
  expect(screen.queryByText("Decisions waiting for you. Nothing risky happens until you approve it.")).toBeNull();
});
test("the open decision is marked in the list and its title is the detail heading", async () => {
  renderApp("#/inbox/ap-0011");
  const heading = await screen.findByRole("heading", { level: 2 });
  const current = within(list()).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "true");
  expect(current).toHaveLength(1);
  expect(current[0]?.textContent).toContain(heading.textContent ?? "never");
});
test("waiting rows say when they expire, and resolved rows show the decision as icon plus word", async () => {
  renderApp("#/inbox");
  const tab = await screen.findByRole("tab", { name: "Waiting (5)" });
  expect(tab.textContent).toBe("Waiting (5)");
  expect(tab.hasAttribute("aria-label")).toBe(false);
  const waiting = await within(list()).findAllByRole("listitem");
  for (const item of waiting) expect(item.textContent).toMatch(/Expires \d+ \w+, \d\d:\d\d/);
  fireEvent.click(await screen.findByRole("tab", { name: "Resolved (2)" }));
  await waitFor(() => expect(within(list()).getAllByRole("listitem")).toHaveLength(2));
  for (const item of within(list()).getAllByRole("listitem")) {
    expect(item.textContent).toMatch(/Approved|Rejected|Expired/);
    expect(item.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  }
});
test("the list column and rows follow the approved layout", () => {
  expect(css).toMatch(/\.layout\s*\{[^}]*grid-template-columns:\s*var\(--list-width\) minmax\(0, 1fr\)/s);
  expect(css).toMatch(/\.item\[aria-current="true"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(css).toMatch(/\.item\[aria-current="true"\]::before\s*\{[^}]*background:\s*var\(--accent\)/s);
  expect(css).toMatch(/\.summary\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  expect(css).toMatch(/\.tab\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(css).toMatch(/\.tab\[aria-selected="true"\]::after\s*\{[^}]*background:\s*var\(--accent\)/s);
  expect(css).toMatch(/\.items\s*\{[^}]*overflow-y:\s*auto/s);
  expect(css).toMatch(/\.detailScroll\s*\{[^}]*overflow-y:\s*auto/s);
  expect(css).toMatch(/\.count\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
});
```

In `App.test.tsx`, test `route changes reset scroll, title and focus` (as Task 7 left it), the description line is gone and the decision scroller lives in the detail. Replace its first nine lines, up to and including the `await waitFor(() => expect(zone.scrollTop).toBe(0));` line, with:

```tsx
renderApp("#/inbox/ap-0011");
await screen.findByRole("heading", { level: 2, name: "Send a reply to Priya Shah about invoice 1042" });
const page = document.querySelector<HTMLElement>('section[data-screen="inbox"]');
if (!page) throw new Error("Missing inbox page");
const zone = () => page.querySelector<HTMLElement>('[data-scroll="top"]');
const first = zone();
if (!first) throw new Error("Missing decision scroller");
first.scrollTop = 200;
const item = within(page)
  .getAllByRole("button", { name: /expires/i })
  .find((b) => b.getAttribute("aria-current") !== "true");
if (!item) throw new Error("Missing inbox item");
fireEvent.click(item);
await waitFor(() => expect(window.location.hash).not.toBe("#/inbox/ap-0011"));
await waitFor(() => expect(zone()?.scrollTop).toBe(0));
```

The Settings half of the test stays as Task 7 wrote it. The decision scroller is inside the keyed `ApprovalDetail`, so a new decision always starts at the top; `App` resets it too.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/inbox apps/desktop/src/App.test.tsx`
Expected: FAIL (`expected [] to have a length of 1`: no row has `aria-current`; in `the Inbox has one h1`, the description line is still shown, so `toBeNull()` fails). The updated `App.test.tsx` test passes before and after the change (before, the `Page` body is the zone): it is a pin that the change must keep green.

- [ ] **Step 3: Implement** the shell, tabs, rows and CSS. Keep the `.patch`, `.hidden`, `.added`, `.removed`, `.recipients` and `.editor` rules and the `white-space: pre-wrap` and `min-height` rules that `Inbox.test.tsx` reads from the CSS file; keep `overflow-wrap: anywhere` and `min-width: 0` on user-text boxes. Remove the old `.waiting` left border.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS (all Inbox tests, old and new)

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add apps/desktop/src/screens/inbox apps/desktop/src/App.test.tsx
git commit -m "Restyle the Inbox list and screen shell" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 11: Inbox: the decision

**Files:**
- Modify: `apps/desktop/src/screens/inbox/ApprovalDetail.tsx`, `apps/desktop/src/screens/inbox/PayloadView.tsx`, `apps/desktop/src/screens/inbox/Inbox.module.css`, `apps/desktop/src/screens/inbox/Inbox.test.tsx`

**Interfaces:**
- Consumes: `Button` (`size="large"`, variants), `StatusBadge`, `Icon`, `Revealed`, `actionName`, `noun`, the "Decision" rules of "UI design: Inbox".
- Produces: `ApprovalDetail` (props unchanged). Inside `.detail`: a bar `<div role="group" aria-label="Decision state">` with the approval `StatusBadge` at the left and, at the right, "Expires <time>" (pending) or "Resolved <time>" (when `resolvedAt` exists); then `.detailScroll > .col` whose direct children are, in order: the `h2` (summary, `Revealed`), the facts `dl` (Action, Flow, Step, Run; the Expires, Decision and Resolved rows move to the bar), `PayloadView`, the note line, the actions, the similar block (a hairline, the text button, the explanation), the "Next decision" button (as today: shown after a decision, secondary, default size), the `role="status"` paragraph, the `role="alert"` paragraph and the 24-hour paragraph. The status, the alert, the 24-hour paragraph and the `h2` stay siblings (existing tests read `status.parentElement` and `alert.parentElement`). Approve, Edit and Reject keep `disabled={busy}` from the `busy` prop, which `InboxScreen` already computes as `busy || justResolved.current.has(selected.id)`. `PayloadView` (props unchanged) renders a card: an `h3` strip (the strings of "UI design: Inbox"), then the rows or the body. The note line is chosen by `payload.kind`: email "Nothing is sent until you choose.", post "Nothing is posted until you choose.", amount "Nothing is paid until you choose.", diff "Nothing changes until you choose.", text "Nothing happens until you choose." (only while the approval is pending). The explanation reads `You see all ${similar.length} ${plural} before anything is approved. This covers this run only.` where `plural` is `${noun(approval)}s`.
- Unchanged: every callback, the guards, `Revealed`, `splitHidden`, the `Recipients` cap and its "and N more" button (restyled as an underlined text), the edit preview and textarea (label "Edit the text"), the patch markup (`.patch > div` per line).

- The CSS tests below read these class names, so the CSS module must use them exactly: `.col`, `.strip`, `.body`, `.similar`, `.hidden` and `.patch` in `Inbox.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Inbox.test.tsx`; existing tests stay unchanged)

```tsx
test("everything that would be sent is above the buttons, under a strip that says what it is", async () => {
  renderApp("#/inbox/ap-0011");
  const strip = await screen.findByRole("heading", { level: 3, name: "This is the email that would be sent" });
  const card = strip.parentElement as HTMLElement;
  expect(within(card).getByText("Priya Shah <priya@example.com>")).toBeTruthy();
  expect(within(card).getByText("Re: Invoice 1042")).toBeTruthy();
  expect(within(card).getByText(/^Hi Priya,/)).toBeTruthy();
  const note = screen.getByText("Nothing is sent until you choose.");
  const approve = screen.getByRole("button", { name: "Approve" });
  expect(card.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(note.compareDocumentPosition(approve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("Approve is the only filled button, Edit and Reject match, Approve all is a text button with its explanation", async () => {
  renderApp("#/inbox/ap-0011");
  const approve = await screen.findByRole("button", { name: "Approve" });
  const edit = screen.getByRole("button", { name: "Edit" });
  const reject = screen.getByRole("button", { name: "Reject" });
  const all = screen.getByRole("button", { name: "Approve all 3 similar for this run" });
  expect(approve.getAttribute("data-variant")).toBe("primary");
  for (const button of [approve, edit, reject]) expect(button.getAttribute("data-size")).toBe("large");
  expect([edit, reject].map((b) => b.getAttribute("data-variant"))).toEqual(["secondary", "secondary"]);
  expect(all.getAttribute("data-variant")).toBe("text");
  const filled = within(screen.getByRole("main")).getAllByRole("button").filter((b) => b.getAttribute("data-variant") === "primary");
  expect(filled).toEqual([approve]);
  const explanation = screen.getByText("You see all 3 sends before anything is approved. This covers this run only.");
  expect(all.compareDocumentPosition(explanation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reject.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("the bar shows the decision state and its expiry, then when it was resolved", async () => {
  renderApp("#/inbox/ap-0014");
  const bar = await screen.findByRole("group", { name: "Decision state" });
  expect(within(bar).getByText("Waiting for you")).toBeTruthy();
  expect(within(bar).getByText(/^Expires \d+ \w+, \d\d:\d\d$/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await screen.findByText("Approved.");
  expect(within(screen.getByRole("group", { name: "Decision state" })).getByText("Approved")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Decision state" })).getByText(/^Resolved \d+ \w+, \d\d:\d\d$/)).toBeTruthy();
});
test("a post and a change are labelled for what they are", async () => {
  const post = renderApp("#/inbox/ap-0014");
  expect(await screen.findByRole("heading", { level: 3, name: "This is the post that would be published" })).toBeTruthy();
  expect(screen.getByText("Nothing is posted until you choose.")).toBeTruthy();
  post.unmount();
  renderApp("#/inbox");
  expect(await screen.findByRole("heading", { level: 3, name: "These are the changes you are approving" })).toBeTruthy();
  expect(screen.getByText("Nothing changes until you choose.")).toBeTruthy();
});
test("the decision styles follow the approved layout", () => {
  expect(css).toMatch(/\.col\s*\{[^}]*max-width:\s*var\(--decision-width\)/s);
  expect(css).toMatch(/\.strip\s*\{[^}]*background:\s*var\(--surface-sunken\)[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  expect(css).toMatch(/\.body\s*\{[^}]*font-size:\s*var\(--text-read\)[^}]*line-height:\s*1\.65[^}]*white-space:\s*pre-wrap/s);
  expect(css).toMatch(/\.similar\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).toMatch(/\.hidden\s*\{[^}]*background:\s*var\(--bad-soft\)[^}]*color:\s*var\(--bad\)/s);
  expect(css).toMatch(/\.patch\s*\{[^}]*white-space:\s*pre-wrap/s);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/inbox`
Expected: FAIL (`Unable to find role="heading" and name "This is the email that would be sent"`)

- [ ] **Step 3: Implement** per the Interfaces and "UI design: Inbox". Edit and Reject are `Button variant="secondary" size="large"`. The Edit-mode buttons ("Approve with edits" primary large, "Cancel" secondary large) keep their behaviour. Hidden-character marks keep `role="img"` and their `aria-label` and `title`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: `pnpm build:web && pnpm preview:web`, open `#/inbox/ap-0011` and `#/inbox/ap-0016?scenario=long` (the query goes before the hash: `http://127.0.0.1:4173/?scenario=long#/inbox/ap-0016`) in light and dark; check the long email, the hidden-character marks and the recipient cap.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/inbox
git commit -m "Restyle the Inbox decision so everything sent shows above the buttons" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 12: Runs and Run detail

**Files:**
- Modify: `apps/desktop/src/screens/runs/RunsScreen.tsx`, `apps/desktop/src/screens/runs/RunsTable.tsx`, `apps/desktop/src/screens/runs/RunDetailScreen.tsx`, `apps/desktop/src/screens/runs/StepBlock.tsx`, `apps/desktop/src/screens/runs/Runs.module.css`, `apps/desktop/src/screens/runs/Runs.test.tsx`

**Interfaces:**
- Consumes: `Page` (`size`), `StatusBadge`, `StateIcon`, `Badge`, `Button`, `CheckList` (Task 4), the "Runs and Run detail" rules of "UI design".
- Produces: Runs uses `<Page size="wide">`; Run detail uses `<Page size="medium">` with `before` = the "All runs" `AppLink` (class `back`, `arrow-left` icon) and `actions` = Resume and Save as flow (small, as today's variants). `StepBlock({ step, index })` renders `<section aria-labelledby=id>` whose header row is the number, the `StateIcon` (domain `step`), the `h3` title and the state word (or, for the contradiction, the `Badge` "Marked passed without a passing check"); the "Worker: ..., attempt N of M" line keeps its text parts (`Worker: Codex, ` and `attempt 4 of 4` in one container so its `textContent` is `Worker: Codex, attempt 4 of 4`). Tables, text, routes, filters (and their persistence), buttons and their guards are unchanged.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.table`, `.step` and `.reason` in `Runs.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Runs.test.tsx`; existing tests stay unchanged; add `import { readFileSync } from "node:fs";` at the top of the file)

```tsx
test("each run's state is an icon plus a word, and the run id is a link", async () => {
  renderApp("#/runs");
  await waitFor(() => expect(bodyRows()).toHaveLength(7));
  const first = bodyRow(0);
  expect(within(first).getByText("Waiting for you")).toBeTruthy();
  expect(first.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(first).getByRole("link", { name: "run-0007" }).getAttribute("href")).toBe("#/runs/run-0007");
});
test("Run detail puts All runs in the bar before the title", async () => {
  renderApp("#/runs/run-0006");
  const heading = await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
  const back = screen.getByRole("link", { name: "All runs" });
  expect(heading.closest("header")?.contains(back)).toBe(true);
  expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
test("a step block is a row with its number, state icon, title and state word", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Build the screens" });
  expect(within(step).getByText("3")).toBeTruthy();
  expect(step.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(within(step).getAllByText("Failed").length).toBeGreaterThan(0);
  expect(step.querySelector("h3")?.textContent).toBe("Build the screens");
});
test("Run detail keeps its six sections", async () => {
  renderApp("#/runs/run-0005");
  await screen.findByRole("heading", { level: 1, name: "Documents and reports" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Report", "Steps", "Inputs", "Outputs", "Approvals", "Usage",
  ]);
});
test("runs styles: hairline rows, 44 px table rows, steps as rows not cards", () => {
  const css = readFileSync("apps/desktop/src/screens/runs/Runs.module.css", "utf8");
  expect(css).toMatch(/\.table td\s*\{[^}]*height:\s*44px/s);
  expect(css).toMatch(/\.table th\s*\{[^}]*color:\s*var\(--text-muted\)[^}]*font-size:\s*12\.5px/s);
  expect(css).toMatch(/\.step\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.step\s*\{[^}]*(border-radius|background)/s);
  expect(css).toMatch(/\.reason\s*\{[^}]*background:\s*var\(--bad-soft\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/runs`
Expected: FAIL in `Run detail puts All runs in the bar before the title` (`expected false to be true`: the link is not in the header yet) and in the CSS test (`expected '...' to match /\.table td\s*\{...`). `each run's state is an icon plus a word, ...`, `a step block is a row with its number, ...` (`StepBlock` already renders the number) and `Run detail keeps its six sections` pass at once and are kept as pins of what the restyle must not change.

- [ ] **Step 3: Implement** per the Interfaces. `Runs.module.css` keeps `overflow-wrap: anywhere` and `min-width: 0` (`layout-guards.test.ts` reads both). The filters' selects take the shared form style from `base.css`; the label is 12.5px muted above the select.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: `pnpm build:web && pnpm preview:web`, open `#/runs` and `#/runs/run-0006` in light and dark.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/runs
git commit -m "Restyle Runs and Run detail" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 13: Readiness

**Files:**
- Modify: `apps/desktop/src/screens/readiness/ReadinessScreen.tsx`, `apps/desktop/src/screens/readiness/ReadinessRow.tsx`, `apps/desktop/src/screens/readiness/FixGuide.tsx`, `apps/desktop/src/screens/readiness/Readiness.module.css`, `apps/desktop/src/screens/readiness/Readiness.test.tsx`

**Interfaces:**
- Consumes: `Page` (`size="medium"`), `StatusBadge`, `RiskBadge`, `Badge`, `Button`, `Icon`, the Readiness rules of "UI design".
- Produces: the same screen with the same behaviour. The banner is `<div data-state="ready" | "attention">` with an `Icon` (`check` or `hand`, as today) and the unchanged texts. The requirement list is a flat `ul` (no card): each row has a hairline below it. The state mark stays at the right of the row header. The fix guide is a `--surface-sunken` block. Dialog and texts unchanged.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.banner` (with `[data-state]`), `.row`, `.list` and `.guide` in `Readiness.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Readiness.test.tsx`; add `import { readFileSync } from "node:fs";` at the top of the file)

```tsx
test("the banner says ready or not ready with an icon, and marks its state", async () => {
  const ready = renderApp("#/readiness/dev.example.documents-and-reports");
  const readyBanner = (await screen.findByText("Ready to run. Every required item is OK.")).closest("[data-state]") as HTMLElement;
  expect(readyBanner.getAttribute("data-state")).toBe("ready");
  expect(readyBanner.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  ready.unmount();
  renderApp("#/readiness/dev.example.social-posts");
  const banner = (await screen.findByText("Not ready. 4 required items need attention.")).closest("[data-state]") as HTMLElement;
  expect(banner.getAttribute("data-state")).toBe("attention");
});
test("each requirement shows its state as icon plus word at the end of its row", async () => {
  renderApp("#/readiness/dev.example.social-posts");
  const ffmpeg = await screen.findByRole("listitem", { name: "FFmpeg" });
  expect(within(ffmpeg).getByText("Missing")).toBeTruthy();
  expect(ffmpeg.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});
test("readiness styles: tinted banner, flat rows, a sunken fix guide", () => {
  const css = readFileSync("apps/desktop/src/screens/readiness/Readiness.module.css", "utf8");
  expect(css).toMatch(/\.banner\[data-state="ready"\]\s*\{[^}]*background:\s*var\(--ok-soft\)/s);
  expect(css).toMatch(/\.banner\[data-state="attention"\]\s*\{[^}]*background:\s*var\(--wait-soft\)/s);
  expect(css).toMatch(/\.row\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.list\s*\{[^}]*border-radius/s);
  expect(css).toMatch(/\.guide\s*\{[^}]*background:\s*var\(--surface-sunken\)[^}]*border-radius:\s*var\(--radius-m\)/s);
  expect(css).not.toMatch(/accent-soft/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/readiness`
Expected: FAIL in `the banner says ready or not ready ...` (`TypeError: Cannot read properties of null (reading 'getAttribute')`: no element has `data-state` yet) and in the CSS test. `each requirement shows its state as icon plus word ...` passes at once and is kept as a pin.

- [ ] **Step 3: Implement** per "UI design: Readiness". Keep `overflow-wrap: anywhere` and `min-width: 0` in the CSS module (`layout-guards.test.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: preview `#/readiness/dev.example.social-posts` in light and dark.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/readiness
git commit -m "Restyle the Readiness screen" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 14: Harnesses

**Files:**
- Modify: `apps/desktop/src/screens/harnesses/HarnessesScreen.tsx`, `apps/desktop/src/screens/harnesses/HarnessCardView.tsx`, `apps/desktop/src/screens/harnesses/Harnesses.module.css`, `apps/desktop/src/screens/harnesses/Harnesses.test.tsx`

**Interfaces:**
- Consumes: `Page` (`size="medium"`), `Button`, `RiskBadge`, `StatusBadge`, `Icon`, the Harnesses rules of "UI design".
- Produces: the same screen and behaviour. The articles are direct children of one list container (`.list`), each `<article aria-label=name>` (the existing test reads `getAllByRole("article")` and expects exactly the detected harnesses), flat, separated by a hairline. `ConsentDialog.tsx` and the texts are unchanged.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.card` and `.warning` in `Harnesses.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Harnesses.test.tsx`; add `import { readFileSync } from "node:fs";` at the top of the file)

```tsx
test("Re-scan sits in the page bar and each harness is a flat article with its name and risk", async () => {
  renderApp("#/harnesses");
  const codex = await screen.findByRole("article", { name: "Codex" });
  const bar = screen.getByRole("heading", { level: 1, name: "Harnesses" }).closest("header") as HTMLElement;
  expect(within(bar).getByRole("button", { name: "Re-scan" })).toBeTruthy();
  expect(within(codex).getByRole("heading", { level: 2, name: "Codex" })).toBeTruthy();
  expect(within(card("Antigravity")).getByText("Unofficial")).toBeTruthy();
});
test("harnesses styles: one flat column with hairlines, no cards", () => {
  const css = readFileSync("apps/desktop/src/screens/harnesses/Harnesses.module.css", "utf8");
  expect(css).toMatch(/\.card\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.card\s*\{[^}]*(border-radius|background)/s);
  expect(css).not.toMatch(/repeat\(auto-fill/);
  expect(css).toMatch(/\.warning\s*\{[^}]*color:\s*var\(--bad\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/harnesses`
Expected: FAIL in the CSS test, on its first assertion (`.card` `border-top`: `expected '...' to match /\.card\s*\{...`). The first test (`Re-scan sits in the page bar ...`) may pass at once; it is kept as a pin.

- [ ] **Step 3: Implement** per "UI design: Harnesses". The vendor warning keeps its `alert` icon and its words.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: preview `#/harnesses` in light and dark.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/harnesses
git commit -m "Restyle the Harnesses screen" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 15: Settings

**Files:**
- Modify: `apps/desktop/src/screens/settings/SettingsScreen.tsx`, `apps/desktop/src/screens/settings/BrainSection.tsx`, `apps/desktop/src/screens/settings/FallbackSection.tsx`, `apps/desktop/src/screens/settings/BudgetSection.tsx`, `apps/desktop/src/screens/settings/Settings.module.css`, `apps/desktop/src/screens/settings/Settings.test.tsx`

**Interfaces:**
- Consumes: `Page` (`size="narrow"`), `Button`, `Badge`, `RiskBadge`, `Dialog`, the Settings rules of "UI design".
- Produces: the same screen, copy and behaviour, as plain sections (no card background, border or radius) with a hairline between them. Sections keep their `h2`s ("Brain", "Fallback order", "Monthly API-key budget", "One-time flows") and the radiogroup, radio, field and checkbox names the tests use.

- The CSS tests below read these class names, so the CSS module must use them exactly: `.panel` (and `.panel + .panel`), `.track`, `.fill`, `.warn` and `.stopped` in `Settings.module.css`.

- [ ] **Step 1: Write the failing tests** (add to `Settings.test.tsx`; add `import { readFileSync } from "node:fs";` at the top of the file)

```tsx
test("Settings is one narrow column of four plain sections", async () => {
  const { container } = renderApp("#/settings");
  await screen.findByRole("radiogroup", { name: "Main brain" });
  expect(container.querySelector("[data-screen='settings'] [data-size='narrow']")).not.toBeNull();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Brain", "Fallback order", "Monthly API-key budget", "One-time flows",
  ]);
});
test("settings styles: sections have a hairline, no card, and the meter uses state colours", () => {
  const css = readFileSync("apps/desktop/src/screens/settings/Settings.module.css", "utf8");
  expect(css).toMatch(/\.panel\s*\+\s*\.panel\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.panel\s*\{[^}]*(border-radius|background)/s);
  expect(css).toMatch(/\.track\s*\{[^}]*background:\s*var\(--surface-sunken\)/s);
  expect(css).toMatch(/\.fill\s*\{[^}]*background:\s*var\(--text-muted\)/s);
  expect(css).toMatch(/\.warn\s*\{[^}]*background:\s*var\(--wait\)/s);
  expect(css).toMatch(/\.stopped\s*\{[^}]*background:\s*var\(--bad\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run apps/desktop/src/screens/settings`
Expected: FAIL (`expected null not to be null`: the page has no narrow column yet)

- [ ] **Step 3: Implement** per "UI design: Settings". The moving-up and moving-down icon buttons in the fallback list stay `quiet` icon buttons with their aria-labels.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (GUI)**: preview `#/settings` in light and dark.

- [ ] **Step 7: Chair step (commit)**

```bash
git add apps/desktop/src/screens/settings
git commit -m "Restyle the Settings screen" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.

---

### Task 16: Final sweep and guards

**Files:**
- Modify: `apps/desktop/src/layout-guards.test.ts`, `apps/desktop/src/styles/tokens.test.ts`, `apps/desktop/src/screens.test.ts`
- The chair, not the executor, also edits `docs/plans/ROADMAP.md` in the commit step.

**Interfaces:**
- Consumes: everything above. This task changes no product code. If a guard below fails, fix the stylesheet or component it names; do not weaken the guard.

- [ ] **Step 1: Write the failing tests**

`layout-guards.test.ts`: add `"nav/Sidebar.module.css"` and `"ui/Page.module.css"` to `files`.

`tokens.test.ts`:

```ts
test("no stylesheet uses a shadow: hairlines only", () => {
  for (const [file, css] of cssFiles()) expect(css, file).not.toMatch(/box-shadow\s*:\s*(?!none)/);
});
test("the tone accent is gone from the code", () => {
  const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.tsx") && !f.endsWith(".test.ts"));
  for (const file of sources) expect(readFileSync(`${SRC}/${file}`, "utf8"), file).not.toMatch(/tone[:=]\s*\{?"accent"/);
});
```

`screens.test.ts` (add; it already imports `screens.json` and `parseRoute`):

```tsx
import { waitFor } from "@testing-library/react";
import { renderApp } from "./test/render";

test("every captured screen becomes ready and never shows Loading once ready", { timeout: 30_000 }, async () => {
  for (const entry of screens) {
    const view = renderApp(`#${entry.hash}`, { scenario: entry.scenario as "long" | undefined });
    await waitFor(() => expect(view.container.querySelector('[data-screen-ready="true"]'), entry.name).not.toBeNull());
    expect(view.container.querySelector('[role="status"]'), entry.name).toBeNull();
    view.unmount();
  }
});
```

(Rename the file's import list as Biome asks; `screens.test.ts` becomes `screens.test.tsx` only if the executor needs JSX, which this test does not.)

- [ ] **Step 2: Prove each guard, then run them**

These are guard tests over finished work, so there is no failing step in the usual sense. Prove each guard bites once, then undo the probe: add `box-shadow: 0 0 1px var(--border);` to `ui/Page.module.css` and run `pnpm vitest run apps/desktop/src/styles` (expected FAIL naming `ui/Page.module.css`); set one `tone: "wait"` in `ui/status.ts` back to `tone: "accent"` and run the same command (expected FAIL naming `ui/status.ts`); add `text-overflow: ellipsis;` to a rule in `nav/Sidebar.module.css` and run `pnpm vitest run apps/desktop/src/layout-guards.test.ts apps/desktop/src/App.test.tsx` (expected FAIL in `a long flow name wraps in the sidebar`). Revert each probe by hand (remove the one added line, put the one `tone` back) and confirm `git status` lists only the three test files of this task; the executor runs no git write.

Run: `pnpm vitest run apps/desktop/src`
Expected: PASS. Any FAIL names the file that still has a shadow, an accent tone, a missing ready attribute or a leftover "Loading". Fix that file, not the test.

- [ ] **Step 3: Run the gate and the build**

Run: `pnpm format && pnpm check && pnpm build:web`
Expected: PASS

- [ ] **Step 4: Chair step (GUI)**: `pnpm capture` must exit 0 with 16 PNGs in `.workflow/scratch/screens/`. Open all 16 (eight screens, light and dark) and compare with the approved look; show the owner. `pnpm start` once to see the real window.

- [ ] **Step 5: Chair step (commit)**: first add this section to `docs/plans/ROADMAP.md`, directly after the "01 Foundation and screens" section and before "02" (the "Order changed" paragraph already says plan 01b is applied alongside and does not change the order, so no other line moves):

```markdown
### 01b The simple look (detailed: `2026-11-11-01b-simple-look.md`)
- Goal: every screen of plan 01 gets the approved simple look: a sidebar with the flows, the conversation in the centre, the work pane on the right, hairlines, an ink primary button, the system font, a light and a dark theme. "New flow" is the only new behaviour.
- Owner sees: the 16 screenshots again in the new look, and the app in its window.
- Spec: 5 and 18.4 (the look), 8.2, 12, 13.2, 13.3.
- Depends on: 01. Changes no contract and not the plan order (see "Order changed").
```

Then:

```bash
git add apps/desktop/src docs/plans/ROADMAP.md
git commit -m "Guard the simple look: no shadows, no accent tone, every screen ready" -m "Assisted-by: Codex"
```

Done by: <tool/model>, <date>. Evidence: <passing command>.
