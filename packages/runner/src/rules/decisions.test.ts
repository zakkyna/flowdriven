import { parseManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
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
  const input = { to: ["sam@example.test"], body: "hello" };
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

test("TC-SR1-19 an earlier rejection disables rules only for that run", async () => {
  // Scenario C belongs to B-05.T7.
  const { earlierNo } = await import("./decisions.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const rejected = pendingDecision(store, { id: "earlier-no", createdAt: "2026-11-21T00:00:00Z" });
  const approved = pendingDecision(store, { id: "earlier-yes", createdAt: "2026-11-21T00:00:00Z" });
  store.updateApproval(rejected.id, { state: "rejected" });
  store.updateApproval(approved.id, { state: "approved" });
  expect(earlierNo(store, rejected.runId)).toBe(true);
  expect(earlierNo(store, approved.runId)).toBe(false);
});

test("TC-SR1-19 matching change asks after reject and uses its rule in another run", async () => {
  // Scenario C belongs to B-05.T7.
  const { earlierNo } = await import("./decisions.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { decide } = await import("../claude/decide.ts");
  const { recordRuleUse } = await import("./standing.ts");
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const row = pendingDecision(store, { id: "post-no", createdAt: "2026-11-21T00:00:00Z" });
  const run = store.getRun(row.runId);
  if (!run) throw new Error("missing run");
  const place = { kind: "account" as const, value: "timesheet", label: "Timesheet" };
  const rule = store.makeRule({
    flowId: run.flowId,
    touchId: "log-hours",
    effect: "change",
    place,
    sentence: "Log hours",
  });
  const name = "timesheet.log_entry";
  const policy = {
    tools: [name],
    folders: [],
    cwd: ".",
    addDirs: [],
    schema: false,
    sessionId: "s1",
    flowId: run.flowId,
    effectCatalog: [
      { tool: name, effect: "change" as const, place: { kind: "account" as const, value: place.value } },
    ],
    touches: [
      {
        touchId: rule.touchId,
        effect: "change" as const,
        matcher: "exact" as const,
        place,
        fixedPlace: true,
        list: "on_its_own" as const,
        covers: [name],
      },
    ],
    rules: [rule],
  };
  const call = {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    tool_name: name,
    tool_input: { hours: 2 },
    tool_use_id: "t1",
  };
  store.updateApproval(row.id, { state: "rejected" });
  expect(decide({ ...policy, earlierNo: earlierNo(store, run.id) }, call)).toMatchObject({
    outcome: "hold",
    effect: "change",
  });
  expect(store.listRules().find((r) => r.id === rule.id)?.uses).toBe(0);
  const next = { ...run, id: "next-run" };
  store.createRun(next);
  expect(decide({ ...policy, earlierNo: earlierNo(store, next.id) }, call)).toMatchObject({
    outcome: "run",
    by: "rule",
    ruleId: rule.id,
  });
  store.upsertStep({
    runId: next.id,
    stepId: row.stepId,
    itemKey: "",
    state: "running",
    attempts: [],
    outputs: {},
    checks: [],
  });
  recordRuleUse(store, {
    ruleId: rule.id,
    runId: next.id,
    stepId: row.stepId,
    itemKey: "",
    tool: name,
    title: "Log hours",
    at: "2026-11-21T01:00:00Z",
  });
  expect(store.listRules().find((r) => r.id === rule.id)?.uses).toBe(1);
  expect(store.listAudit(next.id)).toContainEqual(expect.objectContaining({ kind: "rule_used" }));
});

test("TC-SR1-19 a fake cloud call asks after a rejection and runs by rule in the next run", {
  timeout: 20000,
}, async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FlowManifest, Requirement } = await import("@flowdriven/sdk");
  const { createEngine } = await import("../engine.ts");
  const { demoFlow } = await import("../demo/demo-flow.ts");
  const { routeRequirement } = await import("../router/route.ts");
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { createClaudeAdapter } = await import("../claude/adapter.ts");
  const { recordRuleUse } = await import("./standing.ts");
  const { createGrantBook } = await import("../connectors/grants.ts");
  const { earlierNo } = await import("./decisions.ts");
  const connector = {
    ref: "connector:cloud",
    name: "cloud",
    url: "https://cloud.example.test/mcp",
    prefix: "mcp__cloud__",
    label: "Cloud",
    read: [],
    write: ["upload"],
    risky: {},
  };
  const fact = {
    name: connector.name,
    url: connector.url,
    id: `mcpsrv_${"b".repeat(24)}`,
    status: "connected" as const,
    tools: [{ name: "upload", readOnly: false }],
  };
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-rule-miss-")));
  const home = makeFakeHome({
    connectors: { [connector.name]: { url: fact.url, id: fact.id, tools: fact.tools } },
    plays: [
      {
        when: "First step",
        actions: [
          {
            do: "tool",
            id: "first-call",
            name: `${connector.prefix}upload`,
            input: { folder: "cloud:Other", name: "app.apk" },
          },
          { do: "result", result: "done" },
        ],
      },
      {
        when: "Upload test",
        actions: [
          {
            do: "tool",
            id: "upload-1",
            name: `${connector.prefix}upload`,
            input: { folder: "cloud:Builds", name: "app.apk" },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const store = await openSqliteStore(":memory:");
  try {
    const base = demoFlow().manifest;
    const place = { kind: "folder" as const, value: "cloud:Builds", label: "Builds" };
    const touch = {
      id: "upload-apk",
      sentence: "Upload the APK",
      effect: "change" as const,
      rule: "asks_first" as const,
      covers: ["cloud.upload"],
      place,
    };
    const requirement = Requirement.parse({
      id: "cloud",
      type: "mcp_server",
      ref: connector.ref,
      tools: ["upload"],
    });
    const manifest = FlowManifest.parse({
      ...base,
      id: "example.build-apk",
      format: "flowdriven-flow/1.2",
      requirements: [requirement],
      touches: [touch],
      steps: [
        {
          id: "first",
          do: "worker",
          instructions: "First step",
          uses: ["cloud"],
          checks: [{ type: "contains", pattern: "done" }],
        },
        {
          id: "upload",
          title: "Upload APK",
          do: "worker",
          instructions: "Upload test",
          uses: ["cloud"],
          checks: [{ type: "contains", pattern: "done" }],
        },
      ],
    });
    const hash = `sha256:${"a".repeat(64)}`;
    store.putFlow({
      id: manifest.id,
      hash,
      version: manifest.version,
      manifest,
      files: {},
      registeredAt: "2026-11-20T00:00:00Z",
    });
    const rule = store.makeRule({
      flowId: manifest.id,
      touchId: touch.id,
      effect: touch.effect,
      place,
      createdAt: "2026-11-20T00:00:00Z",
    });
    const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [fact] }, [
      connector,
    ]);
    if (!route?.routed) throw new Error("Missing route");
    const project = join(root, "project");
    mkdirSync(project);
    const adapter = createClaudeAdapter({
      claudePath: () => FAKE_CLAUDE_PATH,
      env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
      controlRoot: join(root, "control"),
      audit: (kind, runId, detail) =>
        store.appendAudit({ at: "2026-11-21T00:00:00.000Z", kind, runId, detail }),
      newId: () => "cc-miss",
      newSessionId: () => "session-miss",
      rounds: 20,
      exitWaitMs: 10000,
      catalog: [connector],
      effectCatalog: [
        {
          tool: `${connector.prefix}upload`,
          effect: "change",
          place: { kind: "folder", fromInput: "folder" },
        },
      ],
      connectors: () => [fact],
      grants: createGrantBook(store),
      confirmation: (runId) => ({
        confirmation: { flowId: manifest.id, hash, onItsOwn: [], touches: [touch] },
        rules: store.listRules(),
        earlierNo: earlierNo(store, runId),
        source: "chat",
        startedAt: "2026-11-21T00:00:00Z",
      }),
      recordRule: (input) => recordRuleUse(store, input),
    });
    let next = 0;
    const engine = createEngine({
      store,
      harness: adapter,
      now: () => new Date("2026-11-21T00:00:00Z"),
      newId: (prefix) => `${prefix}-${++next}`,
      routeOf: () => [route],
    });
    // TC-SR1-19 scenario C and TC-SR1-20: Stop never executes later rule-eligible work.
    const stopped = await engine.startRun(manifest.id, { project });
    const stoppedDecision = store.listApprovals({ runId: stopped.id, state: "pending" }).at(0);
    if (!stoppedDecision) throw new Error("missing stopped decision");
    engine.stopRun(stopped.id, "person");
    expect(store.getRun(stopped.id)?.state).toBe("stopped");
    expect(store.getApproval(stoppedDecision.id)).toMatchObject({ state: "expired", resolvedVia: "stop" });
    expect(store.getStep(stopped.id, "upload")).toBeUndefined();
    expect(store.listRules().find((item) => item.id === rule.id)?.uses).toBe(0);
    expect(readFakeCalls(home).some((call) => "id" in call && call.id === "upload-1")).toBe(false);
    const run = await engine.startRun(manifest.id, { project });
    expect(run.state).toBe("waiting_approval");
    const first = store.listApprovals({ runId: run.id, state: "pending" }).at(0);
    if (!first) throw new Error("missing first decision");
    expect((await engine.decide(first.id, "reject")).state).toBe("waiting_approval");
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ id: "upload-1", hookExit: 2, ran: false }),
    );
    expect(store.listApprovals({ runId: run.id, state: "pending" })).toContainEqual(
      expect.objectContaining({ stepId: "upload" }),
    );
    expect(store.listRules().find((item) => item.id === rule.id)?.uses).toBe(0);
    expect(store.listAudit(run.id).some((item) => item.kind === "call_held")).toBe(true);
    // Complete this run before starting the next one.
    const held = store.listApprovals({ runId: run.id, state: "pending" }).at(0);
    if (!held) throw new Error("missing upload decision");
    await engine.decide(held.id, "reject");
    const nextRun = await engine.startRun(manifest.id, { project });
    const nextFirst = store.listApprovals({ runId: nextRun.id, state: "pending" }).at(0);
    if (!nextFirst) throw new Error("missing next decision");
    expect((await engine.decide(nextFirst.id, "approve")).state).toBe("done");
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ id: "upload-1", hookExit: 0, ran: true }),
    );
    expect(store.listRules().find((item) => item.id === rule.id)?.uses).toBe(1);
    expect(store.listAudit(nextRun.id).some((item) => item.kind === "rule_used")).toBe(true);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-j24-19 batch resumes each held loop item with its exact input once", async () => {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.batch",
    name: "Batch",
    kind: "build",
    steps: [
      {
        id: "items",
        do: "worker",
        instructions: "Items",
        outputs: [
          { id: "list", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "ok" }],
      },
      {
        id: "loop",
        for_each: "${steps.items.outputs.list}",
        as: "item",
        key: "${item.id}",
        steps: [
          { id: "send", do: "worker", instructions: "Send", checks: [{ type: "contains", pattern: "ok" }] },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const tool = "reply";
  const ran: string[] = [];
  const c = await setup(parsed.manifest, {
    steps: {
      items: {
        text: "ok",
        outputs: { list: [{ id: "one" }, { id: "two" }, { id: "three" }], message: "ok" },
      },
      send: (req) => {
        const input = { to: ["sam@example.test"], body: `message-${req.itemKey}` };
        if (!req.approvedCalls)
          return {
            hold: {
              requirementId: "mail",
              tool,
              input,
              digest: digestCall(tool, input),
              effect: "send",
              action: "send",
            },
          };
        expect(req.approvedCalls).toEqual([{ tool, input }]);
        ran.push(req.itemKey);
        return { text: "ok" };
      },
    },
  });
  stores.push(c.store);
  const run = await c.engine.startRun(parsed.manifest.id, { project: "." });
  const first = c.store.listApprovals({ runId: run.id, state: "pending" })[0];
  if (!first) throw new Error(`missing held call: ${JSON.stringify(run)}`);
  const { callGrant } = await import("../connectors/grants.ts");
  const ids = [first.id, "batch-two", "batch-three"];
  for (const [index, itemKey] of ["one", "two", "three"].entries()) {
    const input = { to: ["sam@example.test"], body: `message-${itemKey}` };
    const row = {
      ...first,
      id: ids[index] ?? "",
      itemKey,
      kind: "risky_action" as const,
      riskyAction: "send" as const,
      effect: "send" as const,
      similarGroup: "send:local.batch:reply",
      call: { tool, input },
      approves: [callGrant("mail", tool, digestCall(tool, input))],
    };
    if (index === 0) c.store.updateApproval(row.id, row);
    else c.store.createApproval(row);
    c.store.upsertStep({
      runId: run.id,
      stepId: "send",
      itemKey,
      state: "waiting_approval",
      attempts: [],
      outputs: {},
      checks: [],
    });
    const item = c.store.listItems(run.id).find((entry) => entry.key === itemKey);
    if (!item) throw new Error("missing item");
    c.store.upsertItem({ ...item, status: "running" });
  }
  c.engine.beginDecideSimilar(ids, "send:local.batch:reply");
  await vi.waitFor(() => expect(c.store.getRun(run.id)?.state).toBe("done"));
  expect(ran).toEqual(["one", "two", "three"]);
});

test("TC-j24-12 TC-RUL-08 always allow creates a rule and approves the decision", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { callGrant, digestCall } = await import("../connectors/grants.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T01:00:00Z"),
  });
  try {
    const row = pendingDecision(store, { id: "always", createdAt: "2026-11-21T00:00:00Z" });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("Missing run");
    const flow = store.getFlow(run.flowId, run.flowHash);
    if (!flow || !flow.manifest || typeof flow.manifest !== "object") throw new Error("Missing flow");
    const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
    store.putFlow({
      ...flow,
      manifest: {
        ...flow.manifest,
        format: "flowdriven-flow/1.2",
        touches: [
          {
            id: "log-hours",
            sentence: "Log hours",
            effect: "change",
            rule: "asks_first",
            covers: ["timesheet.log_entry"],
            place,
          },
        ],
      },
    });
    const tool = "timesheet.log_entry";
    const input = { hours: 8 };
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "change",
      touchId: "log-hours",
      fixedPlace: true,
      place,
      call: { tool, input },
      approves: [callGrant("timesheet", tool, digestCall(tool, input))],
    });
    const result = await service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" });
    expect(result).toMatchObject({ decision: { state: "allowed_always", ruleId: expect.any(String) } });
    expect(await service.call("rules.list", { flowId: store.getRun(row.runId)?.flowId })).toHaveLength(1);
    expect(store.listAudit(row.runId)).toContainEqual(
      expect.objectContaining({
        kind: "rule_created",
        detail: expect.objectContaining({ by: "always_allow" }),
      }),
    );
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-14 and TC-SR1-29 a rule use is recorded without its place value", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const standing = await import("./standing.ts");
  const store = await openSqliteStore(":memory:");
  try {
    const row = pendingDecision(store, { id: "rule-use", createdAt: "2026-11-21T00:00:00Z" });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("Missing run");
    const rule = store.makeRule({
      flowId: run.flowId,
      touchId: "log-hours",
      effect: "change",
      place: { kind: "account", value: "timesheet-account" },
      sentence: "Log hours",
    });
    const at = "2026-11-22T00:00:00.000Z";
    standing.recordRuleUse(store, {
      ruleId: rule.id,
      runId: run.id,
      stepId: row.stepId,
      itemKey: "",
      tool: "timesheet.log_entry",
      title: "Log 8 hours",
      at,
    });
    expect(store.listRules()[0]).toMatchObject({ uses: 1, lastUsedAt: at });
    expect(store.getStep(run.id, row.stepId)).toMatchObject({
      ruleUses: [{ ruleId: rule.id, tool: "timesheet.log_entry", at }],
    });
    expect(store.getRun(run.id)?.decisionLines).toContainEqual({
      key: "report.doneByRule",
      params: { title: "Log 8 hours" },
    });
    const audit = store.listAudit(run.id).find((entry) => entry.kind === "rule_used");
    expect(audit?.detail).toMatchObject({
      ruleId: rule.id,
      flowId: run.flowId,
      touchId: "log-hours",
      effect: "change",
      placeKind: "account",
      runId: run.id,
      stepId: row.stepId,
    });
    expect(JSON.stringify(audit)).not.toContain("timesheet-account");
  } finally {
    store.close();
  }
});

