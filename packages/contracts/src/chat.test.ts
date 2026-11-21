import { expect, test } from "vitest";
import * as c from "./index";

const chatId = "chat-1";
const at = "2026-11-19T02:00:00.000Z";
const msg = { id: "msg-1", seq: 1, at, role: "flowdriven", outside: false };
test("TC-CON-17 send input and output limits", () => {
  for (const text of ["Run Fill timesheet", "x".repeat(16000)])
    expect(c.ChatsSendInput.safeParse({ chatId, text }).success).toBe(true);
  for (const text of ["", "   \n ", "x".repeat(16001)])
    expect(c.ChatsSendInput.safeParse({ chatId, text }).success).toBe(false);
  for (const v of [
    { chatId, text: "x", pasted: true },
    { chatId, starter: 0 },
  ])
    expect(c.ChatsSendInput.safeParse(v).success).toBe(true);
  for (const v of [
    { chatId, text: "x", fromChip: true },
    { chatId, starter: -1 },
    { chatId, starter: 1.5 },
    { chatId, text: "x", pasted: "yes" },
    { chatId, text: "x", extra: true },
  ])
    expect(c.ChatsSendInput.safeParse(v).success).toBe(false);
  for (const turn of ["queued", "not_ready", "form_open", "done"])
    expect(c.ChatsSendOutput.safeParse({ messageId: "msg-1", turn }).success).toBe(turn !== "done");
});
test("TC-CON-22 chat read models", () => {
  const chat = {
    id: chatId,
    title: "Chat",
    updatedAt: at,
    from: "person",
    agent: "codex",
    model: "gpt-6.1-terra",
    language: "en",
    waiting: false,
  };
  const view = { chat, messages: [], more: false, turn: { state: "thinking", queued: 1 }, composerText: "" };
  expect(c.ChatView.safeParse(view).success).toBe(true);
  for (const state of ["idle", "queued", "thinking", "running"])
    expect(c.ChatView.safeParse({ ...view, turn: { state, queued: 0 } }).success).toBe(state !== "running");
  for (const field of ["agent", "model", "language", "waiting"]) {
    const copy = { ...chat };
    delete copy[field as keyof typeof copy];
    expect(c.ChatSummary.safeParse(copy).success).toBe(false);
  }
  expect(
    c.MessageView.safeParse({
      ...msg,
      kind: "card",
      card: { type: "agent_needed", state: "open", need: "permission" },
    }).success,
  ).toBe(true);
  for (const bad of [
    { ...msg, kind: "banner" },
    { ...msg, kind: "text", role: "assistant" },
    { ...msg, kind: "text", outside: undefined },
    { ...msg, kind: "text", text: "x".repeat(16001) },
  ])
    expect(c.MessageView.safeParse(bad).success).toBe(false);
  expect(c.MessageView.safeParse({ ...msg, kind: "text", text: "x".repeat(16000) }).success).toBe(true);
  expect(
    c.ChipView.safeParse({ kind: "act", label: { key: "chat.useForm" }, action: "use_form" }).success,
  ).toBe(true);
  expect(c.ChipView.safeParse({ kind: "act", label: { key: "chat.useForm" }, action: "nuke" }).success).toBe(
    false,
  );
});
test("TC-CON-37 chat operation inputs", () => {
  for (const v of [
    {},
    { subject: { kind: "make" } },
    { subject: { kind: "improve", flowId: "example.fill-timesheet" } },
  ])
    expect(c.ChatsCreateInput.safeParse(v).success).toBe(true);
  for (const v of [{ subject: { kind: "improve" } }, { subject: { kind: "skill" } }, { extra: true }])
    expect(c.ChatsCreateInput.safeParse(v).success).toBe(false);
  expect(c.ChatsSetAgentInput.safeParse({ chatId, agent: "codex", model: "gpt-6.1-terra" }).success).toBe(
    true,
  );
  expect(c.ChatsSetAgentInput.safeParse({ chatId, agent: "codex", model: "-m" }).success).toBe(false);
  for (const text of ["", "x".repeat(16000), "x".repeat(16001)])
    expect(c.ChatsSetComposerInput.safeParse({ chatId, text }).success).toBe(text.length <= 16000);
  expect(c.ChatsDeleteInput.safeParse({ chatId }).success).toBe(true);
  for (const schema of [c.ChatsSetAgentInput, c.ChatsSetComposerInput, c.ChatsDeleteInput])
    expect(schema.safeParse({ chatId, agent: "codex", model: "m", text: "", extra: true }).success).toBe(
      false,
    );
});
test("TC-CON-40 structured results and export", () => {
  const result = {
    runId: "run-1",
    lines: ["Logged {duration} for {customer}."],
    values: { duration: { type: "duration", value: 120 }, customer: { type: "text", value: "Example Corp" } },
  };
  expect(c.MessageView.safeParse({ ...msg, kind: "result", result, language: "en" }).success).toBe(true);
  expect(
    c.MessageView.safeParse({ ...msg, kind: "result", result: { ...result, values: undefined } }).success,
  ).toBe(false);
  expect(
    c.MessageView.safeParse({
      ...msg,
      kind: "result",
      result: { ...result, values: { x: { type: "unknown", value: 1 } } },
    }).success,
  ).toBe(false);
  for (const n of [10, 11])
    expect(
      c.MessageView.safeParse({ ...msg, kind: "result", result: { ...result, lines: Array(n).fill("x") } })
        .success,
    ).toBe(n === 10);
  const report = {
    language: "en",
    flowName: "Fill timesheet",
    startedAt: at,
    endedAt: "2026-11-19T02:12:00.000Z",
    state: "done",
    summary: [{ text: "Logged 2h", outside: false }],
    steps: [{ title: "Log the hours", state: "passed", outside: false }],
    decisionLines: [{ key: "report.youSaidNo", params: { title: "x" } }],
  };
  expect(c.RunsExportOutput.safeParse(report).success).toBe(true);
  for (const bad of [
    { ...report, markdown: "x" },
    { ...report, summary: Array(21).fill({ text: "x", outside: false }) },
    { ...report, summary: [{ text: "x".repeat(4001), outside: false }] },
    { ...report, outside: false },
    { ...report, parts: [] },
  ])
    expect(c.RunsExportOutput.safeParse(bad).success).toBe(false);
});

test("TC-CON-37 agent and skill inputs", async () => {
  const { AgentIdInput } = await import("./agents.ts");
  const { SkillIdInput } = await import("./skills.ts");
  expect(AgentIdInput.safeParse({ agentId: "codex" }).success).toBe(true);
  for (const input of [
    {},
    { agentId: "Codex" },
    { agentId: "has space" },
    { agentId: "codex", password: "x" },
  ])
    expect(AgentIdInput.safeParse(input).success).toBe(false);
  expect(SkillIdInput.safeParse({ skillId: "skill" }).success).toBe(true);
  expect(SkillIdInput.safeParse({ skillId: "skill", extra: true }).success).toBe(false);
});
