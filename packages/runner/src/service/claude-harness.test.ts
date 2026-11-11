import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessCard } from "@flowdriven/contracts";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { CLAUDE_ID, CONSENT_TEXT, createHarnessService, gate, toHarnessCard } from "./claude-harness.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const roots: string[] = [];
const stores: Store[] = [];
const services: RunnerService[] = [];
const now = () => new Date("2026-11-11T00:00:00.000Z");
const env = (home: string) => ({ HOME: home, PATH: process.env.PATH, USER: "u" });
function temp() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  return root;
}
function home() {
  const root = makeFakeHome();
  roots.push(root);
  return root;
}
async function store() {
  const s = await openSqliteStore(":memory:");
  stores.push(s);
  return s;
}
function ids() {
  let n = 0;
  return (prefix: string) => `${prefix}-${++n}`;
}
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function until<T>(fn: () => T | undefined): Promise<T> {
  for (let i = 0; i < 1000; i++) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Timed out");
}
const manifest = (
  steps: unknown[] = [
    {
      id: "s",
      do: "worker",
      instructions: "write",
      checks: [{ type: "files", paths: ["notes/hello.txt"] }],
      uses: ["notes"],
    },
  ],
  requirements: unknown[] = [{ id: "notes", type: "path", ref: "notes", access: "read_write" }],
) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "build",
    steps,
    requirements,
  });
const scan = {
  detected: true,
  path: "/bin/claude",
  version: "2.1.318",
  missingFlags: [],
  configFolder: true,
  login: "logged_in" as const,
  scannedAt: now().toISOString(),
};

