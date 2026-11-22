import { operations } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createFixtureRunnerClient } from "./client";

test("TC-IPC-22 fixture reports version 2 and sample mode", async () => {
  const client = createFixtureRunnerClient({ scenario: "story-v2" });
  const info = await client.call("runner.info", {});
  expect(info).toMatchObject({ contractVersion: 2, mode: "sample" });
  expect(operations["runner.info"].output.safeParse(info).success).toBe(true);
});

test("TC-CON-42 kept operations use version 2 shapes and preserve writes", async () => {
  const client = createFixtureRunnerClient({ scenario: "story-v2" });
  const info = await client.call("runner.info", {});
  expect(operations["runner.info"].output.safeParse(info).success).toBe(true);
  const settings = await client.call("settings.get", {});
  expect(operations["settings.get"].output.safeParse(settings).success).toBe(true);
  const flows = await client.call("flows.list", {});
  expect(operations["flows.list"].output.safeParse(flows).success).toBe(true);
  for (const flow of flows) {
    expect(
      operations["flows.get"].output.safeParse(await client.call("flows.get", { flowId: flow.id })).success,
    ).toBe(true);
    expect(
      operations["triggers.list"].output.safeParse(await client.call("triggers.list", { flowId: flow.id }))
        .success,
    ).toBe(true);
    expect(
      operations["readiness.check"].output.safeParse(
        await client.call("readiness.check", { flowId: flow.id }),
      ).success,
    ).toBe(true);
  }
  const runs = await client.call("runs.list", {});
  expect(operations["runs.list"].output.safeParse(runs).success).toBe(true);
  for (const run of runs) {
    expect(
      operations["runs.status"].output.safeParse(await client.call("runs.status", { runId: run.id })).success,
    ).toBe(true);
    expect(
      operations["runs.report"].output.safeParse(await client.call("runs.report", { runId: run.id })).success,
    ).toBe(true);
  }
  const approvals = await client.call("approvals.list", {});
  expect(operations["approvals.list"].output.safeParse(approvals).success).toBe(true);
  expect(operations["audit.list"].output.safeParse(await client.call("audit.list", {})).success).toBe(true);
  expect(
    operations["settings.update"].output.safeParse(
      await client.call("settings.update", { patch: { busyFallback: true } }),
    ).success,
  ).toBe(true);
  const approval = approvals.find((item) => item.state === "pending" && item.kind !== "ask");
  expect(approval).toBeDefined();
  if (!approval) return;
  const resolved = await client.call("approvals.resolve", { approvalId: approval.id, decision: "approve" });
  expect(operations["approvals.resolve"].output.safeParse(resolved).success).toBe(true);
  expect((await client.call("approvals.list", {})).find((item) => item.id === approval.id)?.state).toBe(
    "approved",
  );
  const resumable = runs.find((item) => item.state === "blocked");
  expect(resumable).toBeDefined();
  if (!resumable) return;
  expect(
    operations["runs.resume"].output.safeParse(await client.call("runs.resume", { runId: resumable.id }))
      .success,
  ).toBe(true);
  expect(client.calls.map((call) => call.operation)).toEqual([
    "runner.info",
    "settings.get",
    "flows.list",
    ...flows.flatMap(() => ["flows.get", "triggers.list", "readiness.check"]),
    "runs.list",
    ...runs.flatMap(() => ["runs.status", "runs.report"]),
    "approvals.list",
    "audit.list",
    "settings.update",
    "approvals.resolve",
    "approvals.list",
    "runs.resume",
  ]);
});

test("TC-CON-42 permission off stops active runs and expires decisions", async () => {
  const client = createFixtureRunnerClient();
  await client.call("settings.update", { patch: { agentPermission: "off" } });
  expect((await client.call("runs.status", { runId: "run-timesheet-wait" })).state).toBe("stopped");
  expect((await client.call("approvals.list", {}))[0]).toMatchObject({
    state: "expired",
    resolvedVia: "permission_off",
  });
  expect((await client.call("audit.list", {})).some((record) => record.kind === "permission_changed")).toBe(
    true,
  );
});

