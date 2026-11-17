import { expect, test } from "vitest";
import { throwsMailAway } from "./label-rule.ts";

test("throwsMailAway is false for the label FlowDriven and for INBOX", () => {
  expect(throwsMailAway({ label: "FlowDriven", nested: ["INBOX", 1, true, null] })).toBe(false);
});

test("throwsMailAway is true for Trash, [Gmail]/Spam and a fullwidth TRASH, as a key or a value, at any depth", () => {
  const fullwidth = String.fromCodePoint(0xff34, 0xff32, 0xff21, 0xff33, 0xff28);
  const hidden = `s${String.fromCodePoint(0x200b)}p a m`;
  for (const word of ["Trash", "[Gmail]/Spam", fullwidth, hidden]) {
    expect(throwsMailAway({ nested: [{ label: word }] })).toBe(true);
    expect(throwsMailAway({ nested: [{ [word]: "label" }] })).toBe(true);
  }
  expect(throwsMailAway("pretrashpost")).toBe(true);
});

test("throwsMailAway is true for an input deeper than 20", () => {
  let value: unknown = {};
  for (let i = 0; i < 19; i++) value = [value];
  expect(throwsMailAway(value)).toBe(false);
  expect(throwsMailAway([value])).toBe(true);
  expect(throwsMailAway([[[null]]])).toBe(false);
  let primitive: unknown = "INBOX";
  for (let i = 0; i < 20; i++) primitive = [primitive];
  expect(throwsMailAway(primitive)).toBe(false);
});
