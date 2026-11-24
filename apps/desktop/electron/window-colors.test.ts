import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { WINDOW_BACKGROUND, windowBackground } from "./window-colors";

const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const surfaceApp = (selector: RegExp) => selector.exec(tokens)?.[1]?.toLowerCase();

test("the window is painted with the page colour of each theme", () => {
  expect(WINDOW_BACKGROUND.light.toLowerCase()).toBe(
    surfaceApp(/:root\s*\{[^}]*--surface-app:\s*(#[0-9a-f]{6})/i),
  );
  expect(WINDOW_BACKGROUND.dark.toLowerCase()).toBe(
    surfaceApp(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{[^}]*--surface-app:\s*(#[0-9a-f]{6})/i,
    ),
  );
  expect(windowBackground(false)).toBe(WINDOW_BACKGROUND.light);
  expect(windowBackground(true)).toBe(WINDOW_BACKGROUND.dark);
});
