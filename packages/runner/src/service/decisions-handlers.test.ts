import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { pendingDecision } from "../test-helpers/builders.ts";
import { createRunnerService } from "./service.ts";

test("TC-j24-46 a waiting run keeps its own version after the flow head changes", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "version", createdAt: "2026-11-21T00:00:00Z" });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("missing run");
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", body: "Thanks" };
    const digest = digestCall(tool, input);
    store.updateApproval(row.id, {
      kind: "risky_action",
      riskyAction: "send",
      effect: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digest)],
    });
    store.putFlowHead({
      id: run.flowId,
      name: "Flow",
      summary: "",
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      origin: { kind: "demo" },
      headHash: `sha256:${"b".repeat(64)}`,
    });
    expect(await service.call("runs.status", { runId: run.id })).toMatchObject({ versionChanged: true });
    await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" });
    expect(store.getRun(run.id)?.flowHash).toBe(run.flowHash);
    expect(
      store.findGrant({
        runId: run.id,
        stepId: row.stepId,
        itemKey: row.itemKey,
        tool,
        digest,
        kind: "approve",
        createdAt: "",
      }),
    ).toBeDefined();
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-01 approve records a call grant and decision audit atomically", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    clearNotice: (id) => cleared.push(id),
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "approve-grant", createdAt: "2026-11-21T00:00:00Z" });
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", body: "Thanks" };
    const digest = digestCall(tool, input);
    store.updateApproval(row.id, {
      kind: "risky_action",
      riskyAction: "send",
      effect: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digest)],
    });
    expect(
      await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" }),
    ).toMatchObject({ decision: { state: "approved", resolvedVia: "window" } });
    expect(cleared).toEqual([`approval:${row.id}`]);
    expect(
      store.findGrant({
        runId: row.runId,
        stepId: row.stepId,
        itemKey: row.itemKey,
        tool,
        digest,
        kind: "approve",
        createdAt: "",
      }),
    ).toMatchObject({ approvalId: row.id });
    expect(store.listAudit(row.runId)).toContainEqual(
      expect.objectContaining({
        kind: "decision_made",
        detail: expect.objectContaining({ decision: "approve", via: "window" }),
      }),
    );
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-23 edit changes only the approved body", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "edited-body", createdAt: "2026-11-21T00:00:00Z" });
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", cc: ["alex@example.test"], subject: "Invoice", body: "Monday" };
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digestCall(tool, input))],
      payload: { kind: "email", to: [input.to], cc: input.cc, subject: input.subject, body: input.body },
    });
    const body = "To: other@example.test\nTuesday";
    expect(
      await service.call("approvals.resolve", { approvalId: row.id, decision: "edit", editedText: body }),
    ).toMatchObject({ decision: { state: "approved_edited", editedText: body } });
    const editedDigest = digestCall(tool, { ...input, body });
    expect(store.getApproval(row.id)).toMatchObject({ editedDigest });
    expect(
      store.findGrant({
        runId: row.runId,
        stepId: row.stepId,
        itemKey: "",
        tool,
        digest: editedDigest,
        kind: "approve",
        createdAt: "",
      }),
    ).toBeDefined();
    expect(
      store.findGrant({
        runId: row.runId,
        stepId: row.stepId,
        itemKey: "",
        tool,
        digest: digestCall(tool, input),
        kind: "approve",
        createdAt: "",
      }),
    ).toBeUndefined();
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-03 a second decision cannot change an approved decision", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "answered", createdAt: "2026-11-21T00:00:00Z" });
    await service.call("approvals.resolve", { approvalId: row.id, decision: "approve" });
    const before = store.getApproval(row.id);
    const audit = store.listAudit(row.runId);
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "reject" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "already_answered", params: { via: "window" } });
    expect(store.getApproval(row.id)).toEqual(before);
    expect(store.listAudit(row.runId)).toEqual(audit);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-21 choices reject excess and unknown picks and answer once", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "choice", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(row.id, {
      kind: "ask",
      maxPick: 2,
      payload: {
        question: "Choose",
        options: ["a", "b", "c"].map((key) => ({ key, label: key, item: { id: key } })),
        maxPick: 2,
      },
    });
    await expect(
      service.call("approvals.answer", { approvalId: row.id, picks: ["a", "b", "c"] }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "too_many_picks", params: { max: 2 } });
    await expect(
      service.call("approvals.answer", { approvalId: row.id, picks: ["z"] }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "unknown_pick" });
    expect(await service.call("approvals.answer", { approvalId: row.id, picks: ["a", "b"] })).toMatchObject({
      decision: { state: "approved", picks: ["a", "b"] },
    });
    await expect(service.call("approvals.answer", { approvalId: row.id, picks: [] })).rejects.toMatchObject({
      code: "conflict",
      reason: "already_answered",
    });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-24 and TC-RUL-06 reject hidden or empty edits without a grant", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "invalid-edit", createdAt: "2026-11-21T00:00:00Z" });
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", subject: "Invoice", body: "Monday" };
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digestCall(tool, input))],
      payload: { kind: "email", to: [input.to], subject: input.subject, body: input.body },
    });
    for (const [editedText, reason] of [
      [`ok${String.fromCodePoint(0x200b)}`, "hidden_characters"],
      [`ok${String.fromCodePoint(0x202e)}`, "hidden_characters"],
      ["", "empty_text"],
      ["  \n ", "empty_text"],
    ]) {
      await expect(
        service.call("approvals.resolve", { approvalId: row.id, decision: "edit", editedText }),
      ).rejects.toMatchObject({ code: "invalid_input", reason });
      expect(store.getApproval(row.id)?.state).toBe("pending");
      expect(
        store.findGrant({
          runId: row.runId,
          stepId: row.stepId,
          itemKey: "",
          tool,
          digest: digestCall(tool, input),
          kind: "approve",
          createdAt: "",
        }),
      ).toBeUndefined();
    }
    for (const [editedSubject, reason] of [
      [`ok${String.fromCodePoint(0x200b)}`, "hidden_characters"],
      [`ok${String.fromCodePoint(0x202e)}`, "hidden_characters"],
      ["", "empty_text"],
      ["  ", "empty_text"],
    ]) {
      await expect(
        service.call("approvals.resolve", {
          approvalId: row.id,
          decision: "edit",
          editedText: "valid",
          editedSubject,
        }),
      ).rejects.toMatchObject({ code: "invalid_input", reason });
      expect(store.getApproval(row.id)?.state).toBe("pending");
    }
    store.updateApproval(row.id, { payload: { kind: "diff", files: [{ path: "a", patch: "change" }] } });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "edit", editedText: "valid" }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "edit_not_allowed" });
    expect(store.getApproval(row.id)?.state).toBe("pending");
    store.updateApproval(row.id, {
      payload: { kind: "text", text: "Message" },
      call: { tool, input: { body: "Message" } },
    });
    await expect(
      service.call("approvals.resolve", {
        approvalId: row.id,
        decision: "edit",
        editedText: "valid",
        editedSubject: "Subject",
      }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "edit_not_allowed" });
    expect(store.getApproval(row.id)?.state).toBe("pending");
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-05 edit binds the grant to the edited subject and body", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "edit", createdAt: "2026-11-21T00:00:00Z" });
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", subject: "Re: Invoice question", body: "Monday" };
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digestCall(tool, input))],
      payload: { kind: "email", to: [input.to], subject: input.subject, body: input.body },
    });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "edit" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "approve", editedText: "Tuesday" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(store.getApproval(row.id)?.state).toBe("pending");
    const result = await service.call("approvals.resolve", {
      approvalId: row.id,
      decision: "edit",
      editedSubject: "Re: Invoice",
      editedText: "Tuesday",
    });
    const edited = { ...input, subject: "Re: Invoice", body: "Tuesday" };
    expect(result).toMatchObject({
      decision: { state: "approved_edited", editedSubject: edited.subject, editedText: edited.body },
    });
    expect(
      store.findGrant({
        runId: row.runId,
        stepId: row.stepId,
        itemKey: "",
        tool,
        digest: digestCall(tool, edited),
        kind: "approve",
        createdAt: "",
      }),
    ).toMatchObject({ approvalId: row.id });
    expect(store.getRun(row.runId)?.decisionLines).toContainEqual({
      key: "report.youApprovedEdited",
      params: { title: "Review" },
    });
  } finally {
    service.stop();
    store.close();
  }
});

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
        expect.objectContaining({ id: "send", state: "pending", canAlwaysAllow: false, similarWaiting: 2 }),
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

