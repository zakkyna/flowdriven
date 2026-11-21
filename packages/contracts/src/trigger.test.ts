import { expect, test } from "vitest";
import { Notice, NoticeTarget } from "./notice.ts";
import { operations } from "./operations.ts";
import { RunSummary } from "./run.ts";
import { TriggerStatus } from "./trigger.ts";
import { RpcNoticeFrame } from "./wire.ts";

const at = "2026-11-12T00:00:00Z";
const minimal = {
  flowId: "flow",
  index: 0,
  kind: "schedule",
  summary: "Hourly",
  state: "off",
  canEnable: true,
  firesToday: 0,
  droppedToday: 0,
  dailyCap: 24,
};
const run = {
  id: "run",
  flowId: "flow",
  flowName: "Flow",
  flowVersion: "1.0.0",
  flowHash: `sha256:${"a".repeat(64)}`,
  source: "flows",
  agent: "claude-code",
  versionChanged: false,
  oneTime: false,
  project: "project",
  state: "done",
  startedAt: at,
};
const notice = {
  id: "notice",
  kind: "run_blocked",
  title: { key: "notice.problemTitle" },
  body: { key: "notice.problemBody" },
  language: "en",
  target: { screen: "run", runId: "run" },
};

test("a trigger status has a switch state, a reason, the next run, the last fire and today's counts", () => {
  expect(TriggerStatus.safeParse(minimal).success).toBe(true);
  expect(
    TriggerStatus.safeParse({
      ...minimal,
      state: "on",
      reason: "Ready",
      nextAt: at,
      last: { at, outcome: "started", runId: "run", detail: "Started" },
      firesToday: 1,
      droppedToday: 2,
    }).success,
  ).toBe(true);
  expect(TriggerStatus.safeParse({ ...minimal, firesToday: -1 }).success).toBe(false);
  expect(TriggerStatus.safeParse({ ...minimal, dailyCap: 0 }).success).toBe(false);
});
test("setEnabled needs an index, a boolean and a content hash", () => {
  const input = { flowId: "flow", index: 0, enabled: true, hash: `sha256:${"a".repeat(64)}` };
  expect(operations["triggers.setEnabled"].input.safeParse(input).success).toBe(true);
  expect(operations["triggers.setEnabled"].input.safeParse({ ...input, hash: "abc" }).success).toBe(false);
  expect(operations["triggers.setEnabled"].input.safeParse({ ...input, index: -1 }).success).toBe(false);
  const { enabled: _enabled, ...withoutEnabled } = input;
  expect(operations["triggers.setEnabled"].input.safeParse(withoutEnabled).success).toBe(false);
});
test("both trigger operations are off MCP and are the only writers of the flows topic from this plan", () => {
  expect(operations["triggers.setEnabled"].mcp).toBe("no");
  expect(operations["triggers.list"].mcp).toBe("no");
  expect(operations["triggers.setEnabled"].writes).toEqual(["flows"]);
  expect(operations["triggers.list"].writes).toEqual([]);
});
test("a run summary carries its trigger in words and is still valid without it", () => {
  expect(RunSummary.safeParse(run).success).toBe(true);
  expect(
    RunSummary.safeParse({ ...run, trigger: { kind: "schedule", words: "Started by its schedule" } }).success,
  ).toBe(true);
  expect(RunSummary.safeParse({ ...run, trigger: { kind: "schedule", words: "" } }).success).toBe(false);
});
test("a notice has fixed lines, language and an allow-listed target", () => {
  for (const target of [
    { screen: "chat", chatId: "chat" },
    { screen: "run", runId: "run" },
    { screen: "flow", flowId: "flow" },
    { screen: "activity" },
    { screen: "settings" },
  ]) {
    expect(Notice.safeParse({ ...notice, target }).success).toBe(true);
  }
  expect(NoticeTarget.safeParse({ screen: "inbox" }).success).toBe(false);
  expect(Notice.safeParse({ ...notice, body: { key: "notice.problemBody", params: {} } }).success).toBe(
    false,
  );
  expect(Notice.safeParse({ ...notice, target: { screen: "run", runId: "a/b" } }).success).toBe(false);
  expect(Notice.safeParse({ ...notice, extra: true }).success).toBe(false);
});
test("the notice frame is a `notice` notification and an `event` frame is not one", () => {
  expect(RpcNoticeFrame.safeParse({ jsonrpc: "2.0", method: "notice", params: notice }).success).toBe(true);
  expect(RpcNoticeFrame.safeParse({ jsonrpc: "2.0", method: "event", params: notice }).success).toBe(false);
});
