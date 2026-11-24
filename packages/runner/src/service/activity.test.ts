import type { ActivitySummary } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { RunRow, Store } from "../storage.ts";
import { pendingDecision } from "../test-helpers/builders.ts";
import { createRunnerService } from "./service.ts";

const hash = `sha256:${"a".repeat(64)}`;
const time = (day: number) => `2026-11-${day}T17:00:00.000Z`;
function flow(store: Store, id: string) {
  const { manifest, files } = demoFlow();
  store.putFlow({
    id,
    hash,
    version: manifest.version,
    manifest: { ...manifest, id: `local.${id}` },
    files,
    registeredAt: time(19),
  });
}
function run(store: Store, id: string, state: RunRow["state"], day: number) {
  store.createRun({
    id,
    flowId: "flow",
    flowHash: hash,
    flowVersion: "1.0.0",
    flowName: "Flow",
    state,
    project: ".",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: time(day),
  });
}
function decision(store: Store, id: string, day: number) {
  pendingDecision(store, { id, createdAt: time(day) });
}
function question(store: Store, id: string, day: number, proactive: boolean) {
  const flowId = `flow-${id}`;
  flow(store, flowId);
  store.putChat({
    id: `chat-${id}`,
    title: id,
    titleSource: "flowdriven",
    createdAt: time(day),
    updatedAt: time(day),
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  store.putQuestion({
    id,
    flowId,
    chatId: `chat-${id}`,
    messageId: `message-${id}`,
    kind: "inputs",
    state: "open",
    createdAt: time(day),
    updatedAt: time(day),
    source: "schedule",
    proactive,
    flowHash: hash,
    given: {},
    missing: [],
    pendingStart: { startId: `start-${id}`, source: "schedule", request: {} },
  });
}
function setup() {
  return openSqliteStore(":memory:").then((store) => ({
    store,
    service: createRunnerService({ store, dataDir: ".", mode: "demo" }),
  }));
}

test("TC-j25-04 activity sections and filters", async () => {
  const { store, service } = await setup();
  try {
    flow(store, "flow");
    decision(store, "decision", 19);
    question(store, "question", 20, true);
    const states = [
      "queued",
      "checking",
      "running",
      "retrying",
      "done",
      "failed",
      "blocked",
      "needs_login",
      "interrupted",
      "stopped",
    ] as const;
    states.forEach((state, i) => {
      run(store, state, state, 10 + i);
    });
    const all = (await service.call("activity.summary", { filter: "all" })) as ActivitySummary;
    expect(all.needsYou.map((item) => item.kind)).toEqual(["question", "decision"]);
    expect(all.needsYouCount).toBe(2);
    expect(all.running.map((row) => row.state).sort()).toEqual(
      ["checking", "queued", "retrying", "running", "waiting_approval"].sort(),
    );
    expect(all.earlier.map(({ run }) => run.state)).toEqual([
      "stopped",
      "interrupted",
      "needs_login",
      "blocked",
      "failed",
      "done",
    ]);
    expect(await service.call("activity.summary", {})).toEqual(all);
    const problems = (await service.call("activity.summary", { filter: "problems" })) as ActivitySummary;
    expect(problems.earlier.map(({ run }) => run.state)).toEqual([
      "interrupted",
      "needs_login",
      "blocked",
      "failed",
    ]);
    const finished = (await service.call("activity.summary", { filter: "finished" })) as ActivitySummary;
    expect(finished.earlier.map(({ run }) => run.state)).toEqual(["done"]);
    await expect(service.call("activity.summary", { filter: "x" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-STR-26 activity order, paging and empty store", async () => {
  const { store, service } = await setup();
  try {
    expect(await service.call("activity.summary", {})).toEqual({
      needsYou: [],
      needsYouCount: 0,
      running: [],
      earlier: [],
    });
    flow(store, "flow");
    question(store, "fri", 20, true);
    question(store, "thu", 19, true);
    question(store, "typed", 18, false);
    decision(store, "old", 19);
    decision(store, "new", 20);
    run(store, "running", "running", 21);
    run(store, "login", "needs_login", 22);
    run(store, "done", "done", 23);
    run(store, "failed", "failed", 24);
    for (const outcome of ["missed", "skipped"] as const)
      store.claimStart({
        id: outcome,
        flowId: "flow",
        at: time(24),
        source: "schedule",
        outcome,
        reason: outcome,
        request: {},
      });
    const all = (await service.call("activity.summary", {})) as ActivitySummary;
    expect(
      all.needsYou.map((item) => (item.kind === "question" ? item.questionId : item.decision.id)),
    ).toEqual(["thu", "fri", "new", "old"]);
    expect(all.needsYouCount).toBe(4);
    expect(all.running.map((row) => row.id).sort()).toEqual(["run-new", "run-old", "running"]);
    expect(all.earlier.map(({ run }) => run.id)).toEqual(["failed", "done", "login"]);
    const page = (await service.call("activity.summary", { limit: 2 })) as ActivitySummary;
    expect(page.earlier.map(({ run }) => run.id)).toEqual(["failed", "done"]);
    expect(page.nextBefore).toBe(time(23));
    const next = (await service.call("activity.summary", {
      limit: 2,
      before: page.nextBefore,
    })) as ActivitySummary;
    expect(next.earlier.map(({ run }) => run.id)).toEqual(["login"]);
    expect(next.nextBefore).toBeUndefined();
    const finished = (await service.call("activity.summary", { filter: "finished" })) as ActivitySummary;
    expect(finished.earlier.map(({ run }) => run.id)).toEqual(["done"]);
    const problems = (await service.call("activity.summary", { filter: "problems" })) as ActivitySummary;
    expect(problems.earlier.map(({ run }) => run.id)).toEqual(["failed", "login"]);
  } finally {
    service.stop();
    store.close();
  }
});
