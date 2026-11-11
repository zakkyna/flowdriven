import { expect, test } from "vitest";
import {
  type HarnessAdapter,
  HarnessCallError,
  type JudgeRequest,
  type JudgeResult,
  type StepRequest,
  type StepResult,
} from "../harness.ts";
import type { UsageEventRow } from "../storage.ts";
import { createKeeper } from "./keeper.ts";
import { createKeptHarness } from "./kept-harness.ts";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("not initialized");
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error("not initialized");
  };
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function rig(known = true, failRecord = false) {
  const clock = { now: 1_000_000 };
  const probes = {
    refresh: async () => {},
    availableMb: () => 8000,
    pressureLevel: () => 1,
    groupRssMb: () => undefined,
    totalMb: () => 16000,
  };
  const keeper = createKeeper({
    config: () => ({ ceiling: 1, reserveMb: 0, fiveHourLine: 0.9, sevenDayLine: 0.9 }),
    probes,
    nowMs: () => clock.now,
    every: () => () => {},
    weeklyAnswer: () => undefined,
  });
  const log: string[] = [];
  const rows: UsageEventRow[] = [];
  const steps = new Map<string, ReturnType<typeof deferred<StepResult>>>();
  const judges = new Map<string, ReturnType<typeof deferred<JudgeResult>>>();
  const slot = <T>(m: Map<string, ReturnType<typeof deferred<T>>>, k: string) => {
    let d = m.get(k);
    if (!d) {
      d = deferred<T>();
      m.set(k, d);
    }
    return d;
  };
  const inner: HarnessAdapter = {
    id: "fake",
    name: "Fake",
    replan: async () => undefined,
    probe: async () => ({ ok: true, detail: "" }),
    runStep: (req) => {
      log.push(`inner:${req.stepId}`);
      return slot(steps, req.stepId).promise;
    },
    judge: (req) => {
      log.push(`judge:${req.stepId}`);
      return slot(judges, req.stepId).promise;
    },
  };
  const kept = createKeptHarness({
    inner,
    keeper,
    nowMs: () => clock.now,
    at: () => "2026-11-11T09:00:00.000Z",
    info: () =>
      known ? { cls: 1, underWay: false, startedAt: "2026-11-11T09:00:00.000Z", flowId: "f" } : undefined,
    weight: () => 200,
    record: (row) => {
      if (failRecord) throw new Error("record failed");
      rows.push(row);
    },
  });
  const pause = (id: string) => () => {
    log.push(`pause:${id}`);
    return () => {
      log.push(`resume:${id}`);
    };
  };
  const req = (id: string, over: Partial<StepRequest> = {}): StepRequest => ({
    runId: `run-${id}`,
    stepId: id,
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
    pauseLimit: pause(id),
    ...over,
  });
  const judgeReq = (id: string): JudgeRequest => ({
    runId: `run-${id}`,
    stepId: id,
    itemKey: "k",
    rubric: "r",
    output: "o",
    signal: new AbortController().signal,
    pauseLimit: pause(id),
  });
  return {
    clock,
    keeper,
    log,
    rows,
    kept,
    req,
    judgeReq,
    finish: (id: string, r: StepResult) => slot(steps, id).resolve(r),
    finishJudge: (id: string, r: JudgeResult) => slot(judges, id).resolve(r),
    failJudge: (id: string, e: unknown) => slot(judges, id).reject(e),
  };
}
const call = (over = {}) => ({
  models: [{ model: "m", input: 4, output: 9000, cacheRead: 1, cacheWrite: 2 }],
  turns: 1,
  wallMs: 50,
  limits: [],
  ...over,
});

