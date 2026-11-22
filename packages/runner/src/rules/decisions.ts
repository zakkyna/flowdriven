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

export const restrictedApprovals = {
  parse(value: unknown) {
    if (!Array.isArray(value)) throw new Error("Invalid restricted approvals");
    return value.map((row: unknown) => {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(",") !== "flowId,state,stepId"
      )
        throw new Error("Invalid restricted approval");
      const data = row as Record<string, unknown>;
      if (
        typeof data.flowId !== "string" ||
        typeof data.stepId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,100}$/.test(data.flowId) ||
        !/^[A-Za-z0-9._:-]{1,100}$/.test(data.stepId) ||
        typeof data.state !== "string" ||
        !["pending", "approved", "approved_edited", "rejected", "expired", "allowed_always"].includes(
          data.state,
        )
      )
        throw new Error("Invalid restricted approval");
      return data;
    });
  },
};
