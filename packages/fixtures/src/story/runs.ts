import type { RunDetail, StepRun, StepRunState } from "@flowdriven/contracts";
import type { FlowRecord } from "../state";

export function runs(flows: FlowRecord[]): RunDetail[] {
  function run(
    index: number,
    id: string,
    state: RunDetail["state"],
    startedAt: string,
    project: string,
    states: StepRunState[],
  ): RunDetail {
    const flow = flows[index];
    if (!flow) throw new Error("Missing sample flow");
    const steps: StepRun[] = flow.manifest.steps.map((s, i) => {
      const stepState = states[i] ?? "pending";
      return {
        stepId: s.id,
        title: s.title,
        do: s.do,
        state: stepState,
        attempts: stepState === "passed" ? [{ number: 1, startedAt, endedAt: startedAt, exit: "ok" }] : [],
        maxAttempts: s.retry + 1,
        checks: s.checks.map((c) => ({
          ...c,
          verdict: stepState === "passed" ? "passed" : stepState === "failed" ? "failed" : "pending",
        })),
      };
    });
    return {
      id,
      flowId: flow.manifest.id,
      flowName: flow.manifest.name,
      flowVersion: flow.manifest.version,
      oneTime: false,
      project,
      state,
      startedAt,
      inputs: [],
      steps,
      approvalIds: [],
      outputs: [],
      usage: [],
      estimatedCostUsd: 0,
    };
  }
  const email = run(
    2,
    "run-0007",
    "waiting_approval",
    "2026-11-10T09:00:00.000Z",
    "~/Projects/support-inbox",
    ["passed", "passed", "passed", "passed", "waiting_approval"],
  );
  email.approvalIds = ["ap-0011", "ap-0012", "ap-0013"];
  const figma = run(1, "run-0006", "blocked", "2026-11-10T08:40:00.000Z", "~/Projects/shop-app", [
    "passed",
    "passed",
    "failed",
    "pending",
    "pending",
  ]);
  figma.blockedReason =
    "Build the screens: flutter analyze still fails after 4 attempts and one re-plan. Fix the errors or change the step, then resume.";
  const build = figma.steps[2];
  if (build) {
    build.worker = { harnessId: "codex", name: "Codex" };
    build.attempts = [1, 2, 3, 4].map((number) => ({
      number,
      startedAt: "2026-11-10T08:45:00.000Z",
      endedAt: "2026-11-10T08:46:00.000Z",
      exit: "failed",
    }));
    build.note = "The brain re-planned this step once; it still failed.";
    const [analyze, test, files] = build.checks;
    if (analyze && test && files) {
      analyze.evidence = [
        "flutter analyze: 3 errors",
        "lib/screens/home.dart: missing parameter",
        "lib/screens/cart.dart: undefined name",
        "lib/screens/app.dart: invalid type",
        "Analysis failed.",
      ].join("\n");
      test.evidence = [
        "flutter test: 2 failed, 14 passed",
        ...Array.from({ length: 19 }, (_, i) => `Test output line ${i + 2}`),
      ].join("\n");
      files.verdict = "passed";
    }
  }
  const docs = run(
    0,
    "run-0005",
    "done",
    "2026-11-10T08:00:00.000Z",
    "~/Reports/q3-suppliers",
    Array(6).fill("passed"),
  );
  docs.endedAt = "2026-11-10T08:12:00.000Z";
  docs.report = {
    runId: docs.id,
    lines: [
      "Built the Q3 supplier report from 14 files in ~/Reports/q3-suppliers.",
      "Produced report.docx and report.md.",
      "Nothing needs a look.",
    ],
    saveOffer: false,
  };
  docs.reportFirstLine = docs.report.lines[0];
  docs.usage = [
    { harnessId: "codex", name: "Codex", calls: 6, tokens: 48210, wallSeconds: 412 },
    {
      harnessId: "anthropic-api",
      name: "Anthropic API key",
      calls: 2,
      tokens: 9120,
      wallSeconds: 31,
      estimatedCostUsd: 0.42,
    },
  ];
  docs.estimatedCostUsd = 0.42;
  docs.approvalIds = ["ap-0010"];
  const social = run(
    4,
    "run-0004",
    "waiting_approval",
    "2026-11-09T16:00:00.000Z",
    "~/Projects/launch-content",
    ["passed", "passed", "skipped", "passed", "waiting_approval", "pending"],
  );
  social.approvalIds = ["ap-0014"];
  const media = social.steps[2];
  if (media) media.note = "Skipped: no media requested for this run.";
  const leads = run(3, "run-0003", "interrupted", "2026-11-09T08:00:00.000Z", "~/Projects/sales-leads", [
    "passed",
    "passed",
    "interrupted",
    "pending",
    "pending",
  ]);
  leads.flowVersion = "1.2.0";
  const draft = leads.steps[2];
  if (draft) draft.note = "The runner stopped at 08:02. Nothing was sent.";
  const once = run(0, "run-0002", "done", "2026-11-08T15:00:00.000Z", "~/Desktop/Screenshots", [
    "passed",
    "passed",
    "passed",
  ]);
  once.flowId = "one-time-0002";
  once.flowName = "Rename screenshots by date";
  once.flowVersion = "1.0.0";
  once.oneTime = true;
  const oneTimeSteps = once.steps.slice(0, 3);
  once.steps = oneTimeSteps.map((s, i) => ({
    ...s,
    stepId: ["find-screenshots", "rename", "write-log"][i] ?? "write-log",
    title: ["Find screenshots", "Rename screenshots", "Write the rename log"][i] ?? "Write the rename log",
  }));
  once.report = {
    runId: once.id,
    lines: [
      "Renamed 37 screenshots in ~/Desktop/Screenshots by the date they were taken.",
      "Produced a rename log: rename-log.md.",
      "Nothing needs a look.",
    ],
    saveOffer: true,
  };
  once.reportFirstLine = once.report.lines[0];
  const failed = run(0, "run-0001", "failed", "2026-11-07T10:00:00.000Z", "~/Reports/q3-suppliers", [
    "passed",
    "passed",
    "passed",
    "passed",
    "passed",
    "failed",
  ]);
  failed.approvalIds = ["ap-0009"];
  const finalCheck = failed.steps[5]?.checks[0];
  if (finalCheck)
    finalCheck.evidence = "You rejected the final report: “Section 3 uses last year's numbers.”";
  return [email, figma, docs, social, leads, once, failed];
}
