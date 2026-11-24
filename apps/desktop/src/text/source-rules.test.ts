/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const safeTextRelPath = "text/SafeText.tsx";

const forbiddenPatterns: { label: string; pattern: RegExp }[] = [
  { label: "dangerouslySetInnerHTML", pattern: /\bdangerouslySetInnerHTML\b/ },
  { label: ".innerHTML", pattern: /\.innerHTML\b/ },
  { label: ".outerHTML", pattern: /\.outerHTML\b/ },
  { label: "insertAdjacentHTML", pattern: /\binsertAdjacentHTML\b/ },
  { label: "document.write", pattern: /\bdocument\.write\b/ },
  { label: "eval(", pattern: /\beval\s*\(/ },
  { label: "new Function", pattern: /\bnew\s+Function\b/ },
  { label: "srcdoc", pattern: /\bsrcdoc\b/ },
];

const openLinkPattern = /window\.flowdrivenShell(?:\??\.window)?\??\.openLink|\bopenLink\s*\(/;

function collectNonTestSourceFiles(dir: string): { path: string; content: string }[] {
  if (!existsSync(dir)) return [];
  const files: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectNonTestSourceFiles(fullPath));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push({
        path: relative(srcRoot, fullPath).replaceAll("\\", "/"),
        content: readFileSync(fullPath, "utf8"),
      });
    }
  }
  return files;
}

function checkSafeTextSourceRules(files: { path: string; content: string }[]): string[] {
  const findings: string[] = [];
  const safeText = files.find((file) => file.path === safeTextRelPath);
  if (!safeText) {
    findings.push(`Missing ${safeTextRelPath}`);
  } else if (!openLinkPattern.test(safeText.content)) {
    findings.push(`${safeTextRelPath} does not call openLink`);
  }

  for (const file of files) {
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(file.content)) {
        findings.push(`${file.path}: contains ${rule.label}`);
      }
    }
    if (file.path !== safeTextRelPath && openLinkPattern.test(file.content)) {
      findings.push(`${file.path}: mentions openLink outside ${safeTextRelPath}`);
    }
  }

  return findings;
}

test("TC-UI-09 The source has no way to insert raw HTML", () => {
  expect(existsSync(join(srcRoot, safeTextRelPath))).toBe(true);
  const files = collectNonTestSourceFiles(srcRoot);
  expect(files.length).toBeGreaterThan(0);
  expect(checkSafeTextSourceRules(files)).toEqual([]);
});

test("TC-UI-09 flags planted raw HTML, script, and openLink violations", () => {
  const validSafeText = {
    path: safeTextRelPath,
    content:
      'export function SafeText() { return window.flowdrivenShell?.window?.openLink?.("https://example.com"); }',
  };

  for (const [label, snippet] of [
    ["dangerouslySetInnerHTML", "<div dangerouslySetInnerHTML={{ __html: x }} />"],
    [".innerHTML", "el.innerHTML = x;"],
    [".outerHTML", "el.outerHTML = x;"],
    ["insertAdjacentHTML", 'el.insertAdjacentHTML("beforeend", x);'],
    ["document.write", "document.write(x);"],
    ["eval(", "eval(x);"],
    ["new Function", 'new Function("return 1");'],
    ["srcdoc", "<iframe srcdoc={x} />"],
  ] as const) {
    const findings = checkSafeTextSourceRules([validSafeText, { path: "bad.tsx", content: snippet }]);
    expect(findings, label).toContain(`bad.tsx: contains ${label}`);
  }

  expect(
    checkSafeTextSourceRules([
      validSafeText,
      { path: "other.tsx", content: 'window.flowdrivenShell.window.openLink("https://example.com");' },
    ]),
  ).toContain(`other.tsx: mentions openLink outside ${safeTextRelPath}`);

  expect(
    checkSafeTextSourceRules([
      validSafeText,
      { path: "other2.tsx", content: 'openLink("https://example.com");' },
    ]),
  ).toContain(`other2.tsx: mentions openLink outside ${safeTextRelPath}`);

  expect(checkSafeTextSourceRules([{ path: "only.ts", content: "export const ok = 1;" }])).toContain(
    `Missing ${safeTextRelPath}`,
  );
});
