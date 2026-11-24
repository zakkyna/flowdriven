import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createClaudeAdapter } from "../claude/adapter.ts";
import { digestCall } from "../connectors/grants.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { makeFlow } from "../test-helpers/review-flow.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const at = "2026-11-23T00:00:00.000Z";
const hash = `sha256:${"0".repeat(64)}`;

const services: { service: RunnerService; store: Store }[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const { service, store } of services.splice(0)) {
    service.stop();
    store.close();
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("TC-j12-11 turning permission off stops every active run, expires decisions and leaves ended runs unchanged", async () => {
  const store = await openSqliteStore(":memory:");
  const cleared: string[] = [];
  const startedRuns: string[] = [];
  const tool = "log_entry";
  const heldInput = { hours: 2 };
  const base = scriptedHarness({
    steps: {
      "hold-step": {
        hold: {
          requirementId: "host",
          tool,
          input: heldInput,
          digest: digestCall(tool, heldInput),
          effect: "change",
        },
      },
    },
  });
  let idSeq = 0;
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    clearNotice: (id) => cleared.push(id),
    newId: (prefix) => `${prefix}-${++idSeq}`,
    harness: {
      ...base,
      runStep: (req) => {
        if (req.stepId === "work") {
          startedRuns.push(req.runId);
          return new Promise((resolve) => {
            req.signal.addEventListener(
              "abort",
              () => resolve({ exit: "interrupted", text: "", outputs: {} }),
              { once: true },
            );
          });
        }
        return base.runStep(req);
      },
    },
  });
  services.push({ service, store });

  const overlapFlow = makeFlow(
    [{ id: "work", do: "worker", instructions: "Hang", checks: [{ type: "contains", pattern: "ok" }] }],
    { id: "local.overlap" },
  );
  const holdFlow = makeFlow(
    [{ id: "hold-step", do: "worker", instructions: "Hold", checks: [{ type: "contains", pattern: "ok" }] }],
    { id: "local.hold" },
  );
  const otherFlow = makeFlow(
    [
      {
        id: "other-step",
        do: "worker",
        instructions: "Other",
        checks: [{ type: "contains", pattern: "ok" }],
      },
    ],
    { id: "local.other" },
  );
  service.engine.registerFlow(overlapFlow, hash);
  service.engine.registerFlow(holdFlow, hash);
  service.engine.registerFlow(otherFlow, hash);

  await service.call("settings.update", { patch: { agentPermission: "on" } });

  const running = service.engine.beginStart(overlapFlow.id, { project: "." });
  await vi.waitFor(() => expect(startedRuns).toContain(running.run.id));
  const queued = service.engine.beginStart(overlapFlow.id, { project: "." });
  expect(service.engine.waitingOf(queued.run.id).run).toEqual({ reason: "flow_overlap" });
  expect(store.getRun(queued.run.id)?.state).toBe("queued");

  const waiting = await service.engine.startRun(holdFlow.id, { project: "." });
  expect(waiting.state).toBe("waiting_approval");
  expect(store.getStep(waiting.id, "hold-step")?.state).toBe("waiting_approval");
  const pending = store.listApprovals({ runId: waiting.id, state: "pending" }).at(0);
  if (!pending) throw new Error("missing pending approval");

  const seedRun = (id: string, state: "checking" | "retrying" | "failed" | "done", endedAt?: string) =>
    store.createRun({
      id,
      flowId: otherFlow.id,
      flowHash: hash,
      flowVersion: otherFlow.version,
      state,
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: at,
      ...(state === "failed" ? { cause: { code: "step_failed" as const } } : {}),
      ...(endedAt ? { endedAt } : {}),
    });

  seedRun("run-checking", "checking");
  seedRun("run-retrying", "retrying");
  store.upsertStep({
    runId: "run-retrying",
    stepId: "other-step",
    itemKey: "",
    state: "retrying",
    attempts: [],
    outputs: {},
    checks: [],
  });
  seedRun("run-failed", "failed", at);
  store.upsertStep({
    runId: "run-failed",
    stepId: "other-step",
    itemKey: "",
    state: "failed",
    attempts: [],
    outputs: {},
    checks: [],
  });
  seedRun("run-done", "done", at);
  store.upsertStep({
    runId: "run-done",
    stepId: "other-step",
    itemKey: "",
    state: "passed",
    attempts: [],
    outputs: {},
    checks: [],
  });

  await service.call("settings.update", { patch: { agentPermission: "off" } });
  await Promise.all([running.settled, queued.settled]);

  expect(store.getSetting("agentPermission")).toBe("off");

  const activeIds = [queued.run.id, "run-checking", running.run.id, waiting.id, "run-retrying"];
  for (const runId of activeIds) {
    expect(store.getRun(runId)).toMatchObject({
      state: "stopped",
      stoppedBy: "permission_off",
      cause: { code: "permission_off" },
    });
    expect(store.listAudit(runId).filter((entry) => entry.kind === "run_stopped")).toEqual([
      expect.objectContaining({
        kind: "run_stopped",
        runId,
        detail: { runId, by: "permission_off" },
      }),
    ]);
  }

  expect(store.getStep(running.run.id, "work")?.state).toBe("stopped");
  expect(store.getStep(waiting.id, "hold-step")?.state).toBe("stopped");
  expect(store.getStep("run-retrying", "other-step")?.state).toBe("stopped");
  expect(startedRuns).not.toContain(queued.run.id);
  expect(store.listSteps(queued.run.id)).toEqual([]);

  expect(store.getApproval(pending.id)).toMatchObject({
    state: "expired",
    resolvedVia: "permission_off",
  });
  expect(cleared).toContain(`approval:${pending.id}`);
  expect(store.listAudit(waiting.id).filter((entry) => entry.kind === "decision_expired")).toEqual([
    expect.objectContaining({
      kind: "decision_expired",
      runId: waiting.id,
      detail: { approvalId: pending.id, runId: waiting.id, why: "permission_off" },
    }),
  ]);

  expect(store.getRun("run-failed")).toMatchObject({ state: "failed", cause: { code: "step_failed" } });
  expect(store.getRun("run-failed")?.stoppedBy).toBeUndefined();
  expect(store.getStep("run-failed", "other-step")?.state).toBe("failed");
  expect(store.listAudit("run-failed").filter((entry) => entry.kind === "run_stopped")).toEqual([]);

  expect(store.getRun("run-done")).toMatchObject({ state: "done" });
  expect(store.getRun("run-done")?.stoppedBy).toBeUndefined();
  expect(store.getStep("run-done", "other-step")?.state).toBe("passed");
  expect(store.listAudit("run-done").filter((entry) => entry.kind === "run_stopped")).toEqual([]);

  const allAudit = store.listAudit();
  const permOffIndex = allAudit.findIndex(
    (entry) =>
      entry.kind === "permission_changed" &&
      entry.detail &&
      typeof entry.detail === "object" &&
      !Array.isArray(entry.detail) &&
      entry.detail.to === "off",
  );
  const expiredIndex = allAudit.findIndex(
    (entry) => entry.kind === "decision_expired" && entry.runId === waiting.id,
  );
  const firstStoppedIndex = allAudit.findIndex(
    (entry) => entry.kind === "run_stopped" && entry.runId !== undefined && activeIds.includes(entry.runId),
  );
  expect(permOffIndex).toBeGreaterThanOrEqual(0);
  expect(expiredIndex).toBeGreaterThan(permOffIndex);
  expect(firstStoppedIndex).toBeGreaterThan(expiredIndex);

  // Direct engine.stopRun(id, "permission_off") also skips queue promotion for overlapping runs.
  const first = service.engine.beginStart(overlapFlow.id, { project: "." });
  await vi.waitFor(() => expect(startedRuns).toContain(first.run.id));
  const second = service.engine.beginStart(overlapFlow.id, { project: "." });
  expect(service.engine.stopRun(first.run.id, "permission_off")).toMatchObject({
    changed: true,
    run: { state: "stopped", stoppedBy: "permission_off", cause: { code: "permission_off" } },
  });
  await first.settled;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(startedRuns).not.toContain(second.run.id);
  expect(store.getRun(second.run.id)?.state).toBe("queued");
  service.engine.stopRun(second.run.id, "permission_off");
  await second.settled;
});