test("TC-RUL-04 approvals before and after 24 hours remain valid", async () => {
  // The stopped third decision is covered by B-05.T7.
  const store = await openSqliteStore(":memory:");
  let now = new Date("2026-11-21T23:59:59.999Z");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo", now: () => now });
  try {
    const { digestCall, callGrant } = await import("../connectors/grants.ts");
    for (const [id, at] of [
      ["before", "2026-11-21T23:59:59.999Z"],
      ["after", "2026-11-22T01:00:00Z"],
    ] as const) {
      now = new Date(at);
      const row = pendingDecision(store, { id, createdAt: "2026-11-21T00:00:00Z" });
      const tool = "mcp__claude_ai_Gmail__reply",
        input = { body: "Hello" },
        digest = digestCall(tool, input);
      store.updateApproval(row.id, {
        kind: "risky_action",
        effect: "send",
        riskyAction: "send",
        call: { tool, input },
        approves: [callGrant("mail", tool, digest)],
      });
      expect(await service.call("approvals.resolve", { approvalId: id, decision: "approve" })).toMatchObject({
        decision: { state: "approved" },
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
      ).toMatchObject({ approvalId: id });
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-07 reject records the decision and clears the notice in one call", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
    clearNotice: (id) => cleared.push(id),
  });
  try {
    const row = pendingDecision(store, { id: "reject", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      call: { tool: "reply", input: {} },
    });
    expect(await service.call("approvals.resolve", { approvalId: row.id, decision: "reject" })).toMatchObject(
      { decision: { state: "rejected", resolvedVia: "window" } },
    );
    expect(store.getStep(row.runId, row.stepId)).toMatchObject({
      state: "skipped",
      skipped: { because: "rejected", approvalId: row.id },
    });
    expect(store.getRun(row.runId)?.decisionLines).toContainEqual({
      key: "report.youSaidNo",
      params: { title: row.summary },
    });
    expect(cleared).toEqual([`approval:${row.id}`]);
    expect(store.listAudit(row.runId)).toContainEqual(
      expect.objectContaining({
        kind: "decision_made",
        detail: expect.objectContaining({ decision: "reject", via: "window" }),
      }),
    );
  } finally {
    service.stop();
    store.close();
  }
});

for (const id of ["TC-j24-19", "TC-j24-20", "TC-j24-21", "TC-SR1-24", "TC-RUL-19", "TC-RUL-20"]) {
  test(`${id} similar decisions are checked and approved as one batch`, async () => {
    const store = await openSqliteStore(":memory:");
    const service = createRunnerService({
      store,
      dataDir: ".",
      mode: "demo",
      now: () => new Date("2026-11-21T00:00:00Z"),
    });
    try {
      const first = pendingDecision(store, { id: "batch-1", createdAt: "2026-11-21T00:00:00Z" });
      const { digestCall, callGrant } = await import("../connectors/grants.ts");
      let group = "send:local.flow-batch-1:reply";
      const ids = ["batch-1", "batch-2", "batch-3"];
      for (const [index, approvalId] of ids.entries()) {
        const tool = "mcp__claude_ai_Gmail__reply";
        const input = {
          to: `person${index}@example.test`,
          subject: "Subject",
          body: "Full message".repeat(30),
        };
        const row = {
          ...first,
          id: approvalId,
          itemKey: String(index),
          kind: "risky_action" as const,
          effect: "send" as const,
          riskyAction: "send" as const,
          similarGroup: group,
          call: { tool, input },
          approves: [callGrant("mail", tool, digestCall(tool, input))],
          payload: { kind: "email", to: [input.to], subject: input.subject, body: input.body },
        };
        store.upsertStep({
          runId: first.runId,
          stepId: first.stepId,
          itemKey: row.itemKey,
          state: "waiting_approval",
          attempts: [],
          outputs: {},
          checks: [],
        });
        if (index === 0) store.updateApproval(approvalId, row);
        else store.createApproval(row);
      }
      if (id === "TC-j24-19" || id === "TC-SR1-24") {
        const other = pendingDecision(store, { id: "other-run", createdAt: "2026-11-21T00:00:00Z" });
        store.updateApproval(other.id, {
          kind: "risky_action",
          riskyAction: "send",
          effect: "send",
          similarGroup: group,
        });
        store.createApproval({
          ...first,
          id: "batch-pay",
          kind: "risky_action",
          riskyAction: "pay",
          effect: "pay",
        });
      }
      const listed = await service.call("approvals.list", { runId: first.runId });
      expect(listed).toEqual(
        expect.arrayContaining(
          ids.map((approvalId) =>
            expect.objectContaining({
              id: approvalId,
              similarWaiting: 3,
              payload: expect.objectContaining({ body: "Full message".repeat(30) }),
            }),
          ),
        ),
      );
      if (["TC-j24-20", "TC-RUL-20"].includes(id)) {
        await expect(
          service.call("approvals.resolveSimilar", {
            runId: first.runId,
            group,
            approvalIds: ids.slice(0, 2),
          }),
        ).rejects.toMatchObject({
          code: "conflict",
          reason: "list_changed",
          params: { approvalIds: expect.arrayContaining(ids) },
        });
        expect(ids.map((approvalId) => store.getApproval(approvalId)?.state)).toEqual([
          "pending",
          "pending",
          "pending",
        ]);
      }
      if (id === "TC-RUL-20") {
        await expect(
          service.call("approvals.resolveSimilar", {
            runId: first.runId,
            group,
            approvalIds: ["batch-1", "unknown"],
          }),
        ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
        await expect(
          service.call("approvals.resolveSimilar", { runId: "missing", group, approvalIds: ids }),
        ).rejects.toMatchObject({ code: "not_found" });
        group = "post:local.flow-batch-1:reply";
        for (const approvalId of ids)
          store.updateApproval(approvalId, { riskyAction: "post", effect: "post", similarGroup: group });
      }
      if (id === "TC-j24-21") {
        store.updateApproval("batch-2", { state: "expired" });
        store.updateApproval("batch-3", { state: "expired" });
        expect(await service.call("approvals.list", { runId: first.runId, state: "pending" })).toEqual([
          expect.objectContaining({ id: "batch-1", similarWaiting: 1 }),
        ]);
        await expect(
          service.call("approvals.resolveSimilar", {
            runId: first.runId,
            group,
            approvalIds: ["batch-1", "unknown"],
          }),
        ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
        store.updateApproval("batch-2", { state: "pending" });
        store.updateApproval("batch-3", { state: "pending" });
        for (const effect of ["pay", "delete", "merge", "change"] as const) {
          store.updateApproval("batch-3", { riskyAction: effect === "change" ? undefined : effect, effect });
          await expect(
            service.call("approvals.resolveSimilar", { runId: first.runId, group, approvalIds: ids }),
          ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
        }
        store.updateApproval("batch-3", { riskyAction: "post", effect: "post", similarGroup: "post:other" });
        await expect(
          service.call("approvals.resolveSimilar", { runId: first.runId, group, approvalIds: ids }),
        ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
        expect(ids.map((approvalId) => store.getApproval(approvalId)?.state)).toEqual([
          "pending",
          "pending",
          "pending",
        ]);
        return;
      }
      if (id === "TC-SR1-24") {
        store.updateApproval("batch-2", { stepId: "missing" });
        await expect(
          service.call("approvals.resolveSimilar", { runId: first.runId, group, approvalIds: ids }),
        ).rejects.toMatchObject({ code: "not_found" });
        expect(ids.map((approvalId) => store.getApproval(approvalId)?.state)).toEqual([
          "pending",
          "pending",
          "pending",
        ]);
        expect(
          store
            .listAudit(first.runId)
            .filter((entry) => entry.kind === "decision_made" || entry.kind === "decisions_batch"),
        ).toHaveLength(0);
        store.updateApproval("batch-2", { stepId: first.stepId });
      }
      await service.call("approvals.resolveSimilar", {
        runId: first.runId,
        group,
        approvalIds: [...ids].reverse(),
      });
      expect(ids.map((approvalId) => store.getApproval(approvalId)?.state)).toEqual([
        "approved",
        "approved",
        "approved",
      ]);
      for (const approvalId of ids) {
        const row = store.getApproval(approvalId);
        if (!row?.call) throw new Error("missing call");
        expect(
          store.findGrant({
            runId: row.runId,
            stepId: row.stepId,
            itemKey: row.itemKey,
            tool: row.call.tool,
            digest: digestCall(row.call.tool, row.call.input),
            kind: "approve",
            createdAt: "",
          }),
        ).toMatchObject({ approvalId, kind: "similar" });
      }
      if (id === "TC-j24-19" || id === "TC-SR1-24") {
        expect(store.getApproval("other-run")?.state).toBe("pending");
        expect(store.getApproval("batch-pay")?.state).toBe("pending");
      }
      expect(store.listAudit(first.runId).filter((entry) => entry.kind === "decision_made")).toHaveLength(3);
      expect(store.listAudit(first.runId).filter((entry) => entry.kind === "decisions_batch")).toHaveLength(
        1,
      );
    } finally {
      service.stop();
      store.close();
    }
  });
}

test("TC-j24-21 non-batchable decision kinds never offer a group", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const first = pendingDecision(store, { id: "nonbatch-1", createdAt: "2026-11-21T00:00:00Z" });
    store.createApproval({ ...first, id: "nonbatch-2" });
    for (const kind of ["pay", "delete", "merge", "ask", "result_sign_off"] as const) {
      for (const id of ["nonbatch-1", "nonbatch-2"]) {
        store.updateApproval(id, {
          kind: kind === "ask" || kind === "result_sign_off" ? kind : "risky_action",
          effect: kind === "pay" || kind === "delete" || kind === "merge" ? kind : undefined,
          riskyAction: kind === "pay" || kind === "delete" || kind === "merge" ? kind : undefined,
          similarGroup: undefined,
          payload:
            kind === "ask"
              ? { question: "Choose", options: [{ key: "a", label: "A", item: "a" }], maxPick: 1 }
              : "Review",
        });
      }
      const rows = (await service.call("approvals.list", { runId: first.runId })) as Array<{
        similarGroup?: string;
        similarWaiting?: number;
      }>;
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.similarGroup).toBeUndefined();
      for (const row of rows) expect(row.similarWaiting).toBeUndefined();
      await expect(
        service.call("approvals.resolveSimilar", {
          runId: first.runId,
          group: kind,
          approvalIds: ["nonbatch-1", "nonbatch-2"],
        }),
      ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
      expect([store.getApproval("nonbatch-1")?.state, store.getApproval("nonbatch-2")?.state]).toEqual([
        "pending",
        "pending",
      ]);
    }
    store.putSetting("spending-pause", {
      id: "budget",
      month: "2026-11",
      reachedAt: first.createdAt,
      limitUsd: 10,
      expiresAt: "2026-12-01T00:00:00Z",
      state: "pending",
    });
    const rows = (await service.call("approvals.list", { state: "pending" })) as Array<{
      id: string;
      similarGroup?: string;
    }>;
    expect(rows.find((row) => row.id === "budget")?.similarGroup).toBeUndefined();
    expect(rows.some((row) => row.id === "budget")).toBe(true);
    await expect(
      service.call("approvals.resolveSimilar", {
        runId: first.runId,
        group: "budget",
        approvalIds: ["budget", "nonbatch-1"],
      }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "kind_not_batchable" });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-10 phone decisions retain their source and cannot edit or create rules", async () => {
  const { createDecisionHandlers } = await import("./handlers.ts");
  const { createWeekly } = await import("./weekly-limit.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const handlers = createDecisionHandlers(
    store,
    service.engine,
    createWeekly({ store, now: () => new Date(), recheck: () => {} }),
    () => {},
  );
  try {
    const row = pendingDecision(store, { id: "phone-refuse", createdAt: "2026-11-21T00:00:00Z" });
    for (const decision of ["edit", "always_allow"] as const) {
      expect(() =>
        handlers.resolve(
          { approvalId: row.id, decision, ...(decision === "edit" ? { editedText: "changed" } : {}) },
          { caller: "phone" },
        ),
      ).toThrow(expect.objectContaining({ code: "not_allowed", reason: "phone_no_rules" }));
      expect(store.getApproval(row.id)?.state).toBe("pending");
    }
    for (const decision of ["approve", "reject"] as const) {
      const next = pendingDecision(store, { id: `phone-${decision}`, createdAt: "2026-11-21T00:00:00Z" });
      expect(handlers.resolve({ approvalId: next.id, decision }, { caller: "phone" }).decision).toMatchObject(
        { resolvedVia: "phone" },
      );
      expect(store.listAudit(next.runId)).toContainEqual(
        expect.objectContaining({
          kind: "decision_made",
          detail: { approvalId: next.id, decision, via: "phone" },
        }),
      );
    }
    expect(store.listRules()).toHaveLength(0);
    await expect(service.call("rules.revoke", { ruleId: "missing" }, "phone")).rejects.toMatchObject({
      code: "not_allowed",
      reason: "caller_not_allowed",
    });
  } finally {
    service.stop();
    store.close();
  }
});

test("T17 invalid decision does not hide other decisions in either list", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const good = pendingDecision(store, { id: "good-t17", createdAt: "2026-11-21T00:00:00Z" });
    const bad = pendingDecision(store, { id: "bad-t17", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(bad.id, { summary: "x".repeat(201) });
    expect(await service.call("approvals.list", {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: good.id })]),
    );
    expect(await service.call("activity.summary", {})).toMatchObject({
      needsYou: expect.arrayContaining([
        expect.objectContaining({ decision: expect.objectContaining({ id: good.id }) }),
      ]),
    });
    expect(
      store
        .listAudit()
        .filter((row) => row.kind === "internal_error")
        .map((row) => row.detail),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "approvals.list" }),
        expect.objectContaining({ method: "activity.summary" }),
      ]),
    );
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-28 outside decisions cannot become rules or batches", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });
  try {
    const row = pendingDecision(store, {
      id: "outside-rule",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "outside_flow",
      effect: "send",
    });
    store.updateApproval(row.id, {
      fixedPlace: true,
      place: { kind: "account", value: "mail", label: "Mail" },
      call: { tool: "Bash", input: { command: "echo hello" } },
      payload: { kind: "text", text: "hello" },
    });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("missing run");
    const rule = store.makeRule({
      flowId: run.flowId,
      touchId: "mail",
      effect: "change",
      place: { kind: "account", value: "mail", label: "Mail" },
      sentence: "Change mail",
    });
    store.createApproval({
      ...row,
      id: "outside-change",
      kind: "outside_flow",
      effect: "change",
      riskyAction: undefined,
      fixedPlace: true,
      place: { kind: "account", value: "mail", label: "Mail" },
      call: { tool: "Bash", input: { command: "echo hello" } },
      payload: { kind: "text", text: "hello" },
    });
    const listed = (await service.call("approvals.list", { runId: row.runId })) as Array<
      Record<string, unknown>
    >;
    expect(listed.find((item) => item.id === "outside-change")).toMatchObject({
      kind: "outside_flow",
      canAlwaysAllow: false,
      editable: false,
    });
    expect(listed.find((item) => item.id === "outside-change")?.similarGroup).toBeUndefined();
    expect(listed.find((item) => item.id === "outside-change")?.similarWaiting).toBeUndefined();
    await expect(
      service.call("approvals.resolve", { approvalId: "outside-change", decision: "always_allow" }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "outside_flow_once" });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "outside_flow_once" });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "edit", editedText: "changed" }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "edit_not_allowed" });
    store.createApproval({
      ...row,
      id: "batch-peer",
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      similarGroup: "group",
    });
    await expect(
      service.call("approvals.resolveSimilar", {
        runId: row.runId,
        group: "group",
        approvalIds: [row.id, "batch-peer"],
      }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "outside_flow_once" });
    store.updateApproval(row.id, { state: "approved", resolvedAt: "2026-11-21T00:00:01Z" });
    await expect(
      service.call("approvals.resolveSimilar", {
        runId: row.runId,
        group: "group",
        approvalIds: [row.id, "batch-peer"],
      }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "outside_flow_once" });
    expect(store.getApproval(row.id)?.state).toBe("approved");
    expect(store.getApproval("batch-peer")?.state).toBe("pending");
    expect(store.listRules()).toEqual([rule]);
    expect(store.getApproval("outside-change")?.state).toBe("pending");
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-RUL-29 another way validates window text, rejects non-window callers and ineligible kinds, and writes no grant", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    clearNotice: (id) => cleared.push(id),
    now: () => new Date("2026-11-22T00:00:00Z"),
  });
  try {
    const { callGrant, digestCall } = await import("../connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { to: "sam@example.test", subject: "Invoice", body: "Monday" };
    const digest = digestCall(tool, input);
    const risky = pendingDecision(store, {
      id: "aw-risky",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "risky_action",
      effect: "send",
    });
    store.updateApproval(risky.id, {
      call: { tool, input },
      approves: [callGrant("mail", tool, digest)],
      payload: { kind: "email", to: [input.to], subject: input.subject, body: input.body },
    });
    const outside = pendingDecision(store, {
      id: "aw-outside",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "outside_flow",
      effect: "change",
    });
    const outTool = "WebFetch";
    const outInput = { url: "https://example.test/page" };
    const outDigest = digestCall(outTool, outInput);
    store.updateApproval(outside.id, {
      call: { tool: outTool, input: outInput },
      approves: [`${outTool}#${outDigest}`],
      payload: { kind: "text", text: "Fetch page" },
    });
    const signOff = pendingDecision(store, {
      id: "aw-signoff",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "result_sign_off",
    });
    const choice = pendingDecision(store, {
      id: "aw-choice",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "ask",
    });
    const expiredChoice = pendingDecision(store, {
      id: "aw-choice-expired",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "ask",
    });
    store.updateApproval(expiredChoice.id, { state: "expired" });
    const answeredChoice = pendingDecision(store, {
      id: "aw-choice-answered",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "ask",
    });
    store.updateApproval(answeredChoice.id, { state: "approved", resolvedVia: "window" });
    const flowSignOff = pendingDecision(store, {
      id: "aw-flow-signoff",
      createdAt: "2026-11-21T00:00:00Z",
    });
    store.updateApproval(flowSignOff.id, {
      kind: "flow_sign_off" as unknown as typeof flowSignOff.kind,
    });
    const reqAddition = pendingDecision(store, {
      id: "aw-req-add",
      createdAt: "2026-11-21T00:00:00Z",
    });
    store.updateApproval(reqAddition.id, {
      kind: "requirement_addition" as unknown as typeof reqAddition.kind,
    });
    store.putSetting("weekly:claude-code", {
      resetsAt: Date.parse("2026-11-23T00:00:00Z") / 1000,
      askedAt: "2026-11-21T23:00:00Z",
      percent: 95,
    });
    store.putSetting("spending-pause", {
      id: "budget-aw",
      month: "2026-11",
      reachedAt: "2026-11-21T23:00:00Z",
      limitUsd: 10,
      expiresAt: "2026-12-01T00:00:00Z",
      state: "pending",
    });

    for (const caller of ["tool", "phone"] as const) {
      for (const anotherWayText of ["Try another way", ""]) {
        await expect(
          service.call(
            "approvals.resolve",
            { approvalId: risky.id, decision: "another_way", anotherWayText },
            caller,
          ),
        ).rejects.toMatchObject({ code: "not_allowed", reason: "caller_not_allowed" });
        expect(store.listAudit()).toContainEqual(
          expect.objectContaining({
            kind: "caller_refused",
            detail: { operation: "approvals.resolve", caller },
          }),
        );
      }
    }
    expect(store.getApproval(risky.id)?.state).toBe("pending");
    expect(store.hasCallGrant(risky.runId, risky.stepId, risky.itemKey)).toBe(false);

    for (const target of [risky, outside]) {
      for (const [anotherWayText, reason] of [
        ["", "empty_text"],
        ["  \n\t ", "empty_text"],
        [`try${String.fromCodePoint(0x200b)}`, "hidden_characters"],
        [`try${String.fromCodePoint(0x202e)}`, "hidden_characters"],
        ["a".repeat(4001), "text_too_long"],
      ] as const) {
        await expect(
          service.call("approvals.resolve", {
            approvalId: target.id,
            decision: "another_way",
            anotherWayText,
          }),
        ).rejects.toMatchObject({ code: "invalid_input", reason });
        expect(store.getApproval(target.id)?.state).toBe("pending");
        expect(store.hasCallGrant(target.runId, target.stepId, target.itemKey)).toBe(false);
        expect(store.listRules()).toEqual([]);
      }
    }

    await expect(
      service.call("approvals.resolve", { approvalId: choice.id, decision: "approve" }),
    ).rejects.toThrow("This is a choice. Pick from its options.");
    await expect(
      service.call("approvals.resolve", {
        approvalId: choice.id,
        decision: "another_way",
        anotherWayText: "",
      }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "empty_text" });
    for (const text of ["Try differently", "   \n "]) {
      await expect(
        service.call("approvals.resolve", {
          approvalId: choice.id,
          decision: "another_way",
          anotherWayText: text,
        }),
      ).rejects.toMatchObject({ code: "invalid_input", reason: "another_way_not_allowed" });
    }
    await expect(
      service.call("approvals.resolve", {
        approvalId: expiredChoice.id,
        decision: "another_way",
        anotherWayText: "Try differently",
      }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    await expect(
      service.call("approvals.resolve", {
        approvalId: answeredChoice.id,
        decision: "another_way",
        anotherWayText: "Try differently",
      }),
    ).rejects.toMatchObject({ code: "conflict", reason: "already_answered" });
    for (const ineligibleId of ["weekly-limit:claude-code", "budget-aw", flowSignOff.id, reqAddition.id]) {
      await expect(
        service.call("approvals.resolve", {
          approvalId: ineligibleId,
          decision: "another_way",
          anotherWayText: "Try differently",
        }),
      ).rejects.toMatchObject({ code: "invalid_input", reason: "another_way_not_allowed" });
    }
    expect(store.getApproval(choice.id)?.state).toBe("pending");
    expect(store.getApproval(flowSignOff.id)?.state).toBe("pending");
    expect(store.getApproval(reqAddition.id)?.state).toBe("pending");

    const riskyText = "First line\n\tSecond line";
    expect(
      await service.call("approvals.resolve", {
        approvalId: risky.id,
        decision: "another_way",
        anotherWayText: riskyText,
      }),
    ).toMatchObject({
      decision: {
        id: risky.id,
        state: "another_way",
        anotherWayText: riskyText,
        resolvedVia: "window",
      },
      stepWaiting: 0,
    });
    expect(cleared).toContain(`approval:${risky.id}`);
    expect(store.hasCallGrant(risky.runId, risky.stepId, risky.itemKey)).toBe(false);
    expect(store.listRules()).toEqual([]);
    expect(store.getRun(risky.runId)?.decisionLines).toContainEqual({
      key: "report.anotherWay",
      params: { text: riskyText },
    });
    const riskyAudit = store.listAudit(risky.runId);
    expect(riskyAudit).toContainEqual(
      expect.objectContaining({
        kind: "decision_made",
        detail: { approvalId: risky.id, decision: "another_way", via: "window" },
      }),
    );
    expect(JSON.stringify(riskyAudit)).not.toContain("First line");

    const maxText = "a".repeat(4000);
    expect(
      await service.call("approvals.resolve", {
        approvalId: outside.id,
        decision: "another_way",
        anotherWayText: maxText,
      }),
    ).toMatchObject({
      decision: { id: outside.id, state: "another_way", anotherWayText: maxText, resolvedVia: "window" },
      stepWaiting: 0,
    });
    expect(store.hasCallGrant(outside.runId, outside.stepId, outside.itemKey)).toBe(false);
    expect(store.getRun(outside.runId)?.decisionLines).toContainEqual({
      key: "report.anotherWay",
      params: { text: maxText },
    });

    expect(
      await service.call("approvals.resolve", {
        approvalId: signOff.id,
        decision: "another_way",
        anotherWayText: "Make it shorter",
      }),
    ).toMatchObject({
      decision: {
        id: signOff.id,
        state: "another_way",
        anotherWayText: "Make it shorter",
        resolvedVia: "window",
      },
      stepWaiting: 0,
    });

    for (const caller of ["tool", "phone"] as const) {
      const restricted = (await service.call("approvals.list", { runId: risky.runId }, caller)) as Array<
        Record<string, unknown>
      >;
      expect(restricted).toEqual([
        { flowId: `local.flow-${risky.id}`, stepId: "alerts", state: "another_way" },
      ]);
    }
  } finally {
    service.stop();
    store.close();
  }
});
