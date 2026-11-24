import { expect, test } from "vitest";
import en from "./en";
import { type PluralValue, pluralCategories } from "./plural";
import { createT, t } from "./t";

test("TC-I18N-03 English plural and formatted numbers", () => {
  expect([0, 1, 2, 1240].map((n) => t("flows.count", { n }, "en"))).toEqual([
    "0 flows",
    "1 flow",
    "2 flows",
    "1,240 flows",
  ]);
});
test("TC-I18N-04 locale plural categories", () => {
  const pl = {
    code: "pl",
    name: "Polski",
    words: {
      a: { items: { one: "{n} rzecz", few: "{n} rzeczy", many: "{n} rzeczy-m", other: "{n} rzeczy-o" } },
    },
  };
  const translate = createT([en, pl]);
  expect([1, 2, 5, 22, 1.5].map((n) => translate("a.items", { n }, "pl"))).toEqual([
    "1 rzecz",
    "2 rzeczy",
    "5 rzeczy-m",
    "22 rzeczy",
    "1,5 rzeczy-o",
  ]);
  expect([1, 2].map((n) => t("flows.count", { n }, "id"))).toEqual(["1 flow", "2 flow"]);
  expect(pluralCategories("xx")).toEqual(pluralCategories("en"));
});
test("TC-I18N-05 missing category uses other", () => {
  const pl = {
    code: "pl",
    name: "Polski",
    words: { a: { items: { one: "{n} rzecz", other: "{n} rzeczy" } } },
  };
  const translate = createT([en, pl]);
  expect([2, 5].map((n) => translate("a.items", { n }, "pl"))).toEqual(["2 rzeczy", "5 rzeczy"]);
});
test("TC-I18N-19 plural type requires other", () => {
  // @ts-expect-error Every plural value needs its fallback.
  const invalid: PluralValue = { one: "{n} item" };
  expect(invalid).toEqual({ one: "{n} item" });
});
