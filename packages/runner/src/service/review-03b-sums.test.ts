import { StepUsage, UsageSummary } from "@flowdriven/contracts/v1";
import { expect, test } from "vitest";
import { parseUsage } from "../claude/stream.ts";
import { sumUsage } from "../report.ts";
import type { Store } from "../storage.ts";
import { oneStepFlow } from "../test-helpers/flows.ts";
import { toRunDetail } from "./map-run.ts";
import { summarizeUsage } from "./usage-summary.ts";

const event = { type: "result", modelUsage: { m: { inputTokens: 1e300, outputTokens: 1e300 } } };
const u = parseUsage(event as never);
const row = (at: string) => ({
  at,
  runId: "r",
  stepId: "s",
  itemKey: "",
  attempt: 1,
  kind: "worker" as const,
  harness: "claude-code",
  models: u?.models ?? [],
  turns: 0,
  wallMs: 1,
  queuedMs: 0,
  exit: "ok" as const,
});
test("one hostile result event makes the step usage unparseable", () => {
  expect(u?.models[0]?.input).toBe(1e12);
  expect(() => StepUsage.parse(sumUsage([row("2026-11-12T01:00:00.000Z")]))).not.toThrow();
});
test("and the usage summary", () => {
  const store = {
    listUsage: () => [row("2026-11-12T01:00:00.000Z"), row("2026-11-12T02:00:00.000Z")],
  } as unknown as Store;
  const s = summarizeUsage({
    store,
    now: new Date("2026-11-12T03:00:00.000Z"),
    quotaOf: () => ({}),
    lines: { fiveHour: 0.9, sevenDay: 0.9 },
  });
  expect(() => UsageSummary.parse(s)).not.toThrow();
});

test("a stored row with a count above the safe range still gives a valid run view", () => {
  const manifest = oneStepFlow("local.u");
  const big = {
    ...row("2026-11-12T01:00:00.000Z"),
    stepId: "a",
    models: [{ model: "m", input: 1e300, output: 1e300, cacheRead: 0, cacheWrite: 0 }],
  };
  const detail = toRunDetail(
    {
      manifest,
      run: {
        id: "r",
        flowId: manifest.id,
        flowHash: `sha256:${"a".repeat(64)}`,
        flowVersion: manifest.version,
        state: "done",
        project: ".",
        inputs: {},
        params: {},
        requirements: [],
        startedAt: big.at,
      },
      steps: [
        { runId: "r", stepId: "a", itemKey: "", state: "passed", attempts: [], outputs: {}, checks: [] },
      ],
      items: [],
      approvals: [],
      audit: [],
      usage: [big],
    },
    (n) => n,
  );
  expect(detail.steps[0]?.usage?.input).toBe(Number.MAX_SAFE_INTEGER);
  expect(detail.usage[0]?.tokens).toBe(Number.MAX_SAFE_INTEGER);
  expect(detail.calls?.[0]?.models[0]?.input).toBe(Number.MAX_SAFE_INTEGER);
});

test("stored large counts are capped in each summary total", () => {
  const huge = {
    ...row("2026-11-12T01:00:00.000Z"),
    models: [{ model: "m", input: 1e300, output: 1e300, cacheRead: 1e300, cacheWrite: 1e300 }],
  };
  const store = { listUsage: () => [huge, huge] } as unknown as Store;
  const result = summarizeUsage({
    store,
    now: new Date("2026-11-12T03:00:00.000Z"),
    quotaOf: () => ({}),
    lines: { fiveHour: 0.9, sevenDay: 0.9 },
  });
  expect(UsageSummary.parse(result).harnesses[0]?.today).toEqual({
    calls: 2,
    input: Number.MAX_SAFE_INTEGER,
    output: Number.MAX_SAFE_INTEGER,
    cacheRead: Number.MAX_SAFE_INTEGER,
    cacheWrite: Number.MAX_SAFE_INTEGER,
  });
});
