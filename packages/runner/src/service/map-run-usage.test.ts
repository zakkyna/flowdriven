import { expect, test } from "vitest";
import type { RunView } from "../engine.ts";
import type { UsageEventRow } from "../storage.ts";
import { oneStepFlow } from "../test-helpers/flows.ts";
import { toRunDetail } from "./map-run.ts";

const base = {
  runId: "run-1",
  stepId: "a",
  itemKey: "",
  kind: "worker",
  exit: "ok",
  at: "2026-11-12T00:00:00.000Z",
} as const;
const rows: UsageEventRow[] = [
  {
    ...base,
    harness: "claude-code",
    attempt: 1,
    turns: 2,
    wallMs: 4800,
    queuedMs: 0,
    costUsd: 0.0003,
    models: [{ model: "m", input: 4, output: 384, cacheRead: 8454, cacheWrite: 156 }],
  },
  {
    ...base,
    harness: "claude-code",
    attempt: 2,
    turns: 1,
    wallMs: 400,
    queuedMs: 400,
    models: [{ model: "m", input: 0, output: 16, cacheRead: 0, cacheWrite: 0 }],
  },
  {
    ...base,
    harness: "codex",
    attempt: 1,
    turns: 1,
    wallMs: 100,
    queuedMs: 0,
    models: [{ model: "x", input: 10, output: 0, cacheRead: 0, cacheWrite: 0 }],
  },
];
function view(usage: UsageEventRow[]): RunView & { usage: UsageEventRow[] } {
  const manifest = oneStepFlow("local.u");
  return {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: `sha256:${"a".repeat(64)}`,
      flowVersion: manifest.version,
      state: "done",
      project: ".",
      inputs: {},
      params: {},
      requirements: [],
      startedAt: base.at,
    },
    steps: [
      { runId: "run-1", stepId: "a", itemKey: "", state: "passed", attempts: [], outputs: {}, checks: [] },
    ],
    items: [],
    approvals: [],
    audit: [],
    waiting: { steps: [] },
    usage,
  };
}
test("a step's usage is the sum of its rows; the run has one row per harness and the list of calls", () => {
  const d = toRunDetail(view(rows), (n) => n);
  expect(d.steps[0]?.usage).toEqual({
    calls: 3,
    input: 14,
    output: 400,
    cacheRead: 8454,
    cacheWrite: 156,
    turns: 4,
    wallSeconds: 5.3,
    queuedSeconds: 0.4,
    reported: true,
  });
  expect(d.usage).toEqual([
    {
      harnessId: "claude-code",
      name: "Claude Code",
      calls: 2,
      tokens: 9014,
      wallSeconds: 5.2,
      estimatedCostUsd: 0.0003,
    },
    { harnessId: "codex", name: "codex", calls: 1, tokens: 10, wallSeconds: 0.1 },
  ]);
  expect(d.calls).toHaveLength(3);
  expect(d.estimatedCostUsd).toBe(0.0003);
});
test("a step with no row says nothing was reported, and a waiting reason is mapped to the run and the step", () => {
  const d = toRunDetail(
    {
      ...view([]),
      waiting: {
        run: { reason: "ceiling", running: 1, ceiling: 1 },
        steps: [{ stepId: "a", itemKey: "", waiting: { reason: "ceiling", running: 1, ceiling: 1 } }],
      },
    },
    (n) => n,
  );
  expect(d.steps[0]?.usage).toMatchObject({ calls: 0, reported: false });
  expect(d.waiting?.reason).toBe("ceiling");
  expect(d.steps[0]?.waiting?.running).toBe(1);
});
