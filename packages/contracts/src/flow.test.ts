import { describe, expect, test } from "vitest";
import {
  Check,
  CheckType,
  ContentHash,
  FlowManifest,
  InputType,
  isJudgedOnly,
  LoopDecl,
  RequirementType,
  Step,
  StepDo,
} from "./index";

const step = {
  id: "read-design",
  title: "Read the design",
  do: "worker",
  instructions: "x",
  checks: [{ type: "files", summary: "design/screens.json exists" }],
};

describe("flow read model", () => {
  test("uses the spec's check, input and requirement words", () => {
    expect(CheckType.options).toEqual([
      "command",
      "files",
      "schema",
      "contains",
      "not_contains",
      "judge",
      "user",
      "probe",
    ]);
    expect(InputType.options).toEqual([
      "text",
      "longtext",
      "number",
      "bool",
      "date",
      "time",
      "duration",
      "choice",
      "url",
      "file",
      "folder",
      "secret_ref",
      "list<text>",
    ]);
    expect(RequirementType.options).toEqual([
      "harness",
      "skill",
      "plugin",
      "mcp_server",
      "cli_tool",
      "gui_app",
      "account",
      "browser_session",
      "path",
      "web",
      "desktop",
      "trigger",
    ]);
  });
  test("a step needs at least one check and defaults to 2 retries", () => {
    expect(Step.safeParse({ ...step, checks: [] }).success).toBe(false);
    const parsed = Step.parse(step);
    expect(parsed.retry).toBe(2);
    expect(parsed.checks[0]?.required).toBe(true);
  });
  test("content hash is sha256 with 64 hex digits", () => {
    expect(ContentHash.safeParse(`sha256:${"a1".repeat(32)}`).success).toBe(true);
    expect(ContentHash.safeParse("sha256:abc").success).toBe(false);
  });
  test("manifest format is flowdriven-flow/1", () => {
    const m = {
      format: "flowdriven-flow/2",
      id: "dev.example.x",
      name: "X",
      summary: "s",
      description: "d",
      version: "1.0.0",
      license: "MIT",
      kind: "build",
      inputs: [],
      outputs: [],
      requirements: [],
      defaults: {},
      steps: [step],
    };
    expect(FlowManifest.safeParse(m).success).toBe(false);
    expect(FlowManifest.safeParse({ ...m, format: "flowdriven-flow/1" }).success).toBe(true);
    expect(FlowManifest.safeParse({ ...m, format: "flowdriven-flow/1.2" }).success).toBe(true);
  });
  test("judged only means every required check is a judge check", () => {
    const judge = { type: "judge", required: true, summary: "r" } as const;
    expect(isJudgedOnly([judge])).toBe(true);
    expect(isJudgedOnly([judge, { type: "files", required: false, summary: "f" }])).toBe(true);
    expect(isJudgedOnly([judge, { type: "files", required: true, summary: "f" }])).toBe(false);
    expect(isJudgedOnly([])).toBe(false);
  });
});

test("format 1.1 adds ask, skill, flow and loop to the step words", () => {
  expect(StepDo.options).toEqual(["worker", "agent", "builtin", "skill", "flow", "ask", "loop"]);
});
test("an ask or loop step needs its object and no check, and no other step may carry one", () => {
  const ask = {
    question: "Choose",
    choose_from: "jobs",
    max_pick: 1,
    approves: [],
    expires: "1d",
    on_expiry: "end",
  };
  const loop = { for_each: "jobs", as: "job", on_item_fail: "skip", steps: [step] };
  expect(Step.safeParse({ ...step, do: "ask", ask, checks: [] }).success).toBe(true);
  expect(Step.safeParse({ ...step, do: "loop", loop, checks: [] }).success).toBe(true);
  expect(Step.safeParse({ ...step, do: "ask", checks: [] }).success).toBe(false);
  expect(Step.safeParse({ ...step, do: "loop", checks: [] }).success).toBe(false);
  expect(Step.safeParse({ ...step, loop }).success).toBe(false);
  expect(Step.safeParse({ ...step, ask }).success).toBe(false);
  expect(Step.safeParse({ ...step, checks: [] }).success).toBe(false);
});
test("a step nested in a loop still needs its check", () => {
  const loop = { for_each: "jobs", as: "job", on_item_fail: "skip" };
  expect(LoopDecl.safeParse({ ...loop, steps: [{ ...step, checks: [] }] }).success).toBe(false);
  expect(LoopDecl.safeParse({ ...loop, steps: [] }).success).toBe(false);
});
test("the manifest carries triggers, params and limits as optional read models and accepts format 1 and 1.1", () => {
  const manifest = {
    format: "flowdriven-flow/1",
    id: "dev.example.x",
    name: "X",
    summary: "s",
    description: "d",
    version: "1.0.0",
    license: "MIT",
    kind: "build",
    inputs: [],
    outputs: [],
    requirements: [],
    defaults: {},
    steps: [step],
  };
  expect(FlowManifest.safeParse(manifest).success).toBe(true);
  const additions = {
    triggers: [{ kind: "manual", summary: "Run by hand" }],
    params: { min_score: { type: "number", default: 7 } },
    limits: { max_items: 20 },
  };
  expect(FlowManifest.parse({ ...manifest, ...additions, format: "flowdriven-flow/1.1" })).toMatchObject(
    additions,
  );
  expect(FlowManifest.safeParse({ ...manifest, format: "flowdriven-flow/2" }).success).toBe(false);
});
test("a command check keeps its program and arguments", () => {
  expect(Check.parse({ type: "command", summary: "s", cmd: "pnpm", args: ["test"] })).toMatchObject({
    cmd: "pnpm",
    args: ["test"],
  });
});

