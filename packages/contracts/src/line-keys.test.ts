import { expect, test } from "vitest";
import { Line } from "./common.ts";
import { LINE_KEYS } from "./line-keys.ts";

test("TC-CON-45 decision and note line keys carry their named parameters", () => {
  const lines = [
    { key: "report.approvedOnce", params: { title: "title" } },
    { key: "report.anotherWay", params: { text: "words" } },
    { key: "decision.newTry", params: { text: "words" } },
    { key: "report.didAnotherWay", params: { text: "words" } },
    { key: "report.usedNote", params: { text: "words" } },
    { key: "chat.noteAdded", params: { flow: "flow" } },
  ];
  for (const line of lines) {
    expect(LINE_KEYS).toContain(line.key);
    expect(Line.parse(line)).toEqual(line);
  }
});
