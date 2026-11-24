import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
test("theme, controls, links and reduced motion use the design rules", () => {
  const tokens = read("./styles/tokens.css");
  const base = read("./styles/base.css");
  expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark;/);
  expect(tokens).not.toMatch(/data-theme/);
  expect(tokens.match(/@media\s*\(prefers-color-scheme:\s*dark\)/g)).toHaveLength(1);
  const lightBlock = tokens.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const darkMedia =
    tokens.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(darkMedia).toMatch(/color-scheme:\s*dark;/);
  const lightColourTokens = (lightBlock.match(/--([\w-]+):\s*(?:#[0-9a-f]{6}|rgba\([^)]+\))/gi) ?? [])
    .map((m) => m.slice(2, m.indexOf(":")))
    .sort();
  const darkTokens = (darkMedia.match(/--([\w-]+):/g) ?? []).map((m) => m.slice(2, -1)).sort();
  expect(darkTokens.length).toBe(31);
  expect(darkTokens).toEqual(lightColourTokens);
  expect(base).toMatch(
    /select,\s*textarea,\s*input\s*\{[^}]*background:\s*var\(--surface-panel\);[^}]*color:\s*var\(--text\);[^}]*border:\s*1px solid var\(--border-strong\);[^}]*border-radius:\s*var\(--radius-s\)/,
  );
  expect(base).toMatch(
    /a\s*\{[^}]*color:\s*var\(--text\);[^}]*text-decoration:\s*underline;[^}]*text-underline-offset:\s*2px/,
  );
  expect(base).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{\s*transition:\s*none !important;\s*animation:\s*none !important;/,
  );
});
test("frame and screens own their scroll regions", () => {
  expect(read("./App.module.css")).toMatch(/\.main\s*\{[^}]*overflow:\s*hidden;/);
  expect(read("./ui/Page.module.css")).toMatch(/overflow-y:\s*auto;[\s\S]*padding:\s*24px 32px 32px/);
  expect(read("./screens/builder/Builder.module.css")).not.toMatch(/margin:\s*-28px/);
});
test("capture waits for loading to disappear and config uses explicit extension", () => {
  expect(read("../electron/capture.ts")).toMatch(/role=.["']?status|\[role=/);
  expect(read("../vite.config.mts")).toContain("./src/csp.mts");
});
