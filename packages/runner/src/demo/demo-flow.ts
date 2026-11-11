import { type FlowManifest, parseManifest } from "@flowdriven/sdk";

export function demoFlow(): { manifest: FlowManifest; files: Record<string, string> } {
  const parsed = parseManifest({
    format: "flowdriven-flow/1.1",
    id: "local.sample-job-review",
    name: "Sample job review",
    kind: "light",
    params: { min_score: { type: "number", default: 7 } },
    steps: [
      {
        id: "alerts",
        do: "worker",
        instructions: "List the new job alerts as JSON.",
        outputs: [{ id: "jobs", type: "json" }],
        checks: [{ type: "schema", file: "checks/alerts.schema.json" }],
      },
      {
        id: "review",
        for_each: "${steps.alerts.outputs.jobs}",
        as: "job",
        key: "${job.id}",
        max: 20,
        steps: [
          {
            id: "rough",
            do: "agent",
            instructions: "Score ${job} 0-10.",
            outputs: [{ id: "score", type: "json" }],
            checks: [{ type: "schema", file: "checks/score.schema.json" }],
          },
          {
            id: "page",
            do: "worker",
            instructions: "Open the post for ${job}; return the full text.",
            when: "rough.score.value >= params.min_score",
            checks: [{ type: "contains", pattern: "${job.title}" }],
          },
          {
            id: "full",
            do: "agent",
            instructions: "Decide fit for ${job}.",
            when: "page.passed",
            outputs: [{ id: "verdict", type: "json" }],
            checks: [{ type: "schema", file: "checks/verdict.schema.json" }],
          },
        ],
      },
      {
        id: "pick",
        do: "ask",
        ask: {
          question: "Which jobs get a prototype?",
          max_pick: 1,
          choose_from: "${steps.review.items where steps.full.outputs.verdict.fit}",
        },
      },
      {
        id: "build",
        for_each: "${steps.pick.outputs.choice}",
        as: "job",
        key: "${job.id}",
        steps: [
          {
            id: "proto",
            do: "worker",
            instructions: "Build and publish the prototype for ${job}.",
            checks: [{ type: "contains", pattern: "/p/" }],
          },
          {
            id: "proposal",
            do: "worker",
            instructions: "Draft the proposal for ${job}, at most 150 words.",
            checks: [{ type: "not_contains", pattern: "@" }, { type: "user" }],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    manifest: parsed.manifest,
    files: {
      "checks/alerts.schema.json": '{"type":"array","items":{"type":"object","required":["id","title"]}}',
      "checks/score.schema.json":
        '{"type":"object","required":["value"],"properties":{"value":{"type":"number"}}}',
      "checks/verdict.schema.json":
        '{"type":"object","required":["fit"],"properties":{"fit":{"type":"boolean"}}}',
    },
  };
}
