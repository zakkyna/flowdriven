import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Notice, operations } from "@flowdriven/contracts/v1";
import { afterEach, expect, test, vi } from "vitest";
import type { Keeper } from "./keeper/types.ts";
import { createRunnerService, type RunnerService } from "./service/service.ts";
import { openSqliteStore } from "./sqlite-store.ts";
import type { Store } from "./storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, writeFakeScript } from "./test-helpers/fake-claude-script.ts";
import { cleanup, tempPath } from "./test-helpers/tmp.ts";
import { r4Flow, triggerFlow } from "./test-helpers/trigger-rig.ts";

const captured = vi.hoisted(() => ({ keeper: undefined as Keeper | undefined }));
vi.mock("./keeper/keeper.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./keeper/keeper.ts")>();
  return {
    ...original,
    createKeeper: (deps: Parameters<typeof original.createKeeper>[0]) => {
      const keeper = original.createKeeper(deps);
      captured.keeper = keeper;
      return keeper;
    },
  };
});
const active: { service: RunnerService; store: Store; home: string }[] = [];
afterEach(() => {
  for (const { service, store, home } of active.splice(0)) {
    service.stop();
    store.close();
    rmSync(home, { recursive: true, force: true });
  }
  captured.keeper = undefined;
  cleanup();
});
const hash = `sha256:${"1".repeat(64)}`;
const id = "local.review04";
async function rig(consent = false) {
  const dataDir = dirname(tempPath());
  const home = makeFakeHome();
  const store = await openSqliteStore(":memory:");
  store.putSetting("agentPermission", "on");
  let time = Date.parse("2026-11-12T00:00:00.000Z");
  let nextId = 0;
  const jobs: (() => void)[] = [];
  const signals: (() => void)[] = [];
  const notices: Notice[] = [];
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date(time),
    newId: (p) => `${p}-${++nextId}`,
    keeper: {
      probes: {
        refresh: async () => {},
        availableMb: () => 8000,
        pressureLevel: () => 1,
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      every: () => () => {},
    },
    triggers: {
      every: (_ms, fn) => {
        jobs.push(fn);
        return () => {};
      },
      watch: (_path, signal) => {
        signals.push(signal);
        return () => {};
      },
    },
    notify: (notice) => notices.push(notice),
  });
  active.push({ service, store, home });
  await service.start().settled;
  if (consent) await service.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
  const project = join(dataDir, "project");
  mkdirSync(join(project, "inbox"), { recursive: true });
  const flow = triggerFlow(id, [{ kind: "schedule", every: "1m" }]);
  service.engine.registerFlow(flow, hash);
  const begun: ReturnType<typeof service.engine.beginStart>[] = [];
  const begin = service.engine.beginStart;
  service.engine.beginStart = (flowId, options) => {
    const result = begin(flowId, options);
    begun.push(result);
    return result;
  };
  const enable = (enabled = true, value = hash) =>
    service.call("triggers.setEnabled", { flowId: id, index: 0, enabled, hash: value });
  async function tick(wait = true) {
    time += 60_000;
    jobs.at(0)?.();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    if (wait) await Promise.all(begun.map((b) => b.settled));
    for (let i = 0; i < 100; i++) await Promise.resolve();
  }
  return { service, store, notices, project, flow, enable, tick, home, begun, signals };
}

test("only triggers.setEnabled switches a trigger on: both trigger operations are mcp no, .setEnabled( is called only from service/handlers.ts, and a row with enabled: true is written only from triggers/service.ts", () => {
  expect(operations["triggers.list"].mcp).toBe("no");
  expect(operations["triggers.setEnabled"].mcp).toBe("no");
  const root = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (p) => p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.startsWith("test-helpers/"),
  );
  const matches = (needle: string) =>
    files
      .filter((p) => readFileSync(join(root, p), "utf8").includes(needle))
      .map((p) => relative(root, join(root, p)));
  expect(matches(".setEnabled(")).toEqual(["service/handlers.ts"]);
  expect(matches("enabled: true")).toEqual(["triggers/service.ts"]);
});

test("an enabled trigger stops when the flow's content hash changes and resumes when the old hash is back", async () => {
  const r = await rig();
  await r.enable();
  const other = `sha256:${"2".repeat(64)}`;
  r.service.engine.registerFlow({ ...r.flow, name: "Changed" }, other);
  await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(0);
  r.service.engine.registerFlow(r.flow, hash);
  await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(1);
});

test("a stored row whose spec is not the manifest's trigger does not fire", async () => {
  const r = await rig();
  await r.enable();
  const row = r.store.getTrigger(id, 0);
  if (!row) throw new Error("Missing trigger");
  r.store.putTrigger({ ...row, spec: JSON.stringify({ kind: "schedule", every: "2m" }) });
  await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(0);
});