test("TC-CON-14 schedules", async () => {
  const c = await import("./flow.ts");
  for (const value of [
    { type: "manual" },
    { type: "daily", time: "00:00" },
    { type: "weekdays", time: "17:00", whenItsTime: "ask" },
    { type: "weekly", day: "mon", time: "08:00", whenItsTime: "last" },
    { type: "after", afterFlowId: "example.build-apk" },
  ])
    expect(c.ScheduleSpec.safeParse(value).success).toBe(true);
  for (const time of ["24:00", "25:00", "7:5", "17:60", "5pm"])
    expect(c.ScheduleSpec.safeParse({ type: "daily", time }).success).toBe(false);
  for (const value of [
    { type: "weekly", time: "08:00" },
    { type: "weekly", day: "monday", time: "08:00" },
    { type: "after" },
    { type: "manual", time: "00:00" },
    { type: "daily" },
    { type: "manual", extra: true },
  ])
    expect(c.ScheduleSpec.safeParse(value).success).toBe(false);
  const view = { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false };
  expect(c.ScheduleView.safeParse(view).success).toBe(true);
  for (const bad of [
    { ...view, nextAt: "wrong" },
    { ...view, firstRunNote: "x" },
    { ...view, whenItsTime: undefined },
    { ...view, needsAnswers: undefined },
    { ...view, canUseLast: undefined },
  ])
    expect(c.ScheduleView.safeParse(bad).success).toBe(false);
  expect(
    c.FlowsSetScheduleInput.safeParse({
      flowId: "f",
      hash: `sha256:${"a".repeat(64)}`,
      schedule: { type: "manual" },
      firstRun: true,
    }).success,
  ).toBe(false);
});
test("TC-CON-16 confirm input limits", async () => {
  const c = await import("./flow.ts");
  const input = {
    flowId: "example.fill-timesheet",
    hash: `sha256:${"a".repeat(64)}`,
    onItsOwn: ["log-hours"],
  };
  expect(c.FlowsConfirmInput.safeParse(input).success).toBe(true);
  const ids = Array.from({ length: 100 }, (_, i) => `touch-${i}`);
  expect(c.FlowsConfirmInput.safeParse({ ...input, onItsOwn: ids }).success).toBe(true);
  const pins = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`id${i}`, "x".repeat(600)]));
  expect(c.FlowsConfirmInput.safeParse({ ...input, pins }).success).toBe(true);
  for (const bad of [
    { ...input, onItsOwn: ["log-hours", "log-hours"] },
    { ...input, onItsOwn: [...ids, "extra"] },
    { ...input, pins: { ...pins, extra: "x" } },
    { ...input, pins: { id: "x".repeat(601) } },
    { ...input, pins: { ["x".repeat(101)]: "x" } },
    { ...input, hash: "sha256:abc" },
    { ...input, onItsOwn: undefined },
    { ...input, extra: true },
  ])
    expect(c.FlowsConfirmInput.safeParse(bad).success).toBe(false);
});
test("TC-CON-23 flow read models", async () => {
  const c = await import("./flow.ts");
  const summary = {
    id: "example.fill-timesheet",
    name: "Fill timesheet",
    summary: "s",
    state: "confirmed",
    live: null,
    steps: [],
    schedule: { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false },
    result: "chat",
    asksFor: [],
    format: "flowdriven-flow/1.2",
    createdAt: "2026-11-12T00:00:00Z",
  };
  expect(c.FlowSummary.safeParse(summary).success).toBe(true);
  expect(c.FlowSummary.safeParse({ ...summary, format: "flowdriven-flow/1.0" }).success).toBe(false);
  expect(
    c.FlowSummary.safeParse({ ...summary, steps: Array(51).fill({ id: "x", title: "x" }) }).success,
  ).toBe(false);
  for (const key of ["signOff", "saved", "stepCount", "playback", "conversation", "stepStatus", "canUndo"])
    expect(c.FlowSummary.safeParse({ ...summary, [key]: true }).success).toBe(false);
  const touch = {
    id: "log-hours",
    sentence: "Log hours",
    effect: "change",
    fixedPlace: true,
    alwaysAsks: false,
    declared: "asks_first",
    list: "on_its_own",
    byRule: "rule-000000000001",
  };
  expect(c.TouchView.safeParse(touch).success).toBe(true);
  const input = { id: "duration", label: "Duration", type: "duration", required: true, remember: false };
  for (const line of ["remembers", "default", "asks", "optional"])
    expect(c.InputView.safeParse({ ...input, line }).success).toBe(true);
  expect(c.InputView.safeParse({ ...input, line: "ask" }).success).toBe(false);
});

