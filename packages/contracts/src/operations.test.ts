import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";
import {
  isRunnerError,
  type OperationOutput,
  operationNames,
  operations,
  REASON_CODE,
  RUNNER_ERROR_CODES,
  RUNNER_MODES,
  type RunDetail,
  RunnerError,
} from "./index.ts";
import { operations as v1 } from "./v1/operations.ts";

const live =
  "activity.summary agents.list agents.models agents.rescan agents.setUp agents.signIn approvals.answer approvals.list approvals.resolve approvals.resolveSimilar audit.list chats.act chats.create chats.delete chats.get chats.list chats.send chats.setAgent chats.setComposer flows.confirm flows.delete flows.get flows.import flows.list flows.setSchedule flows.start flows.tryNextRun readiness.check readiness.install rules.list rules.revoke runner.info runs.export runs.list runs.report runs.resume runs.status runs.stop search.query settings.get settings.update skills.list skills.makeFlow triggers.list triggers.setEnabled".split(
    " ",
  );
const retired =
  "flows.build flows.update flows.run flows.capabilities flows.allowCapabilities flows.withdrawCapabilities harnesses.list harnesses.rescan harnesses.setConsent queue.list queue.move usage.summary".split(
    " ",
  );
const persons =
  "agents.setUp settings.update chats.act flows.confirm flows.setSchedule flows.delete approvals.resolve approvals.answer approvals.resolveSimilar rules.revoke triggers.setEnabled"
    .split(" ")
    .sort();
const entries = () => Object.entries(operations);