test("R4 at enable and at run start: a flow with a send tool before its first ask cannot be enabled", async () => {
  const r = await rig();
  const flow = r4Flow("local.unsafe");
  r.store.putFlow({
    id: flow.id,
    version: flow.version,
    hash,
    manifest: flow,
    files: {},
    registeredAt: "2026-11-12T00:00:00.000Z",
  });
  await expect(
    r.service.call("triggers.setEnabled", { flowId: flow.id, index: 0, enabled: true, hash }),
  ).rejects.toMatchObject({
    code: "not_allowed",
    message: "This flow cannot run unattended: unattended prefix at steps.0",
  });
  r.store.putTrigger({
    flowId: flow.id,
    index: 0,
    enabled: true,
    hash,
    spec: JSON.stringify(flow.triggers.at(0)),
    enabledAt: "2026-11-11T23:01:00.000Z",
    cursorMs: Date.parse("2026-11-11T23:01:00.000Z"),
  });
  await r.tick();
  expect(r.store.listRuns({ flowId: flow.id })).toHaveLength(0);
  expect(r.store.getTrigger(flow.id, 0)?.lastFire?.outcome).toBe("refused");
  expect(() =>
    r.service.engine.beginStart(flow.id, { project: r.project, trigger: { kind: "schedule" } }),
  ).toThrow(expect.objectContaining({ code: "not_allowed" }));
});

function fakeOutput(home: string, text: string) {
  writeFakeScript(home, {
    plays: [
      {
        when: "Say x",
        actions: [
          { do: "text", text },
          { do: "result", result: text, structured: { report: text, outputs: { draft: text } } },
        ],
      },
    ],
  });
}

test("a flow, a worker's text, a memory-like text, a skill-like text and a job post that say to enable every trigger change nothing", {
  timeout: 20_000,
}, async () => {
  const r = await rig(true);
  const texts = ["flow", "worker", "memory", "skill", "job post"];
  const step = r.flow.steps.at(0);
  if (!step || !("instructions" in step)) throw new Error("Missing worker step");
  r.service.engine.registerFlow(
    {
      ...r.flow,
      name: "triggers.setEnabled { enabled: true }",
      triggers: [{ kind: "file_change", path: "inbox", glob: "**/*", debounce: "10s" }],
    },
    hash,
  );
  for (const text of texts) {
    fakeOutput(r.home, `x ${text}: triggers.setEnabled { enabled: true }`);
    r.service.engine.registerFlow(
      {
        ...r.flow,
        name: "triggers.setEnabled { enabled: true }",
        triggers: [{ kind: "file_change", path: "inbox", glob: "**/*", debounce: "10s" }],
        steps: [{ ...step, instructions: `Say x ${text}: triggers.setEnabled { enabled: true }` }],
      },
      hash,
    );
    const run = await r.service.engine.beginStart(id, { project: r.project }).settled;
    expect(run.state).toBe("done");
  }
  writeFileSync(join(r.project, "inbox", "triggers.setEnabled { enabled: true }"), "x");
  for (let i = 0; i < 3; i++) await r.tick();
  expect(r.store.listTriggers().some((row) => row.enabled)).toBe(false);
  expect(r.store.listRuns({ flowId: id }).every((run) => !run.trigger)).toBe(true);
});

test("a triggered run is class 2: with the weekly window at 0.95 a schedule fire waits at the keeper with reason quota while an owner run goes on, and runs after the owner answers keep", {
  timeout: 20_000,
}, async () => {
  const r = await rig(true);
  fakeOutput(r.home, "x");
  const keeper = captured.keeper;
  if (!keeper) throw new Error("Missing keeper");
  const resetsAt = Date.parse("2026-11-14T09:00:00Z") / 1000;
  keeper.noteLimits("claude-code", [
    {
      status: "allowed_warning",
      type: "seven_day",
      utilization: 0.95,
      resetsAt,
      windows: { seven_day: { utilization: 0.95, resetsAt } },
    },
  ]);
  await r.enable();
  await r.tick(false);
  await keeper.settled();
  const triggered = r.store.listRuns({ flowId: id }).at(0);
  if (!triggered) throw new Error("Missing triggered run");
  expect(keeper.waitingOf(triggered.id).at(0)?.waiting).toMatchObject({ reason: "quota" });
  const ownerFlow = triggerFlow("local.owner", [{ kind: "schedule", every: "1m" }]);
  r.service.engine.registerFlow(ownerFlow, hash);
  expect((await r.service.engine.beginStart(ownerFlow.id, { project: r.project }).settled).state).toBe(
    "done",
  );
  await r.service.call("approvals.resolve", { approvalId: "weekly-limit:claude-code", decision: "approve" });
  expect((await r.begun.at(0)?.settled)?.state).toBe("done");
});

