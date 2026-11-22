import { createHash } from "node:crypto";
import type { Value } from "@flowdriven/sdk";
import type { CallGrant, Store } from "../storage.ts";

export function canonicalJson(value: Value): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) entries.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
export function digestCall(tool: string, input: Value): string {
  return createHash("sha256")
    .update(`${tool}\n${canonicalJson(input)}`)
    .digest("hex");
}
export function pickGrant(requirementId: string, tool: string): string {
  return `${requirementId}.${tool}`;
}
export function callGrant(requirementId: string, tool: string, digest: string): string {
  return `${pickGrant(requirementId, tool)}#${digest}`;
}
export function isCallGrant(grant: string): boolean {
  return grant.includes("#");
}
export function pickKeyUsable(itemKey: string): boolean {
  return itemKey !== "" && !itemKey.startsWith("#");
}
export function grantUsedKey(runId: string, itemKey: string, grant: string): string {
  return `grant-used:${runId}:${itemKey}:${grant}`;
}
export type GrantBook = {
  has(runId: string, grant: string, itemKey: string, stepId?: string): boolean;
  use(runId: string, grant: string, itemKey: string, stepId?: string): boolean;
  findGrant(key: CallGrant): CallGrant | undefined;
  useGrant(key: CallGrant, at: string): void;
};
export function createGrantBook(store: Pick<Store, "findGrant" | "findPickGrant" | "useGrant">): GrantBook {
  const keyOf = (runId: string, grant: string, itemKey: string, stepId = "*"): CallGrant => {
    const separator = grant.indexOf("#");
    return {
      runId,
      stepId,
      itemKey,
      tool: separator < 0 ? grant : grant.slice(0, separator),
      digest: separator < 0 ? "*" : grant.slice(separator + 1),
      kind: "approve",
      createdAt: "",
    };
  };
  return {
    findGrant: (key) => store.findGrant(key),
    useGrant: (key, at) => store.useGrant(key, at),
    has(runId, grant, itemKey, stepId) {
      const key = keyOf(runId, grant, itemKey, stepId);
      if (isCallGrant(grant)) return !!store.findGrant(key);
      if (!pickKeyUsable(itemKey)) return false;
      const migrated = store.findGrant({ ...key, stepId: "*" });
      return !!store.findPickGrant(key) || migrated?.kind === "migrated";
    },
    use(runId, grant, itemKey, stepId) {
      if (!isCallGrant(grant)) return pickKeyUsable(itemKey);
      const key = keyOf(runId, grant, itemKey, stepId);
      if (!store.findGrant(key)) return false;
      store.useGrant(key, new Date().toISOString());
      return true;
    },
  };
}
