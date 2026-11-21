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

test("TC-CON-42 expiry, refusal and unfinished operations", async () => {
  const expired = createFixtureRunnerClient({ now: () => new Date("2026-11-21T03:00:00.000Z") });
  await expect(
    expired.call("approvals.resolve", { approvalId: "decision-1", decision: "approve" }),
  ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
  const client = createFixtureRunnerClient();
  await expect(client.call("runs.resume", { runId: "run-apk-stopped" })).rejects.toMatchObject({
    code: "not_allowed",
    reason: "not_resumable",
  });
  await expect(client.call("agents.list", {})).rejects.toMatchObject({ code: "unavailable" });
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
