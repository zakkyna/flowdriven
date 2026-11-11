import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
const folders: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

test("runs steps in order and binds inputs, params and earlier outputs", async () => {
  const project = mkdtempSync(join(tmpdir(), "flowdriven-"));
  folders.push(project);
  writeFileSync(join(project, "out.txt"), "done");
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    inputs: [{ id: "file", type: "file", label: "File", required: true }],
    params: { n: { type: "number", default: 3 } },
    requirements: [{ id: "host", type: "mcp_server", tools: ["publish"] }],
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Summarise ${inputs.file} in ${params.n} bullets",
        outputs: [{ id: "draft", type: "text" }],
        checks: [
          { type: "files", paths: ["out.txt"], min_count: 1 },
          { type: "contains", pattern: "D1" },
        ],
      },
      {
        id: "b",
        do: "agent",
        instructions: "Polish ${steps.a.outputs.draft}",
        checks: [{ type: "contains", pattern: "done" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const { engine, store, harness } = await setup(parsed.manifest, {
    steps: { a: { outputs: { draft: "D1" } }, b: { text: "done" } },
  });
  stores.push(store);
  const run = await engine.startRun(parsed.manifest.id, { project, inputs: { file: "notes.md" } });
  expect(run.state).toBe("done");
  expect(harness.calls.map((c) => c.stepId)).toEqual(["a", "b"]);
  expect(harness.calls.at(0)?.instructions).toBe("Summarise notes.md in 3 bullets");
  expect(harness.calls.at(1)?.instructions).toBe("Polish D1");
  expect(store.getStep(run.id, "a")?.attempts.at(0)?.worker).toBe("Scripted harness");
});

const makeFlow = (steps: unknown[], extra: Record<string, unknown> = {}) => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    requirements: [{ id: "host", type: "mcp_server", tools: ["publish"] }],
    steps,
    ...extra,
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
};
const worker = (extra: Record<string, unknown> = {}) => ({
  id: "a",
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
  ...extra,
});
async function ready(
  steps: unknown[],
  script: Parameters<typeof setup>[1],
  extra: Record<string, unknown> = {},
  options: Parameters<typeof setup>[2] = {},
) {
  const manifest = makeFlow(steps, extra);
  const ctx = await setup(manifest, script, options);
  stores.push(ctx.store);
  return { ...ctx, start: () => ctx.engine.startRun(manifest.id, { project: "/tmp" }) };
}

test("a false when skips the step, and a dependent reads as not passed", async () => {
  const c = await ready([worker({ when: "false" }), worker({ id: "b", when: "a.passed" })], {});
  const run = await c.start();
  expect(c.store.getStep(run.id, "a")).toMatchObject({ state: "skipped", note: "skipped: condition false" });
  expect(c.store.getStep(run.id, "b")?.state).toBe("skipped");
});
test("retries with the failure text, re-plans once, then blocks", async () => {
  const c = await ready([worker({ checks: [{ type: "contains", pattern: "zzz" }], retry: 2 })], {
    steps: { a: { text: "no" } },
    replan: () => ({ instructions: "split it" }),
  });
  const run = await c.start();
  expect(c.harness.calls.length).toBe(4);
  expect(c.harness.calls.at(1)?.lastFailure).toContain("zzz");
  expect(c.harness.replanCalls.length).toBe(1);
  expect(c.harness.calls.at(3)).toMatchObject({ attempt: 4, replan: true, instructions: "split it" });
  expect(run).toMatchObject({
    state: "blocked",
    blockedReason: 'Blocked at step "a": checks still failing after 4 attempts.',
  });
  expect(c.store.getStep(run.id, "a")).toMatchObject({ state: "failed" });
});
test("a missing declared output fails the attempt; undeclared outputs are dropped", async () => {
  const c = await ready(
    [worker({ outputs: [{ id: "draft", type: "text" }], checks: [{ type: "contains", pattern: "D" }] })],
    {
      steps: { a: [{ outputs: {} }, { outputs: JSON.parse('{"draft":"D","extra":1,"__proto__":{"x":1}}') }] },
    },
  );
  const run = await c.start();
  const row = c.store.getStep(run.id, "a");
  expect(row?.attempts.at(0)?.exit).toBe("failed");
  expect(row?.outputs).toEqual({ draft: "D" });
  expect(Object.getPrototypeOf(row?.outputs)).toBe(Object.prototype);
});
test("a harness that throws fails the attempt, never the engine", async () => {
  let n = 0;
  const c = await ready([worker()], {
    steps: {
      a: () => {
        if (++n === 1) throw new Error("socket closed");
        return { text: "ok" };
      },
    },
  });
  const run = await c.start();
  expect(c.store.getStep(run.id, "a")?.attempts.at(0)?.exit).toBe("failed");
  expect(c.harness.calls.at(1)?.lastFailure).toContain("socket closed");
  expect(run.state).toBe("done");
});
test("quota and auth block the run without a retry", async () => {
  for (const [exit, reason] of [
    ["auth", "The harness needs you to sign in."],
    ["quota", "The harness has no quota left."],
  ] as const) {
    const c = await ready([worker()], { steps: { a: { exit } } });
    const run = await c.start();
    expect(c.harness.calls.length).toBe(1);
    expect(run).toMatchObject({ state: "blocked", blockedReason: reason });
  }
});
test("max_attempts caps the attempts, re-plan included", async () => {
  for (const [limits, extra, count] of [
    [{ max_attempts: 2 }, {}, 2],
    [undefined, { limits: { max_attempts: 3 } }, 3],
  ] as const) {
    const c = await ready(
      [worker({ retry: 5, ...(limits ? { limits } : {}) })],
      { steps: { a: { text: "no" } } },
      extra,
    );
    await c.start();
    expect(c.harness.calls.length).toBe(count);
  }
});
test("a step stops at its time limit and the request carries it", async () => {
  vi.useFakeTimers();
  try {
    const c = await ready([worker({ retry: 0, limits: { max_duration: "1m", max_attempts: 1 } })], {
      steps: { a: { hang: true } },
    });
    const pending = c.start();
    await vi.advanceTimersByTimeAsync(60_000);
    const run = await pending;
    expect(c.store.getStep(run.id, "a")?.attempts.at(0)?.exit).toBe("failed");
    expect(c.harness.calls.at(0)?.maxDurationMs).toBe(60_000);
    for (const [stepLimits, flowLimits, expected] of [
      [undefined, undefined, 1800000],
      [undefined, { max_duration: "150m" }, 9000000],
      [{ max_duration: "1m" }, { max_duration: "150m" }, 60000],
    ] as const) {
      const d = await ready(
        [worker({ ...(stepLimits ? { limits: stepLimits } : {}) })],
        { steps: { a: { text: "ok" } } },
        flowLimits ? { limits: flowLimits } : {},
      );
      await d.start();
      expect(d.harness.calls.at(0)?.maxDurationMs).toBe(expected);
    }
  } finally {
    vi.useRealTimers();
  }
});
test("a user check holds the run, approve completes it, reject fails it", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: { text: "ok" } } });
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    const ap = c.engine.listApprovals({ state: "pending" }).at(0);
    expect(ap).toMatchObject({ kind: "result_sign_off", itemKey: "", expiresAt: "2026-11-12T09:00:00.000Z" });
    if (!ap) throw new Error("missing approval");
    const result = await c.engine.decide(ap.id, decision);
    expect(result.state).toBe(decision === "approve" ? "done" : "failed");
    if (decision === "reject") {
      expect(result.endedAt).toBeDefined();
      expect(c.engine.listApprovals().at(0)?.state).toBe("rejected");
    }
  }
});
test("a result sign-off expires after 24 hours and fails the run", async () => {
  const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: {} } });
  const run = await c.start();
  c.clock.advance(24 * 3600000 + 1);
  const view = c.engine.getRun(run.id);
  expect(view.run.state).toBe("failed");
  const ap = view.approvals.at(0);
  expect(ap).toMatchObject({ state: "expired", resolvedAt: "2026-11-12T09:00:00.000Z" });
  expect(c.store.getStep(run.id, "a")?.note).toBe("The approval expired after 24 hours.");
  if (!ap) throw new Error("missing approval");
  await expect(c.engine.decide(ap.id, "approve")).rejects.toMatchObject({
    code: "not_allowed",
    message: "This approval expired.",
  });
});
test("a failing readiness hook blocks the run before any step", async () => {
  const c = await ready(
    [worker()],
    {},
    {},
    { readiness: () => ({ ready: false, reason: "Gmail is not connected." }) },
  );
  const run = await c.start();
  expect(run).toMatchObject({ state: "blocked", blockedReason: "Gmail is not connected." });
  expect(c.harness.calls).toEqual([]);
});
test("an unresolved reference fails the step with no retry", async () => {
  const c = await ready(
    [worker({ instructions: "${inputs.file}" })],
    {},
    { inputs: [{ id: "file", type: "file", label: "File" }] },
  );
  const run = await c.start();
  expect(c.harness.calls).toEqual([]);
  expect(run.state).toBe("blocked");
  expect(run.blockedReason).toContain("inputs.file");
});
test("refuses a trigger kind the flow does not declare", async () => {
  const c = await ready([worker()], {});
  await expect(
    c.engine.startRun("local.test", { project: "/tmp", trigger: { kind: "schedule" } }),
  ).rejects.toMatchObject({ code: "not_allowed", message: "This flow has no schedule trigger." });
  expect(c.engine.listRuns()).toEqual([]);
});
test("max_runs_per_day counts only non-manual starts", async () => {
  const c = await ready(
    [worker()],
    { steps: { a: { text: "ok" } } },
    { triggers: [{ kind: "schedule", every: "1h" }], limits: { max_runs_per_day: 2 } },
  );
  for (let i = 0; i < 2; i++)
    await c.engine.startRun("local.test", { project: "/tmp", trigger: { kind: "schedule" } });
  await expect(
    c.engine.startRun("local.test", { project: "/tmp", trigger: { kind: "schedule" } }),
  ).rejects.toMatchObject({ code: "not_allowed" });
  expect(c.store.listAudit().some((a) => a.kind === "run_dropped")).toBe(true);
  await c.start();
});

