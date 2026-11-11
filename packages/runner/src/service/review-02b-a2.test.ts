import { parseManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { toFlowManifest } from "./map-flow.ts";

function flowWithParam(param: Record<string, unknown>) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.p",
    name: "P",
    kind: "light",
    params: { n: param },
    steps: [{ id: "a", do: "worker", instructions: "x", checks: [{ type: "contains", pattern: "x" }] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
test("review: a parameter whose default the contract cannot hold does not make the whole flow unreadable", () => {
  for (const param of [
    { type: "text", default: null },
    { type: "enum", options: ["a"], default: ["a"] },
  ]) {
    const manifest = flowWithParam(param);
    expect(() => toFlowManifest(manifest)).not.toThrow();
  }
});
