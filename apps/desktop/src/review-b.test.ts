import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
test("theme, controls, links and reduced motion use the design rules", () => {
  const tokens = read("./styles/tokens.css");
  const base = read("./styles/base.css");
  expect(tokens).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/);
  const darkMedia = tokens.match(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/)?.[1] ?? "";
  const dark = tokens.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(darkMedia).toMatch(/color-scheme:\s*dark/);
  expect(dark).toMatch(/color-scheme:\s*dark/);
  expect(dark.match(/--[\w-]+:[^;]+;/g)).toEqual(darkMedia.match(/--[\w-]+:[^;]+;/g));
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
  expect(read("./ui/Page.module.css")).toMatch(/overflow:\s*auto;[\s\S]*padding:\s*28px 32px 48px/);
  expect(read("./screens/builder/Builder.module.css")).not.toMatch(/margin:\s*-28px/);
});
test("capture waits for loading to disappear and config uses explicit extension", () => {
  expect(read("../electron/capture.ts")).toMatch(/role=.["']?status|\[role=/);
  expect(read("../vite.config.mts")).toContain("./src/csp.mts");
});
