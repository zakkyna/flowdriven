import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
  isRunnerError,
  type OperationOutput,
  operations,
  RUNNER_ERROR_CODES,
  RUNNER_MODES,
  type RunDetail,
  RunnerError,
} from "./index";

test("version 1 has exactly these operations", () => {
  expect(Object.keys(operations).sort()).toEqual([
    "approvals.answer",
    "approvals.list",
    "approvals.resolve",
    "audit.list",
    "flows.build",
    "flows.get",
    "flows.import",
    "flows.list",
    "flows.run",
    "flows.update",
    "harnesses.list",
    "harnesses.rescan",
    "harnesses.setConsent",
    "readiness.check",
    "readiness.install",
    "runner.info",
    "runs.export",
    "runs.list",
    "runs.report",
    "runs.resume",
    "runs.status",
    "settings.get",
    "settings.update",
  ]);
});
test("only the operations in spec 8.7 are exposed over MCP, and the approval rule travels with the contract", () => {
  const mcp = Object.entries(operations)
    .filter(([, d]) => d.mcp !== "no")
    .map(([n]) => n)
    .sort();
  expect(mcp).toEqual([
    "approvals.answer",
    "approvals.list",
    "approvals.resolve",
    "flows.build",
    "flows.get",
    "flows.list",
    "flows.run",
    "readiness.check",
    "runs.report",
    "runs.status",
  ]);
  expect(
    Object.entries(operations)
      .filter(([, d]) => d.mcp === "restricted")
      .map(([n]) => n),
  ).toEqual(["approvals.resolve", "approvals.answer"]);
  expect(operations["approvals.resolve"].mcpRule).toBe(
    "Over MCP, risky actions only open the item in the app; only flow and result sign-offs resolve; applyToSimilar is refused.",
  );
});
test("every operation has schemas, known error codes and topics", () => {
  for (const def of Object.values(operations)) {
    expect(def.input).toBeInstanceOf(z.ZodType);
    expect(def.output).toBeInstanceOf(z.ZodType);
    expect(def.errors).toContain("invalid_input");
    for (const code of def.errors) expect(RUNNER_ERROR_CODES).toContain(code);
    expect(def.reads.length + def.writes.length).toBeGreaterThan(0);
  }
});
test("runner errors carry a code", () => {
  const e = new RunnerError("not_found", "There is no run run-9999.");
  expect(isRunnerError(e)).toBe(true);
  expect(e.code).toBe("not_found");
  expect(isRunnerError(new Error("x"))).toBe(false);
});
test("output types are inferred from the schemas", () => {
  expectTypeOf<OperationOutput<"runs.status">>().toEqualTypeOf<RunDetail>();
});

test("approvals.answer is restricted over MCP and its rule travels with the contract", () => {
  expect(operations["approvals.answer"].mcp).toBe("restricted");
  expect(operations["approvals.answer"].mcpRule).toBe(
    "Over MCP, an answer only opens the item in the app; picks are never sent over MCP.",
  );
});
test("operations the runner may refuse as not built list unavailable", () => {
  for (const name of [
    "flows.build",
    "flows.update",
    "readiness.install",
    "harnesses.rescan",
    "harnesses.setConsent",
    "settings.update",
  ] as const) {
    expect(operations[name].errors).toContain("unavailable");
  }
});
test("flows.run takes params next to inputs", () => {
  expect(
    operations["flows.run"].input.safeParse({
      flowId: "flow",
      inputs: { x: "y" },
      params: { min_score: 8, fast: true, who: "Ana" },
    }).success,
  ).toBe(true);
  expect(operations["flows.run"].input.safeParse({ flowId: "flow", params: { x: [1] } }).success).toBe(false);
});
test("runner.info names the contract version and one of three modes", () => {
  expect(operations["runner.info"].output.safeParse({ contractVersion: 1, mode: "demo" }).success).toBe(true);
  expect(operations["runner.info"].output.safeParse({ contractVersion: 1, mode: "other" }).success).toBe(
    false,
  );
  expect(RUNNER_MODES).toEqual(["sample", "demo", "live"]);
});
