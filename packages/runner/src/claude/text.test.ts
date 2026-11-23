import { expect, test } from "vitest";
import { visible } from "./text.ts";

test.each([0xfe0f, 0xe0100])("TC-SR1-23 marks default ignorable U+%s", (point) => {
  expect(visible(String.fromCodePoint(point), 100)).toBe(`<U+${point.toString(16).toUpperCase()}>`);
});
