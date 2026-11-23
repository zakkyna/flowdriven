import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { digestCall } from "./connectors/grants.ts";
import { createEngine } from "./engine.ts";
import { scriptedHarness } from "./scripted-harness.ts";
import type { Store } from "./storage.ts";
import { setup } from "./test-helpers/engine.ts";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
const tool = "reply";
const input = { body: "Hello" };
const hold = { requirementId: "mail", tool, input, digest: digestCall(tool, input), action: "send" as const };
function flow(steps: unknown[]) {
  const result = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.reject",
    name: "Reject",
    kind: "build",
    steps,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}
const worker = (id: string, instructions = id) => ({
  id,
  title: id,
  do: "worker",
  instructions,
  checks: [{ type: "contains", pattern: "ok" }],
});
async function ready() {
  const manifest = flow([
    {
      ...worker("reply"),
      outputs: [
        { id: "sent", type: "json" },
        { id: "message", type: "text" },
      ],
    },
    worker("summary", "Read ${steps.reply.outputs.sent}"),
    worker("tidy"),
  ]);
  let executed = 0;
  const c = await setup(manifest, {
    steps: {
      reply: (req) => {
        if (!req.approvedCalls) return { hold };
        executed++;
        return { text: "ok", outputs: { sent: true, message: "ok" } };
      },
      summary: { text: "ok" },
      tidy: { text: "ok" },
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "." });
  const decision = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!decision) throw new Error("missing decision");
  return { ...c, run, decision, executed: () => executed };
}

test("TC-j24-08 TC-SR1-17 TC-ENG-12 reject skips dependent work and runs independent work", async () => {
  const c = await ready();
  const result = await c.engine.decide(c.decision.id, "reject");
  expect(c.store.getApproval(c.decision.id)).toMatchObject({ state: "rejected", resolvedVia: "window" });
  expect(c.store.getStep(c.run.id, "reply")).toMatchObject({
    state: "skipped",
    skipped: { because: "rejected", approvalId: c.decision.id },
  });
  expect(c.store.getStep(c.run.id, "summary")).toMatchObject({
    state: "skipped",
    skipped: { because: "needs_skipped_result", stepId: "reply" },
  });
  expect(c.store.getStep(c.run.id, "tidy")?.state).toBe("passed");
  expect(result.state).toBe("done");
  expect(c.executed()).toBe(0);
  expect(c.store.getRun(c.run.id)?.decisionLines).toContainEqual({
    key: "report.youSaidNo",
    params: { title: c.decision.summary },
  });
  expect(c.store.listAudit(c.run.id)).toContainEqual(
    expect.objectContaining({
      kind: "decision_made",
      detail: expect.objectContaining({ decision: "reject" }),
    }),
  );
});

test("TC-j24-29 TC-SR1-18 TC-ENG-15 a decision remains pending through timer ticks and can be approved", async () => {
  // The scheduled-slot part of TC-j24-29 belongs to B-12.T7.
  const c = await ready();
  for (const ms of [24 * 3600000 - 1, 1, 3600000]) {
    c.clock.advance(ms);
    await c.engine.sweepExpired();
    expect(c.store.getApproval(c.decision.id)?.state).toBe("pending");
    expect(c.store.getRun(c.run.id)?.state).toBe("waiting_approval");
    expect(c.store.getStep(c.run.id, "reply")?.state).toBe("waiting_approval");
    expect(c.executed()).toBe(0);
    expect(c.store.getRun(c.run.id)?.decisionLines ?? []).toEqual([]);
    expect(c.store.listAudit(c.run.id).some((a) => a.kind === "decision_expired")).toBe(false);
  }
  expect(await c.engine.decide(c.decision.id, "approve")).toMatchObject({ state: "done" });
  expect(c.executed()).toBe(1);
});

test("TC-j24-32 TC-SR8-09 TC-ENG-16 a held decision survives restart and 25 hours", async () => {
  const c = await ready();
  c.engine.shutdown();
  c.clock.advance(3600000);
  const harness = scriptedHarness({ steps: { reply: { text: "ok" } } });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.recoverAfterCrash();
  expect(c.store.getApproval(c.decision.id)?.state).toBe("pending");
  expect(harness.calls).toEqual([]);
  c.clock.advance(24 * 3600000);
  await engine.sweepExpired();
  expect(c.store.getApproval(c.decision.id)?.state).toBe("pending");
  expect(c.store.getRun(c.run.id)?.state).toBe("waiting_approval");
  expect(harness.calls).toEqual([]);
  engine.shutdown();
});

