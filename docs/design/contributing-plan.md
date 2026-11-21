# Contributor guides plan (build step B-31)

Decided for V1 (revisable), 2026-11-21: contributing must be easy both for people who write code by hand and for AI agents. This plan says which guide files exist, who each one is for, and what each one says. The files are written in build step B-31, which belongs to V1 (`prd.md` section 9, `build-order.md`).

## Who reads what

| Reader | Starts at | Then |
|---|---|---|
| Someone who wants to try FlowDriven | `README.md` quickstart | `docs/design/prd.md` sections 1 to 5 |
| A person who codes by hand | `CONTRIBUTING.md` | `docs/design/README.md`, the flow spec and test cases of the build step they pick |
| An AI agent (Claude Code, Codex, others) | `AGENTS.md` (Claude Code reads it through `CLAUDE.md`) | the plan task it was given and the spec sections that task names |
| A translator | `docs/translating.md` | the English words file `apps/desktop/src/i18n/en.ts` |

Both paths meet in the same places: the design set in `docs/design/`, the plans in `docs/plans/`, the TDD loop of `docs/design/test-plan.md`, and the gate `pnpm format`, then `pnpm check`.

## The files

### `README.md` (repository root, new)

A short page with:
- the approved one-line description and what FlowDriven is not (from `prd.md` section 1);
- the status: what V1 contains and that it runs from a checkout until the signed download exists;
- requirements: macOS, Node 24.14.0 or later, pnpm 10.9.0, and for real runs at least one AI agent (Claude Code or Codex) signed in through its own flow;
- quickstart: `pnpm install --frozen-lockfile`, then `pnpm dev:web` (the screens in a browser with sample data, no agent needed) or `pnpm start` (the real app);
- the gate: `pnpm format`, then `pnpm check`;
- where to go next: `CONTRIBUTING.md`, `AGENTS.md`, `docs/design/README.md`, `docs/translating.md`;
- licences: AGPL-3.0 for the app, MIT for the SDK, the flow format and the adapter kit.

### `CONTRIBUTING.md` (new), for people who code by hand

1. How work flows: the clickable prototype first, then the flow spec, then its test cases, then code. A change to what the person sees starts in the prototype.
2. Picking work: a build step and its tasks in `docs/design/build-order.md`, or an issue that names one. One task per pull request.
3. The TDD loop of `docs/design/test-plan.md` section 1: write the failing test, run it, see it fail for the stated reason, write the code, tidy, run the gate.
4. Rules that matter most, in plain words, with a link to AGENTS.md for the full list: TypeScript strict and no `any`; Biome formats and lints; plain CSS modules with the tokens; status is icon plus words; no new package without approval (the dependency gate refuses it); no test that talks to the network, a real agent or a real account; never weaken or skip a test to pass the gate.
5. Safety-critical areas: changes to the runner, decisions and standing rules, sandbox limits, flow hashing or signature checks need one independent security review before they merge. The safety rules are in `docs/design/architecture.md`.
6. Commits and pull requests: English, imperative commit messages; AI help is disclosed with an `Assisted-by:` trailer; work on a branch; open pull requests as drafts.
7. Using an AI agent while you contribute: allowed, under the same rules as AGENTS.md, and the person who opens the pull request is responsible for it.
8. Contribution terms: published before outside pull requests are accepted (an open item of the original spec, section 18.2). Nobody signs off on contribution terms for another person.
9. Reporting a security problem: through the security policy file that arrives with the repository's GitHub setup (ROADMAP plan 10); until then, privately to the maintainer, never in a public issue.

### `AGENTS.md` (exists; stays the rule set for AI agents)

AGENTS.md keeps its role and its pinned layout (`tools/checks/test/agent-rules.test.mjs`). B-31 does not edit it (`prd.md`, Q-04). Two small changes wait for a later Ask-first question: pointing its "Design:" line to `docs/design/`, and a sentence saying that the language files are the one place for other languages.

### `docs/translating.md` (new), for translators

At most ten steps, matching brief 24.9.7 of the clickable prototype:
1. Copy `apps/desktop/src/i18n/en.ts` to `apps/desktop/src/i18n/<code>.ts`.
2. Set `code` and `name` (the name written in the language itself).
3. Translate the values. Keep the keys and every `{placeholder}`. Give each count the plural forms your language needs.
4. Add one line for your file to `apps/desktop/src/i18n/languages.ts`.
5. Run `pnpm check`. It fails, naming the file, the key and the fix in one line, on a key English lacks, a changed placeholder, a missing `other` plural form, or a code that is taken or is not a language tag. It lists the words not translated yet; they show in English until they are.
6. Keep product names as they are (FlowDriven, Claude Code, Codex). Do not add hidden or format characters; the hidden-character check refuses them.
7. Bahasa Indonesia's word rules (brief 24.6) are the example of a style note; a new language may add its own short style note at the top of its file.

### Later, with the repository's GitHub setup (ROADMAP plan 10)

`SECURITY.md`, `CODE_OF_CONDUCT.md`, the pull request template, issue forms and `CODEOWNERS`. They are named here so contributors know they are coming; they are not part of B-31.

## Checks for B-31

Docs get checks, not unit tests. The cases are in `test-cases/platform.md` under "DOC":
- every `pnpm <script>` named in `README.md`, `CONTRIBUTING.md` and `docs/translating.md` exists in the root `package.json`;
- every relative link in those files points to a file that exists;
- `docs/translating.md` steps work: a test language file added by a test, with two words, passes the language check and falls back to English for the rest (this is the same case as the I18N tests);
- the hidden-character check covers the new files (it scans every tracked file already).

The first two checks are one Vitest test, `apps/desktop/src/docs.test.ts`, so `tools/checks/` stays unchanged in V1 (`prd.md`, Q-04). Moving them into `tools/checks/` is a later Ask-first item.
