import { expect, test } from "vitest";
import type { StepRow } from "../storage.ts";
import { OWN_TEXT, OWN_TEXT_MAX, ownedNow, ownTextHash, ownTextRefusal } from "./own-text.ts";

test("ownedNow is true for the approved text and false after the output changes", () => {
  const row: StepRow = {
    runId: "r",
    stepId: "s",
    itemKey: "",
    state: "passed",
    attempts: [],
    checks: [],
    outputs: { plan: "hello" },
    ownerApproved: { output: "plan", hash: ownTextHash("hello"), approvalId: "a", at: "now" },
  };
  expect(ownTextHash("hello")).toBe(
    "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  expect(ownedNow(row)).toBe(true);
  row.outputs.plan = "changed";
  expect(ownedNow(row)).toBe(false);
  expect(ownTextRefusal(undefined)).toBe(OWN_TEXT.missing);
  expect(ownTextRefusal(42)).toBe(OWN_TEXT.missing);
  expect(ownTextRefusal("x".repeat(OWN_TEXT_MAX))).toBeUndefined();
  expect(ownTextRefusal("x".repeat(OWN_TEXT_MAX + 1))).toBe(OWN_TEXT.tooLong);
  expect(ownTextRefusal(String.fromCodePoint(0x202e))).toBe(OWN_TEXT.hidden);
});
