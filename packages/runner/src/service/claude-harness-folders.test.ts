import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { createCapabilities } from "./capabilities.ts";
import { ALLOW_FIRST, CLAUDE_ID, createHarnessService, gate, type HarnessService } from "./claude-harness.ts";

const homes: string[] = [];
const stores: Store[] = [];
const services: HarnessService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  for (const s of stores.splice(0)) s.close();
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const manifest = FlowManifest.parse({
  format: "flowdriven-flow/1.1",
  id: "local.test",
  name: "Test",
  kind: "light",
  requirements: [{ id: "work", type: "path", ref: "~/work", access: "read_write", sensitive: true }],
  steps: [{ id: "s", do: "worker", instructions: "Work", uses: ["work"] }],
});
test("the gate passes a flow with a granted folder after the allow and asks for the allow before it", () => {
  const base = {
    platform: "darwin",
    dataDir: "/tmp/data",
    scan: {
      detected: true,
      path: "/bin/claude",
      missingFlags: [],
      configFolder: true,
      login: "logged_in" as const,
      scannedAt: "2026-11-17T00:00:00Z",
    },
    finished: true,
    fileExists: () => true,
    permission: "on" as const,
    facts: { hooks: true, chrome: false },
    manifest,
  };
  expect(gate(base)).toEqual({ ready: false, reason: ALLOW_FIRST });
  expect(gate({ ...base, allowed: true })).toEqual({ ready: true });
});
test("after Withdraw the next attempt of a step with a granted folder is refused", async () => {
  const home = makeFakeHome();
  homes.push(home);
  const dataDir = join(home, "data");
  const project = join(home, "project");
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
  const pin = caps.get(manifest.id).rows[0]?.pin;
  if (!pin) throw new Error("Missing pin");
  caps.allow(manifest.id, hash, { work: pin });
  const request: StepRequest = {
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "Work",
    instructions: "Work",
    uses: ["work"],
    project,
    requirements: manifest.requirements,
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  caps.withdraw(manifest.id);
  expect(await hs.adapter.runStep(request)).toMatchObject({ block: ALLOW_FIRST });
  store.putCapabilityConsent({ flowId: manifest.id, hash, at: now().toISOString() });
  expect(await hs.adapter.runStep(request)).toMatchObject({ block: expect.any(String) });
});
