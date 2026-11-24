import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunDetail } from "@flowdriven/contracts";
import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { createClaudeAdapter } from "./claude/adapter.ts";
import { createGrantBook } from "./connectors/grants.ts";
import { createEngine } from "./engine.ts";
import { toRunDetail } from "./service/map-run.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "./test-helpers/fake-claude-script.ts";

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
test("quota blocks and auth waits for sign-in without a retry", async () => {
  for (const [exit, reason] of [
    ["auth", "The harness needs you to sign in."],
    ["quota", "The harness has no quota left."],
  ] as const) {
    const c = await ready([worker()], { steps: { a: { exit } } });
    const run = await c.start();
    expect(c.harness.calls.length).toBe(1);
    expect(run).toMatchObject({ state: exit === "auth" ? "needs_login" : "blocked", blockedReason: reason });
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
test("TC-j24-08 a user check holds the run and either decision completes it", async () => {
  for (const decision of ["approve", "reject"] as const) {
    const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: { text: "ok" } } });
    const run = await c.start();
    expect(run.state).toBe("waiting_approval");
    const ap = c.engine.listApprovals({ state: "pending" }).at(0);
    expect(ap).toMatchObject({ kind: "result_sign_off", itemKey: "", expiresAt: "2026-11-12T09:00:00.000Z" });
    if (!ap) throw new Error("missing approval");
    const result = await c.engine.decide(ap.id, decision);
    expect(result.state).toBe("done");
    if (decision === "reject") {
      expect(result.endedAt).toBeDefined();
      expect(c.engine.listApprovals().at(0)?.state).toBe("rejected");
      expect(c.store.getStep(run.id, "a")).toMatchObject({
        state: "skipped",
        skipped: { because: "rejected", approvalId: ap.id },
      });
    }
  }
});
test("TC-RUL-04 a sign-off remains answerable after 25 hours", async () => {
  const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: {} } });
  const run = await c.start();
  c.clock.advance(25 * 3600000);
  const view = c.engine.getRun(run.id);
  expect(view.run.state).toBe("waiting_approval");
  const ap = view.approvals.at(0);
  expect(ap?.state).toBe("pending");
  expect(c.store.getStep(run.id, "a")?.state).toBe("waiting_approval");
  if (!ap) throw new Error("missing approval");
  expect((await c.engine.decide(ap.id, "approve")).state).toBe("done");
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

