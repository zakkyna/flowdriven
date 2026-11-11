import { DEFAULT_KEEPER, type RunnerTopic } from "@flowdriven/contracts";
import { afterEach, expect, test } from "vitest";
import type { HarnessAdapter, StepRequest } from "../harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { RunRow } from "../storage.ts";
import { gate, OK } from "../test-helpers/flows.ts";
import { readKeeperSettings, wireKeeper } from "./keeper-wiring.ts";

const NOW = "2026-11-11T09:00:00.000Z";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
async function rig() {
  const store = await openSqliteStore(":memory:");
  const latch = gate();
  const marks: RunnerTopic[] = [];
  const inner: HarnessAdapter = {
    id: "claude-code",
    name: "Claude Code",
    runStep: async () => {
      await latch.wait();
      return OK;
    },
    judge: async () => ({ verdict: "passed", reasons: "ok", evidence: "" }),
    replan: async () => undefined,
    probe: async () => ({ ok: true, detail: "" }),
  };
  const probes = {
    refresh: async () => {},
    availableMb: () => 8000,
    pressureLevel: () => 1,
    groupRssMb: () => undefined,
    totalMb: () => 16000,
  };
  const again = () => {
    const wired = wireKeeper({
      store,
      now: () => new Date(NOW),
      harness: inner,
      probes,
      every: () => () => {},
      markChanged: (t) => marks.push(t),
    });
    cleanup.unshift(() => wired.keeper.stop());
    return wired;
  };
  cleanup.push(() => store.close());
  const wired = again();
  const run = (id: string, over: Partial<RunRow> = {}): RunRow => ({
    id,
    flowId: "f",
    flowHash: "h",
    flowVersion: "1.0.0",
    state: "running",
    project: "/p",
    inputs: {},
    params: {},
    requirements: [],
    startedAt: NOW,
    ...over,
  });
  const req = (runId: string): StepRequest => ({
    runId,
    stepId: "a",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "i",
    uses: [],
    project: "/p",
    requirements: [],
    outputs: [],
    maxDurationMs: 1000,
    signal: new AbortController().signal,
  });
  return { store, wired, again, marks, gate: latch, req, run };
}

test("settings default, junk gives the floor, and a stored change applies at the next decision", async () => {
  const w = await rig();
  expect(readKeeperSettings(w.store)).toEqual(DEFAULT_KEEPER);
  w.store.putSetting("keeper", { ceiling: "many" });
  expect(readKeeperSettings(w.store).ceiling).toBe(1);
  w.store.putSetting("keeper", { ceiling: 1 });
  expect(w.wired.keeper.snapshot().ceiling).toBe(1);
});
test("a run with a trigger other than manual is class 2 and waits at the stored weekly line; the owner's run goes on", async () => {
  const w = await rig();
  const far = Date.parse(NOW) / 1000 + 86400;
  w.store.createRun(w.run("own"));
  w.store.createRun(w.run("trig", { trigger: { kind: "schedule" } }));
  w.store.putSetting("quota:claude-code", { sevenDay: { utilization: 0.95, resetsAt: far } });
  const k = w.again();
  const own = k.harness.runStep(w.req("own"));
  const trig = k.harness.runStep(w.req("trig"));
  await k.keeper.settled();
  expect(k.keeper.snapshot().rows.map((r) => `${r.ticket.runId}:${r.state}:${r.ticket.cls}`)).toEqual([
    "own:running:1",
    "trig:waiting:2",
  ]);
  w.gate.release();
  await own;
  k.keeper.stop();
  await trig;
});
test("the weight is the largest recent peak times 1.25, else the default", async () => {
  const w = await rig();
  for (const id of ["r1", "r2", "r3"]) w.store.createRun(w.run(id));
  const row = (runId: string, peak: number) => ({
    at: NOW,
    runId,
    stepId: "a",
    itemKey: "",
    attempt: 1,
    kind: "worker" as const,
    harness: "claude-code",
    models: [],
    turns: 0,
    wallMs: 1,
    queuedMs: 0,
    memoryPeakMb: peak,
    exit: "ok" as const,
  });
  w.store.addUsage(row("r1", 100));
  w.store.addUsage(row("r2", 200));
  void w.wired.harness.runStep(w.req("r3"));
  await w.wired.keeper.settled();
  expect(w.wired.keeper.snapshot().rows.at(0)?.ticket.weightMb).toBe(250);
  void w.wired.harness.runStep({ ...w.req("r3"), stepId: "b" });
  await w.wired.keeper.settled();
  expect(w.wired.keeper.snapshot().rows.at(1)?.ticket.weightMb).toBe(200);
  w.gate.release();
  w.gate.release();
});
test("a change of the queue marks the runs topic, and waiting changes no run state", async () => {
  const w = await rig();
  w.store.putSetting("keeper", { ceiling: 1 });
  for (const id of ["r1", "r2"]) w.store.createRun(w.run(id));
  void w.wired.harness.runStep(w.req("r1"));
  void w.wired.harness.runStep(w.req("r2"));
  await w.wired.keeper.settled();
  expect(w.wired.keeper.waitingOf("r2")).toHaveLength(1);
  expect(w.marks).toContain("runs");
  expect(w.store.getRun("r2")?.state).toBe("running");
  w.gate.release();
  w.gate.release();
});

test("a stored keeper value that does not parse gives a ceiling of 1, never the default of 4", async () => {
  const w = await rig();
  w.store.putSetting("keeper", { ceiling: "many" });
  expect(readKeeperSettings(w.store)).toEqual({
    ...DEFAULT_KEEPER,
    ceiling: 1,
    quotaLines: { fiveHour: 0.9, sevenDay: 0.9 },
  });
  expect(w.wired.keeper.snapshot().ceiling).toBe(1);
});

test("invalid settings are audited once when the keeper starts", async () => {
  const w = await rig();
  w.store.putSetting("keeper", { ceiling: "bad" });
  w.again();
  expect(w.store.listAudit().filter((entry) => entry.kind === "keeper_settings_invalid")).toMatchObject([
    { detail: "The stored keeper settings could not be read; the ceiling is 1 until they are saved again." },
  ]);
});

test("a malformed stored quota row is dropped and the service still starts", async () => {
  const w = await rig();
  w.store.putSetting("quota:claude-code", { sevenDay: "invalid" });
  const k = w.again();
  expect(w.store.getSetting("quota:claude-code")).toBeUndefined();
  expect(k.keeper.snapshot().ceiling).toBe(DEFAULT_KEEPER.ceiling);
  w.store.createRun(w.run("r1"));
  void k.harness.runStep(w.req("r1"));
  await k.keeper.settled();
  expect(k.keeper.snapshot().rows.at(0)?.state).toBe("running");
  w.gate.release();
});
