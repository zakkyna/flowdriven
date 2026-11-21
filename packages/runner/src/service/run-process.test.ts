import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { CONTRACT_VERSION_V1 as CONTRACT_VERSION, type RunnerEvent } from "@flowdriven/contracts/v1";
import { afterEach, expect, test } from "vitest";
import { demoFlow } from "../demo/demo-flow.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { connectRpcClient } from "../test-helpers/rpc-client.ts";
import { createNoticeSink, guardProcess, runProcess } from "./run-process.ts";
import { DEMO_HASH } from "./service.ts";

const dirs: string[] = [];
const active: { input: PassThrough; done: Promise<number> }[] = [];
function temp() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  dirs.push(path);
  return path;
}
afterEach(async () => {
  for (const p of active.splice(0)) {
    p.input.end();
    await p.done;
  }
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
function start(dataDir: string, extra: { now?: () => Date; sweepEveryMs?: number } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors: string[] = [];
  let n = 0;
  const client = connectRpcClient({ input: output, output: input });
  const done = runProcess({
    dataDir,
    demo: true,
    input,
    output,
    errors: (line) => errors.push(line),
    newId: (prefix) => `${prefix}-${++n}`,
    ...extra,
  });
  active.push({ input, done });
  return { input, output, client, done, errors };
}
async function until<T>(fn: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 500; i++) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}
test("the crash guard writes one line per uncaught error and does not rethrow", () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const lines: string[] = [];
  const proc = {
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return proc;
    },
  };
  guardProcess(proc as Pick<NodeJS.Process, "on">, (line) => lines.push(line));
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    listeners.get(event)?.(new Error("x".repeat(220)));
    listeners.get(event)?.("oops");
  }
  expect(lines).toEqual([
    `Internal error: ${"x".repeat(200)}`,
    "Internal error: oops",
    `Internal error: ${"x".repeat(200)}`,
    "Internal error: oops",
  ]);
});
test("serves runner.info and the demo flow and returns 0 when its input ends, with the store closed", {
  timeout: 20_000,
}, async () => {
  const dir = temp();
  const p = start(dir);
  expect(await p.client.call("runner.info", {})).toEqual({ contractVersion: CONTRACT_VERSION, mode: "demo" });
  expect(await p.client.call("flows.list", {})).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "local.sample-job-review" })]),
  );
  p.input.end();
  expect(await p.done).toBe(0);
  const store = await openSqliteStore(join(dir, "flowdriven.sqlite"), { exclusive: true });
  store.close();
});
test("a second runner on the same folder returns 3 with one line on stderr", {
  timeout: 20_000,
}, async () => {
  const dir = temp();
  const first = start(dir);
  await first.client.call("runner.info", {});
  const second = start(dir);
  expect(await second.done).toBe(3);
  expect(second.errors).toEqual(["Another FlowDriven runner is using this data folder."]);
});
test("a protocol error returns 4", { timeout: 20_000 }, async () => {
  const p = start(temp());
  p.input.write("not json\n");
  expect(await p.done).toBe(4);
});
test("a refused data folder returns 2", { timeout: 20_000 }, async () => {
  const path = join(temp(), "file");
  writeFileSync(path, "");
  const p = start(path);
  expect(await p.done).toBe(2);
  expect(p.errors).toHaveLength(1);
});
test("a run that was walking is found at the next start", { timeout: 20_000 }, async () => {
  const dir = temp();
  const store = await openSqliteStore(join(dir, "flowdriven.sqlite"));
  const demo = demoFlow();
  store.putFlow({
    id: demo.manifest.id,
    version: demo.manifest.version,
    hash: DEMO_HASH,
    manifest: demo.manifest,
    files: demo.files,
    registeredAt: "2026-11-11T00:00:00.000Z",
  });
  store.createRun({
    id: "run-old",
    flowId: demo.manifest.id,
    flowHash: DEMO_HASH,
    flowVersion: demo.manifest.version,
    state: "running",
    project: dir,
    inputs: {},
    params: {},
    requirements: [],
    startedAt: "2026-11-11T00:00:00.000Z",
  });
  store.upsertStep({
    runId: "run-old",
    stepId: "alerts",
    itemKey: "",
    state: "running",
    attempts: [],
    outputs: {},
    checks: [],
  });
  store.close();
  const p = start(dir);
  expect((await p.client.call("runs.status", { runId: "run-old" })).state).toBe("interrupted");
});
test("the sweep runs on its timer and sends a changed event", { timeout: 20_000 }, async () => {
  let time = new Date("2026-11-11T00:00:00.000Z").getTime();
  const p = start(temp(), { now: () => new Date(time), sweepEveryMs: 20 });
  const events: RunnerEvent[] = [];
  p.client.subscribe((event) => events.push(event));
  await p.client.call("flows.run", { flowId: "local.sample-job-review" });
  const approval = await until(async () =>
    (await p.client.call("approvals.list", { state: "pending" })).at(0),
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  events.length = 0;
  time += 24 * 60 * 60 * 1000 + 1;
  await until(async () =>
    events.some((e) => e.type === "changed" && e.topics.includes("approvals")) ? true : undefined,
  );
  expect(await p.client.call("approvals.list", { state: "expired" })).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: approval.id, state: "expired" })]),
  );
});

test("runProcess in live mode takes its environment and claudePath", { timeout: 20_000 }, async () => {
  const dataDir = temp();
  const home = makeFakeHome();
  dirs.push(home);
  const input = new PassThrough(),
    output = new PassThrough();
  const client = connectRpcClient({ input: output, output: input });
  const done = runProcess({
    dataDir,
    demo: false,
    input,
    output,
    errors: () => {},
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
  });
  active.push({ input, done });
  await client.call("harnesses.rescan", {});
  expect((await client.call("harnesses.list", {})).at(0)?.version).toBe("2.1.318");
});

test("a notice sink holds up to 20 notices raised before the server is attached, writes them in order on attach and sends later ones directly; the 21st early notice is dropped", () => {
  const sink = createNoticeSink();
  const received: string[] = [];
  const notice = {
    id: "n",
    kind: "run_blocked" as const,
    title: "Run blocked",
    body: "Blocked",
    target: { screen: "run" as const, runId: "r" },
  };
  for (let i = 0; i < 21; i++) sink.send({ ...notice, id: `n${i}` });
  sink.attach({ notice: (n) => received.push(n.id) });
  sink.send({ ...notice, id: "later" });
  expect(received).toEqual([...Array.from({ length: 20 }, (_, i) => `n${i}`), "later"]);
});
