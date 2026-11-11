import { Approval, FlowManifest, RunDetail } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { createFixtureRunnerClient } from "./client";
import { buildLooped, buildStory } from "./state";

test("the looped scenario adds one flow, one waiting run and one pending choice and leaves the story alone", () => {
  const state = buildLooped();
  expect(state.flows).toHaveLength(6);
  expect(state.runs).toHaveLength(8);
  expect(state.runs.find((run) => run.id === "run-0008")?.state).toBe("waiting_approval");
  expect(state.approvals.filter((approval) => approval.state === "pending")).toHaveLength(6);
  expect(buildStory().flows).toHaveLength(5);
});

test("its flow validates and shows a loop, a condition and an ask", () => {
  const flow = buildLooped().flows.find((record) => record.manifest.id === "dev.example.job-review");
  const manifest = FlowManifest.parse(flow?.manifest);
  expect(manifest.steps.map((step) => step.do)).toEqual(["worker", "loop", "ask", "loop"]);
  expect(
    manifest.steps.find((step) => step.id === "review")?.loop?.steps.find((step) => step.id === "page")?.when,
  ).toBe("rough.score.value >= params.min_score");
});

test("its run shows items in several states and the choice waiting", () => {
  const run = RunDetail.parse(buildLooped().runs.find((item) => item.id === "run-0008"));
  const items = run.steps.find((step) => step.stepId === "review")?.items;
  expect(items?.map((item) => item.state)).toEqual(["passed", "passed", "failed", "skipped", "skipped"]);
  expect(items?.slice(-2).map((item) => item.skip)).toEqual(["seen", "capped"]);
  expect(run.steps.find((step) => step.stepId === "pick")?.state).toBe("waiting_approval");
});

test("its choice validates and is the newest waiting decision", async () => {
  const client = createFixtureRunnerClient({ scenario: "looped" });
  const approvals = await client.call("approvals.list", { state: "pending" });
  const choice = Approval.parse(approvals.at(0));
  expect(choice.id).toBe("ap-0017");
  expect(choice.kind).toBe("ask");
  expect(choice.payload).toEqual({
    kind: "choice",
    question: "Which jobs get a prototype?",
    options: [
      { key: "j1", label: "Job one" },
      { key: "j2", label: "Job two" },
    ],
    maxPick: 2,
  });
});

test("runs.export of the looped run lists its items", async () => {
  const client = createFixtureRunnerClient({ scenario: "looped" });
  expect((await client.call("runs.export", { runId: "run-0008" })).markdown).toContain("  - j3: failed");
});
