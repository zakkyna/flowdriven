import { expect, test } from "vitest";
import { contentHash } from "../hash/canonical.ts";
import { flowV12Yaml } from "../test-data/flow-v12.ts";

const input = { id: "start", label: "Start", type: "time", default: "now", example: "09:00" };
const result = { kind: "chat", answer: ["Started at {start}."] };
const touch = {
  id: "save",
  sentence: "Saves a report",
  effect: "change",
  place: { kind: "folder", value: "fs", label: "Reports" },
  rule: "asks_first",
};
const schedule = { type: "weekdays", time: "17:00", whenItsTime: "ask" };
const files = (overrides: Record<string, unknown> = {}, readme = "Read me\n") =>
  new Map([
    [
      "flow.yaml",
      new TextEncoder().encode(
        flowV12Yaml({ inputs: [input], result, touches: [touch], schedule, ...overrides }),
      ),
    ],
    ["README.md", new TextEncoder().encode(readme)],
  ]);

test("TC-SDK-15 hashes every new field and README bytes", () => {
  const original = contentHash(files());
  expect(original).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(contentHash(files())).toBe(original);
  const variants = [
    files({ inputs: [{ ...input, example: "10:00" }] }),
    files({ result: { ...result, answer: ["Finished at {start}."] } }),
    files({ touches: [{ ...touch, rule: "runs_alone" }] }),
    files({ touches: [{ ...touch, place: { ...touch.place, value: "other" } }] }),
    files({ schedule: { ...schedule, time: "18:00" } }),
    files({}, "Read me \n"),
  ].map(contentHash);
  expect(new Set([original, ...variants]).size).toBe(7);
});
