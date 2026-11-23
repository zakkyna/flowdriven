import { FlowManifest, type Touch } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import { flowWithRules } from "../test-helpers/builders.ts";
import { createRunnerService } from "./service.ts";

const at = "2026-11-23T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const touch = (id: string, effect: Touch["effect"], place?: Touch["place"]): Touch => ({
  id,
  sentence: id,
  effect,
  rule: "asks_first",
  covers: [],
  ...(place ? { place } : {}),
});
const account = { kind: "account" as const, value: "timesheet-account", label: "Timesheet" };
const folder = { kind: "folder" as const, value: "/Notes", label: "Notes" };
const command = { kind: "command" as const, value: "git status", label: "Git" };

async function setup(touches: Touch[], extra: Record<string, unknown> = {}) {
  const store = await openSqliteStore(":memory:");
  const { manifest } = flowWithRules(store, touches, extra);
  const service = createRunnerService({ store, dataDir: ".", mode: "demo", now: () => new Date(at) });
  return { store, service, manifest, input: { flowId: manifest.id, hash, onItsOwn: [] as string[] } };
}

test("TC-RUL-15 confirm creates rules for non-read touches", async () => {
  const x = await setup([
    touch("read", "read"),
    touch("write", "local_write", folder),
    touch("log", "change", account),
    touch("mail", "send", account),
  ]);
  try {
    const result = await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["read", "write", "log"] });
    expect(result).toMatchObject({
      flow: { summary: { state: "confirmed" } },
      rules: { created: [expect.any(String), expect.any(String)], kept: [], ended: [] },
    });
    expect(x.store.getConfirmation(x.input.flowId)).toMatchObject({
      by: "confirm_dialog",
      onItsOwn: ["read", "write", "log"],
    });
    expect(x.store.listRules().map((r) => r.touchId)).toEqual(["write", "log"]);
    expect(x.store.listAudit().map((a) => a.kind)).toEqual(
      expect.arrayContaining(["flow_confirmed", "rule_created", "rule_created"]),
    );
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-SR6-12 secret reference refuses without writes", async () => {
  const x = await setup([], { inputs: [{ id: "login", type: "secret_ref", label: "Login" }] });
  try {
    await expect(x.service.call("flows.confirm", x.input)).rejects.toMatchObject({
      code: "not_allowed",
      reason: "needs_keychain",
    });
    expect(x.store.getConfirmation(x.input.flowId)).toBeUndefined();
    expect(x.store.listRules()).toEqual([]);
    expect(x.store.listAudit()).toEqual([]);
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-RUL-16 confirmation refusals write nothing", async () => {
  const forbidden = { ...touch("never", "delete", account), rule: "not_allowed" as const };
  const x = await setup(
    [touch("log", "change", account), touch("unfixed", "change"), touch("reply", "send"), forbidden],
    { requirements: [{ id: "notes", type: "path", access: "read_write" }] },
  );
  try {
    for (const [input, code, reason] of [
      [{ ...x.input, hash: `sha256:${"b".repeat(64)}` }, "conflict", "hash_mismatch"],
      [{ ...x.input, onItsOwn: ["unknown"] }, "invalid_input", "touch_unknown"],
      [{ ...x.input, onItsOwn: ["unfixed"] }, "not_allowed", "place_not_fixed"],
      [{ ...x.input, onItsOwn: ["reply"] }, "not_allowed", "always_asks"],
      [{ ...x.input, onItsOwn: ["never"] }, "not_allowed", "never_does"],
      [x.input, "invalid_input", "pins_missing"],
      [{ ...x.input, pins: { notes: "relative/path" } }, "invalid_input", "pin_invalid"],
    ] as const) {
      await expect(x.service.call("flows.confirm", input)).rejects.toMatchObject({ code, reason });
      expect(x.store.getConfirmation(x.input.flowId)).toBeUndefined();
      expect(x.store.listRules()).toEqual([]);
      expect(x.store.listAudit()).toEqual([]);
    }
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-j24-49 risky kinds are refused and fixed safe kinds create rules", async () => {
  const risky = ["send", "post", "pay", "delete", "merge"] as const;
  const x = await setup([
    touch("read", "read"),
    touch("write", "local_write", folder),
    touch("command", "run_command", command),
    touch("log", "change", account),
    touch("unfixed", "change"),
    ...risky.map((effect) => touch(effect, effect, account)),
  ]);
  try {
    for (const id of risky)
      await expect(x.service.call("flows.confirm", { ...x.input, onItsOwn: [id] })).rejects.toMatchObject({
        code: "not_allowed",
        reason: "always_asks",
      });
    await expect(
      x.service.call("flows.confirm", { ...x.input, onItsOwn: ["unfixed"] }),
    ).rejects.toMatchObject({ code: "not_allowed", reason: "place_not_fixed" });
    expect(x.store.getConfirmation(x.input.flowId)).toBeUndefined();
    expect(x.store.listRules()).toEqual([]);
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["write", "command", "log"] });
    expect(x.store.listRules().map((r) => r.place.kind)).toEqual(["folder", "command", "account"]);
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-RUL-18 re-confirm keeps and revokes rules", async () => {
  const x = await setup([touch("log", "change", account)]);
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
    const rule = x.store.listRules()[0];
    if (!rule) throw new Error("Missing rule");
    const kept = await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
    expect(kept).toMatchObject({ rules: { kept: [rule.id], created: [], ended: [] } });
    const ended = await x.service.call("flows.confirm", x.input);
    expect(ended).toMatchObject({ rules: { kept: [], created: [], ended: [rule.id] } });
    expect(x.store.listRules()[0]).toMatchObject({ state: "revoked", revokedBy: "moved_to_asks_first" });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-j24-18 changed places end only the affected rule", async () => {
  const x = await setup([
    touch("log", "change", account),
    touch("report", "change", folder),
    touch("note", "local_write", folder),
  ]);
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log", "report", "note"] });
    const rules = x.store.listRules();
    if (!rules[0] || !rules[1] || !rules[2]) throw new Error("Missing rules");
    const nextHash = `sha256:${"b".repeat(64)}`;
    const manifest = FlowManifest.parse({
      ...x.manifest,
      touches: [
        touch("log", "change", { ...account, value: "other" }),
        touch("report", "change", folder),
        touch("note", "local_write", folder),
      ],
    });
    x.store.putFlow({
      id: manifest.id,
      hash: nextHash,
      version: manifest.version,
      manifest,
      files: {},
      registeredAt: at,
    });
    const head = x.store.getFlowHead(manifest.id);
    if (!head) throw new Error("Missing head");
    x.store.putFlowHead({ ...head, headHash: nextHash });
    const result = await x.service.call("flows.confirm", {
      flowId: manifest.id,
      hash: nextHash,
      onItsOwn: ["report", "note"],
    });
    expect(result).toMatchObject({
      rules: { kept: [rules[1].id, rules[2].id], ended: [rules[0].id], created: [] },
    });
    expect(x.store.listRules()[0]).toMatchObject({ state: "revoked", revokedBy: "flow_changed" });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-RUL-18 changed and removed touches revoke their rules and audit both lists", async () => {
  for (const replacement of [touch("log", "change", { ...account, value: "other" }), undefined]) {
    const x = await setup([touch("log", "change", account)]);
    try {
      await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
      const rule = x.store.listRules()[0];
      if (!rule) throw new Error("Missing rule");
      const nextHash = `sha256:${"b".repeat(64)}`;
      const manifest = FlowManifest.parse({ ...x.manifest, touches: replacement ? [replacement] : [] });
      x.store.putFlow({
        id: manifest.id,
        hash: nextHash,
        version: manifest.version,
        manifest,
        files: {},
        registeredAt: at,
      });
      const head = x.store.getFlowHead(manifest.id);
      if (!head) throw new Error("Missing head");
      x.store.putFlowHead({ ...head, headHash: nextHash });
      const result = await x.service.call("flows.confirm", {
        flowId: manifest.id,
        hash: nextHash,
        onItsOwn: [],
      });
      expect(result).toMatchObject({ rules: { kept: [], ended: [rule.id], created: [] } });
      expect(x.store.listRules()[0]).toMatchObject({ state: "revoked", revokedBy: "flow_changed" });
      expect(x.store.listAudit()).toContainEqual(
        expect.objectContaining({
          kind: "flow_changed",
          detail: expect.objectContaining({
            flowId: manifest.id,
            oldHash: hash,
            newHash: nextHash,
            kept: [],
            ended: [rule.id],
          }),
        }),
      );
    } finally {
      x.service.stop();
      x.store.close();
    }
  }
});

