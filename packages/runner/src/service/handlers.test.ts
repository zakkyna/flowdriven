import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunDetail, RunSummary as RunSummaryV2 } from "@flowdriven/contracts";
import { Approval, FlowDetail, RunSummary } from "@flowdriven/contracts/v1";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { createFixtureRunnerClient } from "../../../fixtures/src/client.ts";
import { demoFlow } from "../demo/demo-flow.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createDispatcher, type Handlers } from "./handlers.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const dirs: string[] = [];
const services: { service: RunnerService; store: Store }[] = [];
const fixed = () => new Date("2026-11-11T00:00:00.000Z");
function dir() {
  const p = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  dirs.push(p);
  return p;
}
afterEach(() => {
  for (const { service, store } of services.splice(0)) {
    service.stop();
    store.close();
  }
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
async function setup(mode: "demo" | "live" = "demo", notify = vi.fn()) {
  const dataDir = dir();
  const store = await openSqliteStore(":memory:");
  let n = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode,
    notify,
    claudePath: join(dataDir, "no-claude"),
    now: fixed,
    newId: (prefix) => `${prefix}-${++n}`,
  });
  services.push({ service, store });
  await service.start().settled;
  return { service, store, dataDir };
}
async function until<T>(check: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}
async function approvals(s: RunnerService) {
  return Approval.array().parse(await s.call("approvals.list", { state: "pending" }));
}
async function pending(s: RunnerService, kind: string) {
  return until(async () => (await approvals(s)).find((a) => a.kind === kind));
}
async function run(s: RunnerService) {
  return RunSummary.parse(await s.call("flows.run", { flowId: demoFlow().manifest.id }));
}
async function finish(s: RunnerService, pick: string) {
  const started = await run(s);
  const ask = await pending(s, "ask");
  await s.call("approvals.answer", { approvalId: ask.id, picks: [pick] });
  const sign = await pending(s, "result_sign_off");
  await s.call("approvals.resolve", { approvalId: sign.id, decision: "approve" });
  const detail = await until(async () => {
    const d = RunDetail.parse(await s.call("runs.status", { runId: started.id }));
    return d.state === "done" ? d : undefined;
  });
  return detail;
}