test("TC-CON-42 refusal and unfinished operations (TC-CON-44)", async () => {
  const client = createFixtureRunnerClient();
  await expect(client.call("runs.resume", { runId: "run-apk-stopped" })).rejects.toMatchObject({
    code: "not_allowed",
    reason: "not_resumable",
  });
  expect((await client.call("agents.list", {})).map((agent) => [agent.id, agent.state])).toEqual([
    ["claude-code", "ready"],
    ["codex", "not_installed"],
  ]);
  expect(
    operations["runs.export"].output.safeParse(await client.call("runs.export", { runId: "run-apk-done" }))
      .success,
  ).toBe(true);
  await expect(client.call("flows.import", { path: "/example" })).rejects.toMatchObject({
    code: "unavailable",
  });
  await expect(
    client.call("readiness.install", { flowId: "example.fill-timesheet", requirementId: "missing" }),
  ).rejects.toMatchObject({ code: "unavailable" });
});

test("TC-CON-42 rejection is visible in the run report", async () => {
  const client = createFixtureRunnerClient();
  await client.call("approvals.resolve", { approvalId: "decision-1", decision: "reject" });
  const report = await client.call("runs.report", { runId: "run-timesheet-wait" });
  expect(report.decisionLines).toContainEqual({ key: "report.youSaidNo", params: { title: "Log hours" } });
});

test("TC-CON-42 export masks sensitive text and marks hidden characters", async () => {
  const client = createFixtureRunnerClient();
  const run = client.state.runs.find((item) => item.id === "run-apk-done");
  if (!run) throw new Error("Missing sample run");
  const marker = String.fromCodePoint(0x200b);
  run.report = {
    runId: run.id,
    lines: [`Bearer ${"example-token"} ${marker}`],
    decisionLines: [],
    result: { kind: "report" },
  };
  const output = await client.call("runs.export", { runId: run.id });
  expect(output.summary[0]?.text).toBe("[hidden] [U+200B hidden character]");
});

test("TC-CON-42 resume rechecks a blocker and preserves passed steps", async () => {
  const client = createFixtureRunnerClient();
  const run = client.state.runs.find((item) => item.id === "run-supplier-blocked");
  if (!run) throw new Error("Missing blocked sample run");
  run.steps = [
    {
      stepId: "done",
      title: "Done",
      do: "worker",
      state: "passed",
      attempts: [],
      maxAttempts: 1,
      checks: [],
    },
    {
      stepId: "retry",
      title: "Retry",
      do: "worker",
      state: "failed",
      attempts: [],
      maxAttempts: 1,
      checks: [],
    },
  ];
  expect((await client.call("runs.resume", { runId: run.id })).outcome).toBe("still_stuck");
  expect(run.state).toBe("blocked");
  delete client.state.resumeBlockers[run.id];
  const result = await client.call("runs.resume", { runId: run.id });
  expect(result.outcome).toBe("resumed");
  expect(result.run.state).toBe("running");
  expect(run.steps.map((step) => step.state)).toEqual(["passed", "pending"]);
  expect((await client.call("audit.list", { runId: run.id })).some((row) => row.kind === "run_resumed")).toBe(
    true,
  );
});

test("TC-CON-42 always allow reuses the matching rule and updates flow views", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  if (!decision) throw new Error("Missing decision");
  const result = await client.call("approvals.resolve", {
    approvalId: decision.id,
    decision: "always_allow",
  });
  expect(result.decision.state).toBe("allowed_always");
  expect(result.ruleId).toBe("rule-1");
  expect(client.state.rules).toHaveLength(1);
  const flow = await client.call("flows.get", { flowId: "example.fill-timesheet" });
  expect(flow.rules.map((rule) => rule.id)).toContain(result.ruleId);
});

test("TC-CON-42 settings reject invalid language without side effects", async () => {
  const client = createFixtureRunnerClient();
  await expect(
    client.call("settings.update", { patch: { language: "fr", agentPermission: "off" } }),
  ).rejects.toMatchObject({ code: "invalid_input", reason: "language_unknown" });
  expect((await client.call("runs.status", { runId: "run-timesheet-wait" })).state).toBe("waiting_approval");
});