test("TC-CON-02 active and retired operation names", () => {
  expect(
    entries()
      .filter(([, d]) => !("retired" in d && d.retired))
      .map(([n]) => n)
      .sort(),
  ).toEqual(live);
  expect([...operationNames].sort()).toEqual(live);
  expect(entries()).toHaveLength(57);
});
test("TC-CON-03 retired operations keep version 1 schemas", () => {
  expect(
    entries()
      .filter(([, d]) => "retired" in d && d.retired)
      .map(([n]) => n)
      .sort(),
  ).toEqual(retired.toSorted());
  for (const name of retired as (keyof typeof v1)[]) {
    const d = operations[name];
    expect(d).toMatchObject({
      retired: true,
      mcp: "no",
      phone: "no",
      personOnly: false,
      errors: ["unavailable"],
      reasons: ["retired"],
      reads: [],
      writes: [],
    });
    expect(d.input).toBe(v1[name].input);
    expect(d.output).toBe(v1[name].output);
  }
  for (const [name] of entries()) expect(name).toMatch(/^[a-z]+\.[A-Za-z]+$/);
});
test("TC-SR2-01 and TC-CON-04 person-only operations", () => {
  expect(
    entries()
      .filter(([, d]) => d.personOnly)
      .map(([n]) => n)
      .sort(),
  ).toEqual(persons);
  for (const [, d] of entries().filter(([, d]) => d.personOnly)) {
    expect(d.mcp).toBe("no");
    expect(["no", "restricted"]).toContain(d.phone);
  }
});
test("TC-j24-38 TC-j26-04 TC-CON-05 TC-CON-06 MCP and phone exposure", () => {
  expect(
    entries()
      .filter(([, d]) => d.mcp === "yes")
      .map(([n]) => n),
  ).toEqual(["flows.list"]);
  expect(
    entries()
      .filter(([, d]) => d.mcp === "restricted")
      .map(([n]) => n)
      .sort(),
  ).toEqual(["approvals.list", "flows.get", "flows.start", "runs.status"]);
  expect(
    entries()
      .filter(([, d]) => d.phone === "yes")
      .map(([n]) => n)
      .sort(),
  ).toEqual(["flows.list", "runs.stop"]);
  expect(
    entries()
      .filter(([, d]) => d.phone === "restricted")
      .map(([n]) => n)
      .sort(),
  ).toEqual([
    "activity.summary",
    "approvals.answer",
    "approvals.list",
    "approvals.resolve",
    "flows.start",
    "runs.status",
  ]);
  for (const [, d] of entries()) {
    if (d.mcp === "restricted") expect(d.mcpRule.length).toBeGreaterThan(0);
    if (d.phone === "restricted") expect(d.phoneRule.length).toBeGreaterThan(0);
  }
  expect(operations["approvals.list"].mcpRule).toMatch(/flow id.*step id.*state/i);
});
test("TC-CON-07 reads and writes topics", () => {
  expect(operations["chats.act"].writes).toEqual([
    "chats",
    "flows",
    "rules",
    "runs",
    "approvals",
    "activity",
  ]);
  expect(operations["chats.get"].reads).toEqual(["chats", "runs", "approvals", "flows", "agents"]);
  expect(operations["chats.setComposer"].writes).toEqual([]);
  expect(operations["settings.update"].writes).toEqual([
    "settings",
    "agents",
    "runs",
    "approvals",
    "activity",
  ]);
  expect(operations["flows.confirm"].writes).toEqual(["flows", "rules", "chats", "activity"]);
  expect(operations["flows.delete"].writes).toEqual([
    "flows",
    "rules",
    "runs",
    "approvals",
    "chats",
    "activity",
    "skills",
  ]);
  expect(operations["runs.stop"].writes).toEqual(["runs", "approvals", "chats", "activity"]);
  expect(operations["rules.revoke"].writes).toEqual(["rules", "flows"]);
  expect(operations["search.query"].reads).toEqual(["chats", "flows"]);
  expect(operations["activity.summary"].reads).toEqual(["runs", "approvals", "activity", "chats", "flows"]);
  for (const [, d] of entries())
    for (const topic of [...d.reads, ...d.writes])
      expect([
        "flows",
        "runs",
        "approvals",
        "readiness",
        "settings",
        "chats",
        "rules",
        "activity",
        "agents",
        "skills",
      ]).toContain(topic);
});
test("TC-CON-08 errors and reasons", () => {
  for (const [, d] of entries())
    for (const reason of d.reasons) expect(d.errors).toContain(REASON_CODE[reason]);
  expect(REASON_CODE).toMatchObject({
    card_answered: "conflict",
    permission_off: "not_allowed",
    retired: "unavailable",
    always_asks: "not_allowed",
  });
  for (const name of ["flows.confirm", "chats.act", "approvals.resolve"] as const)
    expect(operations[name].reasons).toContain("always_asks");
  expect(operations["agents.setUp"].reasons).toEqual(
    expect.arrayContaining(["setup_running", "install_unavailable"]),
  );
});
test("TC-CON-09 all active inputs reject extra keys", () => {
  const inputs: Record<string, object> = {
    "agents.setUp": { agentId: "codex" },
    "agents.signIn": { agentId: "codex" },
    "agents.models": { agentId: "codex" },
    "chats.get": { chatId: "chat" },
    "chats.send": { chatId: "chat", text: "hello" },
    "chats.act": { chatId: "chat", messageId: "message", action: "use_form" },
    "chats.setAgent": { chatId: "chat", agent: "codex", model: "gpt" },
    "chats.setComposer": { chatId: "chat", text: "" },
    "chats.delete": { chatId: "chat" },
    "flows.get": { flowId: "example.flow" },
    "flows.import": { path: "/tmp/flow" },
    "flows.start": { flowId: "example.flow", source: "flows" },
    "flows.confirm": { flowId: "example.flow", hash: `sha256:${"a".repeat(64)}`, onItsOwn: [] },
    "flows.setSchedule": {
      flowId: "example.flow",
      hash: `sha256:${"a".repeat(64)}`,
      schedule: { type: "manual" },
    },
    "flows.tryNextRun": { flowId: "example.flow" },
    "flows.delete": { flowId: "example.flow" },
    "runs.status": { runId: "run" },
    "runs.report": { runId: "run" },
    "runs.export": { runId: "run" },
    "runs.resume": { runId: "run" },
    "runs.stop": { runId: "run" },
    "approvals.resolve": { approvalId: "approval", decision: "approve" },
    "approvals.answer": { approvalId: "approval", picks: [] },
    "approvals.resolveSimilar": { runId: "run", group: "group", approvalIds: ["a", "b"] },
    "rules.revoke": { ruleId: "rule" },
    "search.query": { text: "" },
    "skills.makeFlow": { skillId: "skill" },
    "readiness.check": { flowId: "example.flow" },
    "readiness.install": { flowId: "example.flow", requirementId: "requirement" },
    "triggers.list": { flowId: "example.flow" },
    "triggers.setEnabled": {
      flowId: "example.flow",
      index: 0,
      enabled: true,
      hash: `sha256:${"a".repeat(64)}`,
    },
    "settings.update": { patch: { agentPermission: "on" } },
  };
  for (const name of live) {
    const d = operations[name as keyof typeof operations];
    const value = inputs[name] ?? {};
    expect(d.input.safeParse(value).success, name).toBe(true);
    const invalid = d.input.safeParse({ ...value, extra: 1 });
    expect(invalid.success, name).toBe(false);
    if (!invalid.success)
      expect(
        invalid.error.issues.some((issue) => issue.code === "unrecognized_keys"),
        name,
      ).toBe(true);
  }
});
test("TC-CON-36 paging limits", () => {
  for (const [input, ok] of [
    [{ limit: 200 }, true],
    [{ limit: 201 }, false],
    [{ limit: 0 }, false],
    [{ before: "bad" }, false],
    [{ source: "voice" }, false],
    [{ source: "schedule", state: "stopped" }, true],
  ] as const)
    expect(operations["runs.list"].input.safeParse(input).success).toBe(ok);
  expect(operations["activity.summary"].input.safeParse({ filter: "problems" }).success).toBe(true);
  expect(operations["activity.summary"].input.safeParse({ filter: "errors" }).success).toBe(false);
  for (const limit of [500, 501]) {
    expect(operations["audit.list"].input.safeParse({ limit }).success).toBe(limit === 500);
    expect(operations["chats.get"].input.safeParse({ chatId: "chat", before: 0, limit }).success).toBe(
      limit === 500,
    );
  }
});
test("operation schemas, error types and runner modes", () => {
  for (const [, d] of entries()) {
    expect(d.input).toBeInstanceOf(z.ZodType);
    expect(d.output).toBeInstanceOf(z.ZodType);
    for (const code of d.errors) expect(RUNNER_ERROR_CODES).toContain(code);
  }
  const error = new RunnerError("not_found", "There is no run.");
  expect(isRunnerError(error)).toBe(true);
  expect(isRunnerError(new Error("x"))).toBe(false);
  expectTypeOf<OperationOutput<"runs.status">>().toEqualTypeOf<RunDetail>();
  expect(RUNNER_MODES).toEqual(["sample", "demo", "live"]);
  expect(
    operations["runner.info"].output.safeParse({
      contractVersion: 1,
      appVersion: "0.1.0",
      storeVersion: 7,
      mode: "demo",
    }).success,
  ).toBe(true);
});

test("retired flows.run keeps the version 1 parameter schema", () => {
  const schema = operations["flows.run"].input;
  expect(
    schema.safeParse({ flowId: "flow", inputs: { x: "y" }, params: { min_score: 8, fast: true, who: "Ana" } })
      .success,
  ).toBe(true);
  expect(schema.safeParse({ flowId: "flow", params: { x: [1] } }).success).toBe(false);
});