test("two steps at ceiling 1: the second pauses its limit while it waits, runs after the first, and both leave a row with the time they waited", async () => {
  const r = rig();
  const first = r.kept.runStep(r.req("a"));
  const second = r.kept.runStep(r.req("b"));
  await r.keeper.settled();
  await flush();
  expect(r.log).toEqual(["inner:a", "pause:b"]);
  r.clock.now += 5000;
  r.finish("a", { exit: "ok", text: "", outputs: {}, call: call() });
  await first;
  await r.keeper.settled();
  await flush();
  expect(r.log).toEqual(["inner:a", "pause:b", "resume:b", "inner:b"]);
  r.finish("b", { exit: "ok", text: "", outputs: {}, call: call({ models: [] }) });
  await second;
  expect(r.rows.map((x) => [x.runId, x.kind, x.exit, x.models.at(0)?.output ?? 0, x.queuedMs])).toEqual([
    ["run-a", "worker", "ok", 9000, 0],
    ["run-b", "worker", "ok", 0, 5000],
  ]);
});
test("a step the gate refused, with no process started, leaves no usage row", async () => {
  const r = rig();
  const a = r.kept.runStep(r.req("a"));
  await r.keeper.settled();
  await flush();
  r.finish("a", { exit: "failed", text: "", outputs: {}, block: "Claude Code was not found." });
  await a;
  expect(r.rows).toEqual([]);
});
test("a judge passes the keeper too, carries its item, and is recorded as a judge", async () => {
  const r = rig();
  const step = r.kept.runStep(r.req("a"));
  const judge = r.kept.judge(r.judgeReq("a"));
  await r.keeper.settled();
  await flush();
  expect(r.log).toEqual(["inner:a", "pause:a"]);
  r.finish("a", { exit: "ok", text: "", outputs: {}, call: call() });
  await step;
  await r.keeper.settled();
  await flush();
  r.finishJudge("a", { verdict: "passed", reasons: "", evidence: "e", call: call() });
  await judge;
  expect(r.rows.map((x) => [x.kind, x.itemKey, x.attempt])).toEqual([
    ["worker", "", 1],
    ["judge", "k", 0],
  ]);
});
test("a refused judge reaches the keeper and leaves its row; a refusal without a reset time backs off 15 minutes once", async () => {
  const r = rig();
  const judge = r.kept.judge(r.judgeReq("a"));
  await r.keeper.settled();
  await flush();
  r.failJudge(
    "a",
    new HarnessCallError("limit", "quota", call({ limits: [{ status: "rejected", windows: {} }] })),
  );
  await expect(judge).rejects.toThrow("limit");
  expect(r.keeper.quotaOf("fake").rejectedUntil).toBe(1_000_000 + 15 * 60_000);
  expect(r.rows.map((x) => [x.kind, x.exit])).toEqual([["judge", "quota"]]);
  const s = rig();
  const step = s.kept.runStep(s.req("a"));
  await s.keeper.settled();
  await flush();
  s.finish("a", {
    exit: "quota",
    text: "",
    outputs: {},
    call: call({
      limits: [
        { status: "rejected", resetsAt: 2000, windows: { five_hour: { utilization: 0.95, resetsAt: 2000 } } },
      ],
    }),
  });
  await step;
  expect(s.keeper.quotaOf("fake")).toEqual({
    rejectedUntil: 2_000_000,
    fiveHour: { utilization: 0.95, resetsAt: 2000 },
  });
});
test("an abort while waiting gives interrupted, starts nothing and leaves no row", async () => {
  const r = rig();
  const a = r.kept.runStep(r.req("a"));
  const ctl = new AbortController();
  const b = r.kept.runStep(r.req("b", { signal: ctl.signal }));
  await r.keeper.settled();
  await flush();
  ctl.abort();
  expect((await b).exit).toBe("interrupted");
  expect(r.log).not.toContain("inner:b");
  r.finish("a", { exit: "ok", text: "", outputs: {}, call: call() });
  await a;
  expect(r.rows.map((x) => x.runId)).toEqual(["run-a"]);
});

test("a step of a run that cannot be found is refused and nothing starts", async () => {
  const r = rig(false);
  const message = "FlowDriven could not find the run of this step.";
  expect(await r.kept.runStep(r.req("a"))).toEqual({
    exit: "failed",
    text: message,
    outputs: {},
    block: message,
  });
  expect(r.log).toEqual([]);
  expect(r.rows).toEqual([]);
  expect(r.keeper.snapshot().rows).toEqual([]);
});
test("a judge of a run that cannot be found throws and nothing starts", async () => {
  const r = rig(false);
  await expect(r.kept.judge(r.judgeReq("a"))).rejects.toThrow(
    "FlowDriven could not find the run of this step.",
  );
  expect(r.log).toEqual([]);
  expect(r.rows).toEqual([]);
  expect(r.keeper.snapshot().rows).toEqual([]);
});

test("a note that throws does not lose the usage row or change the result", async () => {
  const r = rig();
  r.keeper.noteLimits = () => {
    throw new Error("note failed");
  };
  const result = { exit: "ok" as const, text: "done", outputs: {}, call: call() };
  const step = r.kept.runStep(r.req("a"));
  await r.keeper.settled();
  await flush();
  r.finish("a", result);
  await expect(step).resolves.toEqual(result);
  expect(r.rows).toHaveLength(1);
  expect(r.keeper.snapshot().rows).toEqual([]);
});

test("record and note failures preserve judge errors and release the ticket", async () => {
  const r = rig(true, true);
  let refused = false;
  r.keeper.noteLimits = () => {
    throw new Error("note failed");
  };
  r.keeper.noteRefused = () => {
    refused = true;
    throw new Error("refused failed");
  };
  const judge = r.kept.judge(r.judgeReq("a"));
  await r.keeper.settled();
  await flush();
  r.failJudge("a", new HarnessCallError("original error", "quota", call()));
  await expect(judge).rejects.toThrow("original error");
  expect(refused).toBe(true);
  expect(r.keeper.snapshot().rows).toEqual([]);
});
