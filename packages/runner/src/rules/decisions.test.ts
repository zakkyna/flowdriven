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
        const input = { body: `message-${req.itemKey}` };
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
    const input = { body: `message-${itemKey}` };
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
