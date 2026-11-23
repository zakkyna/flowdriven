import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { ownTextHash } from "../exec/own-text.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createCapabilities } from "./capabilities.ts";
import { CLAUDE_ID, createHarnessService, type HarnessService } from "./claude-harness.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const homes: string[] = [];
const stores: Store[] = [];
const services: (RunnerService | HarnessService)[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
async function setup(changed: boolean, readsJob: boolean) {
  const home = makeFakeHome();
  homes.push(home);
  const dataDir = join(home, "data"),
    project = join(home, "project");
  mkdirSync(dataDir);
  mkdirSync(project);
  mkdirSync(join(project, "work"));
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const now = () => new Date("2026-11-18T00:00:00Z");
  let n = 0;
  const common = {
    store,
    dataDir,
    env: { HOME: home, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: (p: string) => `${p}-${++n}`,
  };
  const hs = createHarnessService({ ...common, projectDir: project });
  services.push(hs);
  await hs.start().settled;
  store.putSetting("agentPermission", "on");
  const service = createRunnerService({ ...common, mode: "live" });
  services.push(service);
  await service.start().settled;
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.own",
    name: "Own",
    kind: "build",
    requirements: [
      { id: "work", type: "path", ref: "work", access: "read_write" },
      { id: "git", type: "cli_tool", commands: ["git status"] },
    ],
    steps: [
      {
        id: "source",
        do: "worker",
        instructions: "Find jobs",
        outputs: [{ id: "jobs", type: "json" }],
        checks: [{ type: "user" }],
      },
      {
        id: "loop",
        for_each: "${steps.source.outputs.jobs}",
        as: "job",
        steps: [
          {
            id: "plan",
            do: "worker",
            instructions: "Plan",
            outputs: [{ id: "plan", type: "text" }],
            checks: [{ type: "contains", pattern: "ok" }],
          },
          {
            id: "build",
            do: "worker",
            instructions: `Build ${"${plan.outputs.plan}"}${readsJob ? " ${job}" : ""}`,
            uses: ["work", "git"],
            checks: [{ type: "contains", pattern: "ok" }],
            retry: 0,
          },
        ],
      },
    ],
  });
  service.engine.registerFlow(manifest, DEMO_HASH, {});
  const caps = createCapabilities({
    store,
    now,
    home,
    dataDir,
    facts: () => ({ hooks: true, chrome: false }),
  });
  caps.allow(manifest.id, DEMO_HASH);
  writeFakeScript(home, {
    plays: [
      {
        when: "Find jobs",
        actions: [{ do: "result", structured: { report: "Found", outputs: { jobs: ["job one"] } } }],
      },
      {
        when: "Build ",
        actions: [
          { do: "tool", id: "b1", name: "Bash", input: { command: "git status" }, result: "ok" },
          { do: "result", result: "ok" },
        ],
      },
    ],
  });
  const run = await service.engine.startRun(manifest.id, { project });
  expect(run.state).toBe("waiting_approval");
  const source = store.getStep(run.id, "source");
  if (!source) throw new Error("Missing source");
  store.upsertStep({ ...source, outside: true });
  store.upsertStep({
    runId: run.id,
    stepId: "plan",
    itemKey: "#0",
    state: "passed",
    attempts: [],
    outputs: { plan: changed ? "Changed" : "Approved" },
    checks: [],
    outside: true,
    ownerApproved: {
      output: "plan",
      hash: ownTextHash("Approved"),
      approvalId: "seed",
      at: now().toISOString(),
    },
  });
  const approval = service.engine.listApprovals().at(0);
  if (!approval) throw new Error("Missing approval");
  await service.engine.decide(approval.id, "approve");
  return { service, store, run, home };
}
const sentence = "A step that reads outside text cannot run commands. Run them in a step of their own.";
test("R1 end to end: a command step that reads the approved plan gets its commands; with the plan changed after approval it is blocked with the outside sentence and no child starts", {
  timeout: 30_000,
}, async () => {
  const good = await setup(false, false);
  expect(good.store.getRun(good.run.id)).toMatchObject({ state: "done" });
  expect(readFakeCalls(good.home).filter((call) => call.kind === "tool")).toMatchObject([
    { name: "Bash", ran: true },
  ]);
  const changed = await setup(true, false);
  expect(changed.store.getRun(changed.run.id)).toMatchObject({ state: "blocked", blockedReason: sentence });
  expect(
    readFakeCalls(changed.home).filter((call) => call.kind === "call" && call.prompt?.includes("Build ")),
  ).toHaveLength(0);
});
test("a command step that also reads the job is blocked even after the plan was approved", {
  timeout: 30_000,
}, async () => {
  const t = await setup(false, true);
  expect(t.store.getRun(t.run.id)).toMatchObject({ state: "blocked", blockedReason: sentence });
  expect(
    readFakeCalls(t.home).filter((call) => call.kind === "call" && call.prompt?.includes("Build ")),
  ).toHaveLength(0);
});
