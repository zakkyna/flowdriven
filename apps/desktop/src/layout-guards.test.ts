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

function classGuard(css: string): string[] {
  const findings: string[] = [];
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (match) => [match[1] ?? "", match[2] ?? ""] as const,
  );
  const names = new Set<string>();
  for (const [selector] of rules) {
    for (const match of selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      const name = match[1];
      if (
        name &&
        name
          .replace(/([a-z])([A-Z])/g, "$1-$2")
          .split(/[-_]/)
          .some((word) => /^(button|tag|tab)$/i.test(word))
      )
        names.add(name);
    }
  }
  for (const name of names) {
    const mentions = rules.filter(([selector]) =>
      [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].some((match) => match[1] === name),
    );
    const base = mentions.filter(([selector]) => selector.trim() === `.${name}`);
    if (!base.some(([, body]) => /overflow-wrap\s*:\s*anywhere\s*(?:;|$)/.test(body.trim())))
      findings.push(`${name}: missing overflow-wrap`);
    if (mentions.some(([, body]) => /(?:text-overflow\s*:\s*ellipsis|white-space\s*:\s*nowrap)\b/.test(body)))
      findings.push(`${name}: truncation`);
  }
  return findings;
}

test("CSS class guard handles whole words, variants and truncation", () => {
  expect(
    classGuard(
      ".table td {} .titleButton:hover {} .tab { overflow-wrap: anywhere; } .tab:hover { color: red; }",
    ),
  ).toEqual(["titleButton: missing overflow-wrap"]);
  expect(classGuard(".tag { overflow-wrap: anywhere; } .parent .tag:hover { white-space: nowrap; }")).toEqual(
    ["tag: truncation"],
  );
});

test("button, tag and tab classes wrap in every CSS file", async () => {
  const { globSync } = await import("node:fs");
  const cssFiles = globSync("apps/desktop/src/**/*.css");
  expect(cssFiles.length).toBeGreaterThan(0);
  for (const file of cssFiles) expect(classGuard(readFileSync(file, "utf8")), file).toEqual([]);
});