test("the gate gives its sentences in order", () => {
  const base = {
    platform: "darwin",
    dataDir: "/tmp/data",
    scan,
    finished: true,
    fileExists: () => true,
    consent: "given" as const,
    manifest: manifest(),
  };
  const cases = [
    [{ platform: "win32" }, "Running flows on Claude Code is not supported on Windows yet."],
    [
      { dataDir: "/tmp/o'brien" },
      "FlowDriven cannot use a data folder whose path holds a quote mark or a line break.",
    ],
    [
      { dataDir: `/tmp/a${String.fromCodePoint(10)}b` },
      "FlowDriven cannot use a data folder whose path holds a quote mark or a line break.",
    ],
    [{ finished: false }, "FlowDriven is still looking for Claude Code. Try again in a moment."],
    [{ scan: undefined }, "FlowDriven is still looking for Claude Code. Try again in a moment."],
    [
      { scan: { ...scan, detected: false } },
      "Claude Code was not found on this Mac. Install it, then scan again.",
    ],
    [{ fileExists: () => false }, "Claude Code was not found on this Mac. Install it, then scan again."],
    [
      { scan: { ...scan, missingFlags: ["--restricted"] } },
      "This version of Claude Code is too old for FlowDriven. Update it, then scan again.",
    ],
    [
      { scan: { ...scan, login: "logged_out" } },
      "Claude Code is signed out. Sign in to it, then scan again.",
    ],
    [
      { scan: { ...scan, login: "unknown" } },
      "FlowDriven could not tell whether Claude Code is signed in. Scan again.",
    ],
    [{ consent: "not_given" }, "Give FlowDriven consent to run Claude Code on the Harnesses screen first."],
    [{ consent: "revoked" }, "Give FlowDriven consent to run Claude Code on the Harnesses screen first."],
  ] satisfies [Partial<Parameters<typeof gate>[0]>, string][];
  for (const [change, reason] of cases)
    expect(gate({ ...base, ...change })).toEqual({ ready: false, reason });
  expect(gate(base)).toEqual({ ready: true });
});
test("the gate blocks what it cannot enforce, then what is marked sensitive, and names the ids sorted", () => {
  const reqs = [
    { id: "gmail", type: "mcp_server", tools: ["read"] },
    { id: "builder", type: "skill" },
    { id: "data", type: "path", ref: "~/job-review" },
    { id: "notes", type: "path", ref: "notes" },
    { id: "cc", type: "harness", ref: "claude-code" },
    { id: "other", type: "harness", ref: "codex" },
  ];
  const worker = (id: string, uses: string[]) => ({ id, do: "worker", instructions: "x", uses });
  const loop = (uses: string[]) => ({
    id: "loop",
    for_each: "items",
    as: "item",
    steps: [worker("nested", uses)],
  });
  const input = {
    platform: "darwin",
    dataDir: "/tmp/data",
    scan,
    finished: true,
    fileExists: () => true,
    consent: "given" as const,
  };
  const flow = manifest(
    [
      worker("one", ["gmail", "notes"]),
      worker("two", ["data"]),
      loop(["other"]),
      { id: "skill", do: "skill", skill: "builder", instructions: "x", uses: ["builder"] },
      { id: "agent", do: "agent", instructions: "x", uses: ["gmail"] },
    ],
    reqs,
  );
  expect(gate({ ...input, manifest: flow }).reason).toBe(
    "This flow needs something FlowDriven cannot enforce yet: builder, data, gmail, other.",
  );
  expect(gate({ ...input, manifest: manifest([worker("one", ["cc", "notes"])], reqs) })).toEqual({
    ready: true,
  });
  const sensitive = reqs
    .map((r) => (["cc", "notes"].includes(r.id) ? { ...r, sensitive: true } : r))
    .concat([
      { id: "vault", type: "path", ref: "v", sensitive: true },
      { id: "idle", type: "path", ref: "i", sensitive: true },
    ]);
  const steps = [worker("one", ["cc", "notes"]), loop(["vault"])];
  expect(gate({ ...input, manifest: manifest(steps, sensitive) }).reason).toBe(
    "This flow marks cc, notes, vault as sensitive, and Claude Code runs without an OS sandbox. Allowing that arrives with a later version.",
  );
  expect(
    gate({ ...input, manifest: manifest([...steps, worker("three", ["gmail"])], sensitive) }).reason,
  ).toBe("This flow needs something FlowDriven cannot enforce yet: gmail.");
});
test("the card of a detected, signed-in Claude Code, and the card before any scan or for a missing binary", () => {
  const inventory = {
    skills: [{ name: "s", scope: "user" as const }],
    plugins: [{ name: "p", scope: "project" as const }],
    mcpServers: [{ name: "m", scope: "user" as const, connection: "needs_login" as const }],
  };
  const card = toHarnessCard({ scan, inventory }, { id: CLAUDE_ID, consent: "given" });
  expect(card).toEqual({
    id: "claude-code",
    name: "Claude Code",
    binary: "claude",
    detected: true,
    version: "2.1.318",
    path: "/bin/claude",
    login: "logged_in",
    risk: "gray",
    riskNote: "Gray on a plan login, official with an API key.",
    vendorProhibited: false,
    consent: "given",
    consentText: CONSENT_TEXT,
    sandbox: "none",
    adapter: "full",
    quota: { state: "unknown", today: { calls: 0 }, week: { calls: 0 } },
    inventory: { supported: true, ...inventory },
  });
  expect(HarnessCard.parse(card)).toEqual(card);
  for (const value of [undefined, { scan: { ...scan, detected: false }, inventory }])
    expect(toHarnessCard(value, undefined)).toMatchObject({
      detected: false,
      login: "unknown",
      inventory: { supported: false },
      consent: "not_given",
    });
});
test("a scan at start fills the card from the fake, a re-scan adds the MCP servers, and a leftover control folder is removed at start", {
  timeout: 20_000,
}, async () => {
  const h = home(),
    dataDir = temp(),
    s = await store();
  mkdirSync(join(h, ".claude/skills/a"), { recursive: true });
  writeFileSync(join(h, ".claude/skills/a/SKILL.md"), "x");
  writeFakeScript(h, {
    plugins: [
      { id: "design@market", enabled: true },
      { id: "old@market", enabled: false },
    ],
    mcp: "claude.ai Gmail: target - Needs authentication\n",
  });
  mkdirSync(join(dataDir, "control/cc-old/req"), { recursive: true });
  writeFileSync(join(dataDir, "control/cc-old/req/x"), "x");
  const hs = createHarnessService({
    store: s,
    dataDir,
    projectDir: dataDir,
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
  });
  await hs.start().settled;
  expect(existsSync(join(dataDir, "control/cc-old"))).toBe(false);
  expect(hs.list().at(0)).toMatchObject({
    version: "2.1.318",
    inventory: { skills: [{ name: "a" }], plugins: [{ name: "design@market" }], mcpServers: [] },
  });
  expect((await hs.rescan()).at(0)?.inventory.mcpServers).toEqual([
    expect.objectContaining({ name: "claude.ai Gmail", connection: "needs_login" }),
  ]);
  hs.stop();
});
test("the stored scan shows the card at once after a restart, and the gate and the recovery of an interrupted run wait for this process's own scan", {
  timeout: 20_000,
}, async () => {
  const h = home(),
    dataDir = temp(),
    s = await store();
  const first = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
  });
  services.push(first);
  await first.start().settled;
  const m = manifest();
  first.engine.registerFlow(m, DEMO_HASH, {});
  s.createRun({
    id: "old",
    flowId: m.id,
    flowHash: DEMO_HASH,
    flowVersion: m.version,
    state: "running",
    project: dataDir,
    inputs: {},
    params: {},
    requirements: m.requirements,
    startedAt: now().toISOString(),
  });
  s.upsertStep({
    runId: "old",
    stepId: "s",
    itemKey: "",
    state: "running",
    attempts: [],
    outputs: {},
    checks: [],
  });
  first.stop();
  writeFakeScript(h, { hang: ["version", "help", "auth"] });
  const second = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
    scanTimeoutMs: 300,
  });
  services.push(second);
  const pending = second.start().settled;
  expect(((await second.call("harnesses.list", {})) as { version?: string }[]).at(0)?.version).toBe(
    "2.1.318",
  );
  expect(s.getRun("old")?.state).toBe("running");
  const direct = createHarnessService({
    store: s,
    dataDir,
    projectDir: dataDir,
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
    scanTimeoutMs: 300,
  });
  const dp = direct.start().settled;
  expect(direct.readiness(m).reason).toBe(
    "FlowDriven is still looking for Claude Code. Try again in a moment.",
  );
  await Promise.all([pending, dp]);
  expect(direct.readiness(m).reason).toBe(
    "This version of Claude Code is too old for FlowDriven. Update it, then scan again.",
  );
  expect(s.getRun("old")?.state).toBe("interrupted");
  expect(readFakeCalls(h).filter((c) => c.kind === "call" && c.args.includes("-p"))).toEqual([]);
  direct.stop();
});
test("setConsent stores given and revoked with the time, audits it, and refuses an unknown harness and one that is not detected", {
  timeout: 20_000,
}, async () => {
  const h = home(),
    dataDir = temp(),
    s = await store();
  const hs = createHarnessService({
    store: s,
    dataDir,
    projectDir: dataDir,
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
  });
  await hs.start().settled;
  for (const consent of ["given", "revoked"] as const) {
    expect(hs.setConsent(CLAUDE_ID, consent).consent).toBe(consent);
    expect(s.getHarnessState(CLAUDE_ID)).toMatchObject({ consent, consentAt: now().toISOString() });
  }
  expect(s.listAudit()).toContainEqual(
    expect.objectContaining({ kind: "harness_consent", detail: { harnessId: CLAUDE_ID, consent: "given" } }),
  );
  expect(() => hs.setConsent("x", "given")).toThrowError(
    expect.objectContaining({ code: "not_found", message: "There is no harness x." }),
  );
  hs.stop();
  const missing = createHarnessService({
    store: s,
    dataDir,
    projectDir: dataDir,
    env: env(h),
    claudePath: join(dataDir, "missing"),
    now,
    newId: ids(),
  });
  await missing.start().settled;
  expect(() => missing.setConsent(CLAUDE_ID, "given")).toThrowError(
    expect.objectContaining({ code: "not_allowed", message: "This harness is not detected." }),
  );
  missing.stop();
});
test("end to end in live mode: blocked for lack of consent, then given and the step passes on the fake", {
  timeout: 20_000,
}, async () => {
  const h = home(),
    dataDir = temp(),
    s = await store(),
    path = join(dataDir, "project/notes/hello.txt");
  writeFakeScript(h, {
    plays: [
      {
        when: "",
        actions: [
          {
            do: "tool",
            id: "t1",
            name: "Write",
            input: { file_path: path, content: "hello" },
            write: { path, text: "hello" },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  const service = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
  });
  services.push(service);
  await service.start().settled;
  const m = manifest();
  service.engine.registerFlow(m, DEMO_HASH, {});
  const run = (await service.call("flows.run", { flowId: m.id })) as { id: string };
  await until(() => (s.getRun(run.id)?.state === "blocked" ? true : undefined));
  expect(s.getRun(run.id)?.blockedReason).toBe(
    "Give FlowDriven consent to run Claude Code on the Harnesses screen first.",
  );
  await service.call("harnesses.setConsent", { harnessId: CLAUDE_ID, consent: "given" });
  await service.call("runs.resume", { runId: run.id });
  await until(() => (s.getRun(run.id)?.state === "done" ? true : undefined));
  expect(readFakeCalls(h)).toContainEqual(
    expect.objectContaining({ kind: "tool", name: "Write", ran: true }),
  );
  expect(s.listAudit(run.id)).toContainEqual(expect.objectContaining({ kind: "tool_calls" }));
});
test("service.stop() ends a running step as interrupted", { timeout: 20_000 }, async () => {
  const h = home(),
    dataDir = temp(),
    s = await store();
  writeFakeScript(h, { plays: [{ when: "", actions: [{ do: "pause", ms: 30000 }] }] });
  const service = createRunnerService({
    store: s,
    dataDir,
    mode: "live",
    env: env(h),
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: ids(),
  });
  services.push(service);
  await service.start().settled;
  await service.call("harnesses.setConsent", { harnessId: CLAUDE_ID, consent: "given" });
  const m = manifest();
  service.engine.registerFlow(m, DEMO_HASH, {});
  const run = (await service.call("flows.run", { flowId: m.id })) as { id: string };
  const call = await until(() => readFakeCalls(h).find((c) => c.kind === "call" && c.args.includes("-p")));
  if (call.kind !== "call") throw Error("Missing call");
  service.stop();
  await until(() => (s.getRun(run.id)?.state === "interrupted" ? true : undefined));
  expect(() => process.kill(call.pid, 0)).toThrow();
});
