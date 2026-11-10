import { describe, expect, test } from "vitest";
import {
  CheckType,
  ContentHash,
  FlowManifest,
  InputType,
  isJudgedOnly,
  RequirementType,
  Step,
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
