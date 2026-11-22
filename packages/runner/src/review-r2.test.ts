import { expect, test, vi } from "vitest";
import { createEngine } from "./engine.ts";
import type { HarnessAdapter } from "./harness.ts";
import { scriptedHarness } from "./scripted-harness.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import { setup } from "./test-helpers/engine.ts";
import { legacyGrant } from "./test-helpers/policy-fixture.ts";
import { makeFlow } from "./test-helpers/review-flow.ts";

const slowHarness = (ms: number): HarnessAdapter => ({
  id: "slow",
  name: "Slow",
  runStep: (req) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ exit: "ok", text: "ok", outputs: {} }), ms);
      req.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      });
    }),
  replan: async () => undefined,
  judge: async () => {
    throw new Error("no judge");
  },
  probe: async () => {
    throw new Error("no probe");
  },
});

for (const limit of ["24d", "25d"]) {
  test(`a time limit of ${limit} lets a 50 ms attempt finish`, async () => {
    const manifest = makeFlow([
      {
        id: "a",
        do: "worker",
        instructions: "x",
        retry: 0,
        limits: { max_duration: limit, max_attempts: 1 },
        checks: [{ type: "contains", pattern: "ok" }],
      },
    ]);
    const store = await openSqliteStore(":memory:");
    vi.useFakeTimers();
    try {
      const engine = createEngine({ store, harness: slowHarness(50) });
      engine.registerFlow(manifest, "h");
      const pending = engine.startRun("local.test", { project: "/tmp" });
      await vi.advanceTimersByTimeAsync(50);
      const run = await pending;
      expect(run.state).toBe("done");
    } finally {
      vi.useRealTimers();
      store.close();
    }
  });
}

test("a crash between saving waiting_approval and creating the sign-off does not run a non-idempotent step again", async () => {
  const manifest = makeFlow([
    { id: "send", do: "worker", instructions: "Send the mail", checks: [{ type: "user" }] },
  ]);
  const { engine, store, harness } = await setup(manifest, { steps: { send: { text: "sent" } } });
  try {
    const run = await engine.startRun("local.test", { project: "/tmp" });
    expect(run.state).toBe("waiting_approval");
    expect(harness.calls.length).toBe(1);
    // leave the rows as a runner killed after leaf.ts saved the row (line 174) and before createApproval / updateRun (lines 175-189)
    store.updateRun(run.id, { state: "running" });
    // the approval row was never written: drop it from what we read by using a fresh store view is not possible, so expire it as "never created"
    const ap = store.listApprovals().at(0);
    if (ap) store.updateApproval(ap.id, { state: "expired" });
    const harness2 = scriptedHarness({ steps: { send: { text: "sent again" } } });
    const engine2 = createEngine({
      store,
      harness: harness2,
      now: () => new Date("2026-11-11T09:00:01.000Z"),
    });
    await engine2.recoverAfterCrash();
    expect(harness2.calls).toEqual([]);
  } finally {
    store.close();
  }
});

test("TC-j24-08 a grant from ask.approves no longer answers true once the rejected run ends", async () => {
  const manifest = makeFlow([
    {
      id: "alerts",
      do: "worker",
      instructions: "Find",
      outputs: [
        { id: "jobs", type: "json" },
        { id: "message", type: "text" },
      ],
      checks: [{ type: "contains", pattern: "ok" }],
    },
    {
      id: "pick",
      do: "ask",
      ask: {
        question: "Pick",
        choose_from: "${steps.alerts.outputs.jobs}",
        max_pick: 1,
        approves: ["host.publish"],
      },
    },
    { id: "publish", do: "worker", instructions: "Publish", uses: ["host"], checks: [{ type: "user" }] },
  ]);
  const { engine, store } = await setup(manifest, {
    steps: {
      alerts: { text: "ok", outputs: { jobs: [{ id: "j1", title: "Job one" }], message: "m" } },
      publish: { text: "draft" },
    },
  });
  try {
    const run = await engine.startRun("local.test", { project: "/tmp" });
    const ask = engine.listApprovals({ state: "pending" }).at(0);
    if (!ask) throw new Error("no ask");
    await engine.answerAsk(ask.id, { picks: ["j1"] });
    const signoff = engine.listApprovals({ state: "pending" }).at(0);
    if (!signoff) throw new Error("no sign-off");
    const ended = await engine.decide(signoff.id, "reject");
    expect(ended.state).toBe("done");
    expect(store.getStep(run.id, "publish")).toMatchObject({
      state: "skipped",
      skipped: { because: "rejected", approvalId: signoff.id },
    });
    expect(engine.isApproved(run.id, "host.publish", "j1")).toBe(false);
  } finally {
    store.close();
  }
});