test("an unknown builtin fails with its reason", async () => {
  const c = await ready([{ id: "a", do: "builtin", builtin: "absent", checks: [{ type: "user" }] }], {});
  const run = await c.start();
  expect(run.state).toBe("blocked");
  expect(c.store.getStep(run.id, "a")).toMatchObject({ state: "failed", note: "unknown builtin" });
});

test("an ask decision for an unknown id still sweeps expired sign-offs", async () => {
  const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: {} } });
  const run = await c.start();
  c.clock.advance(86400001);
  await expect(c.engine.answerAsk("missing", { picks: [] })).rejects.toMatchObject({ code: "not_found" });
  expect(c.store.getRun(run.id)?.state).toBe("failed");
});

test("a sign-off attempt is successful only after approval", async () => {
  const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: {} } });
  const run = await c.start();
  expect(c.store.getStep(run.id, "a")?.attempts.at(0)?.exit).toBeUndefined();
  const approval = c.engine.listApprovals().at(0);
  if (!approval) throw new Error("missing approval");
  await c.engine.decide(approval.id, "approve");
  expect(c.store.getStep(run.id, "a")?.attempts.at(0)?.exit).toBe("ok");
});

test("rejects undeclared inputs", async () => {
  const c = await ready([worker()], {});
  await expect(
    c.engine.startRun("local.test", { project: "/tmp", inputs: { unexpected: "x" } }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(c.engine.listRuns()).toEqual([]);
});
