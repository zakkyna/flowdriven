import { expect, test } from "vitest";
import { createFakeBrain } from "./fake-brain.ts";

const call = {
  chatId: "chat-1",
  agent: "claude-code",
  model: "sonnet-5.5",
  tools: [] as string[],
  schema: { type: "object" },
  text: "run the report",
  parts: [{ text: "run the report", outside: false }],
};

test("fake brain returns matching scripted JSON and records calls", () => {
  const answer = { intent: "run", reply: "Starting.", language: "en" };
  const brain = createFakeBrain([
    { when: "other", answer: { intent: "answer" } },
    { when: "report", answer },
  ]);
  expect(brain.chat(call)).toBe(JSON.stringify(answer));
  expect(brain.calls).toEqual([call]);
  expect(brain.calls.length).toBe(1);
  expect(brain.chat({ ...call, text: "other" })).toBe('{"intent":"answer"}');
  expect(brain.calls.length).toBe(2);
});

test("fake brain consumes unconditional answers and returns raw strings", () => {
  const brain = createFakeBrain([{ answer: "invalid JSON" }, { answer: { intent: "answer" } }]);
  expect(brain.chat(call)).toBe("invalid JSON");
  expect(brain.chat(call)).toBe('{"intent":"answer"}');
  expect(() => brain.chat(call)).toThrow();
  expect(brain.calls.length).toBe(3);
});
