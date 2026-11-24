import { expect, test } from "vitest";
import { isValidLanguageCode, languages, listLanguages, resolveLanguage } from "./languages";

test("TC-j30-03 the real language list and fallback", () => {
  expect(languages.map(({ code }) => code)).toEqual(["en", "id"]);
  expect(languages.map(({ name }) => name)).toEqual(["English", "Bahasa Indonesia"]);
  expect([resolveLanguage("id"), resolveLanguage("xx"), resolveLanguage(undefined)]).toEqual([
    "id",
    "en",
    "en",
  ]);
});
test("TC-I18N-07 language code pattern", () => {
  expect(["en", "id", "fil", "pt-BR"].map(isValidLanguageCode)).toEqual([true, true, true, true]);
  expect(["EN", "e", "english", "en_US", "en-us", "x1", "", "en-"].map(isValidLanguageCode)).toEqual(
    Array(8).fill(false),
  );
});
test("TC-I18N-08 names and registration order", () => {
  const extended = [...languages, { code: "xx", name: "Xxish", words: {} }];
  expect(listLanguages()).toEqual([
    { code: "en", name: "English" },
    { code: "id", name: "Bahasa Indonesia" },
  ]);
  expect(listLanguages(extended)).toEqual([...listLanguages(), { code: "xx", name: "Xxish" }]);
  expect(resolveLanguage("xx", extended)).toBe("xx");
  expect(listLanguages(extended).every(({ name }) => name.length > 0 && name.length <= 40)).toBe(true);
});
