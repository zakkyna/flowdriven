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
test("TC-j24-29 a held exact call remains pending beyond 25 hours", async () => {
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
    state: "pending",
    call: { tool: "delete_draft", input },
  });
  c.clock.advance(25 * 3_600_000);
  await c.engine.sweepExpired();
  expect(c.store.getApproval(a.id)).toMatchObject({
    state: "pending",
    call: { tool: "delete_draft", input },
    approves: [grant],
  });
  expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
  expect(c.harness.calls).toHaveLength(1);
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
test("TC-j24-42 the fourth hold of one run, step and item creates no approval and fails the step with This step asked for approval too many times.", async () => {
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
test("TC-SR1-23 the payload marks hidden characters, keeps its line breaks, and is never cut", async () => {
  const hidden = String.fromCodePoint(0x200b);
  const value = { value: hidden + "x".repeat(100) };
  const c = await ready({ steps: { send: { hold: { ...hold, input: value } } } });
  await c.start();
  const payload = approval(c).payload;
  expect(typeof payload).toBe("string");
  if (typeof payload !== "string") throw new Error("missing payload");
  expect(payload).toContain("[U+200B hidden character]");
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
    [{ exit: "auth" as const }, "needs_login", "The harness needs you to sign in."],
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

test("TC-j24-41 a held call whose input does not fit the card creates no approval or grant and fails the step", async () => {
  const c = await ready({ steps: { send: { hold: { ...hold, input: { body: "x".repeat(5000) } } } } });
  const run = await c.start();
  expect(c.store.listApprovals()).toEqual([]);
  expect(c.store.findGrant(legacyGrant(run.id, "send", "", grant))).toBeUndefined();
  expect(c.store.getStep(run.id, "send")).toMatchObject({
    state: "failed",
    note: "FlowDriven could not show the whole text, so it did not ask.",
    attempts: [expect.objectContaining({ exit: "failed" })],
  });
  expect(run).toMatchObject({
    state: "blocked",
    blockedReason: "FlowDriven could not show the whole text, so it did not ask.",
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
    blockedReason: "FlowDriven could not show the whole text, so it did not ask.",
  });
});

test("TC-SR1-23 email body limits and visible hidden characters", async () => {
  const tool = "mcp__claude_ai_Gmail__reply";
  const email = (body: string) => ({ to: ["sam@example.test"], subject: "Hello", body });
  for (const [body, fits] of [
    ["x".repeat(4001), false],
    ["x".repeat(4000), true],
    [`a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x200b)}`, true],
  ] as const) {
    const input = email(body);
    const c = await ready({
      steps: {
        send: {
          hold: { ...hold, tool, action: "send", effect: "send", input, digest: digestCall(tool, input) },
        },
      },
    });
    const run = await c.start();
    if (!fits) {
      expect(c.store.listApprovals()).toEqual([]);
      expect(c.store.getStep(run.id, "send")?.noteLine).toEqual({ key: "hold.tooLarge" });
    } else {
      const payload = approval(c).payload;
      expect(payload).toMatchObject({ kind: "email", to: ["sam@example.test"], subject: "Hello" });
      if (body.length === 4000) expect(payload).toMatchObject({ body });
      else expect(payload).toMatchObject({ body: "a[U+202E hidden character]b[U+200B hidden character]" });
    }
    expect(c.harness.calls).toHaveLength(1);
  }
});

test("TC-SR5-09 outside held send keeps all text and cannot always allow", async () => {
  const input = { to: ["sam@example.test"], subject: "Hello", body: "The whole reply" };
  const c = await ready({
    steps: {
      send: {
        hold: {
          ...hold,
          tool: "mcp__claude_ai_Gmail__reply",
          action: "send",
          effect: "send",
          fixedPlace: false,
          input,
        },
        outside: true,
      },
    },
  });
  await c.start();
  expect(approval(c)).toMatchObject({
    outside: true,
    fixedPlace: false,
    effect: "send",
    payload: { kind: "email", ...input },
  });
});

test("TC-SR5-15 outside copied file text is shown whole and is not batchable", async () => {
  const input = { to: ["attacker@example.test"], subject: "Copy", body: "x".repeat(3000) };
  const c = await ready({
    steps: {
      send: {
        hold: { ...hold, tool: "mcp__claude_ai_Gmail__send_message", action: "send", effect: "send", input },
        outside: true,
      },
    },
  });
  await c.start();
  expect(approval(c)).toMatchObject({ outside: true, effect: "send", payload: { kind: "email", ...input } });
  expect(approval(c).similarGroup).toBeUndefined();
});

test("TC-j24-01 a held call creates one shared chat decision", async () => {
  let c: Awaited<ReturnType<typeof ready>>;
  c = await ready({
    steps: {
      send: () => {
        const call = c.harness.calls.at(-1);
        if (!call) throw new Error("missing call");
        c.store.updateRun(call.runId, { start: { source: "chat", chatId: "chat-7" } });
        return { hold };
      },
    },
  });
  c.store.putChat({
    id: "chat-7",
    title: "Chat",
    titleSource: "flowdriven",
    createdAt: c.clock.now().toISOString(),
    updatedAt: c.clock.now().toISOString(),
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  const run = await c.start();
  expect(run.state).toBe("waiting_approval");
  expect(c.store.listApprovals({ runId: run.id })).toHaveLength(1);
  expect(c.store.listMessages("chat-7")).toContainEqual(
    expect.objectContaining({
      kind: "card",
      card: { type: "decision", state: "open", approvalId: approval(c).id },
    }),
  );
});

test("TC-j24-42 the decision service stops a fourth distinct hold", async () => {
  const c = await ready({
    steps: { send: () => ({ hold: { ...hold, digest: String(c.harness.calls.length) } }) },
  });
  const { createRunnerService } = await import("../service/service.ts");
  const service = createRunnerService({
    store: c.store,
    dataDir: ".",
    mode: "demo",
    harness: c.harness,
    now: c.clock.now,
  });
  try {
    const run = await c.start();
    for (let i = 0; i < 3; i++) {
      const a = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
      if (!a) throw new Error("missing approval");
      await service.call("approvals.resolve", { approvalId: a.id, decision: "approve" });
      for (
        let n = 0;
        n < 1000 &&
        c.store.listApprovals({ runId: run.id, state: "pending" }).length === 0 &&
        c.store.getStep(run.id, "send")?.state !== "failed";
        n++
      )
        await new Promise((resolve) => setImmediate(resolve));
    }
    expect(c.store.listApprovals({ runId: run.id })).toHaveLength(3);
    expect(c.store.getStep(run.id, "send")).toMatchObject({
      state: "failed",
      note: "This step asked for approval too many times.",
    });
  } finally {
    service.stop();
  }
});

test("TC-j24-06 a loop resumes only the approved item and waits for the others", async () => {
  const c = await ready(
    {
      steps: {
        find: { text: "ok", outputs: { jobs: [{ id: "j1" }, { id: "j2" }, { id: "j3" }], message: "ok" } },
        send: [{ hold }, { text: "ok" }, { text: "ok" }, { text: "ok" }],
      },
    },
    true,
  );
  const { createRunnerService } = await import("../service/service.ts");
  const service = createRunnerService({
    store: c.store,
    dataDir: ".",
    mode: "demo",
    harness: c.harness,
    now: c.clock.now,
  });
  try {
    const run = await c.start();
    const first = approval(c);
    for (const key of ["j2", "j3"]) {
      c.store.upsertStep({
        runId: run.id,
        stepId: "send",
        itemKey: key,
        state: "waiting_approval",
        attempts: [],
        outputs: {},
        checks: [],
      });
      c.store.createApproval({ ...first, id: `ap-${key}`, itemKey: key });
    }
    expect(
      await service.call("approvals.resolve", { approvalId: first.id, decision: "approve" }),
    ).toMatchObject({ stepWaiting: 2 });
    for (let n = 0; n < 1000 && c.store.getStep(run.id, "send", "j1")?.state !== "passed"; n++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(c.store.getStep(run.id, "send", "j1")?.state).toBe("passed");
    expect(c.store.getStep(run.id, "send", "j2")?.state).toBe("waiting_approval");
    expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
    expect(
      await service.call("approvals.resolve", { approvalId: "ap-j2", decision: "approve" }),
    ).toMatchObject({ stepWaiting: 1 });
    for (let n = 0; n < 1000 && c.store.getStep(run.id, "send", "j2")?.state !== "passed"; n++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(c.store.getStep(run.id, "send", "j2")?.state).toBe("passed");
    await service.call("approvals.resolve", { approvalId: "ap-j3", decision: "approve" });
    for (let n = 0; n < 1000 && c.store.getRun(run.id)?.state !== "done"; n++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(c.store.getRun(run.id)?.state).toBe("done");
  } finally {
    service.stop();
  }
});

test("TC-SR1-23 a reply retains bcc, attachments and unrecognized input", async () => {
  const tool = "mcp__claude_ai_Gmail__reply";
  const email = {
    to: ["sam@example.test"],
    cc: ["lee@example.test"],
    bcc: ["kim@example.test"],
    subject: "Subject",
    body: "Hello",
    attachments: ["invoice.pdf"],
  };
  const c = await ready({
    steps: { send: { hold: { ...hold, tool, action: "send", effect: "send", input: email } } },
  });
  await c.start();
  expect(approval(c).payload).toEqual({ kind: "email", ...email });
  const extra = { ...email, threadId: "thread-1" };
  const d = await ready({
    steps: { send: { hold: { ...hold, tool, action: "send", effect: "send", input: extra } } },
  });
  await d.start();
  expect(approval(d).payload).toEqual(JSON.stringify(extra, null, 2));
});

test("TC-SR5-15 a reply without a display recipient keeps the entire input", async () => {
  const input = { threadId: "thread-sam", body: "Thanks." };
  const c = await ready({
    steps: {
      send: { hold: { ...hold, tool: "mcp__claude_ai_Gmail__reply", action: "send", effect: "send", input } },
    },
  });
  await c.start();
  expect(approval(c).payload).toBe(JSON.stringify(input, null, 2));
  const other = { to: "sam@example.test", body: "Thanks." };
  const d = await ready({
    steps: {
      send: {
        hold: { ...hold, tool: "mcp__claude_ai_Gmail__reply", action: "send", effect: "send", input: other },
      },
    },
  });
  await d.start();
  expect(approval(d).payload).toBe(JSON.stringify(other, null, 2));
});

test("TC-j24-06 the run stays waiting while an approved item is still running", async () => {
  const c = await ready(
    {
      steps: {
        find: { text: "ok", outputs: { jobs: [{ id: "j1" }, { id: "j2" }], message: "ok" } },
        send: [{ hold }, { text: "ok" }, { text: "ok" }],
      },
    },
    true,
  );
  const { createRunnerService } = await import("../service/service.ts");
  const service = createRunnerService({
    store: c.store,
    dataDir: ".",
    mode: "demo",
    harness: c.harness,
    now: c.clock.now,
  });
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const run = await c.start();
    const first = approval(c);
    c.store.upsertStep({
      runId: run.id,
      stepId: "send",
      itemKey: "j2",
      state: "waiting_approval",
      attempts: [],
      outputs: {},
      checks: [],
    });
    c.store.createApproval({ ...first, id: "ap-j2", itemKey: "j2" });
    const execute = c.harness.runStep.bind(c.harness);
    c.harness.runStep = async (request) => {
      if (request.itemKey === "j1") await paused;
      return execute(request);
    };
    await service.call("approvals.resolve", { approvalId: first.id, decision: "approve" });
    for (let n = 0; n < 1000 && c.store.getStep(run.id, "send", "j1")?.state !== "running"; n++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(c.store.getStep(run.id, "send", "j1")?.state).toBe("running");
    expect(c.store.getRun(run.id)?.state).toBe("waiting_approval");
    expect(
      await service.call("approvals.resolve", { approvalId: "ap-j2", decision: "approve" }),
    ).toMatchObject({ stepWaiting: 0 });
  } finally {
    release();
    service.stop();
  }
});
