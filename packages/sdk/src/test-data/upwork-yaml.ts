export const upworkYaml = `format: flowdriven-flow/1.1
id: local.upwork-job-review
name: Upwork job review
kind: light
params:
  min_score: {type: number, default: 7}
  daily_builds: {type: number, default: 2}
triggers:
  - {kind: schedule, every: 1h, catch_up: once, overlap: skip}
limits: {max_runs_per_day: 24, max_items: 20}
requirements:
  - {id: gmail, type: mcp_server, ref: connector:gmail, connect: native, sensitive: true,
     tools: [search_threads, get_thread, label_thread]}
  - {id: jobs_web, type: web, mode: read, session: own, sensitive: true,
     url_patterns: ["https://www.upwork.com/jobs/~{id:[0-9a-z]{18,24}}"],
     rate: {per_run: 3, per_day: 10}, on_challenge: stop}
  - {id: builder, type: skill, ref: claude-code:prototype-builder}
  - {id: host, type: mcp_server, ref: connector:prototype-host, connect: native,
     tools: [project_create, prototype_upload, prototype_publish]}
  - {id: data, type: path, ref: ~/job-review, access: read_write}
steps:
  - id: alerts
    do: worker
    uses: [gmail]
    instructions: List Upwork job alerts from donotreply@upwork.com since the last run as JSON.
    outputs: [{id: jobs, type: json}]
    checks: [{type: schema, file: checks/alerts.schema.json}]
  - id: review
    for_each: \${steps.alerts.outputs.jobs}
    as: job
    key: \${job.id}
    max: 20
    steps:
      - {id: rough, do: agent, instructions: "Score \${job} 0-10 against profile.md, with reasons.",
         outputs: [{id: score, type: json}], checks: [{type: schema, file: checks/score.schema.json}]}
      - {id: page, do: worker, uses: [jobs_web], when: "rough.score.value >= params.min_score",
         instructions: "Open the jobs_web URL for id \${job.id}; return the full post text.",
         checks: [{type: contains, pattern: "\${job.title_start}"}]}
      - {id: full, do: agent, when: page.passed, instructions: "Score the full post; fit yes or no.",
         outputs: [{id: verdict, type: json}], checks: [{type: schema, file: checks/verdict.schema.json}]}
  - id: pick
    do: ask
    ask: {question: "Which jobs get a prototype?", max_pick: "\${params.daily_builds}", expires: 24h,
          choose_from: "\${steps.review.items where steps.full.outputs.verdict.fit}",
          approves: [host.prototype_publish]}
  - id: build
    for_each: \${steps.pick.outputs.choice}
    as: job
    steps:
      - {id: proto, do: skill, skill: builder, uses: [builder, host, data], limits: {max_duration: 150m},
         instructions: "Build and publish the prototype for \${job}.", checks: [{type: contains, pattern: "/p/"}]}
      - {id: proposal, do: worker, uses: [data], instructions: "Draft the proposal in voice.md, max 150 words.",
         checks: [{type: not_contains, patterns: ["@", "whatsapp", "telegram"]}, {type: judge, rubric: checks/human.md}, {type: user}]}
`;
