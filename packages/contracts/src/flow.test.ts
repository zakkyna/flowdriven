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
      "number",
      "bool",
      "enum",
      "date",
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