test("an attempt ends at its time limit even when the harness ignores the signal", async () => {
  const harness = scriptedHarness({});
  harness.runStep = () => new Promise(() => {});
  const manifest = makeFlow([
    {
      id: "a",
      do: "worker",
      instructions: "x",
      retry: 0,
      limits: { max_duration: "1s", max_attempts: 1 },
      checks: [{ type: "contains", pattern: "ok" }],
    },
  ]);
  const c = await setup(manifest, {}, { harness });
  vi.useFakeTimers();
  try {
    const pending = c.engine.startRun("local.test", { project: "/tmp" });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).state).toBe("blocked");
    expect(c.store.getStep(c.store.listRuns()[0]?.id ?? "", "a")?.note).toBe("time limit exceeded");
  } finally {
    vi.useRealTimers();
    c.store.close();
  }
}, 2000);

test("a re-plan that never returns ends at its time limit", async () => {
  const harness = scriptedHarness({ steps: { a: { exit: "failed" } } });
  harness.replan = () => new Promise(() => {});
  const manifest = makeFlow([
    {
      id: "a",
      do: "worker",
      instructions: "x",
      retry: 0,
      limits: { max_duration: "1s", max_attempts: 2 },
      checks: [{ type: "contains", pattern: "ok" }],
    },
  ]);
  const c = await setup(manifest, {}, { harness });
  vi.useFakeTimers();
  try {
    const pending = c.engine.startRun("local.test", { project: "/tmp" });
    await vi.advanceTimersByTimeAsync(1000);
    const run = await pending;
    expect(run.state).toBe("blocked");
    expect(c.store.getStep(run.id, "a")?.attempts).toHaveLength(2);
  } finally {
    vi.useRealTimers();
    c.store.close();
  }
}, 2000);

test("a probe that never returns ends at the attempt time limit", async () => {
  const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
  harness.probe = () => new Promise(() => {});
  const manifest = makeFlow([
    {
      id: "a",
      do: "worker",
      instructions: "x",
      uses: ["host"],
      retry: 0,
      limits: { max_duration: "1s", max_attempts: 1 },
      checks: [{ type: "probe", tool: "host.publish", args: {} }],
    },
  ]);
  const c = await setup(manifest, {}, { harness });
  vi.useFakeTimers();
  try {
    const pending = c.engine.startRun("local.test", { project: "/tmp" });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).state).toBe("blocked");
  } finally {
    vi.useRealTimers();
    c.store.close();
  }
}, 2000);

test("decide approval rolls back all writes when the step write fails", async () => {
  const manifest = makeFlow([{ id: "a", do: "worker", instructions: "x", checks: [{ type: "user" }] }]);
  const c = await setup(manifest, { steps: { a: { text: "ok" } } });
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    const approval = c.store.listApprovals({ runId: run.id }).at(0);
    if (!approval) throw new Error("missing approval");
    const original = c.store.upsertStep.bind(c.store);
    c.store.upsertStep = () => {
      throw new Error("simulated crash");
    };
    await expect(c.engine.decide(approval.id, "approve")).rejects.toThrow("simulated crash");
    c.store.upsertStep = original;
    expect(c.store.getApproval(approval.id)?.state).toBe("pending");
    expect(c.store.getStep(run.id, "a")?.state).toBe("waiting_approval");
    expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  } finally {
    c.store.close();
  }
});