test("flows.list and flows.get show the demo flow as approved, with four steps and no run yet", async () => {
  const { service: s } = await setup();
  const list = await s.call("flows.list", {});
  expect(list).toEqual([
    expect.objectContaining({ signOff: expect.objectContaining({ state: "approved" }), stepCount: 4 }),
  ]);
  const flow = FlowDetail.parse(await s.call("flows.get", { flowId: demoFlow().manifest.id }));
  expect(list).toEqual([expect.not.objectContaining({ lastRun: expect.anything() })]);
  expect(flow.manifest.steps).toHaveLength(4);
});
test("flows.run answers at once with a queued run and the run reaches the choice", async () => {
  const { service: s, dataDir } = await setup();
  expect((await run(s)).state).toBe("queued");
  const ask = await pending(s, "ask");
  expect(ask.payload).toMatchObject({ kind: "choice", options: [{ key: "j1" }, { key: "j3" }] });
  await expect(
    s.call("flows.run", { flowId: demoFlow().manifest.id, inputs: { project: "/etc" } }),
  ).rejects.toMatchObject({ code: "invalid_input", message: "Unknown input project." });
  const rows = RunSummaryV2.array().parse(await s.call("runs.list", {}));
  expect(rows).toHaveLength(1);
  expect(rows.at(0)?.project).toBe(join(dataDir, "demo-project"));
});
test("the demo story end to end", async () => {
  const { service: s } = await setup();
  const first = await finish(s, "j1");
  const review = first.steps.find((x) => x.stepId === "review");
  expect(review?.items?.map((x) => [x.key, x.state])).toEqual([
    ["j1", "passed"],
    ["j2", "passed"],
    ["j3", "passed"],
    ["j4", "passed"],
  ]);
  expect(first.steps.find((x) => x.stepId === "build")?.items?.map((x) => x.key)).toEqual(["j1"]);
  const second = await finish(s, "j5");
  expect(
    second.steps
      .find((x) => x.stepId === "review")
      ?.items?.slice(0, 2)
      .map((x) => x.skip),
  ).toEqual(["seen", "seen"]);
  expect(((await s.call("runs.report", { runId: second.id })) as { lines: string[] }).lines.at(1)).toBe(
    "Items: 2 processed, 2 skipped as seen, 0 failed.",
  );
});
test("approvals.resolve refuses a choice, an edit and a batch, and approvals.answer shows the engine's refusals", async () => {
  const { service: s } = await setup();
  await run(s);
  const ask = await pending(s, "ask");
  await expect(
    s.call("approvals.resolve", { approvalId: ask.id, decision: "approve" }),
  ).rejects.toMatchObject({ code: "invalid_input", message: "This is a choice. Pick from its options." });
  await expect(
    s.call("approvals.resolve", { approvalId: ask.id, decision: "approve", applyToSimilar: true }),
  ).rejects.toMatchObject({ code: "not_allowed", message: "Nothing here can be approved as a batch." });
  await expect(s.call("approvals.answer", { approvalId: ask.id, picks: ["bad"] })).rejects.toMatchObject({
    code: "invalid_input",
  });
  await s.call("approvals.answer", { approvalId: ask.id, picks: ["j1"] });
  await expect(s.call("approvals.answer", { approvalId: ask.id, picks: ["j1"] })).rejects.toMatchObject({
    code: "not_allowed",
    message: "This decision was already made.",
  });
  const sign = await pending(s, "result_sign_off");
  await expect(
    s.call("approvals.resolve", { approvalId: sign.id, decision: "edit", editedText: "x" }),
  ).rejects.toMatchObject({ code: "invalid_input", message: "Only text can be edited." });
});
test("live mode blocks a run when Claude Code is not found, and resume checks again", async () => {
  const { service: s, store } = await setup("live");
  const d = demoFlow();
  s.engine.registerFlow(d.manifest, DEMO_HASH, d.files);
  const started = await run(s);
  const blocked = await until(async () => {
    const v = RunDetail.parse(await s.call("runs.status", { runId: started.id }));
    return v.state === "blocked" ? v : undefined;
  });
  expect(blocked.blockedReason).toBe("Claude Code was not found on this Mac. Install it, then scan again.");
  expect(RunSummary.parse(await s.call("runs.resume", { runId: started.id })).id).toBe(started.id);
  await until(async () =>
    ((await s.call("runs.status", { runId: started.id })) as { state: string }).state === "blocked"
      ? true
      : undefined,
  );
  const row = store.getRun(started.id);
  if (!row) throw new Error("Missing run");
  store.createRun({ ...row, id: "manual", blockedReason: undefined });
  expect(
    RunSummaryV2.array()
      .parse(await s.call("runs.list", {}))
      .find((x) => x.id === "manual")?.reportFirstLine,
  ).toBeUndefined();
  const demo = await setup();
  const done = await finish(demo.service, "j1");
  await expect(demo.service.call("runs.resume", { runId: done.id })).rejects.toMatchObject({
    code: "not_allowed",
    message: "This run cannot be resumed.",
  });
});
test("the six not-built operations answer unavailable with their sentences", async () => {
  const { service: s } = await setup();
  const cases = [
    ["flows.build", { message: "x" }, "Operation retired."],
    ["flows.update", { flowId: "x", edit: { kind: "undo" } }, "Operation retired."],
    [
      "readiness.install",
      { flowId: "x", requirementId: "x" },
      "Installing a requirement arrives with the readiness engine.",
    ],
    ["harnesses.rescan", {}, "Looking for harnesses arrives with the harness adapters."],
    [
      "harnesses.setConsent",
      { harnessId: "x", consent: "given" },
      "Harness consent arrives with the harness adapters.",
    ],
  ] as const;
  for (const [name, input, message] of cases)
    await expect(s.call(name, input)).rejects.toMatchObject({ code: "unavailable", message });
  await expect(s.call("settings.update", { patch: {} })).rejects.toMatchObject({ code: "invalid_input" });
});
test("harnesses.list is empty, settings.get has the defaults and readiness.check has one unchecked row per requirement", async () => {
  const { service: s } = await setup();
  const d = demoFlow();
  d.manifest.requirements = [Requirement.parse({ id: "server", type: "mcp_server", tools: ["read"] })];
  s.engine.registerFlow(d.manifest, DEMO_HASH, d.files);
  expect(await s.call("harnesses.list", {})).toEqual([]);
  expect(await s.call("settings.get", {})).toMatchObject({
    language: "en",
    agentPermission: "unset",
    mainAgent: null,
    busyFallback: false,
    spendingLimit: 10,
  });
  expect(await s.call("readiness.check", { flowId: d.manifest.id })).toMatchObject({
    items: [{ requirementId: "server", state: "unchecked" }],
    ready: false,
  });
});
test("input that does not validate is invalid_input and an unknown operation is not_found", async () => {
  const { service: s } = await setup();
  await expect(s.call("runs.status", {})).rejects.toMatchObject({ code: "invalid_input" });
  await expect(s.call("nope.x", {})).rejects.toMatchObject({
    code: "not_found",
    message: "There is no operation nope.x.",
  });
  expect(s.knows("runs.status")).toBe(true);
  expect(s.knows("nope.x")).toBe(false);
});
test("an output that does not parse becomes Internal error and an audit entry", async () => {
  const audit = vi.fn();
  for (const fn of [
    () => ({ mode: "other" }),
    () => {
      throw new Error("boom");
    },
  ]) {
    const dispatch = createDispatcher({
      v2: {},
      legacy: { "runner.info": fn } as unknown as Handlers,
      audit,
    });
    await expect(dispatch("runner.info", {})).rejects.toMatchObject({
      code: "unavailable",
      message: "Internal error",
    });
  }
  expect(audit).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledWith("internal_error", expect.objectContaining({ method: "runner.info" }));
});
test("flows.import registers a valid folder, reports the issues of an invalid one and refuses a relative path", async () => {
  const { service: s } = await setup("live");
  const yaml = `format: flowdriven-flow/1.1\nid: local.import-test\nname: Import test\nkind: build\nsteps:\n  - id: a\n    do: worker\n    instructions: Hello\n    checks:\n      - type: contains\n        pattern: Hello\n`;
  const good = dir(),
    bad = dir();
  for (const p of [good, bad]) writeFileSync(join(p, "README.md"), "Readme");
  writeFileSync(join(good, "flow.yaml"), yaml);
  writeFileSync(join(bad, "flow.yaml"), yaml.replace("    do: worker", "    unknown: yes\n    do: worker"));
  await expect(s.call("flows.import", { path: "relative" })).rejects.toMatchObject({
    code: "invalid_input",
    message: "The flow folder must be an absolute path.",
  });
  const invalid = await s.call("flows.import", { path: bad });
  expect(invalid).toMatchObject({ issues: [expect.objectContaining({ severity: "error" })] });
  expect(invalid).not.toHaveProperty("flow");
  expect(await s.call("flows.list", {})).toEqual([]);
  expect(await s.call("flows.import", { path: good })).toMatchObject({
    flow: expect.objectContaining({ manifest: expect.objectContaining({ id: "local.import-test" }) }),
    hash: expect.any(String),
  });
  expect(await s.call("flows.list", {})).toHaveLength(1);
});