test("TC-ENG-21 TC-RUL-26 a later identical call is held again", async () => {
  const manifest = flow([worker("first"), worker("second")]);
  const c = await setup(manifest, {
    steps: { first: { hold }, second: (req) => (req.approvedCalls ? { text: "ok" } : { hold }) },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "." });
  const first = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!first) throw new Error("missing first decision");
  expect((await c.engine.decide(first.id, "reject")).state).toBe("waiting_approval");
  expect(c.store.listRules()).toEqual([]);
  expect(
    c.store.findGrant({
      runId: run.id,
      stepId: "first",
      itemKey: "",
      tool: "mail.reply",
      digest: hold.digest,
      kind: "approve",
      createdAt: "",
    }),
  ).toBeUndefined();
  const second = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  expect(second).toMatchObject({ stepId: "second" });
  expect(second?.id).not.toBe(first.id);
  if (!second) throw new Error("missing second decision");
  expect((await c.engine.decide(second.id, "approve")).state).toBe("done");
});

test("TC-ENG-14 reject in a loop skips that item and does not stop later items", async () => {
  const manifest = flow([
    { id: "loop", for_each: "${inputs.items}", as: "item", on_item_fail: "stop", steps: [worker("reply")] },
  ]);
  const parsed = parseManifest({
    ...manifest,
    inputs: [{ id: "items", type: "list<text>", label: "Items" }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, {
    steps: { reply: (req) => (req.approvedCalls ? { text: "ok" } : { hold }) },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: ".", inputs: { items: ["a", "b", "c"] } });
  let rejectedId = "";
  for (const choice of ["approve", "reject", "approve"] as const) {
    const decision = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
    if (!decision) throw new Error("missing decision");
    if (choice === "reject") rejectedId = decision.id;
    await c.engine.decide(decision.id, choice);
  }
  expect(c.store.listItems(run.id).at(1)).toMatchObject({
    status: "skipped",
    skipped: { because: "rejected", approvalId: rejectedId },
  });
  expect(c.store.listItems(run.id).map((i) => i.status)).toEqual(["passed", "skipped", "passed"]);
  expect(c.store.getRun(run.id)?.state).toBe("done");
});

test("TC-ENG-16 an unanswered choice remains pending across restart and accepts an answer", async () => {
  // Pinning case: B-05.T2 already removed choice expiry.
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.choice",
    name: "Choice",
    kind: "build",
    inputs: [{ id: "items", type: "list<text>", label: "Items" }],
    steps: [
      {
        id: "pick",
        do: "ask",
        ask: { question: "Pick", choose_from: "${inputs.items}", max_pick: 1, on_expiry: "end" },
      },
      worker("next"),
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, { steps: { next: { text: "ok" } } });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, {
    project: ".",
    inputs: { items: [{ id: "one" }] },
  });
  const decision = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!decision) throw new Error("missing choice");
  c.clock.advance(10 * 3600000);
  c.engine.shutdown();
  c.clock.advance(15 * 3600000);
  const harness = scriptedHarness({ steps: { next: { text: "ok" } } });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.recoverAfterCrash();
  await engine.sweepExpired();
  expect(c.store.getApproval(decision.id)?.state).toBe("pending");
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(harness.calls).toEqual([]);
  expect((await engine.answerAsk(decision.id, { picks: [] })).state).toBe("done");
  expect(harness.calls.map((call) => call.stepId)).toEqual(["next"]);
  engine.shutdown();
});

test("TC-j24-32 an unused approved grant survives interruption and is used on manual resume", async () => {
  const c = await ready();
  c.engine.shutdown();
  c.store.updateApproval(c.decision.id, { state: "approved", resolvedVia: "window" });
  c.store.putCallGrant({
    runId: c.run.id,
    stepId: "reply",
    itemKey: "",
    tool: "mail.reply",
    digest: hold.digest,
    kind: "approve",
    createdAt: c.decision.createdAt,
    approvalId: c.decision.id,
  });
  c.store.updateRun(c.run.id, { state: "running" });
  const step = c.store.getStep(c.run.id, "reply");
  if (!step) throw new Error("missing step");
  c.store.upsertStep({ ...step, state: "running" });
  const harness = scriptedHarness({
    steps: {
      reply: { text: "ok", outputs: { sent: true, message: "ok" } },
      summary: { text: "ok" },
      tidy: { text: "ok" },
    },
  });
  const engine = createEngine({ store: c.store, harness, now: c.clock.now });
  await engine.recoverAfterCrash();
  expect(c.store.getRun(c.run.id)).toMatchObject({
    state: "interrupted",
    cause: { code: "crash", params: { step: "reply" } },
  });
  expect(harness.calls).toEqual([]);
  expect((await engine.resumeRun(c.run.id)).state).toBe("done");
  expect(harness.calls[0]?.approvedCalls).toEqual([{ tool, input }]);
  engine.shutdown();
});

