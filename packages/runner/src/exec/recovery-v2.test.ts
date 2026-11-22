import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { digestCall } from "../connectors/grants.ts";
import { createEngine } from "../engine.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import type { Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function flow(idempotent: boolean, user = false) {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.recovery",
    name: "Recovery",
    kind: "build",
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Work",
        idempotent,
        checks: user ? [{ type: "user" }] : [{ type: "contains", pattern: "ok" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.manifest;
}
test("TC-ENG-17 recovery records crash and resumes only idempotent steps", async () => {
  for (const safe of [true, false]) {
    const c = await setup(flow(safe), { steps: { a: { exit: "quota" } } });
    stores.push(c.store);
    const run = await c.engine.startRun("local.recovery", { project: "/tmp" });
    c.store.updateRun(run.id, { state: "running" });
    const step = c.store.getStep(run.id, "a");
    if (!step) throw new Error("missing step");
    c.store.upsertStep({ ...step, state: "running" });
    const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
    const engine = createEngine({ store: c.store, harness, now: c.clock.now });
    const recovery = engine.beginRecover();
    expect(c.store.getRun(run.id)).toMatchObject({
      state: safe ? "checking" : "interrupted",
      cause: { code: "crash" },
    });
    expect(c.store.listAudit(run.id)).toContainEqual(expect.objectContaining({ kind: "run_interrupted" }));
    await recovery.settled;
    expect(c.store.getRun(run.id)?.state).toBe(safe ? "done" : "interrupted");
    expect(harness.calls).toHaveLength(safe ? 1 : 0);
    if (!safe) expect(c.store.getStep(run.id, "a")?.state).toBe("interrupted");
  }
});
test("TC-ENG-18 pending approval survives recovery without a grant", async () => {
  const input = { id: "draft" };
  const hold = {
    requirementId: "mail",
    tool: "send",
    input,
    digest: digestCall("send", input),
    action: "send" as const,
  };
  const c = await setup(flow(false), { steps: { a: { hold } } });
  stores.push(c.store);
  const run = await c.engine.startRun("local.recovery", { project: "/tmp" });
  const approval = c.store.listApprovals({ runId: run.id })[0];
  expect(approval?.state).toBe("pending");
  const harness = scriptedHarness({ steps: { a: { text: "ok" } } });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.beginRecover().settled;
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(c.store.listApprovals({ runId: run.id })).toEqual([approval]);
  expect(harness.calls).toEqual([]);
  expect(
    c.store.findGrant({
      runId: run.id,
      stepId: "a",
      itemKey: "",
      tool: "mail.send",
      digest: hold.digest,
      kind: "approve",
      createdAt: "2026-11-11T09:00:00.000Z",
    }),
  ).toBeUndefined();
});
