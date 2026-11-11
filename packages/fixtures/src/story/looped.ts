import {
  approvalExpiresAt,
  type LeafStep,
  type LeafStepRun,
  type Step,
  type StepRunState,
} from "@flowdriven/contracts";
import type { FixtureState } from "../state";
import { makeFlow } from "./flows";
import { readiness } from "./readiness";

export function addLooped(state: FixtureState): void {
  const flow = makeFlow(
    "job-review",
    "Job alert review",
    "light",
    "0.1.0",
    [],
    [["worker", "harness", "claude-code"]],
    7,
  );
  const leaf = (
    id: string,
    title: string,
    kind: "worker" | "agent",
    type: "schema" | "contains" | "not_contains",
    summary: string,
  ): LeafStep => ({
    id,
    title,
    do: kind,
    instructions: title,
    uses: ["worker"],
    outputs: [],
    checks: [{ type, required: true, summary }],
    retry: 2,
  });
  const alerts = leaf("alerts", "List the new alerts", "worker", "schema", "The alerts are a list of jobs");
  alerts.outputs = [{ id: "jobs", type: "json" }];
  const rough = leaf("rough", "Score the job", "agent", "schema", "The score is valid");
  rough.outputs = [{ id: "score", type: "json" }];
  const page = {
    ...leaf("page", "Read the full post", "worker", "contains", "The full post is present"),
    when: "rough.score.value >= params.min_score",
  };
  const full = {
    ...leaf("full", "Decide fit", "agent", "schema", "The verdict is valid"),
    when: "page.passed",
    outputs: [{ id: "verdict", type: "json" as const }],
  };
  const proto = leaf("proto", "Build a prototype", "worker", "contains", "The prototype is present");
  const proposal = leaf(
    "proposal",
    "Draft the proposal",
    "worker",
    "not_contains",
    "The proposal has no placeholders",
  );
  proposal.checks.push({ type: "user", required: true, summary: "You approve the proposal" });
  const question = "Which jobs get a prototype?";
  const steps: Step[] = [
    alerts,
    {
      id: "review",
      title: "Review every alert",
      do: "loop",
      instructions: "",
      uses: [],
      outputs: [],
      checks: [],
      retry: 2,
      loop: {
        for_each: "${steps.alerts.outputs.jobs}",
        as: "job",
        key: "${job.id}",
        max: 20,
        on_item_fail: "skip",
        steps: [rough, page, full],
      },
    },
    {
      id: "pick",
      title: "Pick jobs",
      do: "ask",
      instructions: question,
      uses: [],
      outputs: [],
      checks: [],
      retry: 2,
      ask: {
        question,
        choose_from: "${steps.review.items where steps.full.outputs.verdict.fit}",
        max_pick: 2,
        approves: [],
        expires: "24h",
        on_expiry: "end",
      },
    },
    {
      id: "build",
      title: "Build and propose",
      do: "loop",
      instructions: "",
      uses: [],
      outputs: [],
      checks: [],
      retry: 2,
      loop: {
        for_each: "${steps.pick.outputs.choice}",
        as: "job",
        key: "${job.id}",
        on_item_fail: "skip",
        steps: [proto, proposal],
      },
    },
  ];
  Object.assign(flow.manifest, {
    format: "flowdriven-flow/1.1",
    summary: "Review new job alerts, pick the best and draft proposals.",
    steps,
    params: { min_score: { type: "number", default: 7 } },
    triggers: [{ kind: "manual", summary: "Run by hand" }],
  });
  const requirement = flow.manifest.requirements.at(0);
  if (requirement) requirement.why = "Does the scoring and the drafting.";
  flow.playback = {
    goal: "Review new job alerts and prototype the best ones.",
    touches: ["claude-code"],
    asksApprovalFor: ["Each proposal before it counts as done"],
  };
  state.flows.push(flow);
  Object.assign(state.readiness, readiness([flow]));
  const startedAt = "2026-11-10T09:10:00.000Z";
  const runStep = (step: LeafStep, status: StepRunState, note?: string): LeafStepRun => ({
    stepId: step.id,
    title: step.title,
    do: step.do,
    state: status,
    ...(status === "passed" || status === "failed"
      ? { worker: { harnessId: "claude-code", name: "Claude Code" } }
      : {}),
    attempts:
      status === "passed" || status === "failed"
        ? [{ number: 1, startedAt, endedAt: startedAt, exit: status === "passed" ? "ok" : "failed" }]
        : [],
    maxAttempts: step.retry + 1,
    checks: step.checks.map((check) => ({
      ...check,
      verdict: status === "passed" ? "passed" : status === "failed" ? "failed" : "pending",
    })),
    ...(note ? { note } : {}),
  });
  const review = steps.at(1);
  const pick = steps.at(2);
  const build = steps.at(3);
  if (!review || !pick || !build) throw new Error("Missing looped scenario step");
  state.runs.push({
    id: "run-0008",
    flowId: flow.manifest.id,
    flowName: flow.manifest.name,
    flowVersion: flow.manifest.version,
    oneTime: false,
    project: "~/Projects/jobs",
    state: "waiting_approval",
    startedAt,
    inputs: [],
    outputs: [],
    usage: [],
    estimatedCostUsd: 0,
    approvalIds: ["ap-0017"],
    steps: [
      runStep(alerts, "passed"),
      {
        ...runStep(review, "passed"),
        items: [
          {
            key: "j1",
            label: "Job one",
            state: "passed",
            steps: [runStep(rough, "passed"), runStep(page, "passed"), runStep(full, "passed")],
          },
          {
            key: "j2",
            label: "Job two",
            state: "passed",
            steps: [
              runStep(rough, "passed"),
              runStep(page, "skipped", "skipped: condition false"),
              runStep(full, "skipped", "skipped: condition false"),
            ],
          },
          {
            key: "j3",
            label: "Job three",
            state: "failed",
            note: "The score was missing.",
            steps: [runStep(rough, "failed", "The score was missing.")],
          },
          {
            key: "j4",
            label: "Job four",
            state: "skipped",
            skip: "seen",
            note: "skipped: seen in an earlier run",
            steps: [],
          },
          {
            key: "j5",
            label: "Job five",
            state: "skipped",
            skip: "capped",
            note: "skipped: over the item cap",
            steps: [],
          },
        ],
      },
      runStep(pick, "waiting_approval"),
      runStep(build, "pending"),
    ],
  });
  const createdAt = "2026-11-10T09:28:00.000Z";
  state.approvals.push({
    id: "ap-0017",
    kind: "ask",
    flowId: flow.manifest.id,
    flowName: flow.manifest.name,
    runId: "run-0008",
    stepId: "pick",
    stepTitle: "Pick jobs",
    summary: question,
    payload: {
      kind: "choice",
      question,
      options: [
        { key: "j1", label: "Job one" },
        { key: "j2", label: "Job two" },
      ],
      maxPick: 2,
    },
    editable: false,
    createdAt,
    expiresAt: approvalExpiresAt(createdAt),
    state: "pending",
  });
  state.nextRunNumber = 9;
  state.nextHashNumber = 8;
}