test("TC-CON-42 editing an empty decision reports the specified reason", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  if (!decision) throw new Error("Missing decision");
  decision.editable = true;
  await expect(
    client.call("approvals.resolve", { approvalId: decision.id, decision: "edit", editedText: "" }),
  ).rejects.toMatchObject({ code: "invalid_input", reason: "empty_text" });
});

test("TC-CON-42 always allow requires the confirmed touch and place", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  if (!decision || !decision.place) throw new Error("Missing decision place");
  decision.place.value = "other-account";
  await expect(
    client.call("approvals.resolve", { approvalId: decision.id, decision: "always_allow" }),
  ).rejects.toMatchObject({ code: "not_allowed", reason: "place_not_fixed" });
  expect(client.state.rules).toHaveLength(1);
});

test("TC-CON-42 readiness reports requirements in the manifest", async () => {
  const client = createFixtureRunnerClient();
  const flow = client.state.flows[0];
  if (!flow) throw new Error("Missing flow");
  flow.manifest.requirements.push({
    id: "sample-tool",
    type: "cli_tool",
    ref: "sample",
    required: true,
    sensitive: false,
    why: "Needed",
    routes: [],
  });
  const report = await client.call("readiness.check", { flowId: flow.summary.id });
  expect(report.ready).toBe(false);
  expect(report.items[0]).toMatchObject({ requirementId: "sample-tool", state: "unchecked" });
  expect(operations["readiness.check"].output.safeParse(report).success).toBe(true);
});

test("TC-CON-43 new operations return contract shapes and retain writes", async () => {
  const client = createFixtureRunnerClient({ scenario: "story-v2" });
  const expectedCalls: { operation: string; input: unknown }[] = [];
  const check = async <N extends import("@flowdriven/contracts").LiveOperationName>(
    name: N,
    input: import("@flowdriven/contracts").OperationInput<N>,
  ) => {
    expectedCalls.push({ operation: name, input });
    const output = await client.call(name, input);
    expect(operations[name].output.safeParse(output).success, name).toBe(true);
    return output;
  };
  const flows = await check("flows.list", {});
  expect(flows.map((item) => item.id).sort()).toEqual([
    "example.build-apk",
    "example.email-triage",
    "example.fill-timesheet",
    "example.job-review",
    "example.weekly-supplier-report",
  ]);
  const firstFlow = flows[0];
  if (!firstFlow) throw new Error("Missing flow");
  const f = await check("flows.get", { flowId: firstFlow.id });
  const agents = await check("agents.list", {});
  const agent = agents.find((item) => item.state === "ready");
  if (!agent || !agent.defaultModel) throw new Error("Missing ready agent");
  await check("agents.setUp", { agentId: agent.id });
  await check("agents.signIn", { agentId: agent.id });
  await check("agents.rescan", {});
  await check("agents.models", { agentId: agent.id });
  await check("chats.list", {});
  const { chatId } = await check("chats.create", {});
  await check("chats.setAgent", { chatId, agent: agent.id, model: agent.defaultModel });
  await check("chats.setComposer", { chatId, text: "draft" });
  const sent = await check("chats.send", { chatId, text: "Hello fixture" });
  expect(
    (await check("chats.get", { chatId })).messages.some(
      (m) => m.id === sent.messageId && m.text === "Hello fixture",
    ),
  ).toBe(true);
  const chat = client.state.chats.find((item) => item.chat.id === chatId);
  if (!chat) throw new Error("Missing chat");
  chat.messages.push({
    id: "test-card",
    seq: 10,
    at: "2026-11-20T03:00:00.000Z",
    role: "flowdriven",
    kind: "card",
    outside: false,
    card: { type: "ask_run", state: "open", flowId: f.summary.id, name: f.summary.name, values: [] },
  });
  await check("chats.act", { chatId, messageId: "test-card", action: "not_now" });
  await check("flows.confirm", { flowId: f.summary.id, hash: f.hash, onItsOwn: [] });
  await check("flows.start", { flowId: f.summary.id, source: "flows" });
  await check("flows.setSchedule", {
    flowId: f.summary.id,
    hash: f.hash,
    schedule: { type: "weekly", day: "mon", time: "17:00", whenItsTime: "ask" },
  });
  await check("flows.tryNextRun", { flowId: f.summary.id });
  const decisions = await check("approvals.list", {});
  const decision = decisions[0];
  if (!decision || !decision.runId) throw new Error("Missing decision");
  const originals = client.state.decisions;
  originals.push(
    {
      ...decision,
      id: "batch-1",
      effect: "send",
      riskyAction: "send",
      canAlwaysAllow: false,
      similarGroup: "batch",
    },
    {
      ...decision,
      id: "batch-2",
      effect: "send",
      riskyAction: "send",
      canAlwaysAllow: false,
      similarGroup: "batch",
    },
  );
  await check("approvals.resolveSimilar", {
    runId: decision.runId,
    group: "batch",
    approvalIds: ["batch-1", "batch-2"],
  });
  const rules = await check("rules.list", {});
  await check("activity.summary", {});
  await check("search.query", { text: "" });
  await check("search.query", { text: "invoice" });
  const skills = await check("skills.list", {});
  const skill = skills[0];
  const rule = rules[0];
  if (!skill || !rule) throw new Error("Missing skill or rule");
  await check("skills.makeFlow", { skillId: skill.id });
  const runs = await check("runs.list", {});
  const firstRun = runs[0];
  if (!firstRun) throw new Error("Missing run");
  await check("runs.stop", { runId: firstRun.id });
  await check("rules.revoke", { ruleId: rule.id });
  expect((await check("rules.list", {})).map((rule) => rule.id)).not.toContain(rule.id);
  await check("chats.delete", { chatId });
  const deletable = flows.find(
    (item) => !runs.some((r) => r.flowId === item.id && ["running", "waiting_approval"].includes(r.state)),
  );
  if (!deletable) throw new Error("Missing deletable flow");
  await check("flows.delete", { flowId: deletable.id });
  expect(client.calls).toEqual(expectedCalls);
});

