import type { Notice } from "@flowdriven/contracts";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { createEngine } from "../engine.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { ApprovalRow, Store } from "../storage.ts";
import { createNotifier, observeStore } from "./notify-wiring.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function rig(name = "Test flow") {
  const base = await openSqliteStore(":memory:");
  stores.push(base);
  const notices: Notice[] = [];
  const notifier = createNotifier({
    store: base,
    now: () => new Date("2026-11-12T00:00:00Z"),
    send: (n) => notices.push(n),
  });
  const store = observeStore(base, notifier);
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name,
    kind: "build",
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Find",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "ok", of: "message" }],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Pick",
          choose_from: "${steps.a.outputs.jobs}",
          max_pick: 1,
          approves: [],
          on_expiry: "end",
        },
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  let id = 0;
  const engine = createEngine({
    store,
    now: () => new Date("2026-11-12T00:00:00Z"),
    newId: (p) => `${p}-${++id}`,
    harness: scriptedHarness({
      steps: { a: { text: "ok", outputs: { jobs: [{ id: "one" }], message: "ok" } } },
    }),
  });
  engine.registerFlow(parsed.manifest, `sha256:${"0".repeat(64)}`);
  return { store, base, engine, notifier, notices };
}
const approval: ApprovalRow = {
  id: "approval-1",
  kind: "ask",
  runId: "run-1",
  stepId: "pick",
  itemKey: "",
  summary: "Pick",
  payload: {},
  approves: [],
  onExpiry: "end",
  createdAt: "2026-11-12T00:00:00Z",
  expiresAt: "2026-11-13T00:00:00Z",
  state: "pending",
};

test("a pending approval made by the engine sends one approval notice with the flow's name", async () => {
  const r = await rig();
  await r.engine.beginStart("local.test", { project: "/tmp" }).settled;
  await Promise.resolve();
  expect(r.notices).toHaveLength(1);
  expect(r.notices[0]).toMatchObject({
    kind: "approval_waiting",
    body: { key: "notice.decisionBody" },
  });
});
test("an approval created inside a transaction that then throws sends nothing", async () => {
  const r = await rig();
  expect(() =>
    r.store.transaction(() => {
      r.store.createApproval(approval);
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  await Promise.resolve();
  expect(r.notices).toEqual([]);
});
test("a run that ends blocked sends one blocked notice; running, checking, done and failed send none", async () => {
  const r = await rig();
  r.store.createRun({
    id: "run-1",
    flowId: "local.test",
    flowHash: `sha256:${"0".repeat(64)}`,
    flowVersion: "1.0.0",
    state: "queued",
    project: "/tmp",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: "2026-11-12T00:00:00Z",
  });
  for (const state of ["running", "checking", "done", "failed"] as const) {
    r.store.updateRun("run-1", { state });
    await Promise.resolve();
  }
  expect(r.notices).toEqual([]);
  r.store.updateRun("run-1", { state: "blocked" });
  await Promise.resolve();
  expect(r.notices).toHaveLength(1);
  expect(r.notices[0]).toMatchObject({ kind: "run_blocked", body: { key: "notice.problemBody" } });
});
test("a flood event sends one notice and a second the same local day sends none; a paused event sends one trigger_paused notice", async () => {
  const r = await rig();
  const event = { flowId: "local.test", flowName: "Test flow", day: "2026-11-12", cap: 24 };
  r.notifier.onFlood(event);
  r.notifier.onFlood(event);
  r.notifier.onPaused({
    flowId: event.flowId,
    flowName: event.flowName,
    index: 0,
    pausedAt: "2026-11-12T00:00:00.000Z",
  });
  expect(r.notices.map((n) => n.kind)).toEqual(["flood_cap", "trigger_paused"]);
});
test("a send that throws, a hook that reads a missing run and a store that throws in a hook never break the store call", async () => {
  const r = await rig();
  const n = createNotifier({
    store: r.base,
    now: () => new Date(),
    send: () => {
      throw new Error("send");
    },
  });
  expect(() => n.onFlood({ flowId: "f", flowName: "F", day: "2026-11-12", cap: 2 })).not.toThrow();
  expect(() => n.onRunState("missing", "blocked")).not.toThrow();
  const broken = new Proxy(r.base, {
    get(target, key, receiver) {
      if (key === "getSetting")
        return () => {
          throw new Error("store");
        };
      return Reflect.get(target, key, receiver);
    },
  });
  const brokenNotifier = createNotifier({ store: broken, now: () => new Date(), send: () => {} });
  const observed = observeStore(r.base, brokenNotifier);
  expect(() => observed.putSetting("weekly:claude-code", { resetsAt: 1, percent: 80 })).not.toThrow();
  await Promise.resolve();
  const wrapped = observeStore(r.base, {
    onApproval: () => {
      throw new Error("hook");
    },
    onRunState: () => {
      throw new Error("hook");
    },
    onWeekly: () => {
      throw new Error("hook");
    },
  });
  expect(() => wrapped.putSetting("weekly:claude-code", { resetsAt: 1, percent: 80 })).not.toThrow();
  await Promise.resolve();
  expect(r.notices).toEqual([]);
});
test("a flow name with control and bidi characters is cleaned in the notice", async () => {
  const r = await rig(`Hello${String.fromCodePoint(0x202e)}\nworld`);
  await r.engine.beginStart("local.test", { project: "/tmp" }).settled;
  await Promise.resolve();
  expect(r.notices[0]?.body).toEqual({ key: "notice.decisionBody" });
  expect(JSON.stringify(r.notices[0])).not.toContain("Hello");
});
test("a putSetting of a new weekly window (resetsAt in seconds) sends one weekly notice naming the weekday; the same value again, the owner's answer (a value with answer), the weekly-index setting and a reset time that moves by a minute inside 24 hours send none", async () => {
  const r = await rig();
  const resetsAt = Date.parse("2026-11-15T00:00:00Z") / 1000;
  const value = { resetsAt, percent: 95 };
  r.store.putSetting("weekly:claude-code", value);
  await Promise.resolve();
  expect(r.notices).toHaveLength(1);
  expect(r.notices[0]?.body).toEqual({ key: "notice.limitBody" });
  for (const [key, v] of [
    ["weekly:claude-code", value],
    ["weekly:claude-code", { ...value, answer: "keep" }],
    ["weekly-index", value],
    ["weekly:claude-code", { ...value, resetsAt: resetsAt + 60 }],
  ] as const) {
    r.store.putSetting(key, v);
    await Promise.resolve();
  }
  expect(r.notices).toHaveLength(1);
});

test("TC-j24-41 an oversized held call sends no notice", async () => {
  const r = await rig();
  r.store.createRun({
    id: "run-oversize",
    flowId: "local.test",
    flowHash: `sha256:${"0".repeat(64)}`,
    flowVersion: "1.0.0",
    state: "running",
    project: "/tmp",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: "2026-11-12T00:00:00Z",
  });
  r.store.upsertStep({
    runId: "run-oversize",
    stepId: "a",
    itemKey: "",
    state: "failed",
    attempts: [],
    outputs: {},
    checks: [],
    noteLine: { key: "hold.tooLarge" },
  });
  r.store.updateRun("run-oversize", {
    state: "blocked",
    cause: { code: "step_failed", params: { step: "a" } },
  });
  await Promise.resolve();
  expect(r.notices).toEqual([]);
});
