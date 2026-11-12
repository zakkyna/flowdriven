import { expect, test } from "vitest";
import { scrollScript } from "./capture-scroll";

test("scrollScript quotes the id and scrolls it to the top", () => {
  expect(scrollScript("triggers-heading")).toBe(
    'document.getElementById("triggers-heading")?.scrollIntoView({ block: "start" });',
  );
  expect(scrollScript("a")).toBe('document.getElementById("a")?.scrollIntoView({ block: "start" });');
});

test("an id with a quote, a space, upper case or 70 characters gives undefined", () => {
  for (const id of ['a"b', "a b", "Heading", "1abc", "", "a_b", "a');x('", `a${"b".repeat(69)}`])
    expect(scrollScript(id), id).toBeUndefined();
  expect(scrollScript(`a${"b".repeat(60)}`)).toBeDefined();
  expect(scrollScript(`a${"b".repeat(61)}`)).toBeUndefined();
});
