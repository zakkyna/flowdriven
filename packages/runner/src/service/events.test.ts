import type { RunnerTopic } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { createChangeEmitter, wrapStore } from "./events.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function setup() {
  const original = await openSqliteStore(":memory:");
  stores.push(original);
  const marks: RunnerTopic[] = [];
  return { store: wrapStore(original, (topic) => marks.push(topic)), marks };
}
const flow = { id: "f", version: "1", hash: "h", manifest: {}, files: {}, registeredAt: "2026" };
const run = {
  id: "r",
  flowId: "f",
  flowHash: "h",
  flowVersion: "1",
  state: "running" as const,
  project: "p",
  inputs: {},
  params: {},
  requirements: [],
  startedAt: "2026",
};
const step = {
  runId: "r",
  stepId: "s",
  itemKey: "",
  state: "pending" as const,
  attempts: [],
  outputs: {},
  checks: [],
};
const item = { runId: "r", loopId: "l", key: "k", position: 0, item: {}, status: "pending" as const };
const approval = {
  id: "a",
  kind: "ask" as const,
  runId: "r",
  stepId: "s",
  itemKey: "",
  summary: "choose",
  payload: [],
  approves: [],
  onExpiry: "end" as const,
  createdAt: "a",
  expiresAt: "b",
  state: "pending" as const,
};
test("each mutating call marks its topics", async () => {
  const { store, marks } = await setup();
  store.putFlow(flow);
  store.createRun(run);
  store.updateRun("r", {});
  store.upsertStep(step);
  store.upsertItem(item);
  store.createApproval(approval);
  store.updateApproval("a", {});
  store.transaction(() => {
    store.putFlow(flow);
    store.updateRun("r", {});
  });
  expect(marks).toEqual([
    "flows",
    "skills",
    "runs",
    "activity",
    "runs",
    "activity",
    "runs",
    "activity",
    "runs",
    "activity",
    "approvals",
    "runs",
    "activity",
    "chats",
    "approvals",
    "runs",
    "activity",
    "chats",
    "flows",
    "skills",
    "runs",
    "activity",
  ]);
});
test("reads, counters and the audit log mark nothing, and a call that throws marks nothing", async () => {
  const { store, marks } = await setup();
  store.getRun("missing");
  store.listRuns();
  store.markSeen("f", "l", "k", "a");
  store.appendAudit({ at: "a", kind: "x", detail: {} });
  store.addGrant("r", "tool", "");
  store.increment("n", "d");
  expect(() => store.updateRun("missing", {})).toThrow(expect.objectContaining({ code: "not_found" }));
  expect(marks).toEqual([]);
});
test("writes in one turn make one event with sorted topics", async () => {
  const callbacks: (() => void)[] = [];
  const events: { type: "changed"; topics: RunnerTopic[] }[] = [];
  const emitter = createChangeEmitter(
    (event) => events.push(event),
    (callback) => callbacks.push(callback),
  );
  emitter.mark("runs");
  emitter.mark("approvals");
  emitter.mark("runs");
  emitter.mark("flows");
  for (let i = 0; i < 6; i++) emitter.mark("flows");
  expect(callbacks).toHaveLength(1);
  callbacks.shift()?.();
  expect(events).toEqual([{ type: "changed", topics: ["flows", "runs", "approvals"] }]);
  emitter.mark("runs");
  expect(callbacks).toHaveLength(1);
  callbacks.shift()?.();
  expect(events).toHaveLength(2);
  expect(events.at(1)).toEqual({ type: "changed", topics: ["runs"] });
  const automatic: typeof events = [];
  createChangeEmitter((event) => automatic.push(event)).mark("flows");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(automatic).toEqual([{ type: "changed", topics: ["flows"] }]);
});

test("putHarnessState marks the agents and settings topics", async () => {
  const { store, marks } = await setup();
  store.putHarnessState({ id: "claude-code", consent: "given" });
  expect(marks).toEqual(["agents", "settings"]);
});

test("usage and settings mark their topics", async () => {
  const { store, marks } = await setup();
  store.putSetting("weekly:claude-code", {});
  expect(marks.splice(0)).toEqual(["settings", "approvals", "activity"]);
  store.putSetting("keeper", {});
  expect(marks.splice(0)).toEqual(["settings"]);
  store.addUsage({
    at: "2026",
    runId: "r",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    kind: "worker",
    harness: "claude-code",
    models: [],
    turns: 0,
    wallMs: 0,
    queuedMs: 0,
    exit: "ok",
  });
  expect(marks).toEqual(["runs", "settings"]);
});

test("putTrigger marks the flows topic", async () => {
  const { store, marks } = await setup();
  store.putTrigger({
    flowId: "f",
    index: 0,
    enabled: false,
    hash: "h",
    spec: "{}",
    enabledAt: "2026-11-12T00:00:00.000Z",
  });
  expect(marks).toEqual(["flows"]);
});

