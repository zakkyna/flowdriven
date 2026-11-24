import { expect, test } from "vitest";
import { NOTICE_KINDS, Notice, NoticeTarget } from "./notice.ts";

test("TC-CON-27 fixed notice lines, language and kinds", () => {
  const base = {
    id: "question:wq-000000000001",
    kind: "question_waiting",
    title: { key: "notice.questionTitle" },
    body: { key: "notice.questionBody" },
    language: "en",
    target: { screen: "chat", chatId: "chat-000000000001" },
  };
  expect(Notice.safeParse(base).success).toBe(true);
  for (const bad of [
    { ...base, title: { key: "notice.questionTitle", params: {} } },
    { ...base, body: { key: "notice.questionBody", params: {} } },
    { ...base, title: "hello" },
    { ...base, language: "english" },
    { ...base, extra: true },
  ])
    expect(Notice.safeParse(bad).success).toBe(false);
  const rows = [
    ["approval_waiting", "decision", { screen: "activity" }],
    ["question_waiting", "question", base.target],
    ["confirm_waiting", "question", base.target],
    ["run_blocked", "problem", { screen: "run", runId: "run" }],
    ["weekly_limit", "limit", { screen: "activity" }],
    ["flood_cap", "limit", { screen: "flow", flowId: "flow" }],
    ["trigger_paused", "limit", { screen: "flow", flowId: "flow" }],
  ] as const;
  expect(NOTICE_KINDS).toHaveLength(7);
  for (const [kind, key, target] of rows) {
    const item = {
      ...base,
      kind,
      title: { key: `notice.${key}Title` },
      body: { key: `notice.${key}Body` },
      target,
    };
    expect(Notice.safeParse(item).success).toBe(true);
    expect(Notice.safeParse({ ...item, title: { key: "notice.other" } }).success).toBe(false);
    expect(Notice.safeParse({ ...item, body: { key: "notice.other" } }).success).toBe(false);
  }
  expect(Notice.safeParse({ ...base, kind: "run_done" }).success).toBe(false);
  for (const target of [
    { screen: "run", runId: "run", approvalId: "approval" },
    { screen: "flow", flowId: "flow" },
    { screen: "activity" },
    { screen: "settings" },
  ])
    expect(NoticeTarget.safeParse(target).success).toBe(true);
  for (const target of [{ screen: "inbox" }, { screen: "builder", flowId: "flow" }])
    expect(NoticeTarget.safeParse(target).success).toBe(false);
});
