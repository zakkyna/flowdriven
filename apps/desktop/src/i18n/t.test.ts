import { expect, test } from "vitest";
import en from "./en";
import { createT, fillPlaceholders, type TranslationKey, t } from "./t";

const xx = { code: "xx", name: "Xxish", words: { common: { cancel: "Xcancel" } } };
test("TC-j30-18 placeholders plurals and fallback", () => {
  const translate = createT([en, xx]);
  expect([
    t("flows.count", { n: 1 }, "en"),
    t("flows.count", { n: 2 }, "en"),
    t("flows.count", { n: 1 }, "id"),
    t("flows.count", { n: 2 }, "id"),
  ]).toEqual(["1 flow", "2 flows", "1 flow", "2 flow"]);
  expect(t("chat.starting", { flow: "Fill timesheet" }, "en")).toBe("Starting Fill timesheet.");
  expect(fillPlaceholders("Logged {date}, {x}", { date: "Thu 19 Nov" })).toBe("Logged Thu 19 Nov, {x}");
  expect([translate("rail.newChat", {}, "xx"), translate("common.cancel", {}, "xx")]).toEqual([
    "New chat",
    "Xcancel",
  ]);
});
test("TC-j30-19 unknown English key returns itself", () => {
  // @ts-expect-error An unknown key cannot be used.
  expect(t("nope.key")).toBe("nope.key");
});
test("TC-I18N-01 only English leaf keys are valid", () => {
  expect(t("rail.newChat")).toBe("New chat");
  // @ts-expect-error A group is not a key.
  t("rail");
  // @ts-expect-error Unknown keys are rejected.
  t("rail.nope");
  expect(t("rail.nope" as TranslationKey)).toBe("rail.nope");
});
test("TC-I18N-02 placeholders are replaced once", () => {
  expect(fillPlaceholders("Logged {date} for {flow}", { date: "Thu 19 Nov", flow: "Fill timesheet" })).toBe(
    "Logged Thu 19 Nov for Fill timesheet",
  );
  expect(fillPlaceholders("Logged {date}, {x}", { date: "Thu 19 Nov" })).toBe("Logged Thu 19 Nov, {x}");
  expect(fillPlaceholders("{a} {a}", { a: "Hi" })).toBe("Hi Hi");
  expect(fillPlaceholders("{a}", { a: "{b}", b: "no" })).toBe("{b}");
  expect(fillPlaceholders("Total {n}", { n: 1240 })).toBe("Total 1240");
  expect(fillPlaceholders("Brace { and }", {})).toBe("Brace { and }");
});
test("TC-I18N-06 missing words fall back to English", () => {
  const translate = createT([en, xx]);
  expect([
    translate("common.cancel", {}, "xx"),
    translate("rail.newChat", {}, "xx"),
    translate("flows.count", { n: 2 }, "xx"),
    translate("rail.newChat", {}, "zz"),
  ]).toEqual(["Xcancel", "New chat", "2 flows", "New chat"]);
});
