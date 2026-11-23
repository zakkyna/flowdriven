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

test("TC-CON-38 lists the runner and notice keys without duplicates", () => {
  expect(new Set(LINE_KEYS).size).toBe(LINE_KEYS.length);
  for (const key of LINE_KEYS) expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9_]*)+$/);
  for (const key of [
    "report.youApproved",
    "report.youApprovedEdited",
    "report.youSaidNo",
    "report.doneByRule",
    "chat.itsTime",
    "chat.dueAt",
    "chat.needsDetails",
    "chat.alreadyWaiting",
    "chat.chainStopped",
    "chat.reportInActivity",
    "chat.useTheButtons",
    "chat.fillInForm",
    "chat.agentChanged",
    "chat.mainAgentNotReady",
    "chat.modelGone",
    "chat.skillUnreadable",
    "chat.starting",
    "chat.makeFromSkill",
    "notice.decisionTitle",
    "notice.decisionBody",
    "notice.questionTitle",
    "notice.questionBody",
    "notice.problemTitle",
    "notice.problemBody",
    "notice.limitTitle",
    "notice.limitBody",
    "chat.permissionOff",
    "chat.agentCannotRunFlow",
    "flows.empty",
    "chat.nothingWaiting",
  ])
    expect(LINE_KEYS).toContain(key);
  expect(LINE_KEYS).not.toContain("decision.askAgainAfterNo");
});