test("queue.move refuses a run that is running", async () => {
  const { service, store } = await setup();
  store.createRun({
    id: "running",
    flowId: "f",
    flowHash: "h",
    flowVersion: "1.0.0",
    state: "running",
    project: "/p",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: fixed().toISOString(),
  });
  await expect(service.call("queue.move", { runId: "running" })).rejects.toMatchObject({
    code: "not_allowed",
    message: "This run is not waiting.",
  });
  await expect(service.call("queue.move", { runId: "missing" })).rejects.toMatchObject({ code: "not_found" });
});

test("TC-SR2-02 refuses person-only calls before parsing and audits each caller", async () => {
  const notify = vi.fn();
  const { service, store } = await setup("demo", notify);
  notify.mockClear();
  const call = service.call as (name: string, input: unknown, caller: string) => Promise<unknown>;
  const rows: [string, unknown][] = [
    ["approvals.resolve", { approvalId: "ap-1", decision: "approve" }],
    ["approvals.answer", {}],
    ["approvals.resolveSimilar", {}],
    ["rules.revoke", { ruleId: "rule-1" }],
    ["settings.update", { patch: { agentPermission: "off" } }],
    ["settings.update", { patch: { spendingLimit: 500 } }],
    ["flows.confirm", {}],
    ["flows.setSchedule", { schedule: { type: "daily", time: "17:00" } }],
    ["flows.delete", {}],
    ["chats.act", {}],
    ["agents.setUp", {}],
    ["triggers.setEnabled", {}],
  ];
  const before = {
    runs: store.listRuns({}),
    flows: store.listFlows(),
    approvals: store.listApprovals(),
    settings: store.getSetting("keeper"),
  };
  for (const caller of ["tool", "phone"])
    for (const [name, input] of rows) {
      await expect(call(name, input, caller)).rejects.toMatchObject({
        code: "not_allowed",
        reason: "caller_not_allowed",
      });
    }
  expect({
    runs: store.listRuns({}),
    flows: store.listFlows(),
    approvals: store.listApprovals(),
    settings: store.getSetting("keeper"),
  }).toEqual(before);
  expect(
    store
      .listAudit()
      .filter((r) => r.kind === "caller_refused")
      .map((r) => r.detail),
  ).toEqual(["tool", "phone"].flatMap((caller) => rows.map(([operation]) => ({ operation, caller }))));
  expect(notify).not.toHaveBeenCalled();
  await expect(call("runner.info", {}, "tool")).resolves.toHaveProperty("contractVersion");
});

