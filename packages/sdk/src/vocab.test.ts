import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BASE_REQUIREMENT_TYPES, FORMAT_ID, REQUIREMENT_TYPES } from "./vocab.ts";

test("the format string is 1.1", () => expect(FORMAT_ID).toBe("flowdriven-flow/1.1"));
test("the SDK package is MIT licensed", () => {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest).toHaveProperty("license", "MIT");
});
test("format 1.1 adds three requirement types", () =>
  expect([...REQUIREMENT_TYPES]).toEqual([...BASE_REQUIREMENT_TYPES, "web", "desktop", "trigger"]));