test("long limits re-arm until the full duration expires", async () => {
  const harness = scriptedHarness({});
  harness.runStep = () => new Promise(() => {});
  const manifest = makeFlow([
    {
      id: "a",
      do: "worker",
      instructions: "x",
      limits: { max_duration: "25d", max_attempts: 1 },
      checks: [{ type: "contains", pattern: "ok" }],
    },
  ]);
  const c = await setup(manifest, {}, { harness });
  vi.useFakeTimers();
  try {
    const pending = c.engine.startRun("local.test", { project: "/tmp" });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(c.store.listRuns().at(0)?.state).toBe("running");
    await vi.advanceTimersByTimeAsync(12_516_352);
    expect(c.store.listRuns().at(0)?.state).toBe("running");
    await vi.advanceTimersByTimeAsync(1);
    const run = await pending;
    expect(run.state).toBe("blocked");
    expect(c.store.getStep(run.id, "a")?.note).toBe("time limit exceeded");
  } finally {
    vi.useRealTimers();
    c.store.close();
  }
});

test.each(["judge", "builtin"] as const)(
  "a %s that never returns ends at the attempt time limit",
  async (kind) => {
    const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
    harness.judge = () => new Promise(() => {});
    const step =
      kind === "judge"
        ? {
            id: "a",
            do: "worker",
            instructions: "x",
            limits: { max_duration: "1s", max_attempts: 1 },
            checks: [{ type: "judge", rubric: "rubric.md" }],
          }
        : {
            id: "a",
            do: "builtin",
            builtin: "hang",
            limits: { max_duration: "1s", max_attempts: 1 },
            checks: [{ type: "contains", pattern: "ok" }],
          };
    const manifest = makeFlow([step]);
    const store = await openSqliteStore(":memory:");
    const engine = createEngine({ store, harness, builtins: { hang: () => new Promise(() => {}) } });
    engine.registerFlow(manifest, "h", { "rubric.md": "rubric" });
    vi.useFakeTimers();
    try {
      const pending = engine.startRun("local.test", { project: "/tmp" });
      await vi.advanceTimersByTimeAsync(1000);
      const run = await pending;
      expect(run.state).toBe("blocked");
      expect(store.getStep(run.id, "a")?.note).toBe("time limit exceeded");
    } finally {
      vi.useRealTimers();
      store.close();
    }
  },
);

test("late worker results do not change a timed-out attempt", async () => {
  const harness = scriptedHarness({});
  let finish: (value: { exit: "ok"; text: string; outputs: Record<string, never> }) => void = () => {};
  harness.runStep = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const manifest = makeFlow([
    {
      id: "a",
      do: "worker",
      instructions: "x",
      limits: { max_duration: "1s", max_attempts: 1 },
      checks: [{ type: "contains", pattern: "ok" }],
    },
  ]);
  const c = await setup(manifest, {}, { harness });
  vi.useFakeTimers();
  try {
    const pending = c.engine.startRun("local.test", { project: "/tmp" });
    await vi.advanceTimersByTimeAsync(1000);
    const run = await pending;
    finish({ exit: "ok", text: "ok", outputs: {} });
    await Promise.resolve();
    expect(c.store.getRun(run.id)?.state).toBe("blocked");
    expect(c.store.getStep(run.id, "a")?.note).toBe("time limit exceeded");
  } finally {
    vi.useRealTimers();
    c.store.close();
  }
});

test("grants are valid only in running and retrying states", async () => {
  const manifest = makeFlow([{ id: "a", do: "worker", instructions: "x", checks: [{ type: "user" }] }]);
  const c = await setup(manifest, { steps: { a: { text: "ok" } } });
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    c.store.putCallGrant(legacyGrant(run.id, "*", "j1", "host.publish"));
    for (const state of [
      "running",
      "retrying",
      "waiting_approval",
      "blocked",
      "failed",
      "done",
      "interrupted",
      "checking",
      "queued",
    ] as const) {
      c.store.updateRun(run.id, { state });
      expect(c.engine.isApproved(run.id, "host.publish", "j1"), state).toBe(
        state === "running" || state === "retrying",
      );
    }
  } finally {
    c.store.close();
  }
});
