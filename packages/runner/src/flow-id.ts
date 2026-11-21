import type { Store } from "./storage.ts";

export function newFlowId(store: Store, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "flow";
  let result = `local.${slug}`;
  for (let suffix = 2; store.hasFlowId(result); suffix++) {
    const end = `-${suffix}`;
    result = `local.${slug.slice(0, 60 - end.length).replace(/-+$/, "")}${end}`;
  }
  return result;
}