test("TC-RUL-18 changed flow detail describes changed touches, not standing rules", async () => {
  const { toFlowDetail } = await import("./map-flow.ts");
  const x = await setup([touch("log", "change", account)]);
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
    const nextHash = `sha256:${"b".repeat(64)}`;
    const manifest = FlowManifest.parse({
      ...x.manifest,
      touches: [touch("log", "change", { ...account, value: "other" })],
    });
    x.store.putFlow({
      id: manifest.id,
      hash: nextHash,
      version: manifest.version,
      manifest,
      files: {},
      registeredAt: at,
    });
    const head = x.store.getFlowHead(manifest.id);
    if (!head) throw new Error("Missing head");
    x.store.putFlowHead({ ...head, headHash: nextHash });
    const row = x.store.getFlow(manifest.id, nextHash);
    if (!row) throw new Error("Missing version");
    expect(toFlowDetail(row, x.store).changes).toEqual([{ sign: "~", text: "log" }]);
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-RUL-15 confirm closes a waiting confirmation and saves folder pins", async () => {
  const x = await setup([touch("write", "local_write", folder)], {
    requirements: [{ id: "notes", type: "path", access: "read_write" }],
  });
  try {
    x.store.putChat({
      id: "chat-test",
      title: "Test",
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
    x.store.putQuestion({
      id: "question-test",
      flowId: x.manifest.id,
      chatId: "chat-test",
      messageId: "message-test",
      kind: "confirm",
      state: "open",
      createdAt: at,
      updatedAt: at,
      source: "schedule",
      proactive: true,
      flowHash: hash,
      given: {},
      missing: [],
      pendingStart: { startId: "start-test", source: "schedule", request: {} },
    });
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["write"], pins: { notes: "/Notes" } });
    expect(x.store.listQuestions()).toContainEqual(
      expect.objectContaining({ id: "question-test", state: "closed" }),
    );
    expect(x.store.getConfirmation(x.manifest.id)).toMatchObject({
      pins: { folders: { notes: { path: "/Notes", access: "read_write" } } },
    });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-j24-18 confirmed rules reach a fake Claude run", { timeout: 20000 }, async () => {
  const { rmSync } = await import("node:fs");
  const { CONNECTORS } = await import("../connectors/catalog.ts");
  const { routeRequirement } = await import("../router/route.ts");
  const { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } = await import(
    "../test-helpers/fake-claude-script.ts"
  );
  const { CLAUDE_ID, createHarnessService } = await import("./claude-harness.ts");
  const gmail = CONNECTORS[0];
  if (!gmail) throw new Error("Missing Gmail connector");
  const connectorTools = [{ name: "label_thread", readOnly: false }];
  const connector = {
    name: gmail.name,
    url: gmail.url,
    id: `mcpsrv_${"a".repeat(24)}`,
    status: "connected" as const,
    tools: connectorTools,
  };
  const home = makeFakeHome({
    connectors: { [gmail.name]: { url: gmail.url, id: connector.id, tools: connectorTools } },
    plays: [
      {
        when: "Label test",
        actions: [
          {
            do: "tool",
            id: "label",
            name: `${gmail.prefix}label_thread`,
            input: { threadId: "one", add: ["Work"] },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const place = { kind: "account" as const, value: "gmail", label: "Gmail" };
  const x = await setup([{ ...touch("label", "change", place), covers: ["gmail.label_thread"] }], {
    requirements: [{ id: "gmail", type: "mcp_server", ref: "connector:gmail", tools: ["label_thread"] }],
  });
  let n = 0;
  const hs = createHarnessService({
    store: x.store,
    dataDir: home,
    projectDir: home,
    env: { HOME: home, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date(at),
    newId: (p) => `${p}-${++n}`,
    mcpTimeoutMs: 500,
    connectorSettleMs: 0,
    adapter: { rounds: 20 },
  });
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["label"] });
    await hs.start().settled;
    await hs.rescan();
    hs.setConsent(CLAUDE_ID, "given");
    const requirement = x.manifest.requirements[0];
    if (!requirement) throw new Error("Missing requirement");
    const route = routeRequirement(requirement, { hooks: true, chrome: false, connectors: [connector] });
    if (!route?.routed) throw new Error("Missing route");
    x.store.createRun({
      id: "run-rule",
      flowId: x.manifest.id,
      flowHash: hash,
      flowVersion: x.manifest.version,
      state: "running",
      project: home,
      inputs: {},
      params: {},
      requirements: [requirement],
      startedAt: "2026-11-23T00:00:01.000Z",
    });
    x.store.upsertStep({
      runId: "run-rule",
      stepId: "label",
      itemKey: "",
      state: "running",
      attempts: [],
      outputs: {},
      checks: [],
    });
    const result = await hs.adapter.runStep({
      runId: "run-rule",
      stepId: "label",
      itemKey: "",
      attempt: 1,
      replan: false,
      kind: "worker",
      title: "Label",
      instructions: "Label test",
      uses: ["gmail"],
      project: home,
      requirements: [requirement],
      routes: [route],
      outputs: [],
      maxDurationMs: 10000,
      signal: new AbortController().signal,
    });
    expect(result.exit, JSON.stringify({ result, calls: readFakeCalls(home) })).toBe("ok");
    expect(readFakeCalls(home)).toContainEqual(
      expect.objectContaining({ id: "label", hookExit: 0, ran: true }),
    );
    expect(x.store.listRules()[0]).toMatchObject({ uses: 1 });
  } finally {
    hs.stop();
    x.service.stop();
    x.store.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("TC-STO-36 flow reads use the version 2 model", async () => {
  const x = await setup([touch("log", "change", account), touch("reply", "send", account)]);
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
    expect(await x.service.call("flows.list", {})).toMatchObject([{ id: x.manifest.id, state: "confirmed" }]);
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "confirmed" },
      touches: [
        { id: "log", list: "on_its_own", byRule: expect.any(String) },
        { id: "reply", list: "asks_first" },
      ],
      confirmLists: { asksFirst: ["reply"] },
    });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-STO-36 lists live flows newest first and hides tombstones", async () => {
  const x = await setup(
    [touch("log", "change", account), { ...touch("reply", "send", account), rule: "runs_alone" }],
    {
      inputs: [
        { id: "duration", label: "Duration", type: "text", required: true },
        { id: "work", label: "What you did", type: "text", required: true },
      ],
    },
  );
  try {
    await x.service.call("flows.confirm", { ...x.input, onItsOwn: ["log"] });
    x.store.createRun({
      id: "run",
      flowId: x.manifest.id,
      flowHash: hash,
      flowVersion: x.manifest.version,
      state: "waiting_approval",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: at,
    });
    x.store.createApproval({
      id: "approval",
      kind: "result_sign_off",
      runId: "run",
      stepId: "step",
      itemKey: "",
      summary: "Review",
      payload: "Review",
      approves: [],
      onExpiry: "end",
      createdAt: at,
      expiresAt: at,
      state: "pending",
    });
    const second = flowWithRules(x.store, [], { id: "local.second", name: "Second" });
    const deleted = flowWithRules(x.store, [], { id: "local.deleted", name: "Deleted" });
    const secondHead = x.store.getFlowHead(second.manifest.id);
    const deletedHead = x.store.getFlowHead(deleted.manifest.id);
    if (!secondHead || !deletedHead) throw new Error("Missing head");
    x.store.putFlowHead({ ...secondHead, createdAt: "2026-11-24T00:00:00.000Z" });
    x.store.putFlowHead({ ...deletedHead, deletedAt: at });
    const list = await x.service.call("flows.list", {});
    expect(list).toMatchObject([
      { id: second.manifest.id, state: "new" },
      { id: x.manifest.id, live: "needs_you", asksFor: ["Duration", "What you did"] },
    ]);
    const detail = await x.service.call("flows.get", { flowId: x.manifest.id });
    expect(detail).toMatchObject({
      confirmLists: { asksFirst: ["reply"] },
      touches: [
        { id: "log", byRule: expect.any(String) },
        { id: "reply", list: "asks_first" },
      ],
    });
    expect(detail).not.toHaveProperty("signOff");
    await expect(x.service.call("flows.get", { flowId: deleted.manifest.id })).rejects.toMatchObject({
      code: "not_found",
      reason: "flow_deleted",
    });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-SR3-01 TC-SR3-02 flow state follows the head hash and changed place", async () => {
  const x = await setup([touch("log", "change", account)]);
  try {
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "new" },
    });
    await x.service.call("flows.confirm", x.input);
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "confirmed" },
    });
    const nextHash = `sha256:${"b".repeat(64)}`;
    const manifest = FlowManifest.parse({ ...x.manifest, touches: [touch("log", "change", folder)] });
    x.store.putFlow({
      id: manifest.id,
      hash: nextHash,
      version: manifest.version,
      manifest,
      files: {},
      registeredAt: at,
    });
    const head = x.store.getFlowHead(manifest.id);
    if (!head) throw new Error("Missing head");
    x.store.putFlowHead({ ...head, headHash: nextHash });
    expect(await x.service.call("flows.get", { flowId: manifest.id })).toMatchObject({
      summary: { state: "changed" },
      changes: [{ sign: "~", text: "log" }],
    });
    await x.service.call("flows.confirm", { ...x.input, hash: nextHash });
    expect(await x.service.call("flows.get", { flowId: manifest.id })).toMatchObject({
      summary: { state: "confirmed" },
    });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-SR3-12 legacy confirmations produce the migrated flow states", async () => {
  const x = await setup([]);
  try {
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "new" },
    });
    const confirmation = {
      flowId: x.manifest.id,
      hash,
      at,
      by: "migration" as const,
      onItsOwn: [],
      legacy: true as const,
      pins: { skills: {}, folders: {} },
    };
    x.store.putConfirmation(confirmation);
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "confirmed" },
    });
    x.store.putConfirmation({ ...confirmation, hash: `sha256:${"b".repeat(64)}` });
    expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
      summary: { state: "changed" },
    });
  } finally {
    x.service.stop();
    x.store.close();
  }
});