test("putCapabilityConsent and deleteCapabilityConsent mark the flows and readiness topics", async () => {
  const { store, marks } = await setup();
  store.putCapabilityConsent({ flowId: "f", hash: "h", at: "2026" });
  expect(marks.splice(0)).toEqual(["flows", "readiness"]);
  store.deleteCapabilityConsent("f");
  expect(marks).toEqual(["flows", "readiness"]);
});

test("TC-STO-38 store writes mark the topics of their tables", async () => {
  const { store, marks } = await setup();
  store.putFlow(flow);
  expect(marks.splice(0)).toEqual(["flows", "skills"]);
  store.createRun(run);
  expect(marks.splice(0)).toEqual(["runs", "activity"]);
  store.upsertStep(step);
  expect(marks.splice(0)).toEqual(["runs", "activity"]);
  store.upsertItem(item);
  expect(marks.splice(0)).toEqual(["runs", "activity"]);
  store.createApproval(approval);
  expect(marks.splice(0)).toEqual(["approvals", "runs", "activity", "chats"]);
  store.putHarnessState({ id: "claude-code", consent: "given" });
  expect(marks.splice(0)).toEqual(["agents", "settings"]);
  store.putSetting("spending-pause", {});
  expect(marks.splice(0)).toEqual(["settings", "approvals", "activity"]);
  store.putFlowHead({
    id: "f",
    name: "Flow",
    summary: "",
    headHash: "h",
    createdAt: "2026",
    updatedAt: "2026",
    origin: { kind: "import" },
  });
  expect(marks.splice(0)).toEqual(["flows", "skills"]);
  store.putConfirmation({
    flowId: "f",
    hash: "h",
    at: "2026",
    by: "confirm_dialog",
    onItsOwn: [],
    pins: { skills: {}, folders: {} },
  });
  expect(marks.splice(0)).toEqual(["flows", "activity"]);
  store.makeRule({ flowId: "f", touchId: "t", effect: "change", place: { kind: "account", value: "a" } });
  expect(marks.splice(0)).toEqual(["rules", "flows"]);
  store.putSchedule({
    flowId: "f",
    type: "daily",
    time: "17:00",
    whenItsTime: "ask",
    setAt: "2026",
    setBy: "window",
    confirmedHash: "h",
  });
  expect(marks.splice(0)).toEqual(["flows"]);
  store.putTrigger({ flowId: "f", index: 0, enabled: false, hash: "h", spec: "{}", enabledAt: "2026" });
  expect(marks.splice(0)).toEqual(["flows"]);
  store.putRemembered({
    flowId: "f",
    inputId: "i",
    kind: "last",
    value: { type: "text", value: "x" },
    outside: false,
    savedAt: "2026",
    runId: "r",
  });
  expect(marks.splice(0)).toEqual(["flows"]);
  store.claimStart({
    id: "start",
    flowId: "f",
    at: "2026",
    source: "flows",
    outcome: "started",
    request: {},
  });
  expect(marks.splice(0)).toEqual(["activity"]);
  store.putChat({
    id: "chat",
    title: "",
    titleSource: "default",
    createdAt: "2026",
    updatedAt: "2026",
    from: "person",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "model",
    agentSource: "person",
  });
  expect(marks.splice(0)).toEqual(["chats"]);
  store.setComposer("chat", "draft text");
  expect(marks.splice(0)).toEqual([]);
  store.putMessage({
    id: "m",
    chatId: "chat",
    seq: 1,
    at: "2026",
    role: "person",
    kind: "text",
    text: "x",
    outside: false,
  });
  expect(marks.splice(0)).toEqual(["chats"]);
  store.putDraft({
    id: "draft",
    chatId: "chat",
    messageId: "m",
    kind: "new_flow",
    state: "drafted",
    createdAt: "2026",
    updatedAt: "2026",
    files: {},
    hash: "h",
    name: "Flow",
    nameAdjusted: false,
    lists: { onItsOwn: [], asksFirst: [], never: [] },
    outside: false,
    assumptions: [],
  });
  expect(marks.splice(0)).toEqual(["chats"]);
  store.putQuestion({
    id: "q",
    flowId: "f",
    chatId: "chat",
    messageId: "m",
    kind: "inputs",
    state: "open",
    createdAt: "2026",
    updatedAt: "2026",
    source: "schedule",
    proactive: true,
    flowHash: "h",
    given: {},
    missing: [],
    pendingStart: { startId: "start", source: "schedule", request: {} },
  });
  expect(marks.splice(0)).toEqual(["chats", "activity", "flows"]);
  store.putCallGrant({
    runId: "r",
    stepId: "s",
    itemKey: "",
    tool: "tool",
    digest: "d",
    kind: "approve",
    createdAt: "2026",
  });
  store.appendAudit({ at: "2026", kind: "x", detail: {} });
  store.markSeen("f", "l", "k", "2026");
  store.increment("n", "day");
  store.claimKey("f", 0, "key", "2026");
  expect(marks).toEqual([]);
});
