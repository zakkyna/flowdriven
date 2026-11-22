import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { callGrant, digestCall } from "./connectors/grants.ts";
import { createEngine } from "./engine.ts";
import { scriptedHarness } from "./scripted-harness.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const worker = (id: string, idempotent = false) => ({
  id,
  do: "worker",
  instructions: "Work",
  checks: [{ type: "contains", pattern: "ok" }],
  idempotent,
});
function flow(steps: unknown[]) {
  const result = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}

test("resume continues from the first unpassed step and repeats nothing", async () => {
  let blocked = true;
  const c = await setup(flow([worker("a"), worker("b")]), {
    steps: { a: { text: "ok" }, b: () => (blocked ? { exit: "quota" } : { text: "ok" }) },
  });
  stores.push(c.store);
  const run = await c.engine.startRun("local.test", { project: "/tmp" });
  expect(run.state).toBe("blocked");
  blocked = false;
  expect((await c.engine.resumeRun(run.id)).state).toBe("done");
  expect(c.harness.calls.map((call) => call.stepId)).toEqual(["a", "b", "b"]);
  await expect(c.engine.resumeRun(run.id)).rejects.toMatchObject({ code: "not_allowed" });
  expect(c.store.getStep(run.id, "b")?.attempts).toHaveLength(1);
  expect(c.engine.getRun(run.id).run.blockedReason).toBeUndefined();
  await expect(c.engine.resumeRun("missing")).rejects.toMatchObject({ code: "not_found" });
  for (const state of ["failed", "interrupted"] as const) {
    c.store.updateRun(run.id, { state, blockedReason: "old", endedAt: "2026-11-11T09:00:00.000Z" });
    const row = c.store.getStep(run.id, "b");
    if (!row) throw new Error("missing step");
    c.store.upsertStep({ ...row, state, note: "old" });
    expect((await c.engine.resumeRun(run.id)).state).toBe("done");
    expect(c.store.getStep(run.id, "b")?.attempts).toHaveLength(1);
    expect(c.engine.getRun(run.id).run.blockedReason).toBeUndefined();
  }
  const nestedFlow = flow([{ id: "loop", for_each: "${inputs.jobs}", as: "job", steps: [worker("nested")] }]);
  // Add the declared input through parsing, so the item is flow data rather than code.
  const parsed = parseManifest({
    ...nestedFlow,
    inputs: [{ id: "jobs", type: "list<text>", label: "Jobs" }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  let nestedBlocked = true;
  const nested = await setup(parsed.manifest, {
    steps: { nested: () => (nestedBlocked ? { exit: "quota" } : { text: "ok" }) },
  });
  stores.push(nested.store);
  const nestedRun = await nested.engine.startRun("local.test", { project: "/tmp", inputs: { jobs: ["j1"] } });
  expect(nested.store.listItems(nestedRun.id).at(0)?.status).toBe("running");
  nestedBlocked = false;
  expect((await nested.engine.resumeRun(nestedRun.id)).state).toBe("done");
  expect(nested.store.listItems(nestedRun.id).at(0)?.status).toBe("passed");
  expect(nested.store.getStep(nestedRun.id, "nested", "#0")?.attempts).toHaveLength(1);
});

test("after a crash only an idempotent step resumes", async () => {
  for (const mode of ["unsafe", "safe", "queued"] as const) {
    const c = await setup(flow([worker("a", mode === "safe")]), { steps: { a: { exit: "quota" } } });
    stores.push(c.store);
    const started = await c.engine.startRun("local.test", { project: "/tmp" });
    const run =
      mode === "queued"
        ? { ...started, id: "queued", state: "queued" as const, blockedReason: undefined }
        : started;
    if (mode === "queued") {
      c.store.createRun(run);
      expect(c.store.listSteps(run.id)).toEqual([]);
    } else {
      c.store.updateRun(run.id, { state: "running" });
      const row = c.store.getStep(run.id, "a");
      if (!row) throw new Error("missing step");
      c.store.upsertStep({ ...row, state: "running" });
    }
    const harness2 = scriptedHarness({ steps: { a: { text: "ok" } } });
    const engine2 = createEngine({ store: c.store, harness: harness2, now: c.clock.now });
    const resumed = await engine2.recoverAfterCrash();
    expect(engine2.getRun(run.id).run.state).toBe(mode === "unsafe" ? "interrupted" : "done");
    expect(resumed).toHaveLength(mode === "unsafe" ? 0 : 1);
    if (mode === "unsafe") {
      expect(resumed).toEqual([]);
      expect(harness2.calls).toEqual([]);
      expect(c.store.getStep(run.id, "a")?.state).toBe("interrupted");
    }
    expect(harness2.calls).toHaveLength(mode === "unsafe" ? 0 : 1);
    expect(c.store.listAudit(run.id).some((entry) => entry.kind === "run_interrupted")).toBe(true);
  }
  const waiting = await setup(flow([{ ...worker("a"), checks: [{ type: "user" }] }]), {
    steps: { a: { text: "ok" } },
  });
  stores.push(waiting.store);
  const pending = await waiting.engine.startRun("local.test", { project: "/tmp" });
  expect(pending.state).toBe("waiting_approval");
  expect(await waiting.engine.recoverAfterCrash()).toEqual([]);
  expect(waiting.engine.getRun(pending.id).run.state).toBe("waiting_approval");
  expect(waiting.store.listAudit(pending.id).some((entry) => entry.kind === "run_interrupted")).toBe(false);
});

test.each([false, true])(
  "TC-SR8-06 an approved send with idempotent=%s is interrupted after a crash",
  async (idempotent) => {
    const c = await setup(flow([worker("a", idempotent)]), { steps: { a: { exit: "quota" } } });
    stores.push(c.store);
    const run = await c.engine.startRun("local.test", { project: "/tmp" });
    const row = c.store.getStep(run.id, "a");
    if (!row) throw new Error("missing step");
    c.store.updateRun(run.id, { state: "running" });
    c.store.upsertStep({ ...row, state: "running" });
    const tool = "mcp__claude_ai_Gmail__send_message";
    const input = {};
    const digest = digestCall(tool, input);
    c.store.createApproval({
      id: "ap-send",
      kind: "risky_action",
      runId: run.id,
      stepId: "a",
      itemKey: "",
      summary: "Send",
      payload: "Send",
      approves: [callGrant("mail", tool, digest)],
      onExpiry: "fail",
      createdAt: run.startedAt,
      expiresAt: run.startedAt,
      state: "approved",
      riskyAction: "send",
      effect: "send",
      call: { tool, input },
    });
    c.store.putCallGrant({
      runId: run.id,
      stepId: "a",
      itemKey: "",
      tool,
      digest,
      kind: "approve",
      createdAt: run.startedAt,
      approvalId: "ap-send",
    });
    const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
    const engine = createEngine({ store: c.store, harness, now: c.clock.now });
    await engine.recoverAfterCrash();
    expect(c.store.getRun(run.id)).toMatchObject({
      state: "interrupted",
      cause: { code: "crash", params: { step: "a" } },
    });
    expect(harness.calls).toEqual([]);
  },
);

test("a run stays pinned to the flow version it started with", async () => {
  let blocked = true;
  const c = await setup(flow([worker("a"), worker("b")]), {
    steps: { a: { text: "ok" }, b: () => (blocked ? { exit: "quota" } : { text: "ok" }), c: { text: "ok" } },
  });
  stores.push(c.store);
  const first = await c.engine.startRun("local.test", { project: "/tmp" });
  expect(first.state).toBe("blocked");
  c.engine.registerFlow(flow([worker("c")]), `sha256:${"1".repeat(64)}`);
  blocked = false;
  expect((await c.engine.resumeRun(first.id)).state).toBe("done");
  expect((await c.engine.startRun("local.test", { project: "/tmp" })).state).toBe("done");
  expect(c.harness.calls.map((call) => call.stepId)).toEqual(["a", "b", "b", "c"]);
});

test("TC-SR8-06 a declared delete is not automatically repeated even when idempotent", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.delete",
    name: "Delete",
    kind: "build",
    requirements: [{ id: "mail", type: "mcp_server", ref: "connector:gmail", tools: ["trash_message"] }],
    steps: [{ ...worker("delete", true), uses: ["mail"] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, { steps: { delete: { exit: "quota" } } });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "." });
  const row = c.store.getStep(run.id, "delete");
  if (!row) throw new Error("missing step");
  c.store.updateRun(run.id, { state: "running" });
  c.store.upsertStep({ ...row, state: "running" });
  const harness = scriptedHarness({ steps: { delete: { text: "ok" } } });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.recoverAfterCrash();
  expect(c.store.getRun(run.id)).toMatchObject({
    state: "interrupted",
    cause: { code: "crash", params: { step: "delete" } },
  });
  expect(harness.calls).toEqual([]);
});

test("TC-SR8-06 an idempotent local write resumes after a crash", async () => {
  // Pinning case: the idempotent local-work path predates B-05.T3.
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.write",
    name: "Write",
    kind: "build",
    requirements: [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
    steps: [{ ...worker("write", true), uses: ["notes"] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, { steps: { write: { exit: "quota" } } });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "." });
  const row = c.store.getStep(run.id, "write");
  if (!row) throw new Error("missing step");
  c.store.updateRun(run.id, { state: "running" });
  c.store.upsertStep({ ...row, state: "running" });
  const harness = scriptedHarness({ steps: { write: { text: "ok" } } });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.recoverAfterCrash();
  expect(c.store.getRun(run.id)?.state).toBe("done");
  expect(harness.calls.map((call) => call.stepId)).toEqual(["write"]);
});
