import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { bundledSkill, readSkillFolder, skillSource } from "../skills/skill-folder.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { createCapabilities } from "./capabilities.ts";
import { ALLOW_FIRST, CLAUDE_ID, createHarnessService, gate, type HarnessService } from "./claude-harness.ts";
import { createRunnerService, DEMO_HASH, type RunnerService } from "./service.ts";

const homes: string[] = [];
const stores: Store[] = [];
const services: (HarnessService | RunnerService)[] = [];
const now = () => new Date("2026-11-17T00:00:00Z");
const skillText = (body: string) => `---\nname: writer\ndescription: Writes\n---\n${body}`;
const manifest = (ref: string | undefined = "claude-code:writer", web = false) =>
  FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.skill",
    name: "Skill",
    kind: "build",
    requirements: [
      { id: "writer", type: "skill", ...(ref ? { ref } : {}) },
      ...(web
        ? [{ id: "web", type: "web", mode: "read", session: "own", url_patterns: ["https://example.com/"] }]
        : []),
    ],
    steps: [
      {
        id: "s",
        do: "skill",
        skill: "writer",
        instructions: "Write",
        checks: [{ type: "contains", pattern: "done" }],
        uses: web ? ["writer", "web"] : ["writer"],
      },
    ],
    triggers: [{ kind: "schedule", every: "1h" }],
  });
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
};
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
async function setup(ref = "claude-code:writer") {
  const home = makeFakeHome({ chrome: true });
  homes.push(home);
  const dir = join(home, ".claude/skills/writer");
  mkdirSync(dir, { recursive: true });
  const write = (body: string) => writeFileSync(join(dir, "SKILL.md"), skillText(body));
  write("Hello");
  const store = await openSqliteStore(":memory:");
  stores.push(store);
  let n = 0;
  const common = {
    store,
    dataDir: home,
    env: { HOME: home, PATH: process.env.PATH, USER: "u" },
    claudePath: FAKE_CLAUDE_PATH,
    now,
    newId: (prefix: string) => `${prefix}-${++n}`,
  };
  const hs = createHarnessService({ ...common, projectDir: home });
  services.push(hs);
  await hs.start().settled;
  store.putSetting("agentPermission", "on");
  const m = manifest(ref);
  const files = { "skills/writer/SKILL.md": skillText("Bundled") };
  store.putFlow({
    id: m.id,
    version: m.version,
    hash: DEMO_HASH,
    manifest: m,
    files,
    registeredAt: now().toISOString(),
  });
  const caps = createCapabilities({
    store,
    now,
    facts: () => hs.facts(),
    readSkill: (value) => {
      const source = skillSource(value, { home });
      if (!source) return { ok: false, reason: "Cannot read." };
      return source.kind === "installed"
        ? readSkillFolder(source.dir, source.name)
        : bundledSkill(files, source.name);
    },
  });
  const allow = () => {
    const pin = caps.get(m.id).rows.find((row) => row.requirementId === "writer")?.pin;
    if (!pin) throw new Error("Missing pin");
    caps.allow(m.id, DEMO_HASH, { writer: pin });
  };
  return { home, store, hs, m, caps, allow, write, common, files };
}

test("a skill step whose skill and uses are routed and allowed passes the gate", () => {
  expect(
    gate({
      ...base,
      manifest: manifest(),
      facts: { hooks: true, chrome: true, skills: ["writer"] },
      allowed: true,
    }),
  ).toEqual({ ready: true });
});
test("R9: editing SKILL.md after the allow blocks the run until the owner allows it again: the run is blocked with GATE.skillChanged and no child starts", async () => {
  const t = await setup();
  t.allow();
  t.write("Changed");
  const service = createRunnerService({
    ...t.common,
    mode: "live",
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  services.push(service);
  await service.start().settled;
  service.engine.registerFlow(t.m, DEMO_HASH, t.files);
  const before = readFakeCalls(t.home).length;
  const run = await service.engine.startRun(t.m.id, { project: t.home });
  expect(run).toMatchObject({
    state: "blocked",
    blockedReason:
      "Your skill writer changed since you allowed this flow. Look at it on the flow's screen and allow it again.",
  });
  expect(readFakeCalls(t.home)).toHaveLength(before);
});
test("after a new allow the same flow runs", async () => {
  const t = await setup();
  t.allow();
  t.write("Changed");
  t.allow();
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: DEMO_HASH })).toEqual({ ready: true });
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: `sha256:${"1".repeat(64)}` }).reason).toBe(ALLOW_FIRST);
  t.store.putCapabilityConsent({ flowId: t.m.id, hash: DEMO_HASH, at: now().toISOString() });
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: DEMO_HASH }).reason).toBe(
    "Your skill writer changed since you allowed this flow. Look at it on the flow's screen and allow it again.",
  );
});
test("a skill step whose skill is not installed is blocked with This skill is not installed in Claude Code.", () => {
  expect(
    gate({ ...base, manifest: manifest(), facts: { hooks: true, chrome: true }, allowed: true }),
  ).toEqual({ ready: false, reason: "This skill is not installed in Claude Code." });
});
test("a bundled skill step passes with the flow's own consent", async () => {
  const t = await setup("flow:writer");
  t.allow();
  expect(t.hs.readiness(t.m, { flowId: t.m.id, hash: DEMO_HASH })).toEqual({ ready: true });
});
test("switching on a trigger is refused while the skill's pin is stale", async () => {
  const t = await setup("flow:writer");
  t.allow();
  const service = createRunnerService({
    ...t.common,
    mode: "live",
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  services.push(service);
  const input = { flowId: t.m.id, index: 0, enabled: true, hash: DEMO_HASH };
  expect(await service.call("triggers.setEnabled", input)).toMatchObject({ state: "on" });
  await service.call("triggers.setEnabled", { ...input, enabled: false });
  const flow = t.store.getFlow(t.m.id);
  if (!flow) throw new Error("Missing flow");
  t.store.putFlow({ ...flow, files: { "skills/writer/SKILL.md": skillText("Changed") } });
  await expect(service.call("triggers.setEnabled", input)).rejects.toMatchObject({
    code: "not_allowed",
    message: ALLOW_FIRST,
  });
});
test("a skill step that also uses a web requirement needs the allow first, as a worker step does", () => {
  expect(
    gate({
      ...base,
      manifest: manifest("claude-code:writer", true),
      facts: { hooks: true, chrome: true, skills: ["writer"] },
    }),
  ).toEqual({ ready: false, reason: ALLOW_FIRST });
});
test("a skill requirement with no ref stays in cannot enforce yet", () => {
  expect(gate({ ...base, manifest: manifest(""), allowed: true })).toEqual({
    ready: false,
    reason: "This flow needs something FlowDriven cannot enforce yet: writer.",
  });
});
