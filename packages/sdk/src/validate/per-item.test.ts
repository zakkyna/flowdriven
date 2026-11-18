import { expect, test } from "vitest";
import { validateManifest } from "../index.ts";
import { flow, loop, step, userStep } from "../test-data/flows.ts";

const issuesFor = (requirement: Record<string, unknown>, inside = true) =>
  validateManifest(
    flow({
      requirements: [
        { id: "folder", type: "path", ref: "~/work", access: "read_write", per_item: true, ...requirement },
      ],
      steps: [
        inside ? loop("items", [step("a", { uses: ["folder"] })]) : step("a", { uses: ["folder"] }),
        userStep("b"),
      ],
    }),
  );

test("per_item is allowed on a granted folder (~/...) only", () => {
  expect(issuesFor({})).toEqual([]);
  for (const ref of ["work", "/tmp/work", undefined])
    expect(issuesFor({ ref })).toContainEqual(
      expect.objectContaining({ code: "per_item_ref", severity: "error" }),
    );
  expect(issuesFor({ ref: "work", per_item: false })).toEqual([]);
});

test("per_item needs access read_write", () => {
  expect(issuesFor({ access: "read" })).toContainEqual(
    expect.objectContaining({ code: "per_item_access", severity: "error" }),
  );
});

test("a step that uses a per_item folder must be inside a loop", () => {
  expect(issuesFor({}, false)).toContainEqual(
    expect.objectContaining({ code: "per_item_loop", severity: "error" }),
  );
  expect(issuesFor({ per_item: false }, false)).toEqual([]);
});
