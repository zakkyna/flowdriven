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
    "runs",
    "runs",
    "runs",
    "runs",
    "approvals",
    "runs",
    "approvals",
    "runs",
    "flows",
    "runs",
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
