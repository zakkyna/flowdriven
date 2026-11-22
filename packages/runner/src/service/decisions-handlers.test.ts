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
