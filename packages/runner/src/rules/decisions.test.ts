import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { digestCall } from "../connectors/grants.ts";
import { approvedCallsOf } from "../exec/held.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { approvedDecision } from "../test-helpers/builders.ts";
import { setup } from "../test-helpers/engine.ts";
import { makeGrant } from "../test-helpers/policy-fixture.ts";
import { matchGrant } from "./decisions.ts";

test("TC-j20-30 a changed call creates a second card while the first stays approved", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.changed",
    name: "Timesheet",
    kind: "build",
    steps: [{ id: "log", do: "worker", instructions: "Log", checks: [{ type: "contains", pattern: "ok" }] }],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const tool = "log_entry";
  let heldInput = { hours: 2 };
  const c = await setup(parsed.manifest, {
    steps: {
      log: (req) =>
        req.approvedCalls
          ? { text: "ok" }
          : {
              hold: {
                requirementId: "timesheet",
                tool,
                input: heldInput,
                digest: digestCall(tool, heldInput),
                effect: "change",
              },
            },
    },
  });
  stores.push(c.store);
  const at = c.clock.now().toISOString();
  c.store.putChat({
    id: "chat-7",
    title: "Chat",
    titleSource: "flowdriven",
    createdAt: at,
    updatedAt: at,
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  const first = c.engine.beginStart(parsed.manifest.id, { project: "." });
  c.store.updateRun(first.run.id, { start: { source: "chat", chatId: "chat-7" } });
  await first.settled;
  const old = c.store.listApprovals({ runId: first.run.id, state: "pending" }).at(0);
  if (!old) throw new Error("missing first decision");
  await c.engine.decide(old.id, "approve");
  heldInput = { hours: 3 };
  const second = c.engine.beginStart(parsed.manifest.id, { project: "." });
  c.store.updateRun(second.run.id, { start: { source: "chat", chatId: "chat-7" } });
  await second.settled;
  const current = c.store.listApprovals({ runId: second.run.id, state: "pending" }).at(0);
  expect(current).toMatchObject({ call: { input: heldInput }, state: "pending" });
  expect(c.store.getApproval(old.id)?.state).toBe("approved");
  expect(c.store.listMessages("chat-7").map((message) => message.card)).toEqual(
    expect.arrayContaining([
      { type: "decision", state: "open", approvalId: old.id },
      { type: "decision", state: "open", approvalId: current?.id },
    ]),
  );
});

test("TC-j20-28 approval lets the exact held call run once and preserves outputs", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.timesheet",
    name: "Timesheet",
    kind: "build",
    inputs: [
      { id: "duration", type: "number", label: "Duration" },
      { id: "what_you_did", type: "text", label: "Work" },
      { id: "date", type: "date", label: "Date" },
      { id: "start", type: "text", label: "Start" },
    ],
    steps: [
      {
        id: "log",
        do: "worker",
        instructions: "Log",
        outputs: [
          { id: "entry", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "ok", of: "message" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const input = { duration_h: 2 };
  const tool = "log_entry";
  const digest = digestCall(tool, input);
  let ran = 0;
  let book: Store;
  const c = await setup(parsed.manifest, {
    steps: {
      log: (req) => {
        if (!req.approvedCalls)
          return { hold: { requirementId: "timesheet", tool, input, digest, effect: "change" } };
        const key = {
          runId: req.runId,
          stepId: req.stepId,
          itemKey: req.itemKey,
          tool: `timesheet.${tool}`,
          digest,
          kind: "approve" as const,
          createdAt: "",
        };
        if (!book.findGrant(key)) throw new Error("missing exact grant");
        book.useGrant(key, "2026-11-11T09:00:00.000Z");
        ran++;
        return { text: "ok", outputs: { entry: { entry_id: 4812 }, message: "ok" } };
      },
    },
  });
  book = c.store;
  stores.push(book);
  const at = c.clock.now().toISOString();
  book.putChat({
    id: "chat-timesheet",
    title: "Timesheet",
    titleSource: "flowdriven",
    createdAt: at,
    updatedAt: at,
    from: "flowdriven",
    language: "en",
    languageSource: "app",
    agent: "claude-code",
    model: "default",
    agentSource: "main_default",
  });
  const inputs = {
    duration: 120,
    what_you_did: "Release build for Project Example.",
    date: "2026-11-19",
    start: "13:00",
  };
  const started = c.engine.beginStart(parsed.manifest.id, { project: ".", inputs });
  book.updateRun(started.run.id, { start: { source: "chat", chatId: "chat-timesheet" } });
  const run = await started.settled;
  const decision = book.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!decision) throw new Error("missing decision");
  const begun = c.engine.beginDecide(decision.id, "approve");
  expect(
    book.findGrant({
      runId: run.id,
      stepId: "log",
      itemKey: "",
      tool: `timesheet.${tool}`,
      digest,
      kind: "approve",
      createdAt: "",
    }),
  ).toBeDefined();
  expect(approvedCallsOf(book, run.id, "log", "")).toEqual([{ tool, input }]);
  const settled = await begun.settled;
  expect(book.getStep(run.id, "log")?.state).toBe("passed");
  expect(c.harness.calls.map((call) => call.approvedCalls)).toEqual([undefined, [{ tool, input }]]);
  expect(settled.state).toBe("done");
  expect(book.getApproval(decision.id)?.state).toBe("approved");
  expect(ran).toBe(1);
  expect(book.getStep(run.id, "log")?.outputs).toEqual({ entry: { entry_id: 4812 }, message: "ok" });
  expect(book.getRun(run.id)?.inputs).toEqual(inputs);
  expect(book.listAudit(run.id)).toContainEqual(
    expect.objectContaining({
      kind: "decision_made",
      detail: expect.objectContaining({ decision: "approve", via: "window" }),
    }),
  );
});

test("TC-j24-44 signing in after approval preserves the unused grant", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.approve-login",
    name: "Login",
    kind: "build",
    steps: [
      { id: "send", do: "worker", instructions: "Send", checks: [{ type: "contains", pattern: "ok" }] },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const tool = "reply";
  const input = { body: "hello" };
  const digest = digestCall(tool, input);
  let book: Store;
  let attempts = 0;
  let executed = 0;
  const c = await setup(parsed.manifest, {
    steps: {
      send: (req) => {
        if (!req.approvedCalls)
          return { hold: { requirementId: "mail", tool, input, digest, action: "send" } };
        if (attempts++ === 0) return { exit: "auth" };
        const key = {
          runId: req.runId,
          stepId: req.stepId,
          itemKey: req.itemKey,
          tool: "mail.reply",
          digest,
          kind: "approve" as const,
          createdAt: "",
        };
        if (!book.findGrant(key)) throw new Error("grant was lost");
        book.useGrant(key, "2026-11-11T09:00:00.000Z");
        executed++;
        return { text: "ok" };
      },
    },
  });
  book = c.store;
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "." });
  const approval = c.store.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!approval) throw new Error("missing approval");
  expect((await c.engine.decide(approval.id, "approve")).state).toBe("needs_login");
  const key = {
    runId: run.id,
    stepId: "send",
    itemKey: "",
    tool: "mail.reply",
    digest,
    kind: "approve" as const,
    createdAt: "",
  };
  expect(c.store.getApproval(approval.id)?.state).toBe("approved");
  expect(c.store.findGrant(key)).toMatchObject({ approvalId: approval.id });
  expect(c.store.findGrant(key)?.usedAt).toBeUndefined();
  expect((await c.engine.resumeRun(run.id)).state).toBe("done");
  expect(c.harness.calls.at(-1)?.approvedCalls).toEqual([{ tool, input }]);
  expect(executed).toBe(1);
  expect(c.store.findGrant(key)).toBeUndefined();
});

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

