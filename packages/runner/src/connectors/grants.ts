import { createHash } from "node:crypto";
import type { Value } from "@flowdriven/sdk";
import type { Store } from "../storage.ts";

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
  has(runId: string, grant: string, itemKey: string): boolean;
  use(runId: string, grant: string, itemKey: string): boolean;
};
export function createGrantBook(store: Pick<Store, "hasGrant" | "counter" | "increment">): GrantBook {
  return {
    has: (runId, grant, itemKey) =>
      (isCallGrant(grant) || pickKeyUsable(itemKey)) &&
      store.hasGrant(runId, grant, itemKey) &&
      (!isCallGrant(grant) || store.counter(grantUsedKey(runId, itemKey, grant), "run") === 0),
    use: (runId, grant, itemKey) =>
      isCallGrant(grant)
        ? store.increment(grantUsedKey(runId, itemKey, grant), "run") === 1
        : pickKeyUsable(itemKey),
  };
}