test("TC-SR7-10 audits handler failures and rolls back handler transactions", async () => {
  const { store } = await setup();
  const audit = vi.fn();
  const make = createDispatcher as unknown as (
    opts: unknown,
  ) => (name: string, input: unknown) => Promise<unknown>;
  for (const handler of [
    () =>
      store.transaction(() => {
        store.putSetting("rollback", "value");
        throw new Error("disk");
      }),
    () => ({ mode: "wrong" }),
  ]) {
    const dispatch = make({ v2: { "runner.info": handler }, legacy: {}, audit });
    await expect(dispatch("runner.info", {})).rejects.toMatchObject({
      code: "unavailable",
      reason: "internal_error",
      message: "Internal error",
    });
  }
  expect(store.getSetting("rollback")).toBeUndefined();
  expect(audit).toHaveBeenCalledTimes(2);
  expect(audit).toHaveBeenCalledWith("internal_error", expect.objectContaining({ method: "runner.info" }));
});

test("TC-ENG-25 retires build and update and preserves structured handler errors", async () => {
  const { RunnerError } = await import("@flowdriven/contracts");
  const audit = vi.fn();
  const handler = vi.fn(() => {
    throw new RunnerError("conflict", "x", { reason: "card_answered", params: { id: "a" } });
  });
  const make = createDispatcher as unknown as (
    opts: unknown,
  ) => (name: string, input: unknown) => Promise<unknown>;
  const dispatch = make({
    v2: { "runner.info": handler },
    legacy: { "flows.build": handler, "flows.update": handler },
    audit,
  });
  for (const name of ["flows.build", "flows.update"])
    await expect(dispatch(name, {})).rejects.toMatchObject({ code: "unavailable", reason: "retired" });
  expect(handler).not.toHaveBeenCalled();
  await expect(dispatch("flows.nothing", {})).rejects.toMatchObject({ code: "not_found" });
  await expect(dispatch("runner.info", {})).rejects.toMatchObject({
    code: "conflict",
    reason: "card_answered",
    params: { id: "a" },
  });
});

test("TC-ENG-25 selects version 2 before legacy and validates each map with its own schemas", async () => {
  const legacy = vi.fn(() => ({ contractVersion: 1, mode: "demo" as const }));
  const v2 = vi.fn(() => ({
    contractVersion: 2,
    appVersion: "1.0.0",
    storeVersion: 6,
    mode: "demo" as const,
  }));
  const audit = vi.fn();
  const both = createDispatcher({ v2: { "runner.info": v2 }, legacy: { "runner.info": legacy }, audit });
  await expect(both("runner.info", {})).resolves.toMatchObject({ contractVersion: 2 });
  expect(legacy).not.toHaveBeenCalled();
  const old = createDispatcher({ v2: {}, legacy: { "runner.info": legacy }, audit });
  await expect(old("runner.info", {})).resolves.toEqual({ contractVersion: 1, mode: "demo" });
  await expect(old("agents.list", {})).rejects.toMatchObject({ code: "unavailable" });
});

