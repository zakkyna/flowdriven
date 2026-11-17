import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runConnectorDemo } from "./connector-demo-run.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const root = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  return dir;
};
const lines = [
  "list read: search_threads (read)",
  "undeclared tool refused: This step does not declare the tool mcp__claude_ai_Gmail__get_thread.",
  "risky call held: Hold test: delete_draft on Gmail",
  "approved call ran: delete_draft (call)",
  "changed input held again: 2 approvals for the step",
  "pick released one item: j1 ran in the loop over the choice, the call after the loop held",
  "non-text result withheld: unchecked",
  "tab closed after a withheld page: tab 1001 closed, step stopped: The page moved to an address this step does not declare.",
];
test("the demo prints the eight lines in order", { timeout: 60_000 }, async () => {
  expect(await runConnectorDemo({ root: root() })).toEqual(lines);
});
test("each line comes from the audit, the approvals or the call log: a run with no connectors scripted does not print line 1", {
  timeout: 60_000,
}, async () => {
  expect((await runConnectorDemo({ root: root(), connectors: false })).at(0)).not.toBe(lines.at(0));
});
test("the demo leaves no control folder and no temporary folder behind", { timeout: 60_000 }, async () => {
  const base = root();
  await runConnectorDemo({ root: base });
  expect(readdirSync(base)).toEqual([]);
});
