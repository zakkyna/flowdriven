import { expect, test } from "vitest";
import { ruleOf } from "../test-helpers/policy-fixture.ts";

test("TC-RUL-11 matches only the exact active rule and run version", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "account", value: "timesheet-account", label: "Timesheet" };
  const rule = ruleOf("example.fill-timesheet", "log-hours", { place });
  const call = { flowId: rule.flowId, touchId: rule.touchId, effect: rule.effect, place };
  const touch = { id: rule.touchId, effect: rule.effect, place };
  const version = { touches: [touch] };
  expect(matchRule([rule], call, version)).toEqual(rule);
  expect(matchRule([rule], { ...call, place: { ...place, label: "Other label" } }, version)).toEqual(rule);
  for (const other of [
    { ...call, flowId: "another" },
    { ...call, touchId: "another" },
    { ...call, effect: "send" },
    { ...call, place: { ...place, value: "other-account" } },
    { ...call, place: { ...place, kind: "site" } },
  ])
    expect(matchRule([rule], other, version)).toBeUndefined();
  expect(matchRule([{ ...rule, state: "revoked" }], call, version)).toBeUndefined();
  expect(matchRule([rule], call, { touches: [] })).toBeUndefined();
  expect(matchRule([rule], call, { touches: [{ ...touch, effect: "send" }] })).toBeUndefined();
  expect(
    matchRule([rule], call, { touches: [{ ...touch, place: { ...place, value: "other" } }] }),
  ).toBeUndefined();
  const sendRule = { ...rule, effect: "send" };
  expect(
    matchRule([sendRule], { ...call, effect: "send" }, { touches: [{ ...touch, effect: "send" }] }),
  ).toBeUndefined();
});

test("TC-SR1-11 look-alike places never match", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "folder", value: "cloud:Builds" };
  const rule = ruleOf("example.build-apk", "upload-apk", { place });
  const version = { touches: [{ id: rule.touchId, effect: rule.effect, place }] };
  for (const value of [
    "cloud:Bui1ds",
    `cloud:B${String.fromCodePoint(0x0443)}ilds`,
    `cloud:Bu${String.fromCodePoint(0x200b)}ilds`,
    "cloud:Builds/../Secret",
    "cloud:Builds%2F..",
    "cloud:Builds@evil.example.test",
  ]) {
    expect(
      matchRule(
        [rule],
        { flowId: rule.flowId, touchId: rule.touchId, effect: rule.effect, place: { ...place, value } },
        version,
      ),
    ).toBeUndefined();
  }
});

test("TC-j21-31 revoking a rule removes it from the active list", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { standingRule } = await import("../test-helpers/builders.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const rule = standingRule(store);
    await service.call("rules.revoke", { ruleId: rule.id });
    expect(await service.call("rules.list", {})).toEqual([]);
    expect(store.listAudit()).toContainEqual(
      expect.objectContaining({
        kind: "rule_revoked",
        detail: expect.objectContaining({ by: "ask_me_again" }),
      }),
    );
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-j20-33 a send cannot be always allowed", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    const row = pendingDecision(store, { id: "send-rule", createdAt: "2026-11-21T00:00:00Z" });
    store.updateApproval(row.id, {
      kind: "risky_action",
      effect: "send",
      riskyAction: "send",
      fixedPlace: true,
      place: { kind: "account", value: "test", label: "Test" },
    });
    await expect(
      service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "always_asks" });
    expect(store.getApproval(row.id)?.state).toBe("pending");
    expect(await service.call("rules.list", {})).toEqual([]);
  } finally {
    service.stop();
    store.close();
  }
});

test("TC-SR1-09 exact account and folder rules match", async () => {
  const { matchRule } = await import("./standing.ts");
  for (const place of [
    { kind: "account", value: "timesheet-account" },
    { kind: "folder", value: "cloud:Builds" },
  ]) {
    const rule = ruleOf("flow", "touch", { place });
    expect(
      matchRule(
        [rule],
        { flowId: "flow", touchId: "touch", effect: "change", place },
        { touches: [{ id: "touch", effect: "change", place }] },
      ),
    ).toEqual(rule);
  }
});

