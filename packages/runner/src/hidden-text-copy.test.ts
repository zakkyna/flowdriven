import { containsHiddenText } from "@flowdriven/contracts";
import { hasHiddenText } from "@flowdriven/sdk";
import { expect, test } from "vitest";

test("TC-CON-45 hidden text detection matches the SDK for every code point", () => {
  for (let code = 0; code <= 0x10ffff; code++) {
    const text = String.fromCodePoint(code);
    if (containsHiddenText(text) !== hasHiddenText(text)) throw new Error(`Mismatch at ${code}`);
  }
  expect(containsHiddenText("\n\t")).toBe(false);
});