test("TC-CON-43 card actions check the card and permission before answering", async () => {
  const client = createFixtureRunnerClient();
  const chat = client.state.chats[0];
  if (!chat) throw new Error("Missing chat");
  chat.messages.push({
    id: "card-test",
    seq: 2,
    at: "2026-11-20T03:00:00.000Z",
    role: "flowdriven",
    kind: "card",
    outside: false,
    card: { type: "ask_run", state: "open", flowId: "example.build-apk", name: "Build APK", values: [] },
  });
  const input = { chatId: chat.chat.id, messageId: "card-test" };
  await expect(client.call("chats.act", { ...input, action: "use_form" })).rejects.toMatchObject({
    code: "invalid_input",
    reason: "unknown_action",
  });
  client.state.settings.agentPermission = "off";
  await expect(client.call("chats.act", { ...input, action: "run" })).rejects.toMatchObject({
    code: "not_allowed",
    reason: "permission_off",
  });
  expect(chat.messages[2]?.card?.state).toBe("open");
  await client.call("chats.act", { ...input, action: "not_now" });
  await expect(client.call("chats.act", { ...input, action: "not_now" })).rejects.toMatchObject({
    code: "conflict",
    reason: "card_answered",
  });
});

test("TC-CON-43 a start needing inputs posts and reuses its question", async () => {
  const client = createFixtureRunnerClient();
  const input = { flowId: "example.fill-timesheet", source: "flows" } as const;
  const first = await client.call("flows.start", input);
  const second = await client.call("flows.start", input);
  expect(first.outcome).toBe("asked");
  if (first.outcome !== "asked" || second.outcome !== "asked") throw new Error("Missing question");
  expect(second).toMatchObject({ chatId: first.chatId, questionId: first.questionId, reused: true });
  const chat = await client.call("chats.get", { chatId: first.chatId });
  expect(chat.messages.some((m) => m.id === first.questionId && m.card?.type === "inputs_ask")).toBe(true);
});

