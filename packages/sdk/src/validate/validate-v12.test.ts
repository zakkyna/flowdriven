import { expect, test } from "vitest";
import { parseManifest } from "../format/parse.ts";
import { flowV12 } from "../test-data/flow-v12.ts";
import { askStep, loop, step } from "../test-data/flows.ts";
import { validateManifest } from "./validate.ts";

test("TC-SDK-19 existing validation remains unchanged", () => {
  for (const [overrides, code] of [
    [{ triggers: [{ kind: "manual" }], steps: [step("a", { risky: ["send"] })] }, ""],
    [
      { triggers: [{ kind: "schedule", at: "17:00" }], steps: [step("a", { risky: ["send"] })] },
      "unattended_prefix",
    ],
    [{ steps: [step("a", { checks: [{ type: "judge", rubric: "r.md" }] })] }, "judged_only"],
    [{ steps: [step("a")] }, "light_needs_user_check"],
    [{ steps: [loop("loop", [askStep("ask")])] }, "ask_in_loop"],
  ] as const) {
    const parsed = parseManifest(flowV12(overrides));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const issues = validateManifest(parsed.manifest);
      if (code) expect(issues.some((i) => i.code === code)).toBe(true);
      else expect(issues.some((i) => i.code === "unattended_prefix")).toBe(false);
    }
  }
});
test("TC-SDK-17 hidden person-facing text", () => {
  for (const mark of [0x200b, 0x202e]) {
    const bad = `Text${String.fromCodePoint(mark)}`;
    for (const [field, path] of [
      [{ name: bad }, "name"],
      [{ inputs: [{ id: "x", type: "text", label: bad }] }, "inputs.0.label"],
      [{ inputs: [{ id: "x", type: "text", label: "X", example: bad }] }, "inputs.0.example"],
      [{ touches: [{ id: "x", sentence: bad, effect: "read", rule: "asks_first" }] }, "touches.0.sentence"],
      [
        {
          touches: [
            {
              id: "x",
              sentence: "Read",
              effect: "read",
              rule: "asks_first",
              place: { kind: "address", value: "x", label: bad },
            },
          ],
        },
        "touches.0.place.label",
      ],
      [{ result: { kind: "chat", answer: [bad] } }, "result.answer[0]"],
    ] as const) {
      const parsed = parseManifest(flowV12(field));
      expect(parsed.ok).toBe(true);
      if (parsed.ok)
        expect(validateManifest(parsed.manifest)).toContainEqual(
          expect.objectContaining({ code: "hidden_text", path }),
        );
    }
  }
});
