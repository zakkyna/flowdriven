import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { visibleLines } from "../claude/text.ts";
import { callGrant, digestCall } from "../connectors/grants.ts";
import type { HeldCall } from "../harness.ts";
import type { Script } from "../scripted-harness.ts";
import type { ApprovalRow, Store } from "../storage.ts";
import { setup } from "../test-helpers/engine.ts";
import { legacyGrant } from "../test-helpers/policy-fixture.ts";
import { approvedCallsOf, labelOf } from "./held.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const input = { id: "draft-1" };
const hold: HeldCall = {
  requirementId: "mail",
  tool: "delete_draft",
  input,
  digest: digestCall("delete_draft", input),
  action: "delete",
};
const grant = callGrant(hold.requirementId, hold.tool, hold.digest);
const worker = {
  id: "send",
  title: "Delete draft",
  do: "worker",
  instructions: "Work",
  retry: 0,
  checks: [{ type: "contains", pattern: "ok" }],
};
async function ready(script: Script = { steps: { send: { hold } } }, loop = false, ref = "connector:gmail") {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.hold",
    name: "Hold",
    kind: "build",
    requirements: [{ id: "mail", type: "mcp_server", ref, tools: ["delete_draft"] }],
    steps: loop
      ? [
          {
            id: "find",
            do: "worker",
            instructions: "Find",
            outputs: [
              { id: "jobs", type: "json" },
              { id: "message", type: "text" },
            ],
            checks: [{ type: "contains", pattern: "ok" }],
          },
          {
            id: "loop",
            for_each: "${steps.find.outputs.jobs}",
            as: "job",
            key: "${job.id}",
            steps: [worker],
          },
        ]
      : [worker],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, script);
  stores.push(c.store);
  return {
    ...c,
    manifest: parsed.manifest,
    start: () => c.engine.startRun(parsed.manifest.id, { project: "/tmp" }),
  };
}
function approval(c: Awaited<ReturnType<typeof ready>>): ApprovalRow {
  const row = c.store.listApprovals().at(0);
  if (!row) throw new Error("missing approval");
  return row;
}
test("a hold result creates a risky_action approval with the action, the summary, the indented input, grant, expiry and exact call", async () => {
  const c = await ready();
  const run = await c.start();
  const a = approval(c);
  expect(a).toMatchObject({
    kind: "risky_action",
    riskyAction: "delete",
    runId: run.id,
    stepId: "send",
    itemKey: "",
    summary: "Delete draft: delete_draft on Gmail",
    payload: JSON.stringify(input, null, 2),
    approves: [grant],
    onExpiry: "fail",
    createdAt: "2026-11-11T09:00:00.000Z",
    expiresAt: "2026-11-12T09:00:00.000Z",
    state: "pending",
    call: { tool: "delete_draft", input },
  });
});
test("the step and the run become waiting_approval, the walk halts, and the hold is not kept in row.attempts", async () => {
  const c = await ready();
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  expect(c.store.getStep(run.id, "send")).toMatchObject({ state: "waiting_approval", attempts: [] });
  expect(c.harness.calls).toHaveLength(1);
});
test("a hold inside a loop item keeps the item key on the approval and the item running", async () => {
  const c = await ready(
    { steps: { find: { text: "ok", outputs: { jobs: [{ id: "j1" }], message: "ok" } }, send: { hold } } },
    true,
  );
  const run = await c.start();
  expect(run.blockedReason).toBeUndefined();
  expect(approval(c).itemKey).toBe("j1");
  expect(c.store.listItems(run.id).at(0)).toMatchObject({ key: "j1", status: "running" });
});
test("the approval carries outside true when the step row is marked, and no outside key when it is not", async () => {
  for (const outside of [true, false]) {
    const c = await ready({ steps: { send: { hold, outside } } });
    await c.start();
    expect(Object.hasOwn(approval(c), "outside")).toBe(outside);
    if (outside) expect(approval(c).outside).toBe(true);
  }
});
test("a second hold with the same digest while its approval is pending reuses that approval", async () => {
  const c = await ready();
  const run = await c.start();
  const first = approval(c);
  c.store.updateRun(run.id, { state: "blocked" });
  await c.engine.resumeRun(run.id);
  expect(c.store.listApprovals()).toHaveLength(1);
  expect(approval(c).id).toBe(first.id);
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(c.store.getStep(run.id, "send")?.attempts).toEqual([]);
});
test("the fourth hold of one run, step and item creates no approval and fails the step with This step asked for approval too many times.", async () => {
  const c = await ready({
    steps: { send: () => ({ hold: { ...hold, digest: String(c.harness.calls.length) } }) },
  });
  const run = await c.start();
  for (let i = 0; i < 3; i++) {
    const a = c.store.listApprovals({ state: "pending" }).at(0);
    if (!a) throw new Error("missing approval");
    await c.engine.decide(a.id, "approve");
  }
  expect(c.store.listApprovals()).toHaveLength(3);
  expect(c.store.getStep(run.id, "send")).toMatchObject({
    state: "failed",
    note: "This step asked for approval too many times.",
  });
  expect(c.store.getRun(run.id)).toMatchObject({
    state: "blocked",
    blockedReason: "This step asked for approval too many times.",
  });
});
test("a hold uses up no attempt: with retry 0 the step still passes after the approval and the second run of the step", async () => {
  const c = await ready({ steps: { send: [{ hold }, { text: "ok" }] } });
  const run = await c.start();
  const a = approval(c);
  expect((await c.engine.decide(a.id, "approve")).state).toBe("done");
  expect(c.store.getStep(run.id, "send")?.attempts).toHaveLength(1);
  expect(c.harness.calls.map((x) => x.attempt)).toEqual([1, 1]);
});
test("after an approval the next request carries approvedCalls with tool and input; none for a used grant, another item, another run or a pick grant", async () => {
  const c = await ready({ steps: { send: [{ hold }, { text: "ok" }] } });
  const run = await c.start();
  const a = approval(c);
  await c.engine.decide(a.id, "approve");
  expect(c.harness.calls.at(0)?.approvedCalls).toBeUndefined();
  expect(c.harness.calls.at(1)?.approvedCalls).toEqual([{ tool: hold.tool, input }]);
  expect(approvedCallsOf(c.store, run.id, "send", "other")).toEqual([]);
  expect(approvedCallsOf(c.store, "other", "send", "")).toEqual([]);
  c.store.useGrant(legacyGrant(run.id, "send", "", grant), "2026-11-22T00:00:00.000Z");
  expect(approvedCallsOf(c.store, run.id, "send", "")).toEqual([]);
  c.store.createApproval({ ...a, id: "pick", state: "approved", approves: ["mail.delete_draft"] });
  c.store.putCallGrant(legacyGrant(run.id, "send", "", "mail.delete_draft"));
  expect(approvedCallsOf(c.store, run.id, "send", "")).toEqual([]);
});
test("the payload shows hidden characters as <U+...>, keeps its line breaks, and is never cut", async () => {
  const hidden = String.fromCodePoint(0x200b);
  const value = { value: hidden + "x".repeat(100) };
  const c = await ready({ steps: { send: { hold: { ...hold, input: value } } } });
  await c.start();
  const payload = approval(c).payload;
  expect(typeof payload).toBe("string");
  if (typeof payload !== "string") throw new Error("missing payload");
  expect(payload).toContain("<U+200B>");
  expect(payload).toContain("\n");
  expect(payload).toContain("x".repeat(100));
  expect(payload.endsWith("\n}")).toBe(true);
  expect(visibleLines(`a${hidden}\nb`, 4000)).toBe("a<U+200B>\nb");
});
test("the label falls back to a connector for a ref that is not in the catalog", async () => {
  const c = await ready(undefined, false, "connector:other");
  await c.start();
  expect(approval(c).summary).toBe("Delete draft: delete_draft on a connector");
  expect(labelOf(c.manifest.requirements, "missing")).toBe("a connector");
});
test("a present result with block, noRetry, quota, auth or interrupted is handled as before", async () => {
  for (const [reply, state, reason] of [
    [{ block: "blocked" }, "blocked", "blocked"],
    [{ noRetry: "no retry" }, "blocked", "no retry"],
    [{ exit: "quota" as const }, "blocked", "The harness has no quota left."],
    [{ exit: "auth" as const }, "blocked", "The harness needs you to sign in."],
    [{ exit: "interrupted" as const }, "interrupted", undefined],
  ] as const) {
    const c = await ready({ steps: { send: reply } });
    const run = await c.start();
    expect(run.state).toBe(state);
    if (reason) expect(run.blockedReason).toBe(reason);
    expect(c.store.listApprovals()).toEqual([]);
    expect(c.harness.calls).toHaveLength(1);
  }
});

