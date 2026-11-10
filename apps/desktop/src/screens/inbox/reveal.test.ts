import { describe, expect, test } from "vitest";
// @ts-expect-error The checker is an untyped Node module.
import { HIDDEN_RANGES } from "../../../../../tools/checks/lib/ranges.mjs";
import { splitHidden } from "./reveal";

describe("hidden character coverage", () => {
  test("reveals every code point in the checker's hidden ranges", () => {
    for (const { from, to } of HIDDEN_RANGES) {
      for (let code = from; code <= to; code++) {
        expect(splitHidden(String.fromCodePoint(code)), `U+${code.toString(16)}`).toEqual([
          { text: String.fromCodePoint(code), hidden: true },
        ]);
      }
    }
  });
  test("reveals controls and lookalike spaces", () => {
    for (const code of [
      0, 8, 11, 13, 31, 127, 133, 159, 160, 0x1680, 0x2000, 0x202f, 0x205f, 0x3000, 0xfffc, 0x1d173, 0xd800,
    ]) {
      expect(splitHidden(String.fromCodePoint(code))[0]?.hidden, `U+${code.toString(16)}`).toBe(true);
    }
  });
});
