import { expect, test } from "vitest";
import { OWN_TEXT, ownTextRefusal } from "./own-text.ts";

test("own text with a format character (U+0600, U+070F) that the Inbox does not mark is refused as hidden", () => {
  for (const code of [0x0600, 0x070f])
    expect(ownTextRefusal(`text${String.fromCodePoint(code)}text`)).toBe(OWN_TEXT.hidden);
});
