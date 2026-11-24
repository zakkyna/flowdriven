import { expect, test } from "vitest";
import { flowV12 } from "../test-data/flow-v12.ts";
import { step } from "../test-data/flows.ts";
import { validateManifest } from "../validate/validate.ts";
import { parseManifest } from "./parse.ts";

test("TC-SDK-07 result shape and limits", () => {
  for (const result of [
    { kind: "chat" },
    { kind: "report" },
    { kind: "chat", answer: ["Logged {duration} for {customer}."] },
    { kind: "chat", answer: { en: ["Logged {duration}."], id: ["Dicatat {duration}."] } },
    { kind: "chat", answer: Array(10).fill("x") },
    { kind: "chat", answer: ["x".repeat(400)] },
  ])
    expect(parseManifest(flowV12({ result })).ok).toBe(true);
  for (const result of [
    { kind: "email" },
    { kind: "chat", answer: Array(11).fill("x") },
    { kind: "chat", answer: ["x".repeat(401)] },
    { kind: "chat", answer: [""] },
    { kind: "chat", answer: { english: ["x"] } },
  ])
    expect(parseManifest(flowV12({ result })).ok).toBe(false);
  const report = parseManifest(flowV12({ result: { kind: "report", answer: ["x"] } }));
  expect(report.ok ? [] : report.issues).toContainEqual(
    expect.objectContaining({ code: "answer_on_report" }),
  );
});
test("TC-SDK-08 answer placeholders", () => {
  for (const [line, code] of [
    ["{duration}", ""],
    ["{outputs.summary}", ""],
    ["{colour}", "answer_unknown_placeholder"],
    ["{", "answer_bad_placeholder"],
    ["{}", "answer_bad_placeholder"],
  ]) {
    for (const localized of [false, true]) {
      const parsed = parseManifest(
        flowV12({
          inputs: [{ id: "duration", type: "duration", label: "Duration" }],
          steps: [step("a", { outputs: [{ id: "summary", type: "text" }] })],
          result: { kind: "chat", answer: localized ? { en: [line] } : [line] },
        }),
      );
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        const issues = validateManifest(parsed.manifest);
        if (code)
          expect(issues).toContainEqual(
            expect.objectContaining({ code, path: localized ? "result.answer.en[0]" : "result.answer[0]" }),
          );
        else expect(issues.filter((i) => i.code.startsWith("answer_"))).toEqual([]);
      }
    }
  }
});
