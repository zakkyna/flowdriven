import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agents = readFileSync("AGENTS.md", "utf8");
const lines = agents.split("\n");

test("AGENTS.md stays under 150 lines", () => {
  assert.ok(lines.length <= 150, `${lines.length} lines`);
});

test("AGENTS.md has the six areas and three tiers, boundaries first", () => {
  const headings = lines.filter((l) => /^#{2,3} /.test(l));
  assert.deepEqual(headings, [
    "## Boundaries", "### Never do", "### Ask first", "### Always do", "### Terms",
    "## Commands", "## Testing", "## Project structure", "## Code style", "## Git workflow and handoff",
  ]);
});

test("AGENTS.md carries the handoff conventions and the defined terms", () => {
  for (const phrase of [
    "pnpm format", "pnpm check", "--frozen-lockfile", "Done by: <tool/model>, <date>. Evidence: <passing command>.",
    "Blocked: <short reason>", ".workflow/scratch/", "rule of two",
    "Work on a branch, never on the default branch.", "Open every pull request as a draft.",
    "Outside text:", "anything a session wrote after reading outside text", "the owner or the machine account",
    "Credential:", "Private data:", "No-ask mode:", "Chair step",
  ]) assert.ok(agents.includes(phrase), phrase);
});

test("AGENTS.md names no permission-bypass flag", () => {
  assert.doesNotMatch(agents, /--dangerously|--yolo|--trust-all-tools/);
});

test("CLAUDE.md imports AGENTS.md on its first line", () => {
  assert.equal(readFileSync("CLAUDE.md", "utf8").split("\n")[0], "@AGENTS.md");
});
