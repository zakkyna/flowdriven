import type { CallGrant, Store } from "../storage.ts";

type GrantKey = Pick<CallGrant, "runId" | "stepId" | "itemKey" | "tool" | "digest">;
export function matchGrant(book: Pick<Store, "findGrant">, key: GrantKey): CallGrant | undefined {
  const row = book.findGrant({ ...key, kind: "approve", createdAt: "" });
  return row &&
    !row.usedAt &&
    row.kind !== "pick" &&
    row.runId === key.runId &&
    row.stepId === key.stepId &&
    row.itemKey === key.itemKey &&
    row.tool === key.tool &&
    row.digest === key.digest
    ? row
    : undefined;
}