test("TC-j24-08 a loop step skips when its instructions need a rejected result", async () => {
  const manifest = flow([
    { ...worker("reply"), outputs: [{ id: "sent", type: "json" }] },
    {
      id: "loop",
      for_each: "${inputs.items}",
      as: "item",
      steps: [worker("dependent", "Use ${steps.reply.outputs.sent}"), worker("independent")],
    },
  ]);
  const parsed = parseManifest({
    ...manifest,
    inputs: [{ id: "items", type: "list<text>", label: "Items" }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const c = await setup(parsed.manifest, {
    steps: { reply: { hold }, dependent: { text: "ok" }, independent: { text: "ok" } },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: ".", inputs: { items: ["one"] } });
  const decision = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!decision) throw new Error("missing decision");
  expect((await c.engine.decide(decision.id, "reject")).state).toBe("done");
  expect(c.store.getStep(run.id, "dependent", "#0")).toMatchObject({
    state: "skipped",
    skipped: { because: "needs_skipped_result", stepId: "reply" },
  });
  expect(c.store.getStep(run.id, "independent", "#0")?.state).toBe("passed");
  expect(c.harness.calls.some((call) => call.stepId === "dependent")).toBe(false);
});

test("TC-j24-08 checks that need a rejected output skip while status checks still work", async () => {
  const manifest = flow([
    { ...worker("reply"), outputs: [{ id: "sent", type: "json" }] },
    { ...worker("dependent"), checks: [{ type: "contains", pattern: "${steps.reply.outputs.sent}" }] },
    { ...worker("status"), when: "steps.reply.skipped" },
  ]);
  const c = await setup(manifest, {
    steps: { reply: { hold }, dependent: { text: "ok" }, status: { text: "ok" } },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(manifest.id, { project: "." });
  const decision = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!decision) throw new Error("missing decision");
  expect((await c.engine.decide(decision.id, "reject")).state).toBe("done");
  expect(c.store.getStep(run.id, "dependent")).toMatchObject({
    state: "skipped",
    skipped: { because: "needs_skipped_result", stepId: "reply" },
  });
  expect(c.store.getStep(run.id, "status")?.state).toBe("passed");
});

test("TC-RUL-26 a rejection during another item's session stops its rules", async () => {
  const c = await ready();
  const { decide } = await import("./claude/decide.ts");
  const { earlierNo } = await import("./rules/decisions.ts");
  const place = { kind: "account" as const, value: "account", label: "Account" };
  const rule = {
    id: "r",
    flowId: "local.reject",
    touchId: "change",
    effect: "change" as const,
    place,
    state: "active" as const,
    createdAt: "2026-11-01T00:00:00Z",
    createdBy: "confirm" as const,
    sentence: "Change",
    uses: 0,
  };
  const policy = {
    tools: ["sheet.update"],
    folders: [],
    cwd: "/tmp",
    addDirs: [],
    schema: false,
    sessionId: "s",
    flowId: "local.reject",
    earlierNo: false,
    effectCatalog: [
      {
        tool: "sheet.update",
        effect: "change" as const,
        place: { kind: "account" as const, value: "account" },
      },
    ],
    touches: [
      {
        touchId: "change",
        effect: "change" as const,
        matcher: "exact" as const,
        place,
        fixedPlace: true,
        list: "on_its_own" as const,
        covers: ["sheet.update"],
      },
    ],
  };
  const call = {
    hook_event_name: "PreToolUse",
    session_id: "s",
    tool_use_id: "id",
    tool_name: "sheet.update",
    tool_input: {},
  };
  const books = { rules: [rule], earlierNo: () => earlierNo(c.store, c.run.id) };
  expect(decide(policy, call, undefined, undefined, books)).toMatchObject({ by: "rule" });
  await c.engine.decide(c.decision.id, "reject");
  expect(decide(policy, call, undefined, undefined, books)).toMatchObject({ outcome: "hold" });
});
