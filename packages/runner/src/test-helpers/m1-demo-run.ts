import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFlowFolder } from "@flowdriven/sdk/node";
import { CONNECTORS } from "../connectors/catalog.ts";
import { M1_FLOW_DIR } from "../demo/m1-flow.ts";
import { createCapabilities } from "../service/capabilities.ts";
import { createRunnerService } from "../service/service.ts";
import { readSkillFolder } from "../skills/skill-folder.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  type FakePlay,
  readFakeCalls,
  writeFakeScript,
} from "./fake-claude-script.ts";

const jobs = ["abcdefghijklmnopqr", "bcdefghijklmnopqrs", "cdefghijklmnopqrst"].map((id, i) => ({
  id,
  title: `Job ${i + 1}`,
  title_start: `Job ${i + 1}`,
  budget: "Budget",
  snippet: "A job",
}));
const first =
  jobs[0] ??
  (() => {
    throw new Error("Missing first job");
  })();
const second =
  jobs[1] ??
  (() => {
    throw new Error("Missing second job");
  })();
const commands = [
  "flutter create --platforms web --project-name prototype --empty --offline .",
  "flutter create --platforms web --project-name prototype --empty .",
  "flutter pub get",
  "dart format lib test",
  "flutter analyze",
  "flutter test",
  "flutter build web --release",
];
const structured = (outputs: Record<string, unknown>): FakeAction => ({
  do: "result",
  structured: { report: "Done", outputs },
});
const chrome = (id: string, name: string, input: Record<string, unknown>): FakeAction => ({
  do: "tool",
  id,
  name: `mcp__claude-in-chrome__${name}`,
  input,
});

