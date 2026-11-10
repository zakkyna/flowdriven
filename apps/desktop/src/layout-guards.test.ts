/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const files = [
  "nav/Sidebar.module.css",
  "ui/Page.module.css",
  "ui/CheckList.module.css",
  "screens/builder/Builder.module.css",
  "screens/inbox/Inbox.module.css",
  "screens/runs/Runs.module.css",
  "screens/readiness/Readiness.module.css",
  "screens/harnesses/Harnesses.module.css",
  "screens/settings/Settings.module.css",
];

test("long text wraps instead of pushing the layout sideways", () => {
  for (const f of files) {
    const css = readFileSync(`apps/desktop/src/${f}`, "utf8");
    expect(css, f).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css, f).toMatch(/min-width:\s*0\b/);
  }
  expect(readFileSync("apps/desktop/src/styles/base.css", "utf8")).toMatch(/white-space:\s*pre-wrap/);
});
