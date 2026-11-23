import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { callGrant, digestCall } from "./connectors/grants.ts";
import type { ApprovalRow, Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";
import { legacyGrant } from "./test-helpers/policy-fixture.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const parsed = parseManifest({
  format: "flowdriven-flow/1.1",
  id: "local.held",
  name: "Held",
  kind: "build",
  steps: [
    {
      id: "send",
      title: "Send",
      do: "worker",
      instructions: "Send",
      checks: [{ type: "contains", pattern: "ok" }],
    },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
const manifest = parsed.manifest;
const input = { id: "draft-1" };
const grant = callGrant("mail", "delete_draft", digestCall("delete_draft", input));
async function ready(itemKey = "") {
  const c = await setup(manifest, { steps: { send: { text: "ok" } } });
  stores.push(c.store);
  const run = {
    id: "run-1",
    flowId: manifest.id,
    flowHash: `sha256:${"0".repeat(64)}`,
    flowVersion: manifest.version,
    state: "waiting_approval" as const,
    project: ".",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: c.clock.now().toISOString(),
  };
  c.store.createRun(run);
  c.store.upsertStep({
    runId: run.id,
    stepId: "send",
    itemKey,
    state: "waiting_approval",
    attempts: [],
    outputs: {},
    checks: [],
  });
  const approval: ApprovalRow = {
    id: "ap-1",
    kind: "risky_action",
    runId: run.id,
    stepId: "send",
    itemKey,
    summary: "Delete draft",
    payload: "Delete draft",
    approves: [grant],
    onExpiry: "fail",
    createdAt: run.startedAt,
    expiresAt: "2026-11-12T09:00:00.000Z",
    state: "pending",
    riskyAction: "delete",
    call: { tool: "delete_draft", input },
  };
  c.store.createApproval(approval);
  return { ...c, run, approval };
}
test("approve: the approval is approved, a grant <requirement>.<tool>#<digest> is stored at the item key, the audit has call_approved with approvalId, stepId, itemKey and tool, and the run is running again", async () => {
  const c = await ready("j1");
  const begun = c.engine.beginDecide(c.approval.id, "approve");
  expect(begun.run.state).toBe("running");
  expect(c.store.getApproval(c.approval.id)).toMatchObject({
    state: "approved",
    resolvedAt: c.clock.now().toISOString(),
  });
  expect(!!c.store.findGrant(legacyGrant(c.run.id, "send", "j1", grant))).toBe(true);
  expect(!!c.store.findGrant(legacyGrant(c.run.id, "send", "other", grant))).toBe(false);
  expect(c.store.listAudit(c.run.id)).toContainEqual(
    expect.objectContaining({
      kind: "call_approved",
      detail: { approvalId: "ap-1", stepId: "send", itemKey: "j1", tool: "delete_draft" },
    }),
  );
  expect(c.store.getStep(c.run.id, "send", "j1")?.state).toBe("pending");
  await begun.settled;
});
test("after approve the step is run again by the walk and the run ends done, and no grant is counted as used", async () => {
  const c = await ready();
  expect((await c.engine.decide("ap-1", "approve")).state).toBe("done");
  expect(c.harness.calls.map((call) => call.stepId)).toEqual(["send"]);
  expect(c.store.findGrant(legacyGrant(c.run.id, "send", "", grant))).toBeDefined();
  expect(c.store.findGrant(legacyGrant(c.run.id, "send", "", grant))?.usedAt).toBeUndefined();
});
test("TC-ENG-12: rejecting a held call skips it and completes the run", async () => {
  const c = await ready();
  const result = await c.engine.decide("ap-1", "reject");
  expect(result.state).toBe("done");
  expect(c.store.getStep(c.run.id, "send")).toMatchObject({
    state: "skipped",
    skipped: { because: "rejected", approvalId: "ap-1" },
  });
  expect(c.harness.calls).toHaveLength(0);
});
test("TC-ENG-15: a held call still waits after 25 hours", async () => {
  const c = await ready();
  c.clock.advance(25 * 3_600_000);
  await c.engine.sweepExpired();
  expect(c.store.getApproval("ap-1")?.state).toBe("pending");
  expect(c.store.getRun(c.run.id)?.state).toBe("waiting_approval");
  expect(c.harness.calls).toHaveLength(0);
});
test("TC-j24-08 reject skips the step and keeps another decision pending", async () => {
  const c = await ready();
  c.store.createApproval({ ...c.approval, id: "ap-2" });
  const result = await c.engine.decide("ap-1", "reject");
  expect(result.state).toBe("waiting_approval");
  expect(c.store.getApproval("ap-1")).toMatchObject({
    state: "rejected",
    resolvedAt: c.clock.now().toISOString(),
  });
  expect(c.store.getApproval("ap-2")?.state).toBe("pending");
  expect(c.store.getStep(c.run.id, "send")).toMatchObject({
    state: "skipped",
    skipped: { because: "rejected", approvalId: "ap-1" },
  });
  expect(c.store.listAudit(c.run.id)).toContainEqual(
    expect.objectContaining({
      kind: "call_rejected",
      detail: { approvalId: "ap-1", stepId: "send", itemKey: "", tool: "delete_draft" },
    }),
  );
  expect(c.harness.calls).toHaveLength(0);
});
test("TC-ENG-14 reject for a loop item skips that item", async () => {
  const c = await ready("j1");
  c.store.upsertItem({
    runId: c.run.id,
    loopId: "loop",
    key: "j1",
    position: 0,
    item: {},
    status: "running",
  });
  await c.engine.decide("ap-1", "reject");
  expect(c.store.listItems(c.run.id).at(0)).toMatchObject({
    status: "skipped",
    skipped: { because: "rejected", approvalId: "ap-1" },
  });
});
test("TC-RUL-04 a second decision is refused and a late approval succeeds", async () => {
  const c = await ready();
  await c.engine.decide("ap-1", "reject");
  expect(() => c.engine.beginDecide("ap-1", "approve")).toThrow("This approval was already decided.");
  const d = await ready();
  d.clock.advance(24 * 3_600_000 + 1);
  expect((await d.engine.decide("ap-1", "approve")).state).toBe("done");
});
test("a decision for a run that is not waiting is refused with Run is not waiting for approval.", async () => {
  const c = await ready();
  c.store.updateRun(c.run.id, { state: "failed" });
  expect(() => c.engine.beginDecide("ap-1", "approve")).toThrow("Run is not waiting for approval.");
});
test("beginDecide on an ask still throws Not a result sign-off.", async () => {
  const c = await ready();
  c.store.updateApproval("ap-1", { kind: "ask" });
  expect(() => c.engine.beginDecide("ap-1", "approve")).toThrow("Not a result sign-off.");
});
test("TC-j24-29 a held call remains pending after 24 hours", async () => {
  const c = await ready();
  c.clock.advance(24 * 3_600_000 + 1);
  await c.engine.sweepExpired();
  expect(c.store.getApproval("ap-1")?.state).toBe("pending");
  expect(c.store.getStep(c.run.id, "send")?.state).toBe("waiting_approval");
  expect(c.store.getRun(c.run.id)?.state).toBe("waiting_approval");
  expect(c.harness.calls).toEqual([]);
});
test("recoverAfterCrash leaves a run that waits for a held call in waiting_approval with its approval pending", async () => {
  const c = await ready();
  expect(await c.engine.recoverAfterCrash()).toEqual([]);
  expect(c.store.getRun(c.run.id)?.state).toBe("waiting_approval");
  expect(c.store.getApproval("ap-1")?.state).toBe("pending");
});

test("beginAnswer stores no grant for a pick whose key starts with # or is empty, and still passes the step with the picked items", async () => {
  const c = await ready();
  const items = [{ id: "#0" }, { id: "" }, { id: "valid" }];
  c.store.updateApproval("ap-1", {
    kind: "ask",
    approves: ["mail.delete_draft"],
    maxPick: 3,
    payload: { options: items.map((item) => ({ key: item.id, item })) },
  });
  const begun = c.engine.beginAnswer("ap-1", { picks: ["#0", "", "valid"] });
  expect(!!c.store.findPickGrant(legacyGrant(c.run.id, "*", "#0", "mail.delete_draft"))).toBe(false);
  expect(!!c.store.findPickGrant(legacyGrant(c.run.id, "*", "", "mail.delete_draft"))).toBe(false);
  expect(!!c.store.findPickGrant(legacyGrant(c.run.id, "*", "valid", "mail.delete_draft"))).toBe(true);
  expect(c.store.getStep(c.run.id, "send")).toMatchObject({ state: "passed", outputs: { choice: items } });
  expect(c.store.listAudit(c.run.id)).toContainEqual(
    expect.objectContaining({
      kind: "ask_answered",
      detail: { approvalId: "ap-1", picks: ["#0", "", "valid"] },
    }),
  );
  await begun.settled;
});

test("TC-SR8-06 Quit during a send-capable step records the crash warning", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.quit",
    name: "Quit",
    kind: "build",
    requirements: [{ id: "mail", type: "mcp_server", ref: "connector:gmail", tools: ["send_message"] }],
    steps: [
      {
        id: "send",
        do: "worker",
        instructions: "Send",
        uses: ["mail"],
        checks: [{ type: "contains", pattern: "ok" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, { steps: { send: { exit: "interrupted" } } });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "/tmp" });
  expect(run).toMatchObject({ state: "interrupted", cause: { code: "crash", params: { step: "send" } } });
  expect(c.store.getStep(run.id, "send")?.state).toBe("interrupted");
});
