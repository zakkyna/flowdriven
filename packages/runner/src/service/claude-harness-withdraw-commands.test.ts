import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { routeAll } from "../router/route.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import {
  FAKE_CLAUDE_PATH,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createCapabilities } from "./capabilities.ts";
import { ALLOW_FIRST, CLAUDE_ID, createHarnessService, type HarnessService } from "./claude-harness.ts";

const homes: string[] = [];
const stores: Store[] = [];
const services: HarnessService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const manifest = FlowManifest.parse({
  format: "flowdriven-flow/1.1",
  id: "local.cmd",
  name: "Cmd",
  kind: "light",
  requirements: [
    { id: "git", type: "cli_tool", commands: ["git status"] },
    { id: "here", type: "path", access: "read_write" },
  ],
  steps: [{ id: "s", do: "worker", instructions: "Run git status", uses: ["git", "here"] }],
});
async function setup() {
  const home = makeFakeHome();
  homes.push(home);
  const dataDir = join(home, "data"),
    project = join(home, "project");
  mkdirSync(dataDir);
  mkdirSync(project);
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  const now = () => new Date("2026-11-17T00:00:00Z");
  let n = 0;
  const hs = createHarnessService({
    store,
    dataDir,
    projectDir: project,
    env: { HOME: home, PATH: process.env.PATH },
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: (p) => `${p}-${++n}`,
  });
  services.push(hs);
  await hs.start().settled;
  store.putSetting("agentPermission", "on");
  const hash = `sha256:${"a".repeat(64)}`;
  store.putFlow({
    id: manifest.id,
    version: manifest.version,
    hash,
    manifest,
    files: {},
    registeredAt: now().toISOString(),
  });
  store.createRun({
    id: "r1",
    flowId: manifest.id,
    flowHash: hash,
    flowVersion: manifest.version,
    state: "running",
    project,
    inputs: {},
    params: {},
    requirements: manifest.requirements,
    startedAt: now().toISOString(),
  });
  const caps = createCapabilities({
    store,
    now,
    home,
    dataDir,
    facts: () => ({ hooks: true, chrome: false }),
  });
  caps.allow(manifest.id, hash);
  writeFakeScript(home, {
    plays: [
      {
        when: "Run git status",
        actions: [
          { do: "tool", id: "b1", name: "Bash", input: { command: "git status" }, result: "ok" },
          { do: "result", result: "ok" },
        ],
      },
    ],
  });
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "Run",
    instructions: "Run git status",
    uses: ["git", "here"],
    project,
    requirements: manifest.requirements,
    routes: routeAll(manifest.requirements, { hooks: true, chrome: false }),
    takesOutside: false,
    outputs: [],
    maxDurationMs: 20000,
    signal: new AbortController().signal,
  };
  return { home, store, hs, caps, request, now };
}
test("after Withdraw the next attempt of a command step is refused", { timeout: 20_000 }, async () => {
  const { home, store, hs, caps, request, now } = await setup();
  caps.withdraw(manifest.id);
  expect(await hs.adapter.runStep(request)).toMatchObject({ block: ALLOW_FIRST });
  expect(readFakeCalls(home).filter((call) => call.kind === "tool")).toHaveLength(0);
  store.putCapabilityConsent({
    flowId: manifest.id,
    hash: `sha256:${"b".repeat(64)}`,
    at: now().toISOString(),
  });
  expect(await hs.adapter.runStep(request)).toMatchObject({ block: ALLOW_FIRST });
});
test("a command step whose consent is in place is admitted as before", { timeout: 20_000 }, async () => {
  const { home, hs, request } = await setup();
  expect(await hs.adapter.runStep(request)).toMatchObject({ exit: "ok" });
  expect(readFakeCalls(home).filter((call) => call.kind === "tool")).toMatchObject([
    { name: "Bash", ran: true },
  ]);
});
