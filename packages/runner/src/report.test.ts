import { expect, test, vi } from "vitest";
import { demoFlow } from "./demo/demo-flow.ts";
import type { RunView } from "./engine.ts";
import { renderRunReport, reportLines } from "./report.ts";
import type { RunState } from "./states.ts";
import type { CheckOutcome, StepRow, UsageEventRow } from "./storage.ts";

function view(overrides: {
  state?: RunState;
  blockedReason?: string;
  itemKey?: string;
  checks?: CheckOutcome[];
  usage?: UsageEventRow[];
}): RunView {
  const { manifest } = demoFlow();
  return {
    manifest,
    run: {
      id: "run-1",
      flowId: manifest.id,
      flowHash: "hash",
      flowVersion: manifest.version,
      state: overrides.state ?? "done",
      project: ".",
      inputs: {},
      params: { min_score: 7 },
      requirements: [],
      startedAt: "now",
      ...(overrides.blockedReason ? { blockedReason: overrides.blockedReason } : {}),
    },
    steps: manifest.steps.map(
      (step): StepRow => ({
        runId: "run-1",
        stepId: step.id,
        itemKey: "",
        state: "passed",
        attempts: [{ number: 1, replan: false, worker: "Scripted harness", startedAt: "now" }],
        outputs: step.id === "alerts" ? { jobs: [{ id: "j1", title: "Job one" }] } : {},
        checks: step.id === "alerts" ? (overrides.checks ?? []) : [],
      }),
    ),
    items: Array.from({ length: 5 }, (_, i) => ({
      runId: "run-1",
      loopId: i === 4 ? "build" : "review",
      key: i === 0 ? (overrides.itemKey ?? "j1") : `j${i + 1}`,
      position: i,
      item: {},
      status: "passed",
    })),
    approvals: [
      {
        id: "a",
        kind: "ask",
        runId: "run-1",
        stepId: "pick",
        itemKey: "",
        summary: "Which jobs get a prototype?",
        payload: { question: "Which jobs get a prototype?", options: [], maxPick: 1 },
        approves: [],
        onExpiry: "end",
        createdAt: "now",
        expiresAt: "later",
        state: "pending",
      },
    ],
    audit: [],
    ...({ usage: overrides.usage } as { usage?: UsageEventRow[] }),
  };
}
test("the three report lines for each state", () => {
  expect(reportLines(view({ state: "done" }))).toEqual([
    "Sample job review: done. 4 of 4 steps passed.",
    "Items: 5 processed, 0 skipped as seen, 0 failed.",
    "Nothing needs your attention.",
  ]);
  expect(reportLines(view({ state: "blocked", blockedReason: "The harness needs you to sign in." }))[2]).toBe(
    "Blocked: The harness needs you to sign in.",
  );
  expect(reportLines(view({ state: "waiting_approval" }))[2]).toBe(
    "Waiting for you: Which jobs get a prototype?",
  );
  expect(reportLines(view({ state: "interrupted" }))[2]).toBe("Not finished: interrupted.");
});
test("escapes outside text in tables and in the summary", () => {
  const rlo = String.fromCodePoint(0x202e);
  const md = renderRunReport(
    view({ itemKey: `a|b\nc\`d${rlo}`, state: "blocked", blockedReason: `x\ny${rlo}` }),
  );
  expect(md).toContain("a\\|b c'd<U+202E>");
  expect(md).toContain("Blocked: x y<U+202E>");
  expect(md).not.toContain(rlo);
});
test("a step judged only by a judge is labelled", () =>
  expect(
    renderRunReport(
      view({
        checks: [{ type: "judge", required: true, summary: "s", verdict: "passed", evidence: "line 3" }],
      }),
    ),
  ).toContain("judge: passed \\(judged, not verified\\)"));
test("the steps table names the worker and the evidence is quoted", () => {
  const md = renderRunReport(
    view({
      checks: [
        {
          type: "contains",
          required: true,
          summary: "has /p/",
          verdict: "failed",
          evidence: "'/p/' not found",
        },
      ],
    }),
  );
  expect(md).toContain("| Step | State | Worker | Attempts | Checks |");
  expect(md).toContain("| Scripted harness |");
  expect(md).toContain("- alerts contains: '/p/' not found");
});
test("inputs, params and outputs are listed", () => {
  const md = renderRunReport(view({}));
  expect(md).toContain("- min\\_score: 7");
  expect(md).toContain('- alerts.jobs: \\[{"id":"j1"');
  expect(md).toContain("- not reported");
});
test("the report has the sections in order", () => {
  const md = renderRunReport(view({}));
  const at = [
    "## Summary",
    "## Inputs",
    "## Steps",
    "### Evidence",
    "## Items: review",
    "## Choices",
    "## Outputs",
    "## Usage",
    "## Audit",
  ].map((h) => md.indexOf(h));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});