test("TC-CON-23 detail and manifest preserve version 2 fields", async () => {
  const c = await import("./flow.ts");
  const at = "2026-11-12T00:00:00Z";
  const hash = `sha256:${"a".repeat(64)}`;
  const schedule = { type: "manual", whenItsTime: "ask", needsAnswers: false, canUseLast: false };
  const summary = {
    id: "example.fill-timesheet",
    name: "Fill timesheet",
    summary: "s",
    state: "confirmed",
    live: null,
    steps: [],
    schedule,
    result: "chat",
    asksFor: [],
    format: "flowdriven-flow/1.2",
    createdAt: at,
  };
  const touch = {
    id: "log-hours",
    sentence: "Log hours",
    effect: "change",
    fixedPlace: true,
    alwaysAsks: false,
    declared: "asks_first",
    list: "on_its_own",
    byRule: "rule-000000000001",
  };
  const place = { kind: "account", value: "timesheet-account", label: "Timesheet account" };
  const manifest = {
    format: "flowdriven-flow/1.2",
    id: "example.fill-timesheet",
    name: "Fill timesheet",
    summary: "s",
    description: "d",
    version: "1.0.0",
    license: "MIT",
    kind: "light",
    inputs: [
      { id: "date", type: "date", label: "Date", default: "today", example: "Today" },
      { id: "activity", type: "choice", label: "Activity", choices: [{ key: "meeting", label: "Meeting" }] },
    ],
    outputs: [],
    requirements: [],
    defaults: {},
    steps: [step],
    result: { kind: "chat", answer: { en: ["Done"] } },
    touches: [
      {
        id: "log-hours",
        sentence: "Log hours",
        effect: "change",
        place,
        rule: "asks_first",
        covers: ["log"],
      },
    ],
    schedule: { type: "daily", time: "17:00" },
  };
  expect(c.FlowManifest.parse(manifest)).toMatchObject({
    inputs: manifest.inputs,
    result: manifest.result,
    touches: manifest.touches,
    schedule: manifest.schedule,
  });
  const lists = { onItsOwn: ["log-hours"], asksFirst: [], never: [] };
  const detail = {
    summary,
    description: "d",
    hash,
    version: "1.0.0",
    steps: [],
    inputs: [],
    result: { kind: "chat" },
    touches: [touch],
    lists,
    confirmLists: lists,
    rules: [
      {
        id: "rule-000000000001",
        flowId: summary.id,
        touchId: "log-hours",
        sentence: "Log hours",
        effect: "change",
        place,
        createdAt: at,
        createdBy: "confirm",
      },
    ],
    pinsNeeded: [],
    recentRuns: [],
    manifest,
  };
  expect(c.FlowDetail.safeParse(detail).success).toBe(true);
  for (const key of ["signOff", "saved", "stepCount", "playback", "conversation", "stepStatus", "canUndo"])
    expect(c.FlowDetail.safeParse({ ...detail, [key]: true }).success).toBe(false);
});
