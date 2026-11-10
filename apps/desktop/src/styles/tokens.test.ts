import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const SRC = "apps/desktop/src";
const tokens = readFileSync(`${SRC}/styles/tokens.css`, "utf8");
const hex = (css: string) =>
  Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const lightBlock = tokens.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const darkBlock = tokens.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
const light = hex(lightBlock);
const dark = { ...light, ...hex(darkBlock) };
const cssFiles = () =>
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".css"))
    .map((f) => [f, readFileSync(`${SRC}/${f}`, "utf8")] as const);

const ROLES: [string, string, string][] = [
  ["surface-app", "#ffffff", "#212121"],
  ["surface-rail", "#f5f5f5", "#181818"],
  ["surface-panel", "#ffffff", "#2a2a2a"],
  ["surface-sunken", "#f4f4f4", "#1a1a1a"],
  ["surface-hover", "#ececec", "#272727"],
  ["surface-selected", "#e3e3e3", "#323232"],
  ["surface-bubble", "#f0f0f0", "#2e2e2e"],
  ["border", "#e4e4e4", "#353535"],
  ["border-strong", "#8c8c8c", "#767676"],
  ["text", "#171717", "#ececec"],
  ["text-muted", "#5c5c5c", "#a9a9a9"],
  ["ink", "#171717", "#ececec"],
  ["ink-hover", "#343434", "#ffffff"],
  ["on-ink", "#ffffff", "#161616"],
  ["accent", "#5b46c8", "#a597ff"],
  ["accent-text", "#5b46c8", "#a597ff"],
  ["accent-soft", "#eeebfb", "#2d2850"],
  ["on-accent", "#ffffff", "#16113a"],
  ["ok", "#1b7440", "#6fcf97"],
  ["ok-soft", "#e4f2ea", "#1d3326"],
  ["info", "#1b5cab", "#7db4f5"],
  ["info-soft", "#e4edf9", "#1e2d42"],
  ["wait", "#8f5307", "#e8b04a"],
  ["wait-soft", "#faefd9", "#392d16"],
  ["bad", "#bd2f27", "#ff8f86"],
  ["bad-soft", "#fbe8e6", "#3b2220"],
];
test("the colour tokens have the approved values in both themes", () => {
  for (const [name, l, d] of ROLES) {
    expect(light[name], `light ${name}`).toBe(l);
    expect(dark[name], `dark ${name}`).toBe(d);
  }
  expect(Object.keys(hex(darkBlock)).sort()).toEqual(Object.keys(light).sort());
});
test("the size tokens have the approved values", () => {
  const px: [string, string][] = [
    ["rail-width", "256px"],
    ["pane-width", "460px"],
    ["list-width", "368px"],
    ["bar-height", "52px"],
    ["reading-width", "720px"],
    ["dock-width", "768px"],
    ["decision-width", "640px"],
    ["wide-width", "960px"],
    ["text-read", "14.5px"],
    ["text-title", "15px"],
    ["text-xl", "18px"],
    ["radius-s", "6px"],
    ["radius-m", "8px"],
    ["radius-l", "10px"],
    ["radius-bubble", "16px"],
    ["radius-composer", "18px"],
  ];
  for (const [name, value] of px) expect(tokens, name).toMatch(new RegExp(`--${name}:\\s*${value}\\s*;`));
  expect(tokens).toMatch(/--font-ui:\s*system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;/);
  expect(tokens).toMatch(/--font-mono:\s*Menlo, Monaco, monospace;/);
});
const lum = (h: string) => {
  const w = [0.2126, 0.7152, 0.0722];
  const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  return c.reduce(
    (sum, v, i) => sum + (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * (w[i] ?? 0),
    0,
  );
};
const ratio = (a: string, b: string) => {
  const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const TEXT_ON = [
  "surface-app",
  "surface-rail",
  "surface-selected",
  "surface-hover",
  "surface-bubble",
  "surface-panel",
  "surface-sunken",
];
const PAIRS: [string, string[], number][] = [
  ["text", TEXT_ON, 4.5],
  ["text-muted", TEXT_ON, 4.5],
  ["ok", ["surface-app", "surface-rail", "surface-selected", "surface-sunken"], 4.5],
  ["bad", ["surface-app", "surface-rail", "surface-selected"], 4.5],
  ["info", ["surface-app", "surface-rail", "surface-selected"], 4.5],
  ["wait", ["surface-app", "surface-rail", "surface-selected", "wait-soft"], 4.5],
  ["accent", ["surface-app", "surface-rail", "surface-selected", "accent-soft", "surface-panel"], 3],
  ["text", ["info-soft", "accent-soft"], 4.5],
  ["text-muted", ["info-soft"], 4.5],
  ["info", ["info-soft"], 4.5],
  ["ok", ["info-soft"], 4.5],
  ["text", ["ok-soft", "wait-soft", "bad-soft"], 4.5],
  ["text-muted", ["ok-soft", "wait-soft", "bad-soft"], 4.5],
  ["ok", ["ok-soft"], 4.5],
  ["bad", ["bad-soft"], 4.5],
  ["on-ink", ["ink"], 4.5],
  ["border-strong", ["surface-app", "surface-panel", "surface-rail"], 3],
  ["on-accent", ["accent"], 3],
];
test("every text pair keeps its contrast in both themes", () => {
  for (const [name, theme] of [
    ["light", light],
    ["dark", dark],
  ] as const)
    for (const [fg, backgrounds, minimum] of PAIRS)
      for (const bg of backgrounds) {
        const r = ratio(theme[fg] ?? "#000000", theme[bg] ?? "#000000");
        expect(r, `${name}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(minimum);
      }
});
test("every var() in a stylesheet is defined, and colours live only in tokens.css", () => {
  const defined = new Set([...tokens.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
  for (const [file, css] of cssFiles()) {
    if (file === "styles/tokens.css") continue;
    const local = new Set([...css.matchAll(/--([\w-]+)\s*:/g)].map((m) => m[1]));
    for (const m of css.matchAll(/var\(--([\w-]+)/g))
      expect(defined.has(m[1]) || local.has(m[1]), `${file}: --${m[1]}`).toBe(true);
    expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  }
});
test("the body uses the UI font at 14px with a 1.5 line height", () => {
  expect(readFileSync(`${SRC}/styles/base.css`, "utf8")).toMatch(
    /body\s*\{[^}]*font:\s*400 var\(--text-m\)\s*\/\s*1\.5 var\(--font-ui\)/,
  );
});

test("the transitional tokens of Task 1 are gone once Button and Dialog stop using them", () => {
  expect(tokens).not.toMatch(/--accent-hover|--shadow-dialog|--text-l\b/);
});

test("rail, pane and the smallest chat fit the minimum window", () => {
  const security = readFileSync("apps/desktop/electron/security.ts", "utf8");
  const minimum = Number(/MIN_WINDOW = \{ width: (\d+)/.exec(security)?.[1]);
  const px = (name: string) => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(tokens)?.[1]);
  expect(minimum).toBe(1100);
  expect(px("rail-width") + px("pane-width") + 360).toBeLessThanOrEqual(minimum);
  expect(tokens).not.toMatch(/--chat-width/);
});

test("no stylesheet uses a shadow: hairlines only", () => {
  for (const [file, css] of cssFiles()) expect(css, file).not.toMatch(/box-shadow\s*:\s*(?!none)/);
});
test("the tone accent is gone from the code", () => {
  const sources = (readdirSync(SRC, { recursive: true }) as string[]).filter(
    (f) => /\.tsx?$/.test(f) && !f.endsWith(".test.tsx") && !f.endsWith(".test.ts"),
  );
  for (const file of sources)
    expect(readFileSync(`${SRC}/${file}`, "utf8"), file).not.toMatch(/tone[:=]\s*\{?"accent"/);
});
