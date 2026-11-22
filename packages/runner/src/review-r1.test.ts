import { validateManifest } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { scriptedHarness } from "./scripted-harness.ts";
import { setup } from "./test-helpers/engine.ts";
import { makeFlow } from "./test-helpers/review-flow.ts";

const worker = (id: string) => ({
  id,
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
});
const steps = (conditional = false) => [
  {
    ...worker("alerts"),
    outputs: [
      { id: "jobs", type: "json" },
      { id: "message", type: "text" },
    ],
  },
  {
    id: "pick",
    do: "ask",
    ...(conditional ? { when: "params.never == true" } : {}),
    ask: { question: "Pick", choose_from: "${steps.alerts.outputs.jobs}", max_pick: 1 },
  },
  { ...worker("publish"), uses: ["host"] },
];
const extra = {
  triggers: [{ kind: "schedule", every: "1h" }],
  params: { never: { type: "bool", default: false } },
};
const script = {
  steps: { alerts: { text: "ok", outputs: { jobs: [], message: "m" } }, publish: { text: "ok" } },
};

test("a scheduled run never reaches a risky step when the first ask is skipped by its when", async () => {
  const manifest = makeFlow(steps(true), extra);
  expect(validateManifest(manifest).map((i) => i.code)).toContain("unattended_prefix");
  const c = await setup(makeFlow([worker("a")]), {});
  try {
    expect(() => c.engine.registerFlow(manifest, "hash")).toThrow("unattended prefix");
  } finally {
    c.store.close();
  }
});

test("a scheduled run never reaches a risky step when the first ask is passing with no options", async () => {
  const c = await setup(makeFlow(steps(), extra), script);
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp", trigger: { kind: "schedule" } });
    expect(run.state).toBe("done");
    expect(c.harness.calls.map((call) => call.stepId)).toEqual(["alerts"]);
    expect(c.engine.listApprovals()).toEqual([]);
    expect(c.store.getStep(run.id, "pick")).toMatchObject({
      state: "passed",
      outputs: { choice: [] },
      note: "nothing to choose: the run ended here",
    });
    expect(c.store.getStep(run.id, "publish")).toMatchObject({
      state: "skipped",
      note: "skipped: the run ended at a choice with no options",
    });
    const manual = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(manual.state).toBe("done");
    expect(c.harness.calls.map((call) => call.stepId)).toContain("publish");
  } finally {
    c.store.close();
  }
});

test("an exception inside the walk does not leave the run running and startRun does not throw after the row exists", async () => {
  const c = await setup(makeFlow([worker("a")]), { steps: { a: { text: "ok" } } });
  try {
    const original = c.store.listSteps.bind(c.store);
    let once = true;
    c.store.listSteps = (...args) => {
      if (once) {
        once = false;
        throw new Error("walk crashed");
      }
      return original(...args);
    };
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(run).toMatchObject({ state: "blocked", blockedReason: "Internal error: walk crashed" });
    expect(c.store.listAudit(run.id).filter((a) => a.kind === "run_error")).toMatchObject([
      { detail: { message: "walk crashed" } },
    ]);
  } finally {
    c.store.close();
  }
});

test("a readiness hook that throws does not leave the run in checking", async () => {
  const c = await setup(
    makeFlow([worker("a")]),
    {},
    {
      readiness: () => {
        throw new Error("probe crashed");
      },
    },
  );
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(run).toMatchObject({ state: "blocked", blockedReason: "Internal error: probe crashed" });
    expect(c.store.listAudit(run.id).filter((a) => a.kind === "run_error")).toHaveLength(1);
    expect((await c.engine.resumeRun(run.id)).state).toBe("blocked");
  } finally {
    c.store.close();
  }
});

test("recoverAfterCrash handles every run even when resuming one of them throws", async () => {
  const c = await setup(makeFlow([worker("a")]), { steps: { a: { text: "ok" } } });
  try {
    const first = await c.engine.startRun("local.test", { project: "/tmp" });
    const second = await c.engine.startRun("local.test", { project: "/tmp" });
    c.store.updateRun(first.id, { state: "queued" });
    c.store.updateRun(second.id, { state: "queued" });
    const original = c.store.listSteps.bind(c.store);
    let once = true;
    c.store.listSteps = (...args) => {
      if (once) {
        once = false;
        throw new Error("recovery crashed");
      }
      return original(...args);
    };
    await c.engine.recoverAfterCrash();
    expect(c.store.getRun(first.id)).toMatchObject({
      state: "blocked",
      blockedReason: "Internal error: recovery crashed",
    });
    expect(c.store.getRun(second.id)?.state).toBe("done");
    expect(c.store.listAudit(first.id).filter((a) => a.kind === "run_error")).toHaveLength(1);
  } finally {
    c.store.close();
  }
});

