import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BOTH_LANGUAGES_SCREENS, renderAppBoth } from "./render";

function missingWrappers(entries: typeof BOTH_LANGUAGES_SCREENS, read: (path: string) => string | undefined) {
  return entries.filter(
    (entry) => entry.builtIn && !/\brenderAppBoth\s*\(/.test(read(entry.testFile) ?? "renderAppBoth("),
  );
}

test("runs both languages in order, cleans up, and restores document state", async () => {
  const originalLang = document.documentElement.lang;
  const originalHash = window.location.hash;
  const seen: string[] = [];
  await renderAppBoth("#/settings", {}, ({ language, container }) => {
    expect(document.documentElement.lang).toBe(language);
    expect(document.querySelectorAll('[data-testid="both-marker"]')).toHaveLength(0);
    const marker = document.createElement("div");
    marker.dataset.testid = "both-marker";
    container.appendChild(marker);
    seen.push(language);
  });
  expect(seen).toEqual(["en", "id"]);
  expect(document.querySelector('[data-testid="both-marker"]')).toBeNull();
  expect(document.documentElement.lang).toBe(originalLang);
  expect(window.location.hash).toBe(originalHash);
});

test("reports the failing language and restores state", async () => {
  const originalLang = document.documentElement.lang;
  const originalHash = window.location.hash;
  await expect(
    renderAppBoth("#/settings", {}, ({ language }) => {
      if (language === "id") throw new Error("body failed");
    }),
  ).rejects.toThrow(/id.*body failed/s);
  expect(document.documentElement.lang).toBe(originalLang);
  expect(window.location.hash).toBe(originalHash);
});

test("enforces the wrapper only for built-in screen tests that exist", () => {
  const entry = { screen: "test", hash: "#/test", testFile: "test.tsx", builtIn: true };
  expect(missingWrappers([{ ...entry, builtIn: false }], () => "old test")).toEqual([]);
  expect(missingWrappers([entry], () => undefined)).toEqual([]);
  expect(missingWrappers([entry], () => "old test")).toEqual([entry]);
  expect(missingWrappers([entry], () => 'renderAppBoth("#/test", {}, body)')).toEqual([]);
  expect(
    missingWrappers(BOTH_LANGUAGES_SCREENS, (path) =>
      existsSync(path) ? readFileSync(path, "utf8") : undefined,
    ),
  ).toEqual([]);
});