test("TC-SR1-10 near misses never match a rule", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "folder", value: "cloud:Builds" };
  const rule = ruleOf("flow", "touch", { place });
  const call = { flowId: "flow", touchId: "touch", effect: "change", place };
  const version = { touches: [{ id: "touch", effect: "change", place }] };
  for (const value of ["cloud:Other", "cloud:Builds/old", "cloud:builds", "cloud:Builds/", "cloud:Builds "])
    expect(matchRule([rule], { ...call, place: { ...place, value } }, version)).toBeUndefined();
  for (const wrong of [
    { ...call, flowId: "other" },
    { ...call, touchId: "other" },
    { ...call, effect: "local_write" },
    { ...call, place: { ...place, kind: "account" } },
  ])
    expect(matchRule([rule], wrong, version)).toBeUndefined();
  expect(matchRule([{ ...rule, state: "revoked" }], call, version)).toBeUndefined();
  expect(matchRule([rule], call, { touches: [] })).toBeUndefined();
});

test("TC-j20-31 always allow creates a rule and approves the decision", async () => {
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

test("TC-RUL-12 and TC-SR1-29 a rule use is recorded without its place value", async () => {
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

test("TC-j20-32 the next matching call records a rule use and a different place holds", async () => {
  const { matchRule, recordRuleUse } = await import("./standing.ts");
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const store = await openSqliteStore(":memory:");
  try {
    const row = pendingDecision(store, { id: "next-run", createdAt: "2026-11-21T00:00:00Z" });
    const run = store.getRun(row.runId);
    if (!run) throw new Error("Missing run");
    const place = { kind: "account", value: "timesheet-account" };
    const rule = store.makeRule({ flowId: run.flowId, touchId: "log-hours", effect: "change", place });
    const call = { flowId: run.flowId, touchId: rule.touchId, effect: rule.effect, place };
    const version = { touches: [{ id: rule.touchId, effect: rule.effect, place }] };
    expect(matchRule(store.listRules(), call, version)).toMatchObject({ id: rule.id });
    recordRuleUse(store, {
      ruleId: rule.id,
      runId: run.id,
      stepId: row.stepId,
      itemKey: "",
      tool: "timesheet.log_entry",
      title: "Submit this timesheet entry.",
      at: "2026-11-22T00:00:00Z",
    });
    expect(store.getRun(run.id)?.decisionLines).toContainEqual({
      key: "report.doneByRule",
      params: { title: "Submit this timesheet entry." },
    });
    expect(
      matchRule(store.listRules(), { ...call, place: { ...place, value: "other-account" } }, version),
    ).toBeUndefined();
    store.revokeRule(rule.id, "ask_me_again");
    expect(matchRule(store.listRules(), call, version)).toBeUndefined();
  } finally {
    store.close();
  }
});

test("TC-j24-46 a rule created for the new version cannot apply to the waiting run", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "account", value: "timesheet-account" };
  const rule = ruleOf("flow", "log-hours", {
    place,
    confirmationHash: "H2",
    createdAt: "2026-11-22T00:00:00Z",
  });
  const call = { flowId: "flow", touchId: "log-hours", effect: "change", place };
  const version = {
    touches: [{ id: "log-hours", effect: "change", place }],
    startedAt: "2026-11-21T00:00:00Z",
  };
  expect(matchRule([rule], call, version)).toBeUndefined();
  expect(matchRule([rule], call, { ...version, hash: "H1", startedAt: rule.createdAt })).toBeUndefined();
  expect(matchRule([rule], call, { ...version, startedAt: "2026-11-23T00:00:00Z" })).toEqual(rule);
});

test("TC-SR1-30 a near miss is held and does not record a rule use", async () => {
  const { matchRule } = await import("./standing.ts");
  const place = { kind: "folder", value: "cloud:Builds" };
  const rule = ruleOf("flow", "upload-apk", { place });
  const call = {
    flowId: "flow",
    touchId: rule.touchId,
    effect: rule.effect,
    place: { ...place, value: "cloud:Other" },
  };
  expect(
    matchRule([rule], call, { touches: [{ id: rule.touchId, effect: rule.effect, place }] }),
  ).toBeUndefined();
  expect(rule.uses).toBe(0);
});

test("TC-SR1-29 the fake hook records the exact rule and runs the call", { timeout: 20000 }, async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Requirement } = await import("@flowdriven/sdk");
  const { CONNECTORS } = await import("../connectors/catalog.ts");
  const { routeRequirement } = await import("../router/route.ts");
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { demoFlow } = await import("../demo/demo-flow.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { createClaudeAdapter } = await import("../claude/adapter.ts");
  const { recordRuleUse } = await import("./standing.ts");
  const entry = CONNECTORS[0];
  if (!entry) throw new Error("Missing connector");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flow-rule-test-")));
  const fact = {
    name: entry.name,
    url: entry.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: [{ name: "label_thread", readOnly: false }],
  };
  const home = makeFakeHome({
    connectors: { [entry.name]: { url: fact.url, id: fact.id, tools: fact.tools } },
    plays: [
      {
        when: "Rule test",
        actions: [
          {
            do: "tool",
            id: "call-1",
            name: `${entry.prefix}label_thread`,
            input: { threadId: "one", add: ["Work"] },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const store = await openSqliteStore(":memory:");
  try {
    const { manifest, files } = demoFlow();
    const at = "2026-11-21T00:00:00Z";
    const hash = `sha256:${"a".repeat(64)}`;
    store.putFlow({ id: manifest.id, hash, version: manifest.version, manifest, files, registeredAt: at });
    store.createRun({
      id: "run-hook",
      flowId: manifest.id,
      flowHash: hash,
      flowVersion: manifest.version,
      state: "running",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: at,
    });
    store.upsertStep({
      runId: "run-hook",
      stepId: "alerts",
      itemKey: "",
      state: "running",
      attempts: [],
      outputs: {},
      checks: [],
    });
    const row = { runId: "run-hook", stepId: "alerts" };
    const run = store.getRun(row.runId);
    if (!run) throw new Error("Missing run");
    const place = { kind: "account" as const, value: "gmail", label: "Gmail" };
    const rule = store.makeRule({
      flowId: run.flowId,
      touchId: "label",
      effect: "change",
      place,
      createdAt: "2026-11-20T00:00:00Z",
    });
    const requirement = Requirement.parse({
      id: "gmail",
      type: "mcp_server",
      ref: "connector:gmail",
      tools: ["label_thread"],
    });
    const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [fact] });
    if (!route?.routed) throw new Error("Missing connector route");
    const project = join(root, "project");
    mkdirSync(project);
    const adapter = createClaudeAdapter({
      claudePath: () => FAKE_CLAUDE_PATH,
      env: () => ({ HOME: home, PATH: process.env.PATH, TMPDIR: tmpdir() }),
      controlRoot: join(root, "control"),
      audit: () => {},
      newId: () => "cc-rule",
      newSessionId: () => "session-rule",
      rounds: 20,
      exitWaitMs: 10000,
      nowMs: () => Date.parse("2026-11-22T00:00:00Z"),
      connectors: () => [fact],
      confirmation: () => ({
        confirmation: {
          flowId: run.flowId,
          hash: run.flowHash,
          onItsOwn: [],
          touches: [
            {
              id: "label",
              sentence: "Label",
              effect: "change",
              rule: "asks_first",
              covers: ["gmail.label_thread"],
              place,
            },
          ],
        },
        rules: [rule],
        source: "chat",
        startedAt: run.startedAt,
      }),
      recordRule: (input) => recordRuleUse(store, input),
    });
    const result = await adapter.runStep({
      runId: run.id,
      stepId: row.stepId,
      itemKey: "",
      attempt: 1,
      replan: false,
      kind: "worker",
      title: "Log 8 hours to Project Example",
      instructions: "Rule test",
      uses: ["gmail"],
      project,
      requirements: [requirement],
      routes: [route],
      outputs: [],
      maxDurationMs: 10000,
      signal: new AbortController().signal,
    });
    expect(result.exit).toBe("ok");
    expect(store.listApprovals({ runId: run.id })).toEqual([]);
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ id: "call-1", hookExit: 0, ran: true }),
    );
    expect(store.listRules()[0]).toMatchObject({ uses: 1, lastUsedAt: "2026-11-22T00:00:00.000Z" });
    expect(store.getStep(run.id, row.stepId)?.ruleUses).toMatchObject([
      { ruleId: rule.id, tool: `${entry.prefix}label_thread` },
    ]);
    expect(store.getRun(run.id)?.decisionLines).toContainEqual({
      key: "report.doneByRule",
      params: { title: "Log 8 hours to Project Example" },
    });
    expect(store.listAudit(run.id)).toContainEqual(
      expect.objectContaining({
        kind: "rule_used",
        detail: expect.objectContaining({ ruleId: rule.id, placeKind: "account" }),
      }),
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-j20-31 the chat line is posted and the approved run finishes", async () => {
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

test("TC-SR1-30 the cloud upload near miss is held by the decision function", async () => {
  const { decide } = await import("../claude/decide.ts");
  const { callOf } = await import("../test-helpers/policy-fixture.ts");
  const place = { kind: "folder" as const, value: "cloud:Builds", label: "Builds" };
  const rule = ruleOf("example.build-apk", "upload-apk", { place });
  const policy = {
    tools: ["cloud-storage.upload"],
    folders: [],
    cwd: "",
    addDirs: [],
    schema: false,
    sessionId: "session",
    flowId: rule.flowId,
    touches: [
      {
        touchId: rule.touchId,
        effect: "change" as const,
        matcher: "exact" as const,
        place,
        fixedPlace: true,
        list: "on_its_own" as const,
        covers: ["cloud-storage.upload"],
      },
    ],
    effectCatalog: [
      {
        tool: "cloud-storage.upload",
        effect: "change" as const,
        place: { kind: "folder" as const, fromInput: "folder" },
      },
    ],
    rules: [rule],
  };
  expect(
    decide(policy, callOf("cloud-storage.upload", { folder: "cloud:Builds", name: "app.apk" })),
  ).toMatchObject({ outcome: "run", by: "rule" });
  expect(
    decide(policy, callOf("cloud-storage.upload", { folder: "cloud:Other", name: "app.apk" })),
  ).toMatchObject({
    outcome: "hold",
    held: { fixedPlace: false, place: { kind: "folder", value: "cloud:Other" } },
  });
  const hidden = `cloud:Bu${String.fromCodePoint(0x200b)}ilds`;
  expect(decide(policy, callOf("cloud-storage.upload", { folder: hidden, name: "app.apk" }))).toMatchObject({
    outcome: "hold",
    held: { fixedPlace: false, place: { value: expect.stringContaining("U+200B") } },
  });
  expect(rule.uses).toBe(0);
});

test("TC-SR1-09 a damaged rule cannot use a place kind forbidden for its effect", async () => {
  const { matchRule } = await import("./standing.ts");
  for (const [effect, kind] of [
    ["change", "site"],
    ["local_write", "account"],
    ["run_command", "folder"],
  ] as const) {
    const place = { kind, value: "test" };
    const rule = ruleOf("flow", "touch", { effect, place });
    expect(
      matchRule(
        [rule],
        { flowId: "flow", touchId: "touch", effect, place },
        { touches: [{ id: "touch", effect, place }] },
      ),
    ).toBeUndefined();
  }
});

test("TC-SR1-30 the fake cloud call to another folder is held in the run", { timeout: 20000 }, async () => {
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
        when: "Upload test",
        actions: [
          {
            do: "tool",
            id: "upload-1",
            name: `${connector.prefix}upload`,
            input: { folder: "cloud:Other", name: "app.apk" },
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
      confirmation: () => ({
        confirmation: { flowId: manifest.id, hash, onItsOwn: [], touches: [touch] },
        rules: store.listRules(),
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
    const run = await engine.startRun(manifest.id, { project });
    expect(run.blockedReason).toBeUndefined();
    expect(run.state).toBe("waiting_approval");
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ id: "upload-1", hookExit: 2, ran: false }),
    );
    expect(store.listApprovals({ runId: run.id, state: "pending" })).toContainEqual(
      expect.objectContaining({ fixedPlace: false, state: "pending" }),
    );
    expect(store.listRules().find((item) => item.id === rule.id)?.uses).toBe(0);
    expect(store.listAudit(run.id).some((item) => item.kind === "call_held")).toBe(true);
    expect(store.listAudit(run.id).some((item) => item.kind === "rule_used")).toBe(false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-j20-33 non-change work cannot be always allowed", async () => {
  const { openSqliteStore } = await import("../sqlite-store.ts");
  const { createRunnerService } = await import("../service/service.ts");
  const { pendingDecision } = await import("../test-helpers/builders.ts");
  const store = await openSqliteStore(":memory:");
  const service = createRunnerService({ store, dataDir: ".", mode: "demo" });
  try {
    for (const effect of ["read", "local_write", "run_command"] as const) {
      const row = pendingDecision(store, { id: `non-change-${effect}`, createdAt: "2026-11-21T00:00:00Z" });
      store.updateApproval(row.id, { effect });
      await expect(
        service.call("approvals.resolve", { approvalId: row.id, decision: "always_allow" }),
      ).rejects.toMatchObject({ code: "not_allowed", reason: "place_not_fixed" });
      expect(store.getApproval(row.id)?.state).toBe("pending");
    }
  } finally {
    service.stop();
    store.close();
  }
});
