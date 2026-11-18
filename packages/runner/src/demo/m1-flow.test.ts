import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "@flowdriven/sdk";
import { loadFlowFolder } from "@flowdriven/sdk/node";
import { afterEach, expect, test } from "vitest";
import { buildPolicy } from "../claude/policy.ts";
import { CONNECTORS } from "../connectors/catalog.ts";
import { createEngine } from "../engine.ts";
import { commandRefusal } from "../router/commands-route.ts";
import { routeRequirement } from "../router/route.ts";
import { scriptedHarness } from "../scripted-harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { M1_FLOW_DIR } from "./m1-flow.ts";

const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const load = () => loadFlowFolder(M1_FLOW_DIR);
const id = "abcdefghijklmnopqr";
const job = {
  id,
  title: "Unique job title",
  title_start: "Unique job title",
  budget: "Unique budget",
  snippet: "Unique snippet",
};
const plan = "Approved plan: make a small dashboard.";
const commands = [
  "flutter create --platforms web --project-name prototype --empty --offline .",
  "flutter create --platforms web --project-name prototype --empty .",
  "flutter pub get",
  "dart format lib test",
  "flutter analyze",
  "flutter test",
  "flutter build web --release",
];
const gmail = CONNECTORS.find((entry) => entry.ref === "connector:gmail");
if (!gmail) throw new Error("Missing Gmail");
const facts = {
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
        ...Object.keys(gmail.risky).map((name) => ({ name, readOnly: false })),
      ],
    },
  ],
};
async function run(newest?: number) {
  const flow = load();
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "m1-flow-")));
  dirs.push(dir);
  mkdirSync(join(dir, "build", "web"), { recursive: true });
  writeFileSync(join(dir, "build", "web", "index.html"), "x");
  writeFileSync(join(dir, "build", "web", "main.dart.js"), "x".repeat(100000));
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const harness = scriptedHarness({
    steps: {
      alerts: { outputs: { jobs: [job] }, outside: true },
      rough: { outputs: { score: { value: 9, reasons: "Good match" } } },
      page: { outputs: { post: "Unique job title and full post" }, outside: true },
      full: { outputs: { verdict: { fit: true, reasons: "Good fit" } } },
      plan: { outputs: { plan }, outside: true },
      proto: { text: "Built" },
      proposal: { text: "Proposal __LINK__" },
    },
    judge: () => ({ verdict: "passed", reasons: "Good", evidence: "Proposal" }),
  });
  let seq = 0;
  const engine = createEngine({ store, harness, newId: (prefix) => `${prefix}-${++seq}` });
  engine.registerFlow(
    flow.manifest,
    flow.hash,
    Object.fromEntries([...flow.files].map(([k, v]) => [k, new TextDecoder().decode(v)])),
  );
  const result = await engine.startRun(flow.manifest.id, {
    project: dir,
    ...(newest === undefined ? {} : { params: { newest } }),
  });
  return { engine, harness, result };
}

test("the M1 folder loads with loadFlowFolder and has no error issues", () => {
  expect(load().issues.filter((issue) => issue.severity === "error")).toEqual([]);
});
test("R4: nothing risky runs before the pick, proto has retry 0, and build stops after a failed item", () => {
  const flow = load();
  expect(
    validateManifest(flow.manifest, { files: new Set(flow.files.keys()) }).filter(
      (i) => i.severity === "error",
    ),
  ).toEqual([]);
  const build = flow.manifest.steps.find((s) => s.id === "build");
  if (!build || !("for_each" in build)) throw new Error("Missing build loop");
  expect(build.on_item_fail).toBe("stop");
  expect(build.steps.find((s) => s.id === "proto")).toMatchObject({ retry: 0 });
});
test("the flow declares no send tool and no connector but Gmail, and the pick approves no tool", () => {
  const manifest = load().manifest;
  const connectors = manifest.requirements.filter((r) => r.type === "mcp_server");
  expect(connectors.map((r) => r.ref)).toEqual(["connector:gmail"]);
  expect(connectors.flatMap((r) => (r.type === "mcp_server" ? r.tools : []))).not.toContainEqual(
    expect.stringMatching(/send|reply|forward/i),
  );
  expect(manifest.steps.find((s) => s.id === "pick")).toMatchObject({ ask: { approves: [] } });
});
test("the M1 flow routes every requirement with facts that list the Gmail connector and the skill", () => {
  for (const req of load().manifest.requirements)
    expect(routeRequirement(req, facts), req.id).toMatchObject({ routed: true });
});
test("a run started with params newest 3 asks the alerts step for at most 3 jobs, and a run without params for at most 20", async () => {
  for (const [n, expected] of [
    [3, 3],
    [undefined, 20],
  ] as const) {
    const c = await run(n);
    expect(c.harness.calls.find((call) => call.stepId === "alerts")?.instructions).toContain(
      `at most ${expected}`,
    );
  }
});
test("the plan step's prompt holds the job and its review, and the proto step's prompt holds the approved plan and no text of the job", async () => {
  const c = await run();
  const pick = c.engine.listApprovals({ state: "pending" }).at(0);
  if (!pick) throw new Error(`Missing pick: ${JSON.stringify(c.result)}`);
  await c.engine.answerAsk(pick.id, { picks: [id] });
  const approval = c.engine.listApprovals({ state: "pending" }).at(0);
  if (!approval) throw new Error("Missing plan approval");
  const planCall = c.harness.calls.find((call) => call.stepId === "plan");
  expect(planCall?.instructions).toContain(job.title);
  expect(planCall?.instructions).toContain("Good fit");
  await c.engine.decide(approval.id, "approve");
  const proto = c.harness.calls.find((call) => call.stepId === "proto");
  expect(proto?.takesOutside).toBe(false);
  expect(proto?.instructions).toContain(plan);
  for (const value of [job.id, job.title, job.snippet, job.budget])
    expect(proto?.instructions).not.toContain(value);
});
test("proto's seven commands are exact lines, and its folder is the picked job's own folder", () => {
  const reqs = load().manifest.requirements;
  const folder = reqs.find((r) => r.id === "protos");
  const cli = reqs.find((r) => r.id === "build_tools");
  if (!folder || !cli || cli.type !== "cli_tool") throw new Error("Missing requirements");
  expect(cli.commands).toEqual(commands);
  for (const line of commands) expect(commandRefusal(line)).toBeUndefined();
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "m1-policy-")));
  dirs.push(home);
  mkdirSync(join(home, "project"));
  const route = routeRequirement(cli, facts);
  if (!route) throw new Error("Missing route");
  const p = buildPolicy({
    kind: "worker",
    requirements: [folder, cli],
    routes: [route],
    project: join(home, "project"),
    home,
    controlRoot: join(home, "data", "control"),
    controlCwd: join(home, "data", "control", "cwd"),
    sessionId: "s",
    schema: false,
    takesOutside: false,
    itemKey: id,
    grantedFolders: { protos: { path: join(home, "job-review", "prototypes"), access: "read_write" } },
  });
  expect(p.cwd).toBe(join(home, "job-review", "prototypes", id));
  expect(p.commands?.patterns).toEqual(commands);
});