test("TC-j24-12 the chat line is posted and the approved run finishes", async () => {
  const { FlowManifest } = await import("@flowdriven/sdk");
  const { callGrant, digestCall } = await import("../connectors/grants.ts");
  const { scriptedHarness } = await import("../scripted-harness.ts");
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { vi } = await import("vitest");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T01:00:00Z"),
    harness: scriptedHarness({ steps: { alerts: { text: "ok" } } }),
  });
  try {
    const row = pendingDecision(store, { id: "chat-rule", createdAt: "2026-11-21T00:00:00Z" });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("Missing run");
    const flow = store.getFlow(run.flowId, run.flowHash);
    if (!flow || !flow.manifest || typeof flow.manifest !== "object") throw new Error("Missing flow");
    const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
    const manifest = FlowManifest.parse({
      ...flow.manifest,
      format: "flowdriven-flow/1.2",
      name: "Fill timesheet",
      steps: [
        {
          id: "alerts",
          do: "worker",
          instructions: "Log hours",
          checks: [{ type: "contains", pattern: "ok" }],
        },
      ],
      touches: [
        {
          id: "log-hours",
          sentence: "Log hours",
          effect: "change",
          rule: "asks_first",
          covers: ["timesheet.log_entry"],
          place,
        },
      ],
    });
    store.putFlow({ ...flow, manifest });
    store.putChat({
      id: "chat-rule",
      title: "Timesheet",
      titleSource: "flowdriven",
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      from: "flowdriven",
      language: "en",
      languageSource: "app",
      agent: "claude-code",
      model: "default",
      agentSource: "main_default",
    });
    store.updateRun(run.id, { start: { source: "chat", chatId: "chat-rule" } });
    const tool = "log_entry";
    const input = { hours: 8 };
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "change",
      touchId: "log-hours",
      fixedPlace: true,
      place,
      chatId: "chat-rule",
      call: { tool, input },
      approves: [callGrant("timesheet", tool, digestCall(tool, input))],
    });
    await service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" });
    await vi.waitFor(() => expect(store.getRun(run.id)?.state).toBe("done"));
    expect(store.listMessages("chat-rule")).toContainEqual(
      expect.objectContaining({ line: { key: "chat.alwaysAllowed", params: { flow: "Fill timesheet" } } }),
    );
    expect(
      store.findGrant({
        runId: run.id,
        stepId: row.stepId,
        itemKey: "",
        tool: "timesheet.log_entry",
        digest: digestCall(tool, input),
        kind: "approve",
        createdAt: "",
      }),
    ).toBeDefined();
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j24-36 phone can approve or reject but cannot edit, batch or create rules", async () => {
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { createDecisionHandlers } = await import("../service/handlers.ts");
  const { createWeekly } = await import("../service/weekly-limit.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  const handlers = createDecisionHandlers(
    store,
    service.engine,
    createWeekly({ store, now: () => new Date(), recheck: () => {} }),
    () => {},
  );
  try {
    const change = pendingDecision(store, { id: "phone-change", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(change.id, {
      kind: "risky_action",
      effect: "change",
      fixedPlace: true,
      place: { kind: "account", value: "private", label: "Account" },
    });
    const editable = pendingDecision(store, { id: "phone-editable", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(editable.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      payload: { kind: "email", to: ["sam@example.test"], subject: "Hello", body: "Thanks" },
    });
    const group = `send:${change.runId}:reply`;
    const first = {
      ...change,
      id: "phone-send-one",
      kind: "risky_action" as const,
      effect: "send" as const,
      riskyAction: "send" as const,
      similarGroup: group,
    };
    const second = { ...first, id: "phone-send-two" };
    store.createApproval(first);
    store.createApproval(second);
    expect(() =>
      handlers.resolve({ approvalId: change.id, decision: "always_allow" }, { caller: "phone" }),
    ).toThrow(expect.objectContaining({ code: "not_allowed", reason: "phone_no_rules" }));
    expect(() =>
      handlers.resolve(
        { approvalId: editable.id, decision: "edit", editedText: "edited" },
        { caller: "phone" },
      ),
    ).toThrow(expect.objectContaining({ code: "not_allowed", reason: "phone_no_rules" }));
    await expect(
      service.call(
        "approvals.resolveSimilar",
        { runId: change.runId, group, approvalIds: [first.id, second.id] },
        "phone",
      ),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "caller_not_allowed" });
    expect(store.getApproval(change.id)?.state).toBe("pending");
    expect(store.getApproval(editable.id)?.state).toBe("pending");
    expect(store.getApproval(first.id)?.state).toBe("pending");
    expect(store.getApproval(second.id)?.state).toBe("pending");
    for (const decision of ["approve", "reject"] as const) {
      const row = pendingDecision(store, { id: `phone-case-${decision}`, createdAt: "2026-11-21T00:00:00Z" });
      expect(handlers.resolve({ approvalId: row.id, decision }, { caller: "phone" }).decision).toMatchObject({
        resolvedVia: "phone",
      });
      expect(store.listAudit(row.runId)).toContainEqual(
        expect.objectContaining({
          kind: "decision_made",
          detail: { approvalId: row.id, decision, via: "phone" },
        }),
      );
    }
    expect(store.listRules()).toEqual([]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR8-07 used grant precedes allow and a crash requires a new decision", {
  timeout: 20000,
}, async () => {
  const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { DatabaseSync } = await import("node:sqlite");
  const { join } = await import("node:path");
  const { Requirement } = await import("@flowdriven/sdk");
  const { CONNECTORS } = await import("../connectors/catalog.ts");
  const { callGrant, createGrantBook } = await import("../connectors/grants.ts");
  const { routeRequirement } = await import("../router/route.ts");
  const { legacyGrant } = await import("../test-helpers/policy-fixture.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { createClaudeAdapter } = await import("../claude/adapter.ts");
  const gmail = CONNECTORS[0];
  if (!gmail) throw new Error("missing connector");
  const fact = {
    name: gmail.name,
    url: gmail.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: [{ name: "reply", readOnly: false }],
  };
  const requirement = Requirement.parse({
    id: "gmail",
    type: "mcp_server",
    ref: "connector:gmail",
    tools: ["reply"],
  });
  const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [fact] });
  if (!route?.routed) throw new Error("missing route");
  const root = mkdtempSync(join(tmpdir(), "flowdriven-grant-"));
  const home = makeFakeHome({
    connectors: { [gmail.name]: { url: fact.url, id: fact.id, tools: fact.tools } },
    plays: [
      {
        when: "Held test",
        actions: [
          {
            do: "tool",
            id: "a",
            name: `${gmail.prefix}reply`,
            input: { to: "sam@example.test", body: "Thanks" },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  let store = await openSqliteStore(join(root, "store.sqlite"));
  const project = join(root, "project");
  mkdirSync(project);
  const grant = callGrant("gmail", "reply", digestCall("reply", { to: "sam@example.test", body: "Thanks" }));
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const initial = pendingDecision(store, { id: "original-approval", createdAt: "2026-11-21T00:00:00Z" });
  store.updateApproval(initial.id, { state: "approved" });
  const key = {
    ...legacyGrant(initial.runId, initial.stepId, initial.itemKey, grant),
    approvalId: initial.id,
  };
  store.putCallGrant(key);
  const log: string[] = [];
  const audits: { kind: string; detail: unknown }[] = [];
  const book = createGrantBook(store);
  const originalUse = book.use;
  book.use = (...args) => {
    const result = originalUse(...args);
    if (result) log.push("write-used");
    return result;
  };
  let controller = new AbortController();
  const options = {
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind: string, _run: string, detail: unknown) => audits.push({ kind, detail }),
    newId: () => "cc-1",
    newSessionId: () => "session-1",
    connectors: () => [fact],
    grants: book,
    afterAllow: () => {
      const db = new DatabaseSync(join(root, "store.sqlite"));
      const stored = db
        .prepare(
          "SELECT data FROM call_grants WHERE run_id = ? AND step_id = ? AND item_key = ? AND tool = ? AND digest = ?",
        )
        .get(key.runId, key.stepId, key.itemKey, key.tool, key.digest);
      db.close();
      expect(stored && JSON.parse(String(stored.data))).toMatchObject({
        usedAt: expect.any(String),
        approvalId: initial.id,
      });
      log.push("write-allow");
      controller.abort();
      throw new Error("crash");
    },
  };
  const request = {
    runId: key.runId,
    stepId: key.stepId,
    itemKey: key.itemKey,
    attempt: 1,
    replan: false,
    kind: "worker" as const,
    title: "t",
    instructions: "Held test",
    uses: ["gmail"],
    project,
    requirements: [requirement],
    routes: [route],
    outputs: [],
    maxDurationMs: 10000,
    signal: controller.signal,
  };
  try {
    await createClaudeAdapter(options).runStep(request);
    expect(log).toEqual(["write-used", "write-allow"]);
    expect(store.findGrant(key)).toBeUndefined();
    store.close();
    store = await openSqliteStore(join(root, "store.sqlite"));
    options.grants = createGrantBook(store);
    controller = new AbortController();
    const next = await createClaudeAdapter({ ...options, afterAllow: undefined }).runStep({
      ...request,
      signal: controller.signal,
    });
    expect(next).toMatchObject({
      hold: { tool: "reply", input: { to: "sam@example.test", body: "Thanks" } },
    });
    expect(readFakeCalls(home).filter((call) => call.kind === "tool" && call.ran).length).toBeLessThanOrEqual(
      1,
    );
    expect(audits).toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ grant: "call", tool: "reply" }),
      }),
    );
    store.putCallGrant(key);
    expect(store.findGrant(key)).toBeUndefined();
    const second = {
      ...initial,
      id: "new-approval",
      kind: "risky_action" as const,
      effect: "send" as const,
      riskyAction: "send" as const,
      call: { tool: "reply", input: { to: "sam@example.test", body: "Thanks" } },
      approves: [grant],
    };
    store.createApproval(second);
    const { createRunnerService } = await import("../service/service.ts");
    const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
    const begun = service.engine.beginDecide(second.id, "approve");
    expect(store.getApproval(second.id)).toMatchObject({ state: "approved", resolvedVia: "window" });
    expect(store.findGrant(key)).toMatchObject({ approvalId: second.id });
    await begun.settled;
    service.stop();
    expect(
      await createClaudeAdapter({ ...options, afterAllow: undefined }).runStep({
        ...request,
        signal: controller.signal,
      }),
    ).toMatchObject({ exit: "ok" });
    expect(readFakeCalls(home).filter((call) => call.kind === "tool" && call.ran).length).toBeLessThanOrEqual(
      1,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-j24-30 flow deletion expires action and choice decisions", async () => {
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const store = await openSqliteStore(":memory:");
  const action = pendingDecision(store, { id: "deleted-action", createdAt: "2026-11-23T00:00:00.000Z" });
  store.updateRun(action.runId, { state: "needs_login" });
  store.updateApproval(action.id, {
    kind: "risky_action",
    effect: "change",
    call: { tool: "log", input: {} },
  });
  store.createApproval({ ...action, id: "deleted-choice", kind: "ask" });
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const run = store.getRun(action.runId);
    if (!run) throw new Error("Missing run");
    await service.call("flows.delete", { flowId: run.flowId });
    await expect(
      service.call("approvals.resolve", { approvalId: action.id, decision: "approve" }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    await expect(
      service.call("approvals.answer", { approvalId: "deleted-choice", picks: [] }),
    ).rejects.toMatchObject({ code: "conflict", reason: "decision_expired" });
    expect(
      store.findGrant({
        runId: action.runId,
        stepId: action.stepId,
        itemKey: action.itemKey,
        tool: "log",
        digest: digestCall("log", {}),
        kind: "approve",
        createdAt: "",
      }),
    ).toBeUndefined();
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR1-48 outside Bash approval runs once, re-arms on repeat, ignores rules, and holds changed input", {
  timeout: 20_000,
}, async () => {
  const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createClaudeAdapter } = await import("../claude/adapter.ts");
  const { createGrantBook } = await import("../connectors/grants.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls, writeFakeScript } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { recordRuleUse } = await import("./standing.ts");

  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-sr148-")));
  const project = join(root, "project");
  const notesDir = join(project, "notes");
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(join(notesDir, "note.txt"), "ok");

  const bashInput = { command: "echo hello" };
  const changedInput = { command: "echo changed" };
  const digest = digestCall("Bash", bashInput);
  const home = makeFakeHome({
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "b1", name: "Bash", input: bashInput },
          { do: "result", result: "done" },
        ],
      },
    ],
  });

  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let seq = 0;
  let clockMs = Date.parse("2026-11-21T00:00:00Z");
  const now = () => {
    clockMs += 1000;
    return new Date(clockMs);
  };
  const newId = (prefix: string) => `${prefix}-${++seq}`;

  const parsed = parseManifest({
    format: "flowdriven-flow/1.2",
    id: "local.outside-bash",
    name: "Outside Bash",
    kind: "build",
    requirements: [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
    touches: [
      {
        id: "write-notes",
        sentence: "Write notes",
        effect: "local_write",
        rule: "asks_first",
        covers: [],
        place: { kind: "folder", value: "notes", label: "Notes" },
      },
    ],
    steps: [
      {
        id: "work",
        title: "Run work",
        do: "worker",
        instructions: "Work",
        uses: ["notes"],
        checks: [{ type: "contains", pattern: "done" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const hash = `sha256:${"a".repeat(64)}`;
  store.putFlow({
    id: parsed.manifest.id,
    hash,
    version: parsed.manifest.version,
    manifest: parsed.manifest,
    files: {},
    registeredAt: "2026-11-20T00:00:00Z",
  });
  store.putFlowHead({
    id: parsed.manifest.id,
    name: parsed.manifest.name,
    summary: parsed.manifest.summary,
    headHash: hash,
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    origin: { kind: "import" },
  });

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
    rules: (flowId) => store.listRules().filter((r) => r.flowId === flowId),
    recordRule: (input) => recordRuleUse(store, input),
  });

  const service = createRunnerService({
    store,
    dataDir: root,
    mode: "demo",
    harness: adapter,
    now,
    newId,
  });

  try {
    await service.call("flows.confirm", {
      flowId: parsed.manifest.id,
      hash,
      onItsOwn: ["write-notes"],
      pins: { notes: notesDir },
    });
    expect(store.listRules()).toHaveLength(1);
    const matchingCmdRule = store.makeRule({
      flowId: parsed.manifest.id,
      touchId: "write-notes",
      effect: "run_command",
      place: { kind: "command", value: "echo hello", label: "Echo" },
      sentence: "Echo hello",
      createdAt: "2026-11-20T00:00:00Z",
    });
    expect(matchingCmdRule.state).toBe("active");

    const started = await service.engine.startRun(parsed.manifest.id, { project });
    expect(started.state).toBe("waiting_approval");
    const first = store.listApprovals({ runId: started.id, state: "pending" })[0];
    expect(first).toMatchObject({
      kind: "outside_flow",
      effect: "run_command",
      approves: [`Bash#${digest}`],
    });
    if (!first) throw new Error("missing first outside decision");

    const listed = (await service.call("approvals.list", { runId: started.id })) as Array<
      Record<string, unknown>
    >;
    expect(listed[0]).toMatchObject({ id: first.id, canAlwaysAllow: false, editable: false });
    expect(listed[0]?.similarGroup).toBeUndefined();
    expect(listed[0]?.similarWaiting).toBeUndefined();

    writeFakeScript(home, {
      plays: [
        {
          when: "",
          actions: [
            { do: "tool", id: "b2", name: "Bash", input: bashInput },
            { do: "tool", id: "b3", name: "Bash", input: bashInput },
            { do: "result", result: "done" },
          ],
        },
      ],
    });
    await service.call("approvals.resolve", { approvalId: first.id, decision: "approve" });
    await vi.waitFor(
      () => expect(store.listApprovals({ runId: started.id, state: "pending" })).toHaveLength(1),
      {
        timeout: 10_000,
      },
    );
    const second = store.listApprovals({ runId: started.id, state: "pending" })[0];
    if (!second) throw new Error("missing second outside decision");
    expect(second.id).not.toBe(first.id);
    expect(readFakeCalls(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "b2", hookExit: 0, ran: true }),
        expect.objectContaining({ id: "b3", hookExit: 2, ran: false }),
      ]),
    );
    expect(await service.call("audit.list", { runId: started.id })).toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ approvalId: first.id, digest }),
      }),
    );
    expect(await service.call("runs.report", { runId: started.id })).toMatchObject({
      decisionLines: [{ key: "report.approvedOnce", params: { title: first.summary } }],
    });

    writeFakeScript(home, {
      plays: [
        {
          when: "",
          actions: [
            { do: "tool", id: "b4", name: "Bash", input: bashInput },
            { do: "tool", id: "b5", name: "Bash", input: changedInput },
            { do: "result", result: "done" },
          ],
        },
      ],
    });
    await service.call("approvals.resolve", { approvalId: second.id, decision: "approve" });
    await vi.waitFor(
      () => expect(store.listApprovals({ runId: started.id, state: "pending" })).toHaveLength(1),
      {
        timeout: 10_000,
      },
    );
    const third = store.listApprovals({ runId: started.id, state: "pending" })[0];
    if (!third) throw new Error("missing third outside decision");
    expect(third.call).toEqual({ tool: "Bash", input: changedInput });
    expect(readFakeCalls(home)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "b4", hookExit: 0, ran: true }),
        expect.objectContaining({ id: "b5", hookExit: 2, ran: false }),
      ]),
    );
    expect(await service.call("audit.list", { runId: started.id })).toContainEqual(
      expect.objectContaining({
        kind: "grant_used",
        detail: expect.objectContaining({ approvalId: second.id, digest }),
      }),
    );
    expect(await service.call("runs.report", { runId: started.id })).toMatchObject({
      decisionLines: [
        { key: "report.approvedOnce", params: { title: first.summary } },
        { key: "report.approvedOnce", params: { title: second.summary } },
      ],
    });
  } finally {
    service.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-SR1-48 mcp__ and WebFetch outside grants run once, re-arm, and block crash auto-resume", async () => {
  const { decide } = await import("../claude/decide.ts");
  const { callGrant, createGrantBook } = await import("../connectors/grants.ts");
  const { createEngine } = await import("../engine.ts");
  const { scriptedHarness } = await import("../scripted-harness.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");

  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    now: () => new Date("2026-11-21T00:00:00Z"),
  });

  try {
    const mcpTool = "mcp__claude_ai_Gmail__forward";
    const mcpInput = { to: ["x@example.test"], threadId: "t1" };
    const mcpDigest = digestCall(mcpTool, mcpInput);
    const first = pendingDecision(store, {
      id: "outside-mcp-1",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "outside_flow",
      effect: "send",
    });
    store.updateApproval(first.id, {
      call: { tool: mcpTool, input: mcpInput },
      approves: [callGrant("mail", mcpTool, mcpDigest)],
    });
    await service.call("approvals.resolve", { approvalId: first.id, decision: "approve" });
    expect(approvedCallsOf(store, first.runId, first.stepId, first.itemKey)).toEqual([
      { tool: mcpTool, input: mcpInput, outsideFlow: true },
    ]);

    const policy = {
      tools: [],
      folders: [],
      cwd: "/tmp",
      addDirs: [],
      schema: false,
      sessionId: "s",
      touches: [],
      runId: first.runId,
      stepId: first.stepId,
      itemKey: first.itemKey,
    };
    const mcpCall = {
      hook_event_name: "PreToolUse",
      session_id: "s",
      tool_use_id: "u1",
      tool_name: mcpTool,
      tool_input: mcpInput,
    };
    const grants = createGrantBook(store);
    expect(decide(policy, mcpCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "run",
      by: "grant",
      grant: { approvalId: first.id },
    });
    store.useGrant(
      {
        runId: first.runId,
        stepId: first.stepId,
        itemKey: first.itemKey,
        tool: mcpTool,
        digest: mcpDigest,
        kind: "approve",
        createdAt: "",
      },
      "2026-11-21T00:00:01Z",
    );
    expect(decide(policy, mcpCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "hold",
      held: { outsideFlow: true, tool: mcpTool },
    });

    const second = {
      ...first,
      id: "outside-mcp-2",
      state: "pending" as const,
      call: { tool: mcpTool, input: mcpInput },
      approves: [callGrant("mail", mcpTool, mcpDigest)],
      resolvedAt: undefined,
      resolvedVia: undefined,
    };
    store.createApproval(second);
    store.updateRun(first.runId, { state: "waiting_approval" });
    await service.call("approvals.resolve", { approvalId: second.id, decision: "approve" });
    expect(decide(policy, mcpCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "run",
      by: "grant",
      grant: { approvalId: second.id },
    });
    store.useGrant(
      {
        runId: first.runId,
        stepId: first.stepId,
        itemKey: first.itemKey,
        tool: mcpTool,
        digest: mcpDigest,
        kind: "approve",
        createdAt: "",
      },
      "2026-11-21T00:00:02Z",
    );
    expect(decide(policy, mcpCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "hold",
      held: { outsideFlow: true, tool: mcpTool },
    });

    const webTool = "WebFetch";
    const webInput = { url: "https://example.test/" };
    const webDigest = digestCall(webTool, webInput);
    const webRow = pendingDecision(store, {
      id: "outside-webfetch",
      createdAt: "2026-11-21T00:00:00Z",
      kind: "outside_flow",
      effect: "change",
    });
    store.updateApproval(webRow.id, {
      call: { tool: webTool, input: webInput },
      approves: [`${webTool}#${webDigest}`],
    });
    await service.call("approvals.resolve", { approvalId: webRow.id, decision: "approve" });
    expect(approvedCallsOf(store, webRow.runId, webRow.stepId, webRow.itemKey)).toEqual([
      { tool: webTool, input: webInput, outsideFlow: true },
    ]);
    const webPolicy = { ...policy, runId: webRow.runId, stepId: webRow.stepId, itemKey: webRow.itemKey };
    const webCall = { ...mcpCall, tool_name: webTool, tool_input: webInput };
    expect(decide(webPolicy, webCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "run",
      by: "grant",
      grant: { approvalId: webRow.id },
    });
    store.useGrant(
      {
        runId: webRow.runId,
        stepId: webRow.stepId,
        itemKey: webRow.itemKey,
        tool: webTool,
        digest: webDigest,
        kind: "approve",
        createdAt: "",
      },
      "2026-11-21T00:00:03Z",
    );
    expect(decide(webPolicy, webCall, undefined, undefined, { grants })).toMatchObject({
      outcome: "hold",
      held: { outsideFlow: true, tool: webTool },
    });
    expect(
      decide(
        webPolicy,
        { ...webCall, tool_input: { url: "https://other.example.test/" } },
        undefined,
        undefined,
        {
          grants,
        },
      ),
    ).toMatchObject({ outcome: "hold", held: { outsideFlow: true, tool: webTool } });

    const crashManifest = parseManifest({
      format: "flowdriven-flow/1.1",
      id: "local.crash-outside",
      name: "Crash outside",
      kind: "build",
      steps: [{ id: "work", do: "worker", instructions: "Work", idempotent: true, checks: [] }],
    });
    if (!crashManifest.ok) throw new Error(JSON.stringify(crashManifest.issues));
    const crashHash = `sha256:${"b".repeat(64)}`;
    store.putFlow({
      id: crashManifest.manifest.id,
      hash: crashHash,
      version: crashManifest.manifest.version,
      manifest: crashManifest.manifest,
      files: {},
      registeredAt: "2026-11-21T00:00:00Z",
    });
    store.createRun({
      id: "run-crash-outside",
      flowId: crashManifest.manifest.id,
      flowHash: crashHash,
      flowVersion: crashManifest.manifest.version,
      state: "running",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-21T00:00:00Z",
    });
    store.upsertStep({
      runId: "run-crash-outside",
      stepId: "work",
      itemKey: "",
      state: "running",
      attempts: [],
      outputs: {},
      checks: [],
    });
    store.createApproval({
      id: "ap-crash-outside",
      kind: "outside_flow",
      effect: "change",
      runId: "run-crash-outside",
      stepId: "work",
      itemKey: "",
      summary: "work: Bash",
      payload: "echo",
      approves: [`Bash#${digestCall("Bash", { command: "echo" })}`],
      onExpiry: "fail",
      createdAt: "2026-11-21T00:00:00Z",
      expiresAt: "2026-11-22T00:00:00Z",
      state: "approved",
    });
    const harness = scriptedHarness({ steps: { work: { text: "ok" } } });
    const recoveryEngine = createEngine({ store, harness, now: () => new Date("2026-11-21T00:01:00Z") });
    await recoveryEngine.recoverAfterCrash();
    expect(store.getRun("run-crash-outside")).toMatchObject({
      state: "interrupted",
      cause: { code: "crash", params: { step: "work" } },
    });
    expect(harness.calls).toEqual([]);
    recoveryEngine.shutdown();
  } finally {
    service.stop();
  }
});

