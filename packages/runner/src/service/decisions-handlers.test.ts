import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { pendingDecision } from "../test-helpers/builders.ts";
import { createRunnerService } from "./service.ts";

test("TC-RUL-22 lists old decisions, filters and standing-rule eligibility", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-22T00:00:00Z"),
  });
  try {
    const a = pendingDecision(store, { id: "old", createdAt: "2026-11-20T00:00:00Z" });
    store.updateApproval(a.id, {
      kind: "risky_action",
      effect: "change",
      fixedPlace: true,
      place: { kind: "account", value: "timesheet", label: "Timesheet" },
    });
    const b = pendingDecision(store, { id: "send", createdAt: "2026-11-21T23:00:00Z" });
    store.updateApproval(b.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      fixedPlace: true,
      place: { kind: "account", value: "mail", label: "Mail" },
    });
    store.createApproval({
      ...b,
      id: "send-2",
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      similarGroup: "send:local.flow-send:reply",
    });
    store.updateApproval(b.id, { similarGroup: "send:local.flow-send:reply" });
    const outside = pendingDecision(store, { id: "outside", createdAt: "2026-11-21T23:00:00Z" });
    store.updateApproval(outside.id, {
      kind: "risky_action",
      effect: "change",
      fixedPlace: false,
      outside: true,
      place: { kind: "account", value: "outside", label: "Outside" },
    });
    store.putSetting("spending-pause", {
      id: "budget",
      month: "2026-11",
      reachedAt: "2026-11-21T23:00:00Z",
      limitUsd: 10,
      expiresAt: "2026-12-01T00:00:00Z",
      state: "pending",
    });
    store.putSetting("weekly:claude-code", {
      resetsAt: Date.parse("2026-11-23T00:00:00Z") / 1000,
      askedAt: "2026-11-21T23:00:00Z",
      percent: 95,
    });
    const all = (await service.call("approvals.list", { state: "pending" })) as Array<
      Record<string, unknown>
    >;
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "old", state: "pending", canAlwaysAllow: true }),
        expect.objectContaining({ id: "send", state: "pending", canAlwaysAllow: false, similarWaiting: 1 }),
        expect.objectContaining({ id: "outside", outside: true, canAlwaysAllow: false }),
        expect.objectContaining({
          id: "budget",
          kind: "budget_raise",
          state: "pending",
          canAlwaysAllow: false,
        }),
        expect.objectContaining({
          id: "weekly-limit:claude-code",
          kind: "weekly_limit",
          state: "pending",
          canAlwaysAllow: false,
        }),
      ]),
    );
    expect(await service.call("approvals.list", { runId: a.runId })).toEqual([
      expect.objectContaining({ id: "old" }),
    ]);
    expect(await service.call("approvals.list", { flowId: `local.flow-${b.id}` })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "send" }),
        expect.objectContaining({ id: "send-2" }),
      ]),
    );
    expect(await service.call("approvals.list", { flowId: `local.flow-${b.id}` })).toHaveLength(2);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-51 restricted callers see only flow, step and state", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "one", createdAt: "2026-11-21T00:00:00Z" });
    const window = (await service.call("approvals.list", {}, "window")) as Array<Record<string, unknown>>;
    expect(window[0]).toMatchObject({ id: row.id, summary: "Review" });
    for (const caller of ["tool", "phone"] as const)
      expect(await service.call("approvals.list", {}, caller)).toEqual([
        { flowId: "local.flow-one", stepId: "alerts", state: "pending" },
      ]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-04 approve returns the decision and writes a run and step bound grant", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "call", createdAt: "2026-11-21T00:00:00Z" });
    const input = { to: "sam@example.test", body: "Thanks" };
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const digest = digestCall(tool, input);
    store.updateApproval(row.id, {
      kind: "risky_action",
      riskyAction: "send",
      effect: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digest)],
    });
    const result = await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" });
    expect(result).toMatchObject({
      decision: { id: row.id, state: "approved", resolvedVia: "window" },
      stepWaiting: 0,
    });
    expect(
      store.findGrant({
        runId: row.runId,
        stepId: row.stepId,
        itemKey: "",
        tool,
        digest,
        kind: "approve",
        createdAt: "",
      }),
    ).toMatchObject({ approvalId: row.id });
    expect(store.getRun(row.runId)?.decisionLines).toContainEqual({
      key: "report.youApproved",
      params: { title: "Review" },
    });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-35 concurrent answers apply once and the other reports already answered", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "once", createdAt: "2026-11-21T00:00:00Z" });
    const outcomes = await Promise.allSettled([
      service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
      service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((o) => o.status === "rejected")).toMatchObject({
      reason: { code: "conflict", reason: "already_answered", params: { via: "window" } },
    });
    expect(store.getApproval(row.id)?.state).toBe("approved");
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "reject" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "already_answered", params: { via: "window" } });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-06 approving one of three decisions reports two still waiting", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "first", createdAt: "2026-11-21T00:00:00Z" });
    store.createApproval({ ...row, id: "second", itemKey: "two" });
    store.createApproval({ ...row, id: "third", itemKey: "three" });
    expect(
      await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
    ).toMatchObject({ decision: { state: "approved" }, stepWaiting: 2 });
    expect(store.getRun(row.runId)?.state).toBe("waiting_approval");
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-47 activity and a chat card refer to the same approved decision", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "shared", createdAt: "2026-11-21T00:00:00Z" });
    store.putChat({
      id: "chat-7",
      title: "Chat",
      titleSource: "flowdriven",
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      from: "flowdriven",
      language: "en",
      languageSource: "app",
      agent: "claude-code",
      model: "default",
      agentSource: "main_default",
    });
    const card = { type: "decision", state: "open" as const, approvalId: row.id };
    store.putMessage({
      id: "message-7",
      chatId: "chat-7",
      seq: 1,
      at: row.createdAt,
      role: "flowdriven",
      kind: "card",
      outside: false,
      card,
    });
    const before = (await service.call("activity.summary", {})) as { needsYouCount: number };
    expect(before.needsYouCount).toBe(1);
    expect(
      await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
    ).toMatchObject({ decision: { id: row.id, state: "approved" } });
    expect(((await service.call("activity.summary", {})) as { needsYouCount: number }).needsYouCount).toBe(0);
    expect(store.getMessage("message-7")?.card).toEqual(card);
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "already_answered" });
  } finally {
    service.stop();
    store.close();
  }
});
