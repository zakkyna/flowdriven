import { createHash } from "node:crypto";
import { hasHiddenText, type Value } from "@flowdriven/sdk";
import type { StepRow } from "../storage.ts";

export const OWN_TEXT_MAX = 4000;
export const OWN_TEXT = {
  summary: (title: string) =>
    `Approve "${title}" as your own words. A later step may run commands on your Mac from it.`,
  tooLong: "The text to approve is longer than 4,000 characters.",
  hidden: "The text to approve has hidden characters.",
  missing: "The text to approve is missing.",
};
export function ownTextHash(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
export function ownTextRefusal(value: Value | undefined): string | undefined {
  if (typeof value !== "string") return OWN_TEXT.missing;
  if (value.length > OWN_TEXT_MAX) return OWN_TEXT.tooLong;
  if (hasHiddenText(value)) return OWN_TEXT.hidden;
}
export function ownedNow(row: StepRow): boolean {
  const mark = row.ownerApproved;
  if (!mark) return false;
  const value = row.outputs[mark.output];
  return typeof value === "string" && ownTextHash(value) === mark.hash;
}