test("TC-j12-36 settings leave confirmed flow state and hash unchanged", async () => {
  const { exampleAgentProfile } = await import("../test-helpers/agent-profiles.ts");
  const x = await setup([]);
  try {
    await x.service.call("flows.confirm", x.input);
    for (const patch of [
      { mainAgent: { agent: "codex", model: exampleAgentProfile.models[0] } },
      { mainAgent: { agent: "codex", model: exampleAgentProfile.models[1] } },
      { spendingLimit: 50 },
      { busyFallback: true },
    ]) {
      await x.service.call("settings.update", { patch });
      expect(await x.service.call("flows.get", { flowId: x.manifest.id })).toMatchObject({
        hash,
        summary: { state: "confirmed" },
      });
      expect(await x.service.call("flows.list", {})).toMatchObject([{ state: "confirmed" }]);
    }
  } finally {
    x.service.stop();
    x.store.close();
  }
});

async function importFixture(schedule = "17:00") {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { flowV12Yaml } = await import("../../../sdk/src/test-data/flow-v12.ts");
  mkdirSync(".workflow/scratch", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".workflow/scratch/b05-import-"));
  writeFileSync(join(dir, "flow.yaml"), flowV12Yaml({ schedule: { type: "daily", time: schedule } }));
  writeFileSync(join(dir, "README.md"), "Read me\n");
  return dir;
}

