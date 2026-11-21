import { expect, test } from "vitest";
import { RunnerEvent } from "./client.ts";

test("TC-CON-28 event topics and strict shape", () => {
  expect(
    RunnerEvent.safeParse({ type: "changed", topics: ["chats", "rules", "activity", "agents", "skills"] })
      .success,
  ).toBe(true);
  expect(RunnerEvent.safeParse({ type: "changed", topics: [] }).success).toBe(true);
  for (const value of [
    { type: "changed", topics: ["harnesses"] },
    { type: "changed", topics: ["memory"] },
    { type: "progress", topics: [] },
    { type: "changed", topics: [], extra: 1 },
  ])
    expect(RunnerEvent.safeParse(value).success).toBe(false);
});
