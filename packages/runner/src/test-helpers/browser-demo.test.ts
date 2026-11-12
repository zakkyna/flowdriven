import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runBrowserDemo } from "./browser-demo-run.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const root = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  return dir;
};

test("the demo prints the six lines in order", { timeout: 60_000 }, async () => {
  expect(await runBrowserDemo({ root: root() })).toEqual([
    "page read: https://example.com/",
    "click refused: This step may only read pages.",
    "address refused: This address is not one this step declares.",
    "page limit refused: This step reached its page limit for this run.",
    "moved page withheld: FlowDriven withheld this page because its address is not one this step declares.",
    "challenge blocked the run: This site asked for a login or a robot check. FlowDriven stopped and will not try to pass it.",
  ]);
});

test("each line comes from the audit or the run row: removing the page table makes line 1 fail", {
  timeout: 60_000,
}, async () => {
  const lines = await runBrowserDemo({ root: root(), pages: {} });
  expect(lines).toHaveLength(6);
  expect(lines.at(0)).not.toBe("page read: https://example.com/");
  expect(lines.at(1)).toBe("click refused: This step may only read pages.");
});

test("the demo leaves no control folder and no temporary folder behind", { timeout: 60_000 }, async () => {
  const base = root();
  await runBrowserDemo({ root: base });
  expect(readdirSync(base)).toEqual([]);
});