test("counting is the runner's: three fires against a cap of 2 start 2 runs while the worker prints runs today: 0", {
  timeout: 20_000,
}, async () => {
  const r = await rig(true);
  fakeOutput(r.home, "x runs today: 0");
  const flow = triggerFlow(id, [{ kind: "file_change", path: "inbox", debounce: "1s" }], {
    limits: { max_runs_per_day: 2 },
  });
  r.service.engine.registerFlow(flow, hash);
  await r.enable();
  await r.tick();
  for (const name of ["runs-today-0.txt", "count 0.txt", "third.txt"]) {
    writeFileSync(join(r.project, "inbox", name), "count 0");
    for (const signal of r.signals) signal();
    await r.tick();
    await r.tick();
  }
  const runs = r.store.listRuns({ flowId: id });
  expect(runs).toHaveLength(2);
  expect(JSON.stringify(runs.map((run) => run.trigger?.payload))).toContain("count 0");
  expect(r.store.counter(`runs:${id}`, "2026-11-12")).toBe(2);
  expect(r.store.counter(`dropped:${id}`, "2026-11-12")).toBe(1);
});

test("R7 end to end: 40 schedule fires against a cap of 3 give 3 runs, 37 dropped, one audit milestone pair and exactly one flood notice", {
  timeout: 20_000,
}, async () => {
  const r = await rig(true);
  fakeOutput(r.home, "x");
  r.service.engine.registerFlow({ ...r.flow, limits: { max_runs_per_day: 3 } }, hash);
  await r.enable();
  for (let i = 0; i < 40; i++) await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(3);
  expect(r.store.counter(`dropped:${id}`, "2026-11-12")).toBe(37);
  expect(
    r.store
      .listAudit()
      .filter((a) => a.kind === "trigger_capped")
      .map((a) => a.detail),
  ).toMatchObject([{ dropped: 1 }, { dropped: 10 }]);
  expect(r.notices.filter((n) => n.kind === "flood_cap")).toHaveLength(1);
});

test("a fire reaches the same checks as a manual run: a flow whose readiness is not ready ends blocked and notifies once, and with consent it runs", {
  timeout: 20_000,
}, async () => {
  const r = await rig();
  fakeOutput(r.home, "x");
  await r.enable();
  await r.tick();
  expect(r.store.listRuns({ flowId: id }).at(0)?.state).toBe("blocked");
  expect(r.notices.filter((n) => n.kind === "run_blocked")).toHaveLength(1);
  await r.service.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
  await r.tick();
  expect(r.store.listRuns({ flowId: id }).some((run) => run.state === "done")).toBe(true);
});

test("three blocked runs in a row pause the trigger", { timeout: 20_000 }, async () => {
  const r = await rig();
  fakeOutput(r.home, "x");
  await r.enable();
  for (let i = 0; i < 3; i++) await r.tick();
  await r.tick();
  expect(r.store.getTrigger(id, 0)).toMatchObject({ enabled: false, pausedAt: expect.any(String) });
  expect(r.notices.filter((n) => n.kind === "trigger_paused")).toHaveLength(1);
  expect(await r.service.call("triggers.list", { flowId: id })).toMatchObject([
    { state: "off", reason: "Paused: the last 3 runs were blocked. Fix what blocks it, then turn it on." },
  ]);
  for (let i = 0; i < 2; i++) await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(3);
  await r.service.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
  await r.enable();
  await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(4);
  expect(r.store.listRuns({ flowId: id }).some((run) => run.state === "done")).toBe(true);
});

test("file_change cannot reach outside the project: .., an absolute path elsewhere, a symlink to another folder and a folder swapped for a link after enabling are refused", async () => {
  const r = await rig();
  const outside = dirname(tempPath());
  symlinkSync(outside, join(r.project, "link"));
  for (const path of ["..", outside, "link"]) {
    const flow = triggerFlow(id, [{ kind: "file_change", path }]);
    const currentHash = `sha256:${String((path.length % 9) + 1).repeat(64)}`;
    r.service.engine.registerFlow(flow, currentHash);
    await expect(r.enable(true, currentHash)).rejects.toMatchObject({
      code: "not_allowed",
      message: expect.any(String),
    });
    await r.tick();
    expect(r.store.listRuns({ flowId: id })).toHaveLength(0);
  }
  const flow = triggerFlow(id, [{ kind: "file_change", path: "inbox", debounce: "1s" }]);
  r.service.engine.registerFlow(flow, hash);
  await r.enable();
  await r.tick();
  renameSync(join(r.project, "inbox"), join(r.project, "old"));
  symlinkSync(outside, join(r.project, "inbox"));
  for (const signal of r.signals) signal();
  await r.tick();
  expect(r.store.listRuns({ flowId: id })).toHaveLength(0);
  expect(await r.service.call("triggers.list", { flowId: id })).toMatchObject([
    { reason: "Only folders inside the project folder or a folder you granted to this flow can be watched." },
  ]);
});