test("TC-j20-30 approvedDecision makes an approved decision and its exact grant", async () => {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const row = approvedDecision(store, { id: "previous", createdAt: "2026-11-21T00:00:00.000Z" });
  expect(store.getApproval(row.id)).toMatchObject({ state: "approved", resolvedVia: "window" });
  expect(store.listMessages("chat-previous").map((message) => message.card)).toEqual([
    { type: "decision", state: "open", approvalId: row.id },
  ]);
  const input = { duration_h: 2 };
  expect(
    store.findGrant({
      runId: row.runId,
      stepId: row.stepId,
      itemKey: row.itemKey,
      tool: "timesheet.log_entry",
      digest: digestCall("log_entry", input),
      kind: "approve",
      createdAt: "",
    }),
  ).toMatchObject({ approvalId: row.id });
});

test("TC-j24-23 TC-RUL-05 the approved edited call runs with its edited body and subject only", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.edited",
    name: "Reply",
    kind: "build",
    steps: [
      { id: "reply", do: "worker", instructions: "Reply", checks: [{ type: "contains", pattern: "ok" }] },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const tool = "mcp__claude_ai_Gmail__reply";
  const input = { to: ["sam@example.test"], cc: ["alex@example.test"], subject: "Old", body: "Monday" };
  const edited = { ...input, subject: "New", body: "To: other@example.test\nTuesday" };
  let executed: unknown;
  let calls = 0;
  let book: Store;
  const c = await setup(parsed.manifest, {
    steps: {
      reply: (req) => {
        if (!req.approvedCalls)
          return {
            hold: { requirementId: "mail", tool, input, digest: digestCall(tool, input), action: "send" },
          };
        const call = req.approvedCalls[0];
        if (!call) throw new Error("missing approved call");
        const key = {
          runId: req.runId,
          stepId: req.stepId,
          itemKey: req.itemKey,
          tool,
          digest: digestCall(tool, call.input),
          kind: "approve" as const,
          createdAt: "",
        };
        if (!book.findGrant(key)) throw new Error("missing edited grant");
        book.useGrant(key, "2026-11-11T09:00:00.000Z");
        executed = call.input;
        calls++;
        return { text: "ok" };
      },
    },
  });
  book = c.store;
  stores.push(book);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "." });
  const row = book.listApprovals({ runId: run.id, state: "pending" }).at(0);
  if (!row) throw new Error("missing held call");
  const started = c.engine.beginDecide(row.id, "edit", { text: edited.body, subject: edited.subject });
  expect(book.getApproval(row.id)).toMatchObject({
    state: "approved_edited",
    editedDigest: digestCall(tool, edited),
  });
  expect((await started.settled).state).toBe("done");
  expect(executed).toEqual(edited);
  expect(calls).toBe(1);
  expect(
    book.findGrant({
      runId: run.id,
      stepId: "reply",
      itemKey: "",
      tool,
      digest: digestCall(tool, input),
      kind: "approve",
      createdAt: "",
    }),
  ).toBeUndefined();
});
test("TC-SR1-08 matches every identity field and only an unused grant", async () => {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const tool = "mcp__claude_ai_Gmail__reply";
  const input = { threadId: "thread-sam", body: "Thanks." };
  const grant = makeGrant({ tool, input }, { runId: "run-1", stepId: "reply" });
  store.putCallGrant(grant);
  expect(matchGrant(store, grant)).toEqual(grant);
  for (const change of [
    { runId: "run-2" },
    { stepId: "other" },
    { itemKey: "item" },
    { tool: "mcp__claude_ai_Gmail__forward" },
    { digest: digestCall(tool, { ...input, body: "Thanks!" }) },
  ])
    expect(matchGrant(store, { ...grant, ...change })).toBeUndefined();
  store.useGrant(grant, "2026-11-22T00:00:00.000Z");
  expect(matchGrant(store, grant)).toBeUndefined();
});
test("TC-RUL-02 an exact canonical grant matches once and is bound to run and step", async () => {
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const tool = "mcp__claude_ai_Gmail__reply";
  const input = { to: "sam@example.test", body: "Thanks" };
  const grant = makeGrant({ tool, input }, { runId: "run-1", stepId: "reply" });
  store.putCallGrant(grant);
  expect(
    matchGrant(store, { ...grant, digest: digestCall(tool, { body: "Thanks", to: "sam@example.test" }) }),
  ).toEqual(grant);
  expect(
    matchGrant(store, { ...grant, digest: digestCall(tool, { ...input, body: "Changed" }) }),
  ).toBeUndefined();
  expect(matchGrant(store, { ...grant, runId: "run-2" })).toBeUndefined();
  expect(matchGrant(store, { ...grant, stepId: "other" })).toBeUndefined();
  store.useGrant(grant, "2026-11-22T00:00:00.000Z");
  expect(matchGrant(store, grant)).toBeUndefined();
});