for (const [id, time] of [
  ["TC-j28-46", "09:00"],
  ["TC-SR2-20", "17:00"],
]) {
  test(`${id} importing a schedule suggestion does not enable it`, async () => {
    const { rmSync } = await import("node:fs");
    const path = await importFixture(time);
    const x = await setup([]);
    try {
      const result = await x.service.call("flows.import", { path });
      expect(result).toMatchObject({ flow: { state: "new", schedule: { type: "manual" } } });
      const list = await x.service.call("flows.list", {});
      expect(list).toContainEqual(
        expect.objectContaining({ state: "new", schedule: expect.objectContaining({ type: "manual" }) }),
      );
      const imported = result as { flow: { id: string } };
      expect(x.store.getSchedule(imported.flow.id)).toBeUndefined();
      expect(x.store.getConfirmation(imported.flow.id)).toBeUndefined();
      expect(x.store.listRules().filter((r) => r.flowId === imported.flow.id)).toEqual([]);
      expect(x.store.listApprovals()).toEqual([]);
      expect(x.store.listTriggers(imported.flow.id)).toEqual([]);
    } finally {
      x.service.stop();
      x.store.close();
      rmSync(path, { recursive: true, force: true });
    }
  });
}

test("TC-STO-37 import returns a summary and duplicate is unknown", async () => {
  const { rmSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { flowV12Yaml } = await import("../../../sdk/src/test-data/flow-v12.ts");
  const path = await importFixture();
  const x = await setup([]);
  try {
    const first = (await x.service.call("flows.import", { path })) as { flow: { id: string }; hash: string };
    expect(first).toMatchObject({
      flow: { state: "new" },
      hash: expect.any(String),
      issues: [],
    });
    x.store.putConfirmation({
      flowId: first.flow.id,
      hash: first.hash,
      at,
      by: "confirm_dialog",
      onItsOwn: [],
      pins: { skills: {}, folders: {} },
    });
    x.store.putSchedule({
      flowId: first.flow.id,
      type: "daily",
      time: "17:00",
      whenItsTime: "ask",
      setAt: at,
      setBy: "window",
      confirmedHash: first.hash,
    });
    writeFileSync(join(path, "flow.yaml"), flowV12Yaml({ summary: "Changed summary" }));
    expect(await x.service.call("flows.import", { path })).toMatchObject({
      flow: { state: "changed", schedule: { type: "daily", time: "17:00" } },
    });
    expect(x.store.getSchedule(first.flow.id)).toMatchObject({ type: "daily", time: "17:00" });
    expect(x.store.listAudit()).toContainEqual(expect.objectContaining({ kind: "flow_imported" }));
    expect(x.service.knows("flows.duplicate")).toBe(false);
    await expect(x.service.call("flows.duplicate", { flowId: x.manifest.id })).rejects.toMatchObject({
      code: "not_found",
    });
  } finally {
    x.service.stop();
    x.store.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test("TC-SR1-47 risky planted rules never appear as allowed", async () => {
  const { mkdirSync, mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const { FlowDetail } = await import("@flowdriven/contracts");
  const { matchRule } = await import("../rules/standing.ts");
  const { canAlwaysAllow } = await import("../rules/always-allow.ts");
  const { decide } = await import("../claude/decide.ts");
  mkdirSync(".workflow/scratch", { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".workflow/scratch/b05-rules-"));
  const path = join(dir, "data.sqlite");
  const store = await openSqliteStore(path);
  const service = createRunnerService({ store, dataDir: dir, mode: "demo", now: () => new Date(at) });
  const effects = ["send", "post", "pay", "delete", "merge"] as const;
  const { manifest } = flowWithRules(
    store,
    effects.map((effect) => touch(effect, effect, account)),
  );
  const db = new DatabaseSync(path);
  try {
    for (const effect of effects) {
      const row = {
        id: `rule-${effect}`,
        flowId: manifest.id,
        touchId: effect,
        effect,
        place: account,
        sentence: effect,
        state: "active" as const,
        createdAt: at,
        createdBy: "always_allow" as const,
        uses: 0,
      };
      db.prepare("INSERT INTO standing_rules VALUES (?, ?, ?, ?)").run(
        row.id,
        row.flowId,
        row.state,
        JSON.stringify(row),
      );
      expect(
        matchRule(
          [row],
          { flowId: manifest.id, touchId: effect, effect, place: account },
          { touches: [{ id: effect, effect, place: account }] },
        ),
      ).toBeUndefined();
      const tool = "example.action";
      const policy = {
        tools: [tool],
        folders: [],
        cwd: ".",
        addDirs: [],
        schema: false,
        sessionId: "session",
        flowId: manifest.id,
        effectCatalog: [{ tool, effect, place: { kind: "account" as const, value: account.value } }],
        touches: [
          {
            touchId: effect,
            effect,
            matcher: "exact" as const,
            place: account,
            fixedPlace: true,
            list: "on_its_own" as const,
            covers: [tool],
          },
        ],
        rules: [row],
      };
      expect(
        decide(policy, {
          hook_event_name: "PreToolUse",
          session_id: "session",
          tool_name: tool,
          tool_use_id: "call",
          tool_input: {},
        }),
      ).toMatchObject({ outcome: "hold", held: { action: effect } });
      expect(canAlwaysAllow({ effect, place: "fixed", caller: "window" })).toBe(false);
    }
    const detail = FlowDetail.parse(await service.call("flows.get", { flowId: manifest.id }));
    for (const view of detail.touches) {
      expect(view.list).toBe("asks_first");
      expect(view).not.toHaveProperty("byRule");
    }
    expect(store.listRules().every((r) => r.uses === 0)).toBe(true);
  } finally {
    db.close();
    service.stop();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