test("a held call whose input does not fit the card is not offered: no approval row, no grant, and the step fails with This call is too large to show for your approval.", async () => {
  const c = await ready({ steps: { send: { hold: { ...hold, input: { body: "x".repeat(5000) } } } } });
  const run = await c.start();
  expect(c.store.listApprovals()).toEqual([]);
  expect(c.store.findGrant(legacyGrant(run.id, "send", "", grant))).toBeUndefined();
  expect(c.store.getStep(run.id, "send")).toMatchObject({
    state: "failed",
    note: "This call is too large to show for your approval.",
    attempts: [expect.objectContaining({ exit: "failed" })],
  });
  expect(run).toMatchObject({
    state: "blocked",
    blockedReason: "This call is too large to show for your approval.",
  });
});
test("an input that fits is shown whole: the last key of the input is in the card text", async () => {
  const value = { body: "x".repeat(3000), bcc: "last@example.com" };
  const c = await ready({ steps: { send: { hold: { ...hold, input: value } } } });
  await c.start();
  expect(approval(c).payload).toBe(JSON.stringify(value, null, 2));
  expect(approval(c).payload).toContain('"bcc": "last@example.com"');
});
test("the too-large check comes before reuse and before the count of holds", async () => {
  const c = await ready({
    steps: { send: [{ hold }, { hold: { ...hold, input: { body: "x".repeat(5000) } } }] },
  });
  const run = await c.start();
  const first = approval(c);
  c.store.createApproval({ ...first, id: "other-1", state: "approved" });
  c.store.createApproval({ ...first, id: "other-2", state: "approved" });
  c.store.updateRun(run.id, { state: "blocked" });
  await c.engine.resumeRun(run.id);
  expect(c.store.listApprovals()).toHaveLength(3);
  expect(c.store.getApproval(first.id)?.state).toBe("pending");
  expect(c.store.getRun(run.id)).toMatchObject({
    state: "blocked",
    blockedReason: "This call is too large to show for your approval.",
  });
});