test("resuming a run blocked by readiness checks readiness again before any step", async () => {
  const c = await setup(
    makeFlow([worker("a")]),
    { steps: { a: { text: "ok" } } },
    { readiness: () => ({ ready: false, reason: "Gmail is not connected." }) },
  );
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    expect(await c.engine.resumeRun(run.id)).toMatchObject({
      state: "blocked",
      blockedReason: "Gmail is not connected.",
    });
    expect(c.harness.calls).toEqual([]);
  } finally {
    c.store.close();
  }
});

test("a queued run recovered after a crash goes through readiness", async () => {
  const c = await setup(
    makeFlow([worker("a")]),
    { steps: { a: { text: "ok" } } },
    { readiness: () => ({ ready: false, reason: "Gmail is not connected." }) },
  );
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    c.store.updateRun(run.id, { state: "queued" });
    await c.engine.recoverAfterCrash();
    expect(c.store.getRun(run.id)).toMatchObject({
      state: "blocked",
      blockedReason: "Gmail is not connected.",
    });
    expect(c.harness.calls).toEqual([]);
  } finally {
    c.store.close();
  }
});

test("an unknown harness exit fails closed", async () => {
  const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
  harness.runStep = async () => ({ exit: "typo" as "ok", text: "ok", outputs: {} });
  const c = await setup(makeFlow([worker("a")]), {}, { harness });
  try {
    expect((await c.engine.startRun("local.test", { project: "/tmp" })).state).toBe("blocked");
  } finally {
    c.store.close();
  }
});

test("TC-j24-31 resume leaves an unanswered choice pending without a deadline", async () => {
  const manifest = makeFlow(
    [
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Pick",
          choose_from: "${inputs.jobs}",
          max_pick: 1,
          expires: "1h",
          on_expiry: "fail",
        },
      },
      worker("a"),
    ],
    { inputs: [{ id: "jobs", type: "list<text>", label: "Jobs" }] },
  );
  const c = await setup(manifest, { steps: { a: { text: "ok" } } });
  try {
    const run = await c.engine.startRun("local.test", { project: "/tmp", inputs: { jobs: [{ id: "j1" }] } });
    c.clock.advance(3600001);
    await expect(c.engine.resumeRun(run.id)).rejects.toMatchObject({ code: "not_allowed" });
    expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
    expect(c.store.listApprovals({ runId: run.id }).map((a) => a.state)).toContain("pending");
  } finally {
    c.store.close();
  }
});

test("walk errors after answering or approving return a blocked run", async () => {
  for (const mode of ["ask", "signoff"] as const) {
    const first =
      mode === "ask"
        ? { id: "first", do: "ask", ask: { question: "Pick", choose_from: "${inputs.jobs}", max_pick: 1 } }
        : { ...worker("first"), checks: [{ type: "user" }] };
    const c = await setup(
      makeFlow([first, worker("next")], { inputs: [{ id: "jobs", type: "list<text>", label: "Jobs" }] }),
      { steps: { first: { text: "ok" }, next: { text: "ok" } } },
    );
    try {
      const run = await c.engine.startRun("local.test", {
        project: "/tmp",
        inputs: { jobs: [{ id: "j1" }] },
      });
      const approval = c.store.listApprovals({ runId: run.id }).at(0);
      if (!approval) throw new Error("missing approval");
      const original = c.store.getStep.bind(c.store);
      let failed = false;
      c.store.getStep = (...args) => {
        if (args[1] === "next" && !failed) {
          failed = true;
          throw new Error("x".repeat(250));
        }
        return original(...args);
      };
      const result =
        mode === "ask"
          ? await c.engine.answerAsk(approval.id, { picks: ["j1"] })
          : await c.engine.decide(approval.id, "approve");
      expect(result).toMatchObject({ state: "blocked", blockedReason: `Internal error: ${"x".repeat(200)}` });
      expect(c.store.listAudit(run.id).filter((a) => a.kind === "run_error")).toMatchObject([
        { detail: { message: "x".repeat(200) } },
      ]);
    } finally {
      c.store.close();
    }
  }
});

test("a store exception inside an ask is recorded as an internal error", async () => {
  const c = await setup(makeFlow(steps(), extra), script);
  try {
    const original = c.store.upsertStep.bind(c.store);
    let once = true;
    c.store.upsertStep = (row) => {
      if (row.stepId === "pick" && once) {
        once = false;
        throw new Error("store crashed");
      }
      return original(row);
    };
    const run = await c.engine.startRun("local.test", { project: "/tmp", trigger: { kind: "schedule" } });
    expect(run).toMatchObject({ state: "blocked", blockedReason: "Internal error: store crashed" });
    expect(c.store.listAudit(run.id).filter((a) => a.kind === "run_error")).toHaveLength(1);
  } finally {
    c.store.close();
  }
});
