import { expect, test } from "vitest";
import { CHAT_INTENTS } from "./chat.ts";
import { operations } from "./operations.ts";

test("TC-j12-34 settings cannot be changed by the assistant or MCP", () => {
  expect(operations["settings.update"].mcp).toBe("no");
  for (const [name, operation] of Object.entries(operations)) {
    if (name.startsWith("settings.")) expect(operation.mcp).not.toBe("yes");
  }
  expect(CHAT_INTENTS).toEqual([
    "answer",
    "run",
    "run_together",
    "run_chain",
    "stop",
    "status",
    "schedule",
    "unschedule",
    "make_flow",
    "make_flow_from_skill",
    "improve_flow",
    "fill_inputs",
  ]);
  for (const intent of ["settings_update", "set_permission", "set_limit", "set_main_agent"]) {
    expect(CHAT_INTENTS).not.toContain(intent);
  }
});

test("TC-j21-32 and TC-j28-43 no duplicate, next or first run", () => {
  expect(Object.keys(operations)).not.toContain("flows.duplicate");
  expect(Object.keys(operations)).not.toContain("starts.next");
  expect(Object.values(operations).filter((v) => !("retired" in v && v.retired))).toHaveLength(45);
  const op = operations["flows.tryNextRun"];
  expect(op.input.safeParse({ flowId: "example.flow" }).success).toBe(true);
  for (const extra of [{ missedStartId: "x" }, { ranLate: true }])
    expect(op.input.safeParse({ flowId: "example.flow", ...extra }).success).toBe(false);
});

test("TC-j21-32 and TC-j28-43 schedule and run schemas omit first-run fields", async () => {
  const { ScheduleView, RunSummary, RunDetail } = await import("./index.ts");
  const schedule = { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false };
  const hash = `sha256:${"a".repeat(64)}`;
  const input = { flowId: "flow", hash, schedule: { type: "manual" } };
  expect(operations["flows.setSchedule"].input.safeParse(input).success).toBe(true);
  expect(operations["flows.setSchedule"].input.safeParse({ ...input, firstRun: true }).success).toBe(false);
  expect(operations["flows.setSchedule"].output.safeParse({ schedule }).success).toBe(true);
  expect(operations["flows.setSchedule"].output.safeParse({ schedule, firstRun: true }).success).toBe(false);
  expect(ScheduleView.safeParse({ ...schedule, firstRunNote: "x" }).success).toBe(false);
  const run = {
    id: "run",
    flowId: "flow",
    flowName: "Flow",
    flowVersion: "1.0.0",
    flowHash: hash,
    source: "flows",
    agent: "codex",
    versionChanged: false,
    oneTime: false,
    project: "project",
    state: "done",
    startedAt: "2026-11-21T00:00:00Z",
  };
  expect(RunSummary.safeParse(run).success).toBe(true);
  expect(RunSummary.safeParse({ ...run, firstScheduledRun: true }).success).toBe(false);
  const detail = {
    ...run,
    inputs: [],
    steps: [],
    approvalIds: [],
    outputs: [],
    usage: [],
    estimatedCostUsd: 0,
    decisionLines: [],
    costLine: { kind: "none" },
    canRunAgain: true,
    canTryAgain: false,
  };
  expect(RunDetail.safeParse(detail).success).toBe(true);
  expect(RunDetail.safeParse({ ...detail, firstScheduledRun: true }).success).toBe(false);
});
