# Plan NN: <Name> Implementation Plan

> **Execution:** one task per Codex call through the handoff rules in AGENTS.md; Claude reviews each task against its gates. Steps use checkbox syntax for tracking.

**Goal:** <one sentence: what the owner can see or run when this plan is done>

**Architecture:** <two or three sentences on the approach>

**Tech Stack:** <only what is already on `tools/checks/allowlist.json`, plus any addition named under "Dependency changes">

**Spec:** `docs/superpowers/specs/2026-11-10-flow-maker-design.md` (sections ...). Roadmap: `docs/plans/ROADMAP.md`.

## Global Constraints

<one line per project-wide rule, with exact values copied from the spec: version floors, names and states, copy rules, platform limits>

## Gates

| Gate | Command | Passes when | Who |
|---|---|---|---|
| Task gate | `pnpm format && pnpm check` | exit 0 | executor |
| Commit | `git add ... && git commit ...` | commit created | **Chair step (commit)** |
| <network or GUI step, if any> | <command> | <result> | **Chair step (network)** / **Chair step (GUI)** |

## Dependency changes

<"None." or a table: package, exact version, permitted range, used in, why. A change here needs the owner's yes before the task that installs it. The allowlist change is its own task.>

## Decisions made in this plan

<numbered, one line each with its reason; only what the spec leaves to the builder (spec 18.4)>

## Review Focus

<the five input classes or failure modes most likely to bite a user that the spec implies but no test covers yet; one line each, most likely first; each line names the test added to the owning task>

---

## File Structure

```
<path>    <responsibility> (Task N)
```

---

### Task N: <Component name>

**Files:**
- Create: `exact/path`
- Modify: `exact/path`
- Test: `exact/path.test.ts`

**Interfaces:**
- Consumes: <exact names and signatures from earlier tasks>
- Produces: <exact names, parameter and return types later tasks rely on>

- [ ] **Step 1: Write the failing test**

```ts
test("<behaviour in the spec's words>", () => {
  expect(<call>).toEqual(<exact value from the spec>);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run <path>`
Expected: FAIL with "<message>"

- [ ] **Step 3: Implement `<name>(<params>): <ReturnType>` in `<path>`**

<one line on the approach only where the signature and the test leave a choice>

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run <path>`
Expected: PASS

- [ ] **Step 5: Run the gate**

Run: `pnpm format && pnpm check`
Expected: PASS

- [ ] **Step 6: Chair step (commit)**

```bash
git add <files>
git commit -m "<imperative summary>" -m "Assisted-by: Codex"
```

<!-- After the gates pass the executor adds one line under the task:
Done by: <tool/model>, <date>. Evidence: <passing command>.
After two failures: Blocked: <short reason> -->