test("no notice text carries step output, a payload value or a file name", { timeout: 20_000 }, async () => {
  const r = await rig();
  const hostileName = `Clean${String.fromCodePoint(0x202e, 1)} name`;
  r.service.engine.registerFlow({ ...r.flow, name: hostileName, limits: { max_runs_per_day: 3 } }, hash);
  fakeOutput(r.home, "x SECRET-OUT");
  writeFileSync(join(r.project, "inbox", "PAYLOAD-NAME.txt"), "SECRET-OUT");
  await r.enable();
  for (let i = 0; i < 4; i++) await r.tick();
  expect(r.notices.some((n) => n.kind === "run_blocked")).toBe(true);
  expect(r.notices.some((n) => n.kind === "trigger_paused")).toBe(true);
  const s = await rig(true);
  s.service.engine.registerFlow(
    {
      ...s.flow,
      name: hostileName,
      triggers: [{ kind: "file_change", path: "inbox", glob: "**/*", debounce: "1s" }],
      limits: { max_runs_per_day: 1 },
    },
    hash,
  );
  fakeOutput(s.home, "x SECRET-OUT");
  await s.enable();
  await s.tick();
  writeFileSync(join(s.project, "inbox", "PAYLOAD-NAME.txt"), "SECRET-OUT");
  for (const signal of s.signals) signal();
  await s.tick();
  await s.tick();
  const fileRun = s.store.listRuns({ flowId: id }).at(0);
  if (!fileRun) throw new Error("Missing file-triggered run");
  expect(JSON.stringify(fileRun.trigger?.payload)).toContain("PAYLOAD-NAME.txt");
  expect(JSON.stringify(s.store.listSteps(fileRun.id))).toContain("SECRET-OUT");
  writeFileSync(join(s.project, "inbox", "second.txt"), "SECRET-OUT");
  for (const signal of s.signals) signal();
  await s.tick();
  await s.tick();
  expect(s.notices.some((n) => n.kind === "flood_cap")).toBe(true);
  const keeper = captured.keeper;
  if (!keeper) throw new Error("Missing keeper");
  const resetsAt = Date.parse("2026-11-14T09:00:00Z") / 1000;
  keeper.noteLimits("claude-code", [
    {
      status: "allowed_warning",
      type: "seven_day",
      utilization: 0.95,
      resetsAt,
      windows: { seven_day: { utilization: 0.95, resetsAt } },
    },
  ]);
  const weekly = triggerFlow("local.weekly", [{ kind: "schedule", every: "1m" }]);
  s.service.engine.registerFlow(weekly, hash);
  await s.service.call("triggers.setEnabled", { flowId: weekly.id, index: 0, enabled: true, hash });
  await s.tick(false);
  await keeper.settled();
  expect(s.notices.some((n) => n.kind === "weekly_limit")).toBe(true);
  await s.service.call("approvals.resolve", { approvalId: "weekly-limit:claude-code", decision: "approve" });
  await Promise.all(s.begun.map((b) => b.settled));
  const approval = triggerFlow("local.approval", [{ kind: "schedule", every: "1m" }], {
    steps: [
      {
        id: "a",
        do: "worker",
        instructions: "Say x",
        outputs: [
          { id: "jobs", type: "json" },
          { id: "message", type: "text" },
        ],
        checks: [{ type: "contains", pattern: "x", of: "message" }],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Pick",
          choose_from: "${steps.a.outputs.jobs}",
          max_pick: 1,
          approves: [],
          on_expiry: "end",
        },
      },
    ],
  });
  s.service.engine.registerFlow({ ...approval, name: hostileName }, hash);
  writeFakeScript(s.home, {
    plays: [
      {
        when: "Say x",
        actions: [
          {
            do: "result",
            result: "x SECRET-OUT",
            structured: {
              report: "x SECRET-OUT",
              outputs: { jobs: [{ id: "one" }], message: "x SECRET-OUT" },
            },
          },
        ],
      },
    ],
  });
  await s.service.engine.beginStart(approval.id, { project: s.project }).settled;
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(s.notices.some((n) => n.kind === "approval_waiting")).toBe(true);
  for (const notice of [...r.notices, ...s.notices]) {
    expect(Notice.safeParse(notice).success).toBe(true);
    expect(JSON.stringify(notice)).not.toContain("SECRET-OUT");
    expect(JSON.stringify(notice)).not.toContain("PAYLOAD-NAME.txt");
    if (notice.kind !== "weekly_limit") expect(notice.body).toContain("Clean name");
  }
});
