import { expect, test } from "vitest";
import { hasHiddenText, validateManifest } from "../index.ts";
import { flow, step, userStep } from "../test-data/flows.ts";

const issuesFor = (outputs: unknown[], checks: unknown[]) =>
  validateManifest(flow({ steps: [step("a", { outputs, checks }), userStep("b")] }));
const own = { type: "user", own_text: true };
const textOutput = { id: "result", type: "text" };

test("a user check may say own_text when the step declares exactly one text output", () => {
  expect(issuesFor([textOutput], [own])).toEqual([]);
  expect(issuesFor([], [{ type: "user", own_text: false }])).toEqual([]);
});

test("own_text on a step with no output, two outputs, or a json output is an error", () => {
  for (const outputs of [[], [textOutput, { id: "other", type: "text" }], [{ id: "result", type: "json" }]]) {
    expect(issuesFor(outputs, [own])).toContainEqual(
      expect.objectContaining({ code: "own_text_output", severity: "error" }),
    );
  }
});

test("own_text on a check with required false, or on two checks of one step, is an error", () => {
  expect(issuesFor([textOutput], [{ ...own, required: false }])).toContainEqual(
    expect.objectContaining({ code: "own_text_required", severity: "error" }),
  );
  expect(issuesFor([textOutput], [own, own])).toContainEqual(
    expect.objectContaining({ code: "own_text_once", severity: "error" }),
  );
});

test("hasHiddenText finds a zero-width space, a right-to-left override and a form feed, and allows newlines and tabs", () => {
  for (const code of [0x200b, 0x202e, 0x0c])
    expect(hasHiddenText(`a${String.fromCodePoint(code)}b`)).toBe(true);
  expect(hasHiddenText("a\nb\tc")).toBe(false);
});