test("usage reports step totals and escapes item keys", () => {
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
  const md = renderRunReport(view({ usage: rows }));
  expect(md).toContain("| a | 3 | 14 | 400 | 8454 | 156 | 4 | 5.3 | 0.4 |");
  expect(md).toContain("| Total | 3 | 14 | 400 | 8454 | 156 | 4 | 5.3 | 0.4 |");
  expect(renderRunReport(view({ usage: [{ ...(rows[0] as UsageEventRow), itemKey: "x|y" }] }))).toContain(
    "a@x\\|y",
  );
});

test("TC-j24-39 TC-SR1-48 outside decisions and audit records appear in report lines and audit markdown", () => {
  const base = view({ state: "waiting_approval" });
  const firstApproval = base.approvals.at(0);
  if (!firstApproval) throw new Error("missing approval");
  const outsideView: RunView = {
    ...base,
    approvals: [
      {
        ...firstApproval,
        id: "outside-1",
        kind: "outside_flow",
        effect: "run_command",
        summary: "alerts: Bash",
      },
    ],
    audit: [
      {
        at: "2026-11-21T00:00:00.000Z",
        kind: "call_held",
        runId: "run-1",
        detail: {
          approvalId: "outside-1",
          tool: "Bash",
          effect: "run_command",
          digest: "d1",
          hiddenCharacters: ["[U+200B hidden character]"],
        },
      },
      {
        at: "2026-11-21T00:00:01.000Z",
        kind: "decision_made",
        runId: "run-1",
        detail: { approvalId: "outside-1", decision: "approve", via: "window" },
      },
    ],
  };
  expect(reportLines(outsideView)[2]).toBe("Waiting for you: alerts: Bash");
  const md = renderRunReport(outsideView);
  expect(md).toContain("call\\_held");
  expect(md).toContain("\\[U+200B hidden character\\]");
  expect(md).toContain("decision\\_made");
  expect(md).not.toContain(String.fromCodePoint(0x200b));
});

test("TC-ENG-26 another way decision and outside retry appear in runs.report and audit markdown without text in audit", async () => {
  const { parseManifest } = await import("@flowdriven/sdk");
  const { digestCall } = await import("./connectors/grants.ts");
  const { scriptedHarness } = await import("./scripted-harness.ts");
  const { openSqliteStore } = await import("./sqlite-store.ts");
  const { createRunnerService } = await import("./service/service.ts");
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.report-aw",
    name: "Report another way",
    kind: "build",
    steps: [
      {
        id: "work",
        title: "Work",
        do: "worker",
        instructions: "Work",
        checks: [{ type: "contains", pattern: "ok" }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  const store = await openSqliteStore(":memory:");
  const tool = "WebFetch";
  const input = { url: "https://example.test" };
  const harness = scriptedHarness({
    steps: {
      work: (req) =>
        req.anotherWay
          ? { text: "ok" }
          : {
              hold: {
                requirementId: tool,
                tool,
                input,
                digest: digestCall(tool, input),
                effect: "read",
                outsideFlow: true,
              },
            },
    },
  });
  const service = createRunnerService({
    store,
    dataDir: ".",
    mode: "demo",
    harness,
    now: () => new Date("2026-11-22T00:00:00Z"),
  });
  try {
    service.engine.registerFlow(parsed.manifest, `sha256:${"a".repeat(64)}`);
    const run = await service.engine.startRun(parsed.manifest.id, { project: "." });
    const row = store.listApprovals({ runId: run.id, state: "pending" }).at(0);
    if (!row) throw new Error("missing approval");
    const words = "Skip fetching and write the summary.";
    await service.call("approvals.resolve", {
      approvalId: row.id,
      decision: "another_way",
      anotherWayText: words,
    });
    await vi.waitFor(() => expect(store.getRun(run.id)?.state).toBe("done"));
    const finalView = service.engine.getRun(run.id);
    expect(reportLines(finalView)).toEqual([
      "Report another way: done. 1 of 1 steps passed.",
      "Items: 0 processed, 0 skipped as seen, 0 failed.",
      "Nothing needs your attention.",
    ]);
    expect(await service.call("runs.report", { runId: run.id })).toMatchObject({
      runId: run.id,
      decisionLines: [
        { key: "report.anotherWay", params: { text: words } },
        { key: "report.didAnotherWay", params: { text: words } },
      ],
    });
    const md = renderRunReport(finalView);
    expect(md).toContain("decision\\_made");
    expect(md).toContain("another\\_way");
    expect(md).not.toContain(words);
  } finally {
    service.stop();
    store.close();
  }
});
