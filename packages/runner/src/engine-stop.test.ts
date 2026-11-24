import { expect, test } from "vitest";
import { createRunnerService } from "./service/service.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import { pendingDecision } from "./test-helpers/builders.ts";

const at = "2026-11-23T00:00:00.000Z";

test("TC-j24-33 TC-SR8-03 TC-ENG-08 stop expires decisions and clears notices in each active state", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    clearNotice: (id) => cleared.push(id),
  });
  try {
    for (const state of [
      "queued",
      "checking",
      "running",
      "retrying",
      "waiting_approval",
      "needs_login",
    ] as const) {
      const decision = pendingDecision(store, { id: state, createdAt: at });
      store.updateRun(decision.runId, { state });
      if (state === "waiting_approval") store.createApproval({ ...decision, id: "second-decision" });
      expect(await service.call("runs.stop", { runId: decision.runId })).toMatchObject({
        changed: true,
        run: { state: "stopped", cause: { code: "stopped" } },
      });
      expect(store.getRun(decision.runId)?.stoppedBy).toBe("person");
      expect(store.getApproval(decision.id)).toMatchObject({ state: "expired", resolvedVia: "stop" });
      expect(cleared).toContain(`approval:${decision.id}`);
      if (state === "waiting_approval") {
        expect(store.getApproval("second-decision")).toMatchObject({ state: "expired", resolvedVia: "stop" });
        expect(cleared).toContain("approval:second-decision");
        expect(await service.call("runs.report", { runId: decision.runId })).toMatchObject({
          decisionLines: [],
        });
      }
      expect(store.listAudit(decision.runId)).toContainEqual(
        expect.objectContaining({
          kind: "decision_expired",
          detail: { approvalId: decision.id, runId: decision.runId, why: "stop" },
        }),
      );
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j25-21 TC-ENG-09 ended runs are unchanged and unknown runs fail", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    for (const state of ["done", "failed", "stopped"] as const) {
      const decision = pendingDecision(store, { id: state, createdAt: at });
      store.updateRun(decision.runId, { state });
      expect(await service.call("runs.stop", { runId: decision.runId })).toMatchObject({
        changed: false,
        run: { state },
      });
      expect(store.listAudit(decision.runId).filter((row) => row.kind === "run_stopped")).toHaveLength(0);
    }
    await expect(service.call("runs.stop", { runId: "run-999999999999" })).rejects.toMatchObject({
      code: "not_found",
    });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-ENG-08 flow deletion stops blocked and interrupted runs", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    for (const state of ["blocked", "interrupted"] as const) {
      const decision = pendingDecision(store, { id: state, createdAt: at });
      store.updateRun(decision.runId, { state });
      service.engine.stopRun(decision.runId, "flow_deleted");
      expect(store.getRun(decision.runId)).toMatchObject({ state: "stopped", stoppedBy: "flow_deleted" });
      expect(store.getApproval(decision.id)).toMatchObject({ state: "expired", resolvedVia: "stop" });
      expect(store.listAudit(decision.runId).filter((row) => row.kind === "decision_expired")).toMatchObject([
        { detail: { approvalId: decision.id, runId: decision.runId, why: "flow_deleted" } },
      ]);
    }
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-34 TC-SR8-04 permission off expires the decision and stops both runs", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    clearNotice: (id) => cleared.push(id),
  });
  try {
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    const decision = pendingDecision(store, { id: "permission", createdAt: at });
    const running = pendingDecision(store, { id: "running-permission", createdAt: at });
    store.updateRun(running.runId, { state: "running" });
    store.updateApproval(running.id, { state: "approved", resolvedVia: "window" });
    await service.call("settings.update", { patch: { agentPermission: "off" } });
    expect(store.getApproval(decision.id)).toMatchObject({ state: "expired", resolvedVia: "permission_off" });
    expect(store.getRun(decision.runId)).toMatchObject({
      state: "stopped",
      cause: { code: "permission_off" },
    });
    expect(store.getRun(running.runId)).toMatchObject({
      state: "stopped",
      cause: { code: "permission_off" },
    });
    expect(
      store
        .listAudit()
        .filter(
          (row) =>
            row.kind === "permission_changed" &&
            row.detail &&
            typeof row.detail === "object" &&
            !Array.isArray(row.detail) &&
            row.detail.to === "off",
        ),
    ).toHaveLength(1);
    expect(cleared).toContain(`approval:${decision.id}`);
    expect(store.listAudit(decision.runId).filter((row) => row.kind === "decision_expired")).toMatchObject([
      { detail: { approvalId: decision.id, runId: decision.runId, why: "permission_off" } },
    ]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-30 TC-RUL-04 stopped and permission-off decisions refuse later answers", async () => {
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const { digestCall, callGrant } = await import("./connectors/grants.ts");
    const tool = "mcp__claude_ai_Gmail__reply";
    const input = { body: "Hello" };
    const digest = digestCall(tool, input);
    const stopped = pendingDecision(store, { id: "stop-answer", createdAt: at });
    store.updateApproval(stopped.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      call: { tool, input },
      approves: [callGrant("mail", tool, digest)],
    });
    await service.call("runs.stop", { runId: stopped.runId });
    await expect(
      service.call("approvals.resolve", { approvalId: stopped.id, decision: "approve" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    const choice = pendingDecision(store, { id: "stopped-choice", createdAt: at });
    store.updateApproval(choice.id, {
      kind: "ask",
      maxPick: 1,
      payload: { question: "Choose", options: [{ key: "a", label: "A", item: { id: "a" } }], maxPick: 1 },
    });
    await service.call("runs.stop", { runId: choice.runId });
    await expect(
      service.call("approvals.answer", { approvalId: choice.id, picks: ["a"] }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    expect(
      store.findGrant({
        runId: stopped.runId,
        stepId: stopped.stepId,
        itemKey: stopped.itemKey,
        tool,
        digest,
        kind: "approve",
        createdAt: "",
      }),
    ).toBeUndefined();
    const off = pendingDecision(store, { id: "off-answer", createdAt: at });
    const offChoice = pendingDecision(store, { id: "off-choice", createdAt: at });
    store.updateApproval(offChoice.id, {
      kind: "ask",
      maxPick: 1,
      payload: { question: "Choose", options: [{ key: "a", label: "A", item: { id: "a" } }], maxPick: 1 },
    });
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    await service.call("settings.update", { patch: { agentPermission: "off" } });
    await expect(
      service.call("approvals.resolve", { approvalId: off.id, decision: "approve" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    await expect(
      service.call("approvals.answer", { approvalId: offChoice.id, picks: ["a"] }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-ENG-07 TC-ENG-10 TC-SR1-19 TC-SR1-20 stop aborts active work and releases the next run", async () => {
  const { createEngine } = await import("./engine.ts");
  const { scriptedHarness } = await import("./scripted-harness.ts");
  const { makeFlow } = await import("./test-helpers/review-flow.ts");
  const { vi } = await import("vitest");
  const store = await openSqliteStore(":memory:");
  const calls: string[] = [];
  let aborted = false;
  const base = scriptedHarness({});
  const engine = createEngine({
    store,
    harness: {
      ...base,
      runStep: (req) => {
        calls.push(req.runId);
        return new Promise((resolve) => {
          req.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve({ exit: "interrupted", text: "", outputs: {} });
            },
            { once: true },
          );
        });
      },
    },
    newId: (() => {
      let n = 0;
      return (prefix: string) => `${prefix}-${++n}`;
    })(),
  });
  try {
    engine.registerFlow(
      makeFlow([
        { id: "work", do: "worker", instructions: "Work", checks: [{ type: "contains", pattern: "ok" }] },
        { id: "later", do: "worker", instructions: "Later", checks: [{ type: "contains", pattern: "ok" }] },
      ]),
      `sha256:${"0".repeat(64)}`,
    );
    const first = engine.beginStart("local.test", { project: "." });
    await vi.waitFor(() => expect(calls).toEqual([first.run.id]));
    const second = engine.beginStart("local.test", { project: "." });
    expect(engine.waitingOf(second.run.id).run).toEqual({ reason: "flow_overlap" });
    engine.stopRun(first.run.id, "person");
    await first.settled;
    expect(aborted).toBe(true);
    expect(store.getRun(first.run.id)).toMatchObject({ state: "stopped", cause: { code: "stopped" } });
    expect(store.getStep(first.run.id, "work")?.state).toBe("stopped");
    expect(store.getStep(first.run.id, "later")).toBeUndefined();
    await vi.waitFor(() => expect(calls).toContain(second.run.id));
    expect(engine.waitingOf(second.run.id).run).toBeUndefined();
    engine.stopRun(second.run.id, "person");
    await second.settled;
  } finally {
    engine.shutdown();
    store.close();
  }
});

test("TC-j25-21 TC-ENG-07 Stop ends the fake agent process group and starts the queued run", {
  timeout: 20000,
}, async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { vi } = await import("vitest");
  const { createClaudeAdapter } = await import("./claude/adapter.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } = await import(
    "./test-helpers/fake-claude-script.ts"
  );
  const { makeFlow } = await import("./test-helpers/review-flow.ts");
  const root = mkdtempSync(join(tmpdir(), "flow-stop-"));
  const home = makeFakeHome({
    plays: [{ when: "Work", actions: [{ do: "ignore_sigterm" }, { do: "pause", ms: 30000 }] }],
  });
  mkdirSync(join(root, "project"));
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  let id = 0;
  const store = await openSqliteStore(":memory:");
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
    controlRoot: join(root, "control"),
    audit: () => {},
    newId: () => `cc-${++id}`,
    newSessionId: () => `session-${++id}`,
    graceMs: 50,
    killGroup: (pid, signal) => {
      signals.push({ pid, signal });
      process.kill(-pid, signal);
    },
  });
  const service = createRunnerService({
    store,
    dataDir: root,
    mode: "demo",
    harness: adapter,
    newId: (prefix) => `${prefix}-${++id}`,
  });
  try {
    const manifest = makeFlow([
      { id: "work", do: "worker", instructions: "Work", checks: [{ type: "contains", pattern: "ok" }] },
    ]);
    service.engine.registerFlow(manifest, `sha256:${"0".repeat(64)}`);
    const first = service.engine.beginStart(manifest.id, { project: join(root, "project") });
    await vi.waitFor(() => expect(readFakeCalls(home).some((call) => call.kind === "init")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = service.engine.beginStart(manifest.id, { project: join(root, "project") });
    expect(await service.call("runs.stop", { runId: first.run.id })).toMatchObject({
      changed: true,
      run: { state: "stopped" },
    });
    expect(signals[0]?.signal).toBe("SIGTERM");
    await vi.waitFor(() => expect(signals.some((entry) => entry.signal === "SIGKILL")).toBe(true));
    const pid = signals[0]?.pid;
    if (pid === undefined) throw new Error("missing process group");
    await vi.waitFor(() => expect(() => process.kill(-pid, 0)).toThrow());
    await vi.waitFor(() => expect(store.getRun(second.run.id)?.state).toBe("running"));
    expect(store.getStep(first.run.id, "work")?.state).toBe("stopped");
    expect(store.listAudit(first.run.id).filter((entry) => entry.kind === "run_stopped")).toMatchObject([
      { detail: { runId: first.run.id, by: "person" } },
    ]);
    service.engine.stopRun(second.run.id, "person");
    await second.settled;
  } finally {
    service.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-ENG-08 Stop marks all four read topics", async () => {
  const store = await openSqliteStore(":memory:");
  const topics: string[] = [];
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    markChanged: (topic) => topics.push(topic),
  });
  try {
    const decision = pendingDecision(store, { id: "topics", createdAt: at });
    await service.call("runs.stop", { runId: decision.runId });
    expect(topics).toEqual(expect.arrayContaining(["runs", "approvals", "chats", "activity"]));
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-34 a trigger tick after permission off starts no run", async () => {
  const { triggerFlow, triggerRig } = await import("./test-helpers/trigger-rig.ts");
  const { cleanup } = await import("./test-helpers/tmp.ts");
  const id = "local.permission-stop";
  const rig = await triggerRig([
    { manifest: triggerFlow(id, [{ kind: "schedule", every: "1m", overlap: "queue" }]) },
  ]);
  const service = createRunnerService({ store: rig.store, dataDir: ".", mode: "demo" });
  try {
    rig.enable(id, 0);
    await service.call("settings.update", { patch: { agentPermission: "off" } });
    rig.clock.advance(60000);
    await rig.svc.tick();
    await rig.idle();
    expect(rig.runsOf(id)).toHaveLength(0);
  } finally {
    service.stop();
    rig.svc.stop();
    rig.engine.shutdown();
    rig.store.close();
    cleanup();
  }
});