test("TC-SR2-02 retired operations refuse tool and phone but reach window handlers", async () => {
  const audit = vi.fn();
  const reached = vi.fn(() => {
    throw new Error("reached legacy handler");
  });
  const dispatch = createDispatcher({
    v2: {},
    legacy: {
      "harnesses.setConsent": reached,
      "flows.allowCapabilities": reached,
      "flows.withdrawCapabilities": reached,
    },
    audit,
  });
  const rows = [
    ["harnesses.setConsent", { harnessId: "h", consent: "given" }],
    ["flows.allowCapabilities", { flowId: "f", hash: `sha256:${"a".repeat(64)}` }],
    ["flows.withdrawCapabilities", { flowId: "f" }],
  ] as const;
  for (const [name, input] of rows) {
    for (const caller of ["tool", "phone"] as const) {
      await expect(dispatch(name, input, caller)).rejects.toMatchObject({
        code: "not_allowed",
        reason: "caller_not_allowed",
      });
      expect(audit).toHaveBeenCalledWith("caller_refused", { operation: name, caller });
    }
    await expect(dispatch(name, input, "window")).rejects.toMatchObject({
      code: "unavailable",
      reason: "internal_error",
    });
  }
  expect(reached).toHaveBeenCalledTimes(3);
});

test("TC-AGT-32 runner.info reports live, demo and sample modes", async () => {
  for (const mode of ["live", "demo"] as const) {
    const { service } = await setup(mode);
    const info = await service.call("runner.info", {});
    expect(info).toEqual({
      contractVersion: 2,
      appVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      storeVersion: 7,
      mode,
    });
  }
  await expect(createFixtureRunnerClient().call("runner.info", {})).resolves.toEqual({
    contractVersion: 2,
    appVersion: "0.1.0",
    storeVersion: 7,
    mode: "sample",
  });
});

test("TC-j12-32 settings defaults and choices survive a restart", async () => {
  const dataDir = dir();
  const path = join(dataDir, "store.sqlite");
  const store = await openSqliteStore(path);
  const make = (s: Store) => createRunnerService({ store: s, dataDir, mode: "demo", now: fixed });
  const first = make(store);
  await first.start().settled;
  expect(await first.call("settings.get", {})).toMatchObject({
    language: "en",
    agentPermission: "unset",
    mainAgent: null,
    busyFallback: false,
    spendingLimit: 10,
  });
  const patch = {
    language: "id",
    agentPermission: "on",
    mainAgent: { agent: "codex", model: "gpt-6.1-terra" },
    busyFallback: true,
    spendingLimit: 40,
  };
  const updated = await first.call("settings.update", { patch });
  first.stop();
  store.close();
  const reopened = await openSqliteStore(path);
  const second = make(reopened);
  services.push({ service: second, store: reopened });
  await second.start().settled;
  expect(await second.call("settings.get", {})).toEqual(updated);
});

test("TC-j28-40 background is rejected without changes or audit", async () => {
  const { service, store } = await setup();
  const before = await service.call("settings.get", {});
  expect(before).not.toHaveProperty("background");
  const audit = store.listAudit().filter((row) => row.kind === "setting_changed");
  await expect(
    service.call("settings.update", { patch: { background: { keepRunning: false, openAtLogin: false } } }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(await service.call("settings.get", {})).toEqual(before);
  expect(store.listAudit().filter((row) => row.kind === "setting_changed")).toEqual(audit);
});

test("settings updates validate limits, round cents and audit changed keys", async () => {
  const { service, store } = await setup();
  for (const value of [10, 5, 10.001])
    await expect(service.call("settings.update", { patch: { spendingLimit: value } })).rejects.toMatchObject({
      code: "invalid_input",
      reason: "limit_not_above",
    });
  await expect(service.call("settings.update", { patch: { spendingLimit: 10001 } })).rejects.toMatchObject({
    code: "invalid_input",
  });
  expect(
    await service.call("settings.update", { patch: { spendingLimit: 25.004, agentPermission: "on" } }),
  ).toMatchObject({
    spendingLimit: 25,
    spending: { month: "2026-11", spentUsd: 0, limitUsd: 25, state: "ok", allOnPlans: false },
  });
  expect(
    store.listAudit().filter((row) => ["setting_changed", "permission_changed"].includes(row.kind)),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "setting_changed",
        detail: expect.objectContaining({ key: "spendingLimit", from: 10, to: 25 }),
      }),
      expect.objectContaining({
        kind: "permission_changed",
        detail: expect.objectContaining({
          from: "unset",
          to: "on",
          source: "window",
        }),
      }),
    ]),
  );
});
