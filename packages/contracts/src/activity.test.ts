import { expect, test } from "vitest";

test("TC-CON-24 activity, search and skills", async () => {
  const { ActivitySummary, EarlierRow, NeedsYouItem } = await import("./activity.ts");
  const { SearchResult } = await import("./search.ts");
  const { Skill } = await import("./skills.ts");
  expect(
    ActivitySummary.safeParse({ needsYou: [], needsYouCount: 0, running: [], earlier: [] }).success,
  ).toBe(true);
  for (const kind of ["missed", "skipped"]) expect(EarlierRow.safeParse({ kind }).success).toBe(false);
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
    startedAt: "2026-11-21T00:00:00Z",
  };
  expect(EarlierRow.safeParse({ kind: "run", run }).success).toBe(true);
  for (const extra of ["canRunNow", "ranLate", "missedStartId"])
    expect(EarlierRow.safeParse({ kind: "run", run, [extra]: true }).success).toBe(false);
  const question = {
    kind: "question",
    questionId: "q",
    flowId: "f",
    flowName: "Flow",
    chatId: "c",
    askedAt: "2026-11-21T00:00:00Z",
  };
  for (const kind of ["inputs", "confirm", "other", undefined])
    expect(NeedsYouItem.safeParse({ ...question, questionKind: kind }).success).toBe(
      kind === "inputs" || kind === "confirm",
    );
  const chat = { chatId: "c", title: "Chat", updatedAt: "2026-11-21T00:00:00Z", outside: false };
  const flow = { flowId: "f", name: "Flow", summary: "Summary" };
  for (const [recent, chats, flows, valid] of [
    [false, 21, 0, false],
    [true, 5, 0, true],
    [false, 0, 51, false],
    [true, 0, 200, true],
    [true, 6, 0, false],
  ] as const)
    expect(
      SearchResult.safeParse({ recent, chats: Array(chats).fill(chat), flows: Array(flows).fill(flow) })
        .success,
    ).toBe(valid);
  const skill = {
    id: "s",
    name: "Skill",
    about: "About",
    origin: "agent",
    usedBy: [],
    readable: false,
    problem: "hidden_characters",
  };
  for (const origin of ["agent", "flowdriven", "library"])
    expect(Skill.safeParse({ ...skill, origin }).success).toBe(true);
  expect(Skill.safeParse({ ...skill, problem: "virus" }).success).toBe(false);
});