export async function runM1Demo(): Promise<string[]> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "m1-demo-home-")));
  const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "m1-demo-data-")));
  const project = join(dataDir, "project");
  const work = join(home, "job-review/work");
  const build = join(home, "job-review/prototypes", first.id);
  const skill = join(home, ".claude/skills/prototype-builder");
  for (const dir of [
    project,
    skill,
    join(home, "job-review/notes"),
    join(work, "proposals"),
    join(build, "build/web"),
  ])
    mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: prototype-builder\ndescription: Builds prototypes\nallowed-tools: Bash\n---\nBuild a prototype.\n",
  );
  writeFileSync(join(home, "job-review/notes/profile.md"), "Builds web apps.\n");
  const gmail = CONNECTORS.find((entry) => entry.ref === "connector:gmail");
  if (!gmail) throw new Error("Missing Gmail");
  const pages = Object.fromEntries(
    [first, second].map((job) => [
      `https://www.upwork.com/jobs/~${job.id}`,
      { title: job.title, text: `${job.title} full post` },
    ]),
  );
  const gmailCall: FakeAction = {
    do: "tool",
    id: "gmail-search",
    name: `${gmail.prefix}search_threads`,
    input: { query: "alerts" },
    result: "Three alerts",
  };
  const plays: FakePlay[] = [
    {
      when: "You are a reviewer for FlowDriven",
      actions: [
        { do: "result", structured: { verdict: "passed", reasons: "Specific", evidence: "Proposal" } },
      ],
    },
    { when: "Search Gmail for", actions: [gmailCall, structured({ jobs })] },
    { when: "Write the short", actions: [structured({ plan: "Build a small dashboard." })] },
    {
      when: "The user approved the plan below",
      actions: [
        ...commands.map(
          (command, i): FakeAction => ({
            do: "tool",
            id: `build-${i}`,
            name: "Bash",
            input: { command, timeout: 600000 },
          }),
        ),
        ...[
          ["index.html", "<html>Demo</html>"],
          ["main.dart.js", "x".repeat(100001)],
        ].map(([file, text], i): FakeAction => {
          if (file === undefined || text === undefined) throw new Error("Missing build file");
          const path = join(build, "build/web", file);
          return {
            do: "tool",
            id: `write-${i}`,
            name: "Write",
            input: { file_path: path, content: text },
            write: { path, text },
          };
        }),
        { do: "result", result: "Built" },
      ],
    },
    {
      when: "Draft the proposal for this job",
      actions: [
        {
          do: "tool",
          id: "proposal-write",
          name: "Write",
          input: { file_path: join(work, "proposals", `${first.id}.md`), content: "Proposal __LINK__" },
          write: { path: join(work, "proposals", `${first.id}.md`), text: "Proposal __LINK__" },
        },
        { do: "result", result: "Proposal __LINK__" },
      ],
    },
    ...[first, second].map(
      (job): FakePlay => ({
        when: `Open the jobs_web address for id ${job.id}`,
        actions: [
          chrome(`context-${job.id}`, "tabs_context_mcp", { createIfEmpty: true }),
          chrome(`navigate-${job.id}`, "navigate", {
            tabId: 1001,
            url: `https://www.upwork.com/jobs/~${job.id}`,
          }),
          chrome(`read-${job.id}`, "get_page_text", { tabId: 1001 }),
          structured({ post: `${job.title} full post` }),
        ],
      }),
    ),
    ...[first, second].map(
      (job, i): FakePlay => ({
        when: `${job.title} full post`,
        actions: [structured({ verdict: { fit: i === 0, reasons: "Reviewed" } })],
      }),
    ),
    ...jobs.map(
      (job, i): FakePlay => ({
        when: job.title,
        actions: [structured({ score: { value: i < 2 ? 8 : 3, reasons: "Scored" } })],
      }),
    ),
  ];
  writeFakeScript(home, {
    chrome: true,
    pages,
    connectors: {
      [gmail.name]: {
        url: gmail.url,
        id: `mcpsrv_${"a".repeat(24)}`,
        tools: [
          ...gmail.read.map((name) => ({ name, readOnly: true })),
          ...(gmail.write ?? []).map((name) => ({ name, readOnly: false })),
        ],
      },
    },
    plays,
  });
  const store = await openSqliteStore(":memory:");
  let id = 0;
  const service = createRunnerService({
    store,
    dataDir,
    mode: "live",
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now: () => new Date("2026-11-18T00:00:00Z"),
    newId: (prefix) => `${prefix}-${++id}`,
    keeper: {
      probes: {
        refresh: async () => {},
        availableMb: () => 8000,
        pressureLevel: () => 1,
        groupRssMb: () => undefined,
        totalMb: () => 16000,
      },
      every: () => () => {},
    },
    triggers: { dayOf: () => "2026-11-18", every: () => () => {}, watch: () => () => {} },
  });
  try {
    await service.start().settled;
    await service.call("agents.rescan", {});
    await service.call("settings.update", { patch: { agentPermission: "on" } });
    const flow = loadFlowFolder(M1_FLOW_DIR);
    service.engine.registerFlow(
      flow.manifest,
      flow.hash,
      Object.fromEntries([...flow.files].map(([key, value]) => [key, new TextDecoder().decode(value)])),
    );
    const caps = createCapabilities({
      store,
      now: () => new Date("2026-11-18T00:00:00Z"),
      home,
      dataDir,
      readSkill: () => readSkillFolder(skill, "prototype-builder"),
      facts: () => ({
        hooks: true,
        chrome: true,
        skills: ["prototype-builder"],
        connectors: [
          {
            name: gmail.name,
            url: gmail.url,
            status: "connected",
            tools: [
              ...gmail.read.map((name) => ({ name, readOnly: true })),
              ...(gmail.write ?? []).map((name) => ({ name, readOnly: false })),
            ],
          },
        ],
      }),
    });
    const preview = caps.get(flow.manifest.id);
    const pins = Object.fromEntries(
      preview.rows.flatMap((row): [string, string][] =>
        row.pin === undefined ? [] : [[row.requirementId, row.pin]],
      ),
    );
    caps.allow(flow.manifest.id, flow.hash, pins);
    const run = await service.engine.startRun(flow.manifest.id, { project, params: { newest: 3 } });
    const pending = () => {
      const approval = store.listApprovals({ runId: run.id, state: "pending" }).at(0);
      if (!approval)
        throw new Error(
          `Missing approval: ${JSON.stringify({ run: store.getRun(run.id), steps: store.listSteps(run.id), audit: store.listAudit(run.id) })}`,
        );
      return approval;
    };
    await service.engine.answerAsk(pending().id, { picks: [first.id] });
    await service.engine.decide(pending().id, "approve");
    await service.engine.decide(pending().id, "approve");
    const rows = store.listSteps(run.id);
    const audit = store.listAudit(run.id);
    const approvals = store.listApprovals({ runId: run.id });
    const calls = readFakeCalls(home);
    const buildCall = calls.find(
      (call) => call.kind === "call" && call.prompt?.includes("The user approved the plan below"),
    );
    const skillCopy =
      buildCall?.kind === "call"
        ? Object.values(buildCall.skillFiles ?? {}).find((text) => text.startsWith("---"))
        : undefined;
    const bash = calls.filter((call) => call.kind === "tool" && call.name === "Bash");
    const secondRun = await service.engine.startRun(flow.manifest.id, { project, params: { newest: 3 } });
    const secondRows = store.listSteps(secondRun.id);
    const count = (step: string) =>
      rows.filter((row) => row.stepId === step && row.state === "passed").length;
    const fit = rows.filter(
      (row) =>
        row.stepId === "full" &&
        typeof row.outputs.verdict === "object" &&
        row.outputs.verdict !== null &&
        !Array.isArray(row.outputs.verdict) &&
        row.outputs.verdict.fit === true,
    ).length;
    const firstJobs = store.getStep(run.id, "alerts")?.outputs.jobs;
    const secondJobs = store.getStep(secondRun.id, "alerts")?.outputs.jobs;
    return [
      `alerts: ${Array.isArray(firstJobs) ? firstJobs.length : 0} jobs`,
      `scored: ${count("rough")}, pages read: ${audit.filter((row) => row.kind === "page_read").length}`,
      `fit: ${fit}`,
      `pick: ${store.listItems(run.id, "build").length} job`,
      `plan: ${audit.some((row) => row.kind === "own_text_approved") ? "approved as your own words" : "not approved"}`,
      `skill copy: ${skillCopy && /^---\nname: [^\n]+\ndescription: [^\n]+\n---\n/.test(skillCopy) ? "name and description only" : "unexpected front matter"}`,
      `build: ${buildCall?.kind === "call" && buildCall.cwd === build ? bash.filter((call) => call.kind === "tool" && call.ran).length : 0} commands allowed in the job's folder, ${bash.filter((call) => call.kind === "tool" && !call.ran).length} refused`,
      `proposal: ${count("proposal") === 1 && approvals.some((a) => a.stepId === "proposal" && a.state === "approved") ? "passed checks and your sign-off" : "not passed"}`,
      `run: ${store.getRun(run.id)?.state ?? "missing"}`,
      `sends: ${calls.filter((call) => call.kind === "tool" && /send|reply|forward/i.test(call.name)).length}, held calls: ${approvals.filter((a) => a.kind === "risky_action").length}`,
      `second run: ${Array.isArray(secondJobs) ? secondJobs.length : 0} jobs seen, ${secondRows.filter((row) => row.stepId === "rough" && row.state === "passed").length} scored`,
    ];
  } finally {
    service.stop();
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
}
