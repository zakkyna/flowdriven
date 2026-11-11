// Belongs in: packages/sdk/src/validate/review-03-a4.test.ts
import { expect, test } from "vitest";
import { validateManifest } from "../index.ts";
import { flow } from "../test-data/flows.ts";

// engine.startRun (packages/runner/src/engine.ts, "Invalid parameter <id>.") refuses a default that is below
// min, above max, or outside options, so such a flow loads without an issue and then every run without
// explicit params fails.
test("a param default that the engine refuses at run time is an error at validation time", () => {
  for (const param of [
    { type: "number", default: 5, min: 10 },
    { type: "number", default: 50, max: 10 },
    { type: "text", default: "a", options: ["b"] },
  ]) {
    const errors = validateManifest(flow({ params: { p: param } })).filter(
      (issue) => issue.severity === "error" && issue.path === "params.p.default",
    );
    expect(errors, JSON.stringify(param)).toEqual([expect.objectContaining({ code: "param_default_range" })]);
  }
});

test("an enum default outside its options remains a type error", () => {
  expect(
    validateManifest(flow({ params: { p: { type: "enum", default: "x", options: ["a"] } } })).filter(
      (issue) => issue.path === "params.p.default",
    ),
  ).toEqual([expect.objectContaining({ code: "param_default_type" })]);
});