test("TC-CON-42 decisions resume only waiting runs with permission on", async () => {
  for (const method of ["resolve", "answer"] as const) {
    for (const [runState, permission, expected] of [
      ["waiting_approval", "on", "running"],
      ["waiting_approval", "off", "waiting_approval"],
      ["needs_login", "on", "needs_login"],
      ["stopped", "on", "stopped"],
    ] as const) {
      const client = createFixtureRunnerClient();
      const decision = client.state.decisions[0];
      const run = client.state.runs.find((item) => item.id === decision?.runId);
      if (!decision || !run) throw new Error("Missing sample decision or run");
      run.state = runState;
      client.state.settings.agentPermission = permission;
      if (method === "answer") {
        decision.kind = "ask";
        decision.canAlwaysAllow = false;
        decision.payload = {
          kind: "choice",
          question: "Choose",
          options: [{ key: "one", label: "One" }],
          maxPick: 1,
          approves: [],
        };
        await client.call("approvals.answer", { approvalId: decision.id, picks: ["one"] });
      } else {
        await client.call("approvals.resolve", { approvalId: decision.id, decision: "approve" });
      }
      expect(run.state, `${method} ${runState} ${permission}`).toBe(expected);
    }
  }
});

test("TC-CON-42 permission off stops needs_login runs and expires their decisions", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  const run = client.state.runs.find((item) => item.id === decision?.runId);
  if (!decision || !run) throw new Error("Missing sample decision or run");
  run.state = "needs_login";
  await client.call("settings.update", { patch: { agentPermission: "off" } });
  expect(run.state).toBe("stopped");
  expect(decision).toMatchObject({ state: "expired", resolvedVia: "permission_off", canAlwaysAllow: false });
});

test("TC-CON-42 edited subjects reject bidi and zero-width characters", async () => {
  for (const code of [0x202e, 0x200b]) {
    const client = createFixtureRunnerClient();
    const decision = client.state.decisions[0];
    if (!decision) throw new Error("Missing sample decision");
    decision.editable = true;
    decision.payload = { kind: "text", text: "Original" };
    await expect(
      client.call("approvals.resolve", {
        approvalId: decision.id,
        decision: "edit",
        editedText: "Safe",
        editedSubject: `Subject${String.fromCodePoint(code)}`,
      }),
    ).rejects.toMatchObject({ code: "invalid_input", reason: "hidden_characters" });
    expect(decision.state).toBe("pending");
  }
});

test("TC-CON-42 always allow uses the held touch and its sentence", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  if (!decision) throw new Error("Missing sample decision");
  decision.stepId = "different-step";
  decision.stepTitle = "Different title";
  client.state.rules.length = 0;
  const result = await client.call("approvals.resolve", {
    approvalId: decision.id,
    decision: "always_allow",
  });
  expect(client.state.rules.find((rule) => rule.id === result.ruleId)).toMatchObject({
    touchId: "log-hours",
    sentence: "Log hours",
  });
});

test("TC-CON-42 rule ids never repeat after revocation", async () => {
  const client = createFixtureRunnerClient();
  const decision = client.state.decisions[0];
  if (!decision) throw new Error("Missing sample decision");
  client.state.rules.length = 0;
  const first = await client.call("approvals.resolve", { approvalId: decision.id, decision: "always_allow" });
  if (!first.ruleId) throw new Error("Missing rule");
  await client.call("rules.revoke", { ruleId: first.ruleId });
  decision.state = "pending";
  decision.canAlwaysAllow = true;
  const second = await client.call("approvals.resolve", {
    approvalId: decision.id,
    decision: "always_allow",
  });
  expect(first.ruleId).toMatch(/^rule-fixture-\d+$/);
  expect(second.ruleId).not.toBe(first.ruleId);
});

test("TC-CON-44 fixture decisions wait beyond 25 hours and can be answered", async () => {
  const client = createFixtureRunnerClient({ now: () => new Date("2026-11-22T04:00:00.000Z") });
  const decisions = await client.call("approvals.list", {});
  expect(decisions.length).toBeGreaterThan(0);
  expect(decisions.every((decision) => !("expiresAt" in decision))).toBe(true);
  const decision = decisions.find((item) => item.id === "decision-1");
  expect(decision?.state).toBe("pending");
  expect((await client.call("runs.status", { runId: "run-timesheet-wait" })).state).toBe("waiting_approval");
  expect(
    (await client.call("approvals.resolve", { approvalId: "decision-1", decision: "approve" })).decision
      .state,
  ).toBe("approved");
});