test("TC-j12-11 permission off kills a hung fake claude child that ignores SIGTERM and spawns no queued run", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-perm-off-")));
  dirs.push(root);
  const home = makeFakeHome({
    plays: [{ when: "Work", actions: [{ do: "ignore_sigterm" }, { do: "pause", ms: 30_000 }] }],
  });
  dirs.push(home);
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
  services.push({ service, store });

  const manifest = makeFlow([
    { id: "work", do: "worker", instructions: "Work", checks: [{ type: "contains", pattern: "ok" }] },
  ]);
  service.engine.registerFlow(manifest, hash);
  await service.call("settings.update", { patch: { agentPermission: "on" } });

  const first = service.engine.beginStart(manifest.id, { project: join(root, "project") });
  await vi.waitFor(() => expect(readFakeCalls(home).some((call) => call.kind === "init")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const second = service.engine.beginStart(manifest.id, { project: join(root, "project") });
  expect(store.getRun(second.run.id)?.state).toBe("queued");

  await service.call("settings.update", { patch: { agentPermission: "off" } });

  expect(signals[0]?.signal).toBe("SIGTERM");
  await vi.waitFor(() => expect(signals.some((entry) => entry.signal === "SIGKILL")).toBe(true));
  const pid = signals[0]?.pid;
  if (pid === undefined) throw new Error("missing process group");
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  expect(() => process.kill(-pid, 0)).toThrow();

  await Promise.all([first.settled, second.settled]);

  expect(store.getRun(first.run.id)).toMatchObject({
    state: "stopped",
    stoppedBy: "permission_off",
    cause: { code: "permission_off" },
  });
  expect(store.getStep(first.run.id, "work")?.state).toBe("stopped");

  expect(store.getRun(second.run.id)).toMatchObject({
    state: "stopped",
    stoppedBy: "permission_off",
    cause: { code: "permission_off" },
  });
  expect(store.listSteps(second.run.id)).toEqual([]);
  expect(readFakeCalls(home).filter((call) => call.kind === "init")).toHaveLength(1);

  for (const runId of [first.run.id, second.run.id]) {
    expect(store.listAudit(runId).filter((entry) => entry.kind === "run_stopped")).toEqual([
      expect.objectContaining({
        kind: "run_stopped",
        runId,
        detail: { runId, by: "permission_off" },
      }),
    ]);
  }
});