test("TC-j24-39 decision audit and report record every path without secrets or raw hidden chars", async () => {
  const { scriptedHarness } = await import("../scripted-harness.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { recordRuleUse } = await import("./standing.ts");

  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let seq = 0;
  let ms = Date.parse("2026-11-21T00:00:00Z");
  const now = () => {
    ms += 1000;
    return new Date(ms);
  };
  const newId = (prefix: string) => `${prefix}-${++seq}`;

  const zws = String.fromCodePoint(0x200b);
  const fakeToken = `sk-${"y".repeat(24)}`;
  const riskyTool = "mcp__claude_ai_Gmail__reply";
  const hiddenBody = `Hi${zws} ${fakeToken}`;
  const hiddenInput = { to: "sam@example.test", subject: "Reply", body: hiddenBody };
  const rejectInput = { to: "alex@example.test", subject: "Skip", body: "No" };
  const outsideInput = { url: "https://example.test/" };

  let mode: "hidden" | "reject" | "stop" | "outside" = "hidden";
  const harness = scriptedHarness({
    steps: {
      work: (req) => {
        if (req.approvedCalls?.length || req.rejectedCalls?.length) return { text: "ok" };
        if (mode === "hidden")
          return {
            hold: {
              requirementId: "mail",
              tool: riskyTool,
              input: hiddenInput,
              digest: digestCall(riskyTool, hiddenInput),
              effect: "send",
              action: "send",
            },
          };
        if (mode === "reject" || mode === "stop")
          return {
            hold: {
              requirementId: "mail",
              tool: riskyTool,
              input: rejectInput,
              digest: digestCall(riskyTool, rejectInput),
              effect: "send",
              action: "send",
            },
          };
        return {
          hold: {
            requirementId: "WebFetch",
            tool: "WebFetch",
            input: outsideInput,
            digest: digestCall("WebFetch", outsideInput),
            effect: "change",
            outsideFlow: true,
          },
        };
      },
    },
  });

  const service = createRunnerService({ store, dataDir: ".", mode: "demo", harness, now, newId });
  try {
    const parsed = parseManifest({
      format: "flowdriven-flow/1.2",
      id: "local.j24-39",
      name: "Audit report flow",
      kind: "build",
      steps: [
        {
          id: "work",
          title: "Work step",
          do: "worker",
          instructions: "Work",
          checks: [{ type: "contains", pattern: "ok" }],
        },
      ],
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const hash = `sha256:${"a".repeat(64)}`;
    store.putFlow({
      id: parsed.manifest.id,
      hash,
      version: parsed.manifest.version,
      manifest: parsed.manifest,
      files: {},
      registeredAt: "2026-11-21T00:00:00Z",
    });
    store.putChat({
      id: "chat-secret",
      title: "Secret chat",
      titleSource: "flowdriven",
      createdAt: "2026-11-21T00:00:00Z",
      updatedAt: "2026-11-21T00:00:00Z",
      from: "flowdriven",
      language: "en",
      languageSource: "app",
      agent: "claude-code",
      model: "default",
      agentSource: "main_default",
    });
    store.putMessage({
      id: "msg-secret",
      chatId: "chat-secret",
      seq: 1,
      at: "2026-11-21T00:00:00Z",
      role: "person",
      kind: "text",
      outside: false,
      text: `Please use ${fakeToken}`,
    });

    // 1. Risky approved with hidden char and token
    const r1 = await service.engine.startRun(parsed.manifest.id, { project: "." });
    const a1 = store.listApprovals({ runId: r1.id, state: "pending" })[0];
    if (!a1) throw new Error("missing a1");
    expect(JSON.stringify(await service.call("approvals.list", { runId: r1.id }))).toContain(
      "[U+200B hidden character]",
    );
    await service.call("approvals.resolve", { approvalId: a1.id, decision: "approve" });
    await vi.waitFor(() => expect(store.getRun(r1.id)?.state).toBe("done"));
    expect(await service.call("audit.list", { runId: r1.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "call_held",
          detail: expect.objectContaining({
            approvalId: a1.id,
            hiddenCharacters: ["[U+200B hidden character]"],
          }),
        }),
        expect.objectContaining({
          kind: "decision_made",
          detail: expect.objectContaining({ approvalId: a1.id, decision: "approve", via: "window" }),
        }),
      ]),
    );
    expect(await service.call("runs.report", { runId: r1.id })).toMatchObject({
      decisionLines: [{ key: "report.youApproved", params: { title: a1.summary } }],
    });

    // 2. Risky rejected
    mode = "reject";
    const r2 = await service.engine.startRun(parsed.manifest.id, { project: "." });
    const a2 = store.listApprovals({ runId: r2.id, state: "pending" })[0];
    if (!a2) throw new Error("missing a2");
    await service.call("approvals.resolve", { approvalId: a2.id, decision: "reject" });
    await vi.waitFor(() => expect(store.getRun(r2.id)?.state).toBe("done"));
    expect(await service.call("audit.list", { runId: r2.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "call_held",
          detail: expect.objectContaining({ approvalId: a2.id }),
        }),
        expect.objectContaining({
          kind: "decision_made",
          detail: expect.objectContaining({ approvalId: a2.id, decision: "reject", via: "window" }),
        }),
      ]),
    );
    expect(await service.call("runs.report", { runId: r2.id })).toMatchObject({
      decisionLines: [{ key: "report.youSaidNo", params: { title: a2.summary } }],
    });

    // 3. Stopped before answer
    mode = "stop";
    const r3 = await service.engine.startRun(parsed.manifest.id, { project: "." });
    const a3 = store.listApprovals({ runId: r3.id, state: "pending" })[0];
    if (!a3) throw new Error("missing a3");
    await service.call("runs.stop", { runId: r3.id });
    expect(await service.call("audit.list", { runId: r3.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "call_held",
          detail: expect.objectContaining({ approvalId: a3.id }),
        }),
        expect.objectContaining({
          kind: "decision_expired",
          detail: expect.objectContaining({ approvalId: a3.id, runId: r3.id, why: "stop" }),
        }),
        expect.objectContaining({ kind: "run_stopped", detail: expect.objectContaining({ runId: r3.id }) }),
      ]),
    );
    expect(await service.call("runs.report", { runId: r3.id })).toMatchObject({ decisionLines: [] });

    // 4. Done by rule and rule revoked
    const rule = store.makeRule({
      flowId: parsed.manifest.id,
      touchId: "log-hours",
      effect: "change",
      place: { kind: "account", value: "timesheet-account", label: "Timesheet" },
      sentence: "Log hours",
      createdAt: "2026-11-21T00:00:00Z",
    });
    store.createRun({
      id: "run-rule-j24-39",
      flowId: parsed.manifest.id,
      flowHash: hash,
      flowVersion: parsed.manifest.version,
      state: "running",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: "2026-11-21T00:00:00Z",
    });
    store.upsertStep({
      runId: "run-rule-j24-39",
      stepId: "work",
      itemKey: "",
      state: "running",
      attempts: [],
      outputs: {},
      checks: [],
    });
    recordRuleUse(store, {
      ruleId: rule.id,
      runId: "run-rule-j24-39",
      stepId: "work",
      itemKey: "",
      tool: "timesheet.log_entry",
      title: "Log hours",
      at: "2026-11-21T00:05:00Z",
    });
    expect(await service.call("audit.list", { runId: "run-rule-j24-39" })).toContainEqual(
      expect.objectContaining({
        kind: "rule_used",
        detail: expect.objectContaining({ ruleId: rule.id, placeKind: "account" }),
      }),
    );
    expect(await service.call("runs.report", { runId: "run-rule-j24-39" })).toMatchObject({
      decisionLines: [{ key: "report.doneByRule", params: { title: "Log hours" } }],
    });
    await service.call("rules.revoke", { ruleId: rule.id });

    // 5. Outside flow held and approved once
    mode = "outside";
    const r5 = await service.engine.startRun(parsed.manifest.id, { project: "." });
    const a5 = store.listApprovals({ runId: r5.id, state: "pending" })[0];
    if (!a5) throw new Error("missing a5");
    await service.call("approvals.resolve", { approvalId: a5.id, decision: "approve" });
    await vi.waitFor(() => expect(store.getRun(r5.id)?.state).toBe("done"));
    expect(await service.call("audit.list", { runId: r5.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "call_held",
          detail: expect.objectContaining({ approvalId: a5.id, tool: "WebFetch", effect: "change" }),
        }),
        expect.objectContaining({
          kind: "decision_made",
          detail: expect.objectContaining({ approvalId: a5.id, decision: "approve", via: "window" }),
        }),
      ]),
    );
    expect(await service.call("runs.report", { runId: r5.id })).toMatchObject({
      decisionLines: [{ key: "report.approvedOnce", params: { title: a5.summary } }],
    });

    const allAudits = await service.call("audit.list", {});
    expect(allAudits).toContainEqual(
      expect.objectContaining({
        kind: "rule_revoked",
        detail: expect.objectContaining({ ruleId: rule.id, placeKind: "account", by: "ask_me_again" }),
      }),
    );
    expect(JSON.stringify(allAudits)).not.toContain(fakeToken);
    expect(JSON.stringify(allAudits)).not.toContain(zws);
  } finally {
    service.stop();
  }
});

