import type { Requirement, Value } from "@flowdriven/sdk";
import { visible } from "../claude/text.ts";
import { catalogEntry } from "../connectors/catalog.ts";
import { grantUsedKey, isCallGrant } from "../connectors/grants.ts";
import type { Store } from "../storage.ts";

export const MAX_HOLDS = 3;
export const MAX_HELD_CHARS = 4000;
export const HOLD_TEXT = {
  tooMany: "This step asked for approval too many times.",
  tooLarge: "This call is too large to show for your approval.",
};
export function heldPayload(input: Value): string | undefined {
  const text = JSON.stringify(input, null, 2)
    .split("\n")
    .map((line) => visible(line, Infinity))
    .join("\n");
  return text.length <= MAX_HELD_CHARS ? text : undefined;
}

export function approvedCallsOf(
  store: Pick<Store, "listApprovals" | "hasGrant" | "counter">,
  runId: string,
  stepId: string,
  itemKey: string,
): { tool: string; input: Value }[] {
  return store.listApprovals({ runId, state: "approved" }).flatMap((row) => {
    const grant = row.approves.at(0);
    if (
      row.kind !== "risky_action" ||
      row.stepId !== stepId ||
      row.itemKey !== itemKey ||
      !row.call ||
      !grant ||
      !isCallGrant(grant) ||
      !store.hasGrant(runId, grant, itemKey) ||
      store.counter(grantUsedKey(runId, itemKey, grant), "run") !== 0
    )
      return [];
    return [row.call];
  });
}
export function labelOf(requirements: Requirement[], requirementId: string): string {
  return (
    catalogEntry(requirements.find((requirement) => requirement.id === requirementId)?.ref)?.label ??
    "a connector"
  );
}