test("TC-ENG-15 an unknown answer leaves a late sign-off pending", async () => {
  const c = await ready([worker({ checks: [{ type: "user" }] })], { steps: { a: {} } });
  const run = await c.start();
  c.clock.advance(86400001);
  await expect(c.engine.answerAsk("missing", { picks: [] })).rejects.toMatchObject({ code: "not_found" });
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(c.store.listApprovals({ runId: run.id }).at(0)?.state).toBe("pending");
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

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("TC-SR9-14 repeated calls and errors consume attempts, send one plain retry note, block with stuck_repeating, and Try again resumes", async () => {
  // Refusing Try again with permission_off moves to B-19.T2 (TC-j12-38 covers a blocked run).
  const bel = String.fromCodePoint(0x0007);
  const rlo = String.fromCodePoint(0x202e);
  const c = await ready(
    [
      worker({ id: "prep" }),
      worker({
        id: "work",
        retry: 1,
        limits: { max_attempts: 2 },
        checks: [{ type: "contains", pattern: "ok" }],
      }),
    ],
    {
      steps: {
        prep: { text: "ok" },
        work: [
          {
            events: Array.from({ length: 5 }, () => ({
              tool: "Read",
              input: { file_path: "SECRET_IN" },
              resultDigest: sha256("SECRET_OUT"),
            })),
            text: "ok",
          },
          {
            events: Array.from({ length: 3 }, () => ({
              tool: "Bash",
              input: { command: "SECRET_CMD" },
              resultDigest: sha256("err"),
              error: `ERR_ONE${bel}${rlo}\nSECRET_LINE2`,
            })),
            text: "ok",
          },
          { text: "ok" },
        ],
      },
    },
  );
  const blocked = await c.start();
  expect(blocked).toMatchObject({
    state: "blocked",
    cause: { code: "stuck_repeating" },
    blockedReason: "The agent kept repeating itself.",
  });
  const stepRow = c.store.getStep(blocked.id, "work");
  expect(stepRow?.attempts).toHaveLength(2);
  expect(stepRow?.attempts.every((a) => a.exit === "failed")).toBe(true);
  const workCalls = c.harness.calls.filter((call) => call.stepId === "work");
  expect(workCalls).toHaveLength(2);
  expect(workCalls.at(0)?.lastFailure).toBeUndefined();
  expect(workCalls.at(1)?.lastFailure).toBe(
    "The last attempt repeated the same call 4 times. Try a different way.",
  );
  expect(workCalls.at(1)?.lastFailure).not.toContain("Read");
  expect(workCalls.at(1)?.lastFailure).not.toContain("SECRET_IN");
  expect(workCalls.at(1)?.lastFailure).not.toContain("SECRET_OUT");

  const audit = c.store.listAudit(blocked.id);
  const stuckAudit = audit.filter((entry) => entry.kind === "attempt_stuck");
  expect(stuckAudit.map((entry) => entry.detail)).toEqual([
    { runId: blocked.id, step: "work", attempt: 1, reason: "repeated_call", count: 4 },
    { runId: blocked.id, step: "work", attempt: 2, reason: "repeated_error", count: 3 },
  ]);
  const auditJson = JSON.stringify(audit);
  for (const secret of ["SECRET_IN", "SECRET_OUT", "SECRET_CMD", "ERR_ONE", "SECRET_LINE2"])
    expect(auditJson).not.toContain(secret);

  const detail = RunDetail.parse(toRunDetail(c.engine.getRun(blocked.id), () => "scripted"));
  expect(detail.cause).toEqual({ code: "stuck_repeating" });
  expect(detail.canTryAgain).toBe(true);
  expect(detail.attemptLog).toEqual([
    { step: 2, attempt: 1, reason: "repeated_call", count: 4, evidence: "Read", outside: false },
    { step: 2, attempt: 2, reason: "repeated_error", count: 3, evidence: "ERR_ONE", outside: true },
  ]);

  const resumed = await c.engine.beginResume(blocked.id).settled;
  expect(resumed.state).toBe("done");
  expect(resumed.cause).toBeUndefined();
  expect(c.harness.calls.filter((call) => call.stepId === "prep")).toHaveLength(1);
  const resumedWorkCalls = c.harness.calls.filter((call) => call.stepId === "work");
  expect(resumedWorkCalls).toHaveLength(3);
  expect(resumedWorkCalls.at(2)?.attempt).toBe(1);
  expect(resumedWorkCalls.at(2)?.lastFailure).toBeUndefined();
});

test("TC-SR9-14 silence alone never ends an attempt and the 30-minute limit remains", async () => {
  vi.useFakeTimers();
  try {
    const c = await ready([worker({ retry: 0, limits: { max_attempts: 1 } })], {
      steps: { a: { hang: true } },
    });
    const pending = c.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.harness.calls).toHaveLength(1);
    expect(c.harness.calls.at(0)?.maxDurationMs).toBe(1_800_000);
    await vi.advanceTimersByTimeAsync(1_799_999);
    const runId = c.engine.listRuns().at(0)?.id;
    if (!runId) throw new Error("missing run");
    expect(c.store.getRun(runId)?.state).toBe("running");
    expect(c.store.listAudit(runId).some((entry) => entry.kind === "attempt_stuck")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const run = await pending;
    expect(run.state).toBe("blocked");
    expect(run.cause?.code).not.toBe("stuck_repeating");
    expect(c.store.getStep(run.id, "a")?.note).toBe("time limit exceeded");
    expect(c.store.listAudit(run.id).some((entry) => entry.kind === "attempt_stuck")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("TC-SR9-14 Try again runs every call through decide again and does not reuse a spent grant", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-sr9-")));
  folders.push(root);
  const project = join(root, "project");
  const notesDir = join(project, "notes");
  mkdirSync(notesDir, { recursive: true });
  const noteFile = join(notesDir, "note.txt");
  writeFileSync(noteFile, "KIWI");

  const webInput = { url: "https://example.test/one" };
  const home = makeFakeHome({
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "w1", name: "WebFetch", input: webInput },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  folders.push(home);

  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let seq = 0;
  let clockMs = Date.parse("2026-11-23T00:00:00Z");
  const now = () => {
    clockMs += 1000;
    return new Date(clockMs);
  };
  const newId = (prefix: string) => `${prefix}-${++seq}`;

  const parsed = parseManifest({
    format: "flowdriven-flow/1.2",
    id: "local.stuck-grant",
    name: "Stuck Grant",
    kind: "build",
    requirements: [{ id: "notes", type: "path", ref: "notes", access: "read" }],
    touches: [
      {
        id: "read-notes",
        sentence: "Read notes",
        effect: "read",
        rule: "asks_first",
        covers: [],
        place: { kind: "folder", value: "notes", label: "Notes" },
      },
    ],
    steps: [
      {
        id: "work",
        title: "Work",
        do: "worker",
        instructions: "Work",
        uses: ["notes"],
        retry: 0,
        limits: { max_attempts: 1 },
        checks: [{ type: "contains", pattern: "done" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const hash = `sha256:${"a".repeat(64)}`;

  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
    controlRoot: join(root, "control"),
    audit: (kind, runId, detail) => store.appendAudit({ at: now().toISOString(), kind, runId, detail }),
    newId,
    newSessionId: () => `session-${++seq}`,
    rounds: 20,
    exitWaitMs: 10_000,
    grants: createGrantBook(store),
    confirmation: (runId) => {
      const run = store.getRun(runId);
      const confirmation = run && store.getConfirmation(run.flowId);
      if (!run || !confirmation) return undefined;
      return {
        confirmation: {
          flowId: run.flowId,
          hash: run.flowHash,
          onItsOwn: confirmation.onItsOwn,
          touches: parsed.manifest.format === "flowdriven-flow/1.2" ? (parsed.manifest.touches ?? []) : [],
        },
        rules: store.listRules().filter((r) => r.flowId === run.flowId),
        source: "window",
        earlierNo: false,
        startedAt: run.startedAt,
      };
    },
  });

  const engine = createEngine({ store, harness: adapter, now, newId });
  engine.registerFlow(parsed.manifest, hash);
  store.putConfirmation({
    flowId: parsed.manifest.id,
    hash,
    at: now().toISOString(),
    by: "confirm_dialog",
    onItsOwn: ["read-notes"],
    pins: { skills: {}, folders: {} },
  });

  const heldRun = await engine.startRun(parsed.manifest.id, { project });
  expect(heldRun.state).toBe("waiting_approval");
  const ap1 = store.listApprovals({ runId: heldRun.id, state: "pending" }).at(0);
  if (!ap1) throw new Error("missing first approval");
  expect(ap1.kind).toBe("outside_flow");

  writeFakeScript(home, {
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "w2", name: "WebFetch", input: webInput },
          { do: "tool", id: "r1", name: "Read", input: { file_path: noteFile }, result: "KIWI" },
          { do: "tool", id: "r2", name: "Read", input: { file_path: noteFile }, result: "KIWI" },
          { do: "tool", id: "r3", name: "Read", input: { file_path: noteFile }, result: "KIWI" },
          { do: "tool", id: "r4", name: "Read", input: { file_path: noteFile }, result: "KIWI" },
          { do: "pause", ms: 2000 },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const stuckRun = await engine.beginDecide(ap1.id, "approve").settled;
  expect(stuckRun).toMatchObject({ state: "blocked", cause: { code: "stuck_repeating" } });
  expect(store.listAudit(heldRun.id)).toContainEqual(
    expect.objectContaining({
      kind: "attempt_stuck",
      detail: { runId: heldRun.id, step: "work", attempt: 1, reason: "repeated_call", count: 4 },
    }),
  );

  writeFakeScript(home, {
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "w3", name: "WebFetch", input: webInput },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const resumed = await engine.beginResume(heldRun.id).settled;
  expect(resumed.state).toBe("waiting_approval");
  const ap2 = store.listApprovals({ runId: heldRun.id, state: "pending" }).at(0);
  expect(ap2).toBeDefined();
  expect(ap2?.id).not.toBe(ap1.id);
  expect(ap2?.kind).toBe("outside_flow");
  expect(readFakeCalls(home)).toContainEqual(
    expect.objectContaining({ kind: "tool", id: "w3", name: "WebFetch", ran: false }),
  );
});

test("TC-SR9-14 a stuck attempt records its held call", async () => {
  const held = {
    requirementId: "host",
    tool: "publish",
    input: { text: "Hi" },
    digest: "digest",
    action: "post" as const,
    effect: "post" as const,
  };
  const c = await ready([worker({ retry: 0 })], {
    steps: {
      a: {
        hold: held,
        events: Array.from({ length: 4 }, () => ({
          tool: "Read",
          input: {},
          resultDigest: sha256("result"),
        })),
      },
    },
  });
  c.harness.runStep = async (req) => {
    for (let i = 0; i < 4; i++) req.onEvent?.({ tool: "Read", input: {}, resultDigest: sha256("result") });
    return { exit: "ok", text: "", outputs: {}, hold: held };
  };
  const run = await c.start();
  expect(
    c.store
      .listAudit(run.id)
      .filter((entry) => entry.kind === "call_held")
      .map((entry) => entry.detail),
  ).toEqual([{ tool: "publish", effect: "post", digest: "digest" }]);
});