test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const)(
  "TC-SR7-01 row %i writes the exact decision audit record",
  { timeout: 20_000 },
  async (rowNumber) => {
    const { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ResolvedVia } = await import("@flowdriven/contracts");
    const { createClaudeAdapter } = await import("../claude/adapter.ts");
    const { CONNECTORS } = await import("../connectors/catalog.ts");
    const { callGrant, createGrantBook } = await import("../connectors/grants.ts");
    const { createEngine } = await import("../engine.ts");
    const { routeRequirement } = await import("../router/route.ts");
    const { createDecisionHandlers } = await import("../service/handlers.ts");
    const { createRunnerService } = await import("../service/service.ts");
    const { createWeekly } = await import("../service/weekly-limit.ts");
    const { pendingDecision } = await import("../test-helpers/builders.ts");
    const { FAKE_CLAUDE_PATH, makeFakeHome, writeFakeScript } = await import(
      "../test-helpers/fake-claude-script.ts"
    );
    const { recordRuleUse } = await import("./standing.ts");

    const store = await openSqliteStore(":memory:");
    stores.push(store);
    let seq = 0;
    let ms = Date.parse("2026-11-21T00:00:00Z");
    const now = () => {
      ms += 1000;
      return new Date(ms);
    };
    const newId = (prefix: string) => `${prefix}-${++seq}`;

    const runWithFakeClaude = async (opts: {
      manifestInput: unknown;
      actions: import("../test-helpers/fake-claude-script.ts").FakeAction[];
      nextActions?: import("../test-helpers/fake-claude-script.ts").FakeAction[];
      connectors?: Record<string, { url: string; id: string; tools: { name: string; readOnly?: boolean }[] }>;
      facts?: import("../claude/connector-scan.ts").ConnectorFact[];
      catalog?: import("../connectors/catalog.ts").ConnectorEntry[];
      effectCatalog?: import("./effects.ts").EffectEntry[];
      routes?: import("../router/types.ts").Routed[];
      confirm?: { flowId: string; hash: string; onItsOwn: string[]; pins?: Record<string, string> };
      beforeStart?: (flowId: string, hash: string) => Promise<void> | void;
      afterHold?: (runId: string, svc: import("../service/service.ts").RunnerService) => Promise<void>;
    }) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-sr701-")));
      const project = join(root, "project");
      const notesDir = join(project, "notes");
      mkdirSync(notesDir, { recursive: true });
      writeFileSync(join(notesDir, "note.txt"), "hello");
      const home = makeFakeHome({
        ...(opts.connectors ? { connectors: opts.connectors } : {}),
        plays: [{ when: "", actions: opts.actions }],
      });
      const parsed = parseManifest(opts.manifestInput);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const hash = `sha256:${"a".repeat(64)}`;
      store.putFlow({
        id: parsed.manifest.id,
        hash,
        version: parsed.manifest.version,
        manifest: parsed.manifest,
        files: {},
        registeredAt: "2026-11-20T00:00:00Z",
      });
      store.putFlowHead({
        id: parsed.manifest.id,
        name: parsed.manifest.name,
        summary: parsed.manifest.summary,
        headHash: hash,
        createdAt: "2026-11-20T00:00:00Z",
        updatedAt: "2026-11-20T00:00:00Z",
        origin: { kind: "import" },
      });

      const adapter = createClaudeAdapter({
        claudePath: () => FAKE_CLAUDE_PATH,
        env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
        controlRoot: join(root, "control"),
        audit: (kind, runId, detail) => store.appendAudit({ at: now().toISOString(), kind, runId, detail }),
        newId,
        newSessionId: () => `session-${++seq}`,
        rounds: 20,
        exitWaitMs: 10_000,
        ...(opts.catalog ? { catalog: opts.catalog } : {}),
        ...(opts.effectCatalog ? { effectCatalog: opts.effectCatalog } : {}),
        ...(opts.facts ? { connectors: () => opts.facts ?? [] } : {}),
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
              touches:
                parsed.manifest.format === "flowdriven-flow/1.2" ? (parsed.manifest.touches ?? []) : [],
            },
            rules: store.listRules().filter((r) => r.flowId === run.flowId),
            source: "window",
            earlierNo: false,
            startedAt: run.startedAt,
          };
        },
        rules: (flowId) => store.listRules().filter((r) => r.flowId === flowId),
        recordRule: (input) => recordRuleUse(store, input),
      });

      const service = createRunnerService({
        store,
        dataDir: root,
        mode: "demo",
        harness: adapter,
        now,
        newId,
      });
      const routeEngine = opts.routes
        ? createEngine({
            store,
            harness: adapter,
            now,
            newId,
            routeOf: () => opts.routes ?? [],
          })
        : service.engine;

      try {
        if (opts.confirm) {
          await service.call("flows.confirm", {
            flowId: parsed.manifest.id,
            hash,
            onItsOwn: opts.confirm.onItsOwn,
            pins: Object.fromEntries(
              Object.entries(opts.confirm.pins ?? {}).map(([k, v]) => [k, v === "NOTES" ? notesDir : v]),
            ),
          });
        }
        await opts.beforeStart?.(parsed.manifest.id, hash);
        const run = await routeEngine.startRun(parsed.manifest.id, { project });
        if (opts.nextActions) {
          writeFakeScript(home, {
            ...(opts.connectors ? { connectors: opts.connectors } : {}),
            plays: [{ when: "", actions: opts.nextActions }],
          });
        }
        await opts.afterHold?.(run.id, service);
        const audit = (await service.call("audit.list", { runId: run.id })) as Array<{
          id: number;
          kind: string;
          runId?: string;
          detail: Record<string, unknown>;
        }>;
        return { run, audit, notesDir, flowId: parsed.manifest.id, service };
      } finally {
        if (routeEngine !== service.engine) routeEngine.shutdown();
        service.stop();
        rmSync(root, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      }
    };

    const service = createRunnerService({
      store,
      dataDir: ".",
      mode: "demo",
      now,
      newId,
    });
    try {
      if (rowNumber === 1) {
        const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-sr7-r1-")));
        const project = join(root, "project");
        const notesDir = join(project, "notes");
        mkdirSync(notesDir, { recursive: true });
        const filePath = join(notesDir, "note.txt");
        writeFileSync(filePath, "hello");
        const home = makeFakeHome({
          plays: [
            {
              when: "",
              actions: [
                { do: "tool", id: "r1", name: "Read", input: { file_path: filePath } },
                { do: "result", result: "done" },
              ],
            },
          ],
        });
        try {
          const parsed = parseManifest({
            format: "flowdriven-flow/1.2",
            id: "local.sr7-r1",
            name: "Read",
            kind: "build",
            requirements: [{ id: "notes", type: "path", ref: "notes", access: "read" }],
            touches: [
              {
                id: "read-notes",
                sentence: "Read notes",
                effect: "read",
                rule: "runs_alone",
                covers: [],
                place: { kind: "folder", value: "notes", label: "Notes" },
              },
            ],
            steps: [
              {
                id: "read",
                do: "worker",
                instructions: "Read",
                uses: ["notes"],
                checks: [{ type: "contains", pattern: "done" }],
              },
            ],
          });
          if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
          const hash = `sha256:${"a".repeat(64)}`;
          store.putFlow({
            id: parsed.manifest.id,
            hash,
            version: parsed.manifest.version,
            manifest: parsed.manifest,
            files: {},
            registeredAt: "2026-11-20T00:00:00Z",
          });
          store.putFlowHead({
            id: parsed.manifest.id,
            name: parsed.manifest.name,
            summary: parsed.manifest.summary,
            headHash: hash,
            createdAt: "2026-11-20T00:00:00Z",
            updatedAt: "2026-11-20T00:00:00Z",
            origin: { kind: "import" },
          });
          await service.call("flows.confirm", {
            flowId: parsed.manifest.id,
            hash,
            onItsOwn: [],
            pins: { notes: notesDir },
          });
          const adapter = createClaudeAdapter({
            claudePath: () => FAKE_CLAUDE_PATH,
            env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
            controlRoot: join(root, "control"),
            audit: (kind, runId, detail) =>
              store.appendAudit({ at: now().toISOString(), kind, runId, detail }),
            newId,
            newSessionId: () => `session-${++seq}`,
            rounds: 20,
            exitWaitMs: 10_000,
            confirmation: (runId) => {
              const run = store.getRun(runId);
              const confirmation = run && store.getConfirmation(run.flowId);
              if (!run || !confirmation) return undefined;
              return {
                confirmation: {
                  flowId: run.flowId,
                  hash: run.flowHash,
                  onItsOwn: confirmation.onItsOwn,
                  touches:
                    parsed.manifest.format === "flowdriven-flow/1.2" ? (parsed.manifest.touches ?? []) : [],
                },
                rules: [],
                source: "window",
                earlierNo: false,
                startedAt: run.startedAt,
              };
            },
          });
          const engine = createEngine({ store, harness: adapter, now, newId });
          const run = await engine.startRun(parsed.manifest.id, { project });
          engine.shutdown();
          expect(run.state).toBe("done");
          const audit = (await service.call("audit.list", { runId: run.id })) as Array<{
            kind: string;
            runId?: string;
            detail: Record<string, unknown>;
          }>;
          expect(audit.filter((entry) => entry.kind === "call_held")).toEqual([]);
          expect(audit.filter((entry) => entry.kind === "tool_calls")).toEqual([
            expect.objectContaining({
              kind: "tool_calls",
              runId: run.id,
              detail: expect.objectContaining({ allowed: 1, held: 0, refused: 0 }),
            }),
          ]);
        } finally {
          rmSync(root, { recursive: true, force: true });
          rmSync(home, { recursive: true, force: true });
        }
        return;
      }

      if (rowNumber === 2 || rowNumber === 4) {
        const input = { url: "https://example.test/" };
        const digest = digestCall("WebFetch", input);
        let heldId = "";
        const { run, audit } = await runWithFakeClaude({
          manifestInput: {
            format: "flowdriven-flow/1.2",
            id: "local.sr7-r24",
            name: "Outside",
            kind: "build",
            steps: [
              {
                id: "work",
                do: "worker",
                instructions: "Work",
                checks: [{ type: "contains", pattern: "done" }],
              },
            ],
          },
          actions: [
            { do: "tool", id: "w1", name: "WebFetch", input },
            { do: "result", result: "done" },
          ],
          nextActions:
            rowNumber === 4
              ? [
                  { do: "tool", id: "w2", name: "WebFetch", input },
                  { do: "result", result: "done" },
                ]
              : undefined,
          confirm: { flowId: "local.sr7-r24", hash: "", onItsOwn: [] },
          afterHold: async (runId, svc) => {
            const pending = store.listApprovals({ runId, state: "pending" })[0];
            if (!pending) throw new Error("missing pending outside hold");
            heldId = pending.id;
            if (rowNumber === 4) {
              await svc.call("approvals.resolve", { approvalId: heldId, decision: "approve" });
              await vi.waitFor(() => expect(store.getRun(runId)?.state).toBe("done"), { timeout: 10_000 });
            }
          },
        });
        if (rowNumber === 2) {
          expect(audit.filter((e) => e.kind === "call_held")).toEqual([
            expect.objectContaining({
              kind: "call_held",
              runId: run.id,
              detail: expect.objectContaining({
                approvalId: heldId,
                tool: "WebFetch",
                effect: "change",
                digest,
              }),
            }),
          ]);
          expect(audit.filter((e) => e.kind === "tool_calls")).toEqual([
            expect.objectContaining({
              kind: "tool_calls",
              runId: run.id,
              detail: expect.objectContaining({ held: 1 }),
            }),
          ]);
        } else {
          expect(audit.filter((e) => e.kind === "grant_used")).toEqual([
            expect.objectContaining({
              kind: "grant_used",
              runId: run.id,
              detail: expect.objectContaining({ approvalId: heldId, digest }),
            }),
          ]);
        }
        return;
      }

      if (rowNumber === 3) {
        const gmail = CONNECTORS[0];
        if (!gmail) throw new Error("missing gmail");
        const fact = {
          name: gmail.name,
          url: gmail.url,
          id: `mcpsrv_${"a".repeat(24)}`,
          status: "connected" as const,
          tools: [{ name: "reply", readOnly: false }],
        };
        const req = {
          id: "gmail",
          type: "mcp_server" as const,
          ref: "connector:gmail",
          tools: ["reply"],
          required: true,
          sensitive: false,
          why: "Reply",
        };
        const route = routeRequirement(req, { hooks: true, chrome: false, connectors: [fact] });
        if (!route?.routed) throw new Error("missing route");
        const input = { to: ["sam@example.test"], subject: "Hi", body: "Thanks" };
        const toolName = `${gmail.prefix}reply`;
        const digest = digestCall(toolName, input);
        let heldId = "";
        const { run, audit } = await runWithFakeClaude({
          manifestInput: {
            format: "flowdriven-flow/1.2",
            id: "local.sr7-r3",
            name: "Mail",
            kind: "build",
            requirements: [req],
            touches: [
              { id: "reply", sentence: "Reply", effect: "send", rule: "asks_first", covers: ["gmail.reply"] },
            ],
            steps: [
              {
                id: "reply",
                do: "worker",
                instructions: "Reply",
                uses: ["gmail"],
                checks: [{ type: "contains", pattern: "done" }],
              },
            ],
          },
          actions: [
            { do: "tool", id: "m1", name: toolName, input },
            { do: "result", result: "done" },
          ],
          connectors: { [gmail.name]: { url: fact.url, id: fact.id, tools: fact.tools } },
          facts: [fact],
          routes: [route],
          confirm: { flowId: "local.sr7-r3", hash: "", onItsOwn: [] },
          afterHold: async (runId) => {
            const pending = store.listApprovals({ runId, state: "pending" })[0];
            if (!pending) throw new Error("missing risky hold");
            heldId = pending.id;
          },
        });
        expect(audit.filter((e) => e.kind === "call_held")).toEqual([
          expect.objectContaining({
            kind: "call_held",
            runId: run.id,
            detail: expect.objectContaining({
              approvalId: heldId,
              tool: toolName,
              effect: "send",
              digest,
            }),
          }),
        ]);
        return;
      }

      if (rowNumber === 5) {
        const timesheet = {
          ref: "connector:timesheet",
          name: "timesheet",
          url: "https://timesheet.example.test/mcp",
          prefix: "mcp__timesheet__",
          label: "Timesheet",
          read: [],
          write: ["log_entry"],
          risky: {},
        };
        const fact = {
          name: timesheet.name,
          url: timesheet.url,
          id: `mcpsrv_${"b".repeat(24)}`,
          status: "connected" as const,
          tools: [{ name: "log_entry", readOnly: false }],
        };
        const req = {
          id: "timesheet",
          type: "mcp_server" as const,
          ref: "connector:timesheet",
          tools: ["log_entry"],
          required: true,
          sensitive: false,
          why: "Log",
        };
        const route = routeRequirement(req, { hooks: true, chrome: false, connectors: [fact] }, [timesheet]);
        if (!route?.routed) throw new Error("missing timesheet route");
        const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
        const { run, audit, flowId } = await runWithFakeClaude({
          manifestInput: {
            format: "flowdriven-flow/1.2",
            id: "local.sr7-r5",
            name: "Timesheet",
            kind: "build",
            requirements: [req],
            touches: [
              {
                id: "log-hours",
                sentence: "Log hours",
                effect: "change",
                rule: "asks_first",
                covers: ["timesheet.log_entry"],
                place,
              },
            ],
            steps: [
              {
                id: "log",
                do: "worker",
                instructions: "Log hours",
                uses: ["timesheet"],
                checks: [{ type: "contains", pattern: "done" }],
              },
            ],
          },
          actions: [
            { do: "tool", id: "ts1", name: `${timesheet.prefix}log_entry`, input: { hours: 2 } },
            { do: "result", result: "done" },
          ],
          connectors: { [timesheet.name]: { url: fact.url, id: fact.id, tools: fact.tools } },
          facts: [fact],
          catalog: [timesheet],
          effectCatalog: [{ tool: `${timesheet.prefix}log_entry`, effect: "change", place }],
          routes: [route],
          confirm: { flowId: "local.sr7-r5", hash: "", onItsOwn: ["log-hours"] },
        });
        expect(run.state).toBe("done");
        const rule = store.listRules()[0];
        if (!rule) throw new Error("missing rule");
        expect(audit.filter((e) => e.kind === "rule_used")).toEqual([
          expect.objectContaining({
            kind: "rule_used",
            runId: run.id,
            detail: {
              ruleId: rule.id,
              flowId,
              touchId: "log-hours",
              effect: "change",
              placeKind: "account",
              runId: run.id,
              stepId: "log",
            },
          }),
        ]);
        expect(JSON.stringify(audit)).not.toContain("timesheet-account");
        return;
      }

      if (rowNumber === 6 || rowNumber === 7 || rowNumber === 8) {
        const row = pendingDecision(store, {
          id: `sr7-r${rowNumber}`,
          createdAt: "2026-11-21T00:00:00Z",
          kind: "risky_action",
          effect: "send",
        });
        const tool = "mcp__claude_ai_Gmail__reply";
        const input = { to: ["sam@example.test"], subject: "Hello", body: "Thanks" };
        store.updateApproval(row.id, {
          call: { tool, input },
          payload: { kind: "email", to: ["sam@example.test"], subject: "Hello", body: "Thanks" },
          approves: [callGrant("mail", tool, digestCall(tool, input))],
        });
        const decision = rowNumber === 6 ? "approve" : rowNumber === 7 ? "edit" : "reject";
        await service.call("approvals.resolve", {
          approvalId: row.id,
          decision,
          ...(decision === "edit" ? { editedText: "Edited" } : {}),
        });
        const audit = (await service.call("audit.list", { runId: row.runId })) as Array<{
          kind: string;
          runId?: string;
          detail: Record<string, unknown>;
        }>;
        const made = audit.filter((e) => e.kind === "decision_made");
        expect(made).toEqual([
          expect.objectContaining({
            kind: "decision_made",
            runId: row.runId,
            detail: { approvalId: row.id, decision, via: "window" },
          }),
        ]);
        expect(ResolvedVia.safeParse(made[0]?.detail.via).success).toBe(true);
        return;
      }

      if (rowNumber === 9) {
        const sendRow = pendingDecision(store, {
          id: "sr7-r9-send",
          createdAt: "2026-11-21T00:00:00Z",
          kind: "risky_action",
          effect: "send",
        });
        store.updateApproval(sendRow.id, {
          fixedPlace: true,
          place: { kind: "account", value: "mail", label: "Mail" },
        });
        await expect(
          service.call("approvals.resolve", { approvalId: sendRow.id, decision: "always_allow" }),
        ).rejects.toMatchObject({ code: "not_allowed", reason: "always_asks" });
        expect(await service.call("audit.list", { runId: sendRow.runId })).toEqual([]);

        const row = pendingDecision(store, {
          id: "sr7-r9-change",
          createdAt: "2026-11-21T00:00:00Z",
          kind: "risky_action",
          effect: "change",
        });
        const flow = store.getFlow(store.getRun(row.runId)?.flowId ?? "");
        if (!flow || !flow.manifest || typeof flow.manifest !== "object") throw new Error("missing flow");
        const place = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
        store.putFlow({
          ...flow,
          manifest: {
            ...flow.manifest,
            format: "flowdriven-flow/1.2",
            touches: [
              {
                id: "log-hours",
                sentence: "Log hours",
                effect: "change",
                rule: "asks_first",
                covers: ["timesheet.log_entry"],
                place,
              },
            ],
          },
        });
        const tool = "timesheet.log_entry";
        const input = { hours: 8 };
        store.updateApproval(row.id, {
          touchId: "log-hours",
          fixedPlace: true,
          place,
          call: { tool, input },
          approves: [callGrant("timesheet", tool, digestCall(tool, input))],
        });
        const res = (await service.call("approvals.resolve", {
          approvalId: row.id,
          decision: "always_allow",
        })) as { decision: { ruleId?: string } };
        const audit = (await service.call("audit.list", { runId: row.runId })) as Array<{
          kind: string;
          runId?: string;
          detail: Record<string, unknown>;
        }>;
        expect(audit.filter((e) => e.kind === "decision_made")).toEqual([
          expect.objectContaining({
            kind: "decision_made",
            runId: row.runId,
            detail: { approvalId: row.id, decision: "always_allow", via: "window" },
          }),
        ]);
        expect(audit.filter((e) => e.kind === "rule_created")).toEqual([
          expect.objectContaining({
            kind: "rule_created",
            runId: row.runId,
            detail: expect.objectContaining({
              by: "always_allow",
              ruleId: res.decision.ruleId,
              placeKind: "account",
            }),
          }),
        ]);
        expect(JSON.stringify(audit)).not.toContain("timesheet-account");
        return;
      }

      if (rowNumber === 10 || rowNumber === 11 || rowNumber === 12) {
        const row = pendingDecision(store, {
          id: `sr7-r${rowNumber}`,
          createdAt: "2026-11-21T00:00:00Z",
          kind: "risky_action",
          effect: "change",
        });
        const run = store.getRun(row.runId);
        if (!run) throw new Error("missing run");
        if (rowNumber === 10) {
          store.updateRun(row.runId, { state: "needs_login" });
          store.putFlowHead({
            id: run.flowId,
            name: "Flow",
            summary: "Summary",
            headHash: run.flowHash,
            createdAt: row.createdAt,
            updatedAt: row.createdAt,
            origin: { kind: "import" },
          });
          await service.call("flows.delete", { flowId: run.flowId });
        } else if (rowNumber === 11) {
          await service.call("runs.stop", { runId: row.runId });
        } else {
          await service.call("settings.update", { patch: { agentPermission: "on" } });
          await service.call("settings.update", { patch: { agentPermission: "off" } });
        }
        const audit = (await service.call("audit.list", { runId: row.runId })) as Array<{
          kind: string;
          runId?: string;
          detail: Record<string, unknown>;
        }>;
        const why = rowNumber === 10 ? "flow_deleted" : rowNumber === 11 ? "stop" : "permission_off";
        expect(audit.filter((e) => e.kind === "decision_expired")).toEqual([
          expect.objectContaining({
            kind: "decision_expired",
            runId: row.runId,
            detail: { approvalId: row.id, runId: row.runId, why },
          }),
        ]);
        if (rowNumber === 11)
          expect(audit.filter((e) => e.kind === "run_stopped")).toEqual([
            expect.objectContaining({ kind: "run_stopped", runId: row.runId }),
          ]);
        return;
      }

      const row = pendingDecision(store, {
        id: "sr7-r13",
        createdAt: "2026-11-21T00:00:00Z",
        kind: "risky_action",
        effect: "change",
      });
      const handlers = createDecisionHandlers(
        store,
        service.engine,
        createWeekly({ store, now, recheck: () => {} }),
        () => {},
      );
      handlers.resolve({ approvalId: row.id, decision: "approve" }, { caller: "phone" });
      const audit = (await service.call("audit.list", { runId: row.runId })) as Array<{
        kind: string;
        runId?: string;
        detail: Record<string, unknown>;
      }>;
      const made = audit.filter((e) => e.kind === "decision_made");
      expect(made).toEqual([
        expect.objectContaining({
          kind: "decision_made",
          runId: row.runId,
          detail: { approvalId: row.id, decision: "approve", via: "phone" },
        }),
      ]);
      expect(ResolvedVia.safeParse(made[0]?.detail.via).success).toBe(true);
    } finally {
      service.stop();
    }
  },
);
