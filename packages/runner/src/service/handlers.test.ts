import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Approval, FlowDetail, RunDetail, RunSummary } from "@flowdriven/contracts";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createDispatcher, type Handlers } from "./handlers.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const dirs: string[] = [];
const services: { service: RunnerService; store: Store }[] = [];
const fixed = () => new Date("2026-11-11T00:00:00.000Z");
function dir() {
  const p = mkdtempSync(join(tmpdir(), "flowdriven-"));
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
async function setup(mode: "demo" | "live" = "demo") {
  const dataDir = dir();
  const store = await openSqliteStore(":memory:");
  let n = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode,
    now: fixed,
    newId: (prefix) => `${prefix}-${++n}`,
  });
  services.push({ service, store });
  service.start();
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
  const rows = RunSummary.array().parse(await s.call("runs.list", {}));
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
test("live mode blocks a run with No harness is connected yet. and resume checks again", async () => {
  const { service: s, store } = await setup("live");
  const d = demoFlow();
  s.engine.registerFlow(d.manifest, DEMO_HASH, d.files);
  const started = await run(s);
  const blocked = await until(async () => {
    const v = RunDetail.parse(await s.call("runs.status", { runId: started.id }));
    return v.state === "blocked" ? v : undefined;
  });
  expect(blocked.blockedReason).toBe("No harness is connected yet.");
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
    RunSummary.array()
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
    ["flows.build", { message: "x" }, "Building a flow from chat arrives with the agent."],
    [
      "flows.update",
      { flowId: "x", edit: { kind: "undo" } },
      "Editing a flow in the app arrives with the agent.",
    ],
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
    ["settings.update", { patch: {} }, "Changing settings arrives with the agent."],
  ] as const;
  for (const [name, input, message] of cases)
    await expect(s.call(name, input)).rejects.toMatchObject({ code: "unavailable", message });
});
test("harnesses.list is empty, settings.get has the defaults and readiness.check has one unchecked row per requirement", async () => {
  const { service: s } = await setup();
  const d = demoFlow();
  d.manifest.requirements = [Requirement.parse({ id: "server", type: "mcp_server", tools: ["read"] })];
  s.engine.registerFlow(d.manifest, DEMO_HASH, d.files);
  expect(await s.call("harnesses.list", {})).toEqual([]);
  expect(await s.call("settings.get", {})).toMatchObject({
    budget: { month: "2026-11", capUsd: 0, spentUsd: 0 },
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
    const dispatch = createDispatcher({ "runner.info": fn } as unknown as Handlers, audit);
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
