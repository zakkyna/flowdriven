import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadinessReport } from "@flowdriven/contracts/v1";
import { FlowManifest } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { scriptedHarness } from "../scripted-harness.ts";
import { bundledSkill, readSkillFolder } from "../skills/skill-folder.ts";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { toReadinessReport } from "./map-flow.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

const paths = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => paths.home,
}));
const roots: string[] = [];
const active: { service: RunnerService; store: Store }[] = [];
afterEach(() => {
  for (const { service, store } of active.splice(0)) {
    service.stop();
    store.close();
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const date = "2026-11-17T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
function setupPaths() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-local-")));
  roots.push(root);
  const home = join(root, "home");
  const data = join(root, "data");
  const bin = join(root, "bin");
  for (const dir of [home, data, bin]) mkdirSync(dir);
  paths.home = home;
  return { root, home, data, bin };
}
async function setup(requirements: unknown[], files: Record<string, string> = {}) {
  const p = setupPaths();
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements,
    steps: [{ id: "work", do: "worker", instructions: "Work", checks: [{ type: "user" }] }],
  });
  const store = await openSqliteStore(":memory:");
  const harness = scriptedHarness({ steps: {} });
  const service = createRunnerService({
    store,
    dataDir: p.data,
    mode: "live",
    env: { HOME: p.home, PATH: p.bin },
    harness,
    keeper: { every: () => () => {} },
    triggers: { every: () => () => {} },
  });
  active.push({ service, store });
  service.engine.registerFlow(manifest, hash, files);
  const check = async () =>
    ReadinessReport.parse(await service.call("readiness.check", { flowId: manifest.id }));
  return { ...p, manifest, service, harness, check };
}
const skill = (id: string, ref: string) => ({ id, type: "skill", ref });
const folder = (id: string, ref: string, access = "read_write") => ({ id, type: "path", ref, access });
const skillText = (name: string) => `---\nname: ${name}\ndescription: A test skill\n---\nHello.\n`;

test("a skill row is ok with its size, missing when not installed, and missing with the reason when it cannot be read", async () => {
  const t = await setup(
    [
      skill("installed", "claude-code:good"),
      skill("absent", "claude-code:absent"),
      skill("bad", "claude-code:bad"),
      skill("bundled", "flow:bundled"),
    ],
    { "skills/bundled/SKILL.md": skillText("bundled") },
  );
  const good = join(t.home, ".claude", "skills", "good");
  const bad = join(t.home, ".claude", "skills", "bad");
  mkdirSync(good, { recursive: true });
  mkdirSync(bad, { recursive: true });
  writeFileSync(join(good, "SKILL.md"), skillText("good"));
  symlinkSync(join(good, "SKILL.md"), join(bad, "SKILL.md"));
  const loaded = readSkillFolder(good, "good");
  const bundled = bundledSkill({ "skills/bundled/SKILL.md": skillText("bundled") }, "bundled");
  if (!loaded.ok || !bundled.ok) throw new Error("Test skills must be readable");
  const rows = (await t.check()).items;
  expect(rows.at(0)).toMatchObject({
    state: "ok",
    detail: `Found your skill good; its text has ${loaded.skill.copyText.length.toLocaleString("en-US")} characters.`,
  });
  expect(rows.at(1)).toMatchObject({
    state: "missing",
    detail: "Your Claude Code has no skill absent.",
    guide: { steps: ["Your Claude Code has no skill absent."] },
  });
  expect(rows.at(2)).toMatchObject({ state: "missing", detail: "This skill contains a symbolic link." });
  expect(rows.at(3)).toMatchObject({
    state: "ok",
    detail: `Found your skill bundled; its text has ${bundled.skill.copyText.length.toLocaleString("en-US")} characters.`,
  });
});
test("a command row is ok or missing from PATH", async () => {
  const t = await setup([
    { id: "yes", type: "cli_tool", commands: ["present check"] },
    { id: "no", type: "cli_tool", commands: ["absent check"] },
  ]);
  writeFileSync(join(t.bin, "present"), "unused", { mode: 0o755 });
  const rows = (await t.check()).items;
  expect(rows.at(0)).toMatchObject({ state: "ok", detail: `Found present at ${join(t.bin, "present")}.` });
  expect(rows.at(1)).toMatchObject({ state: "missing", detail: "absent is not on this Mac's PATH." });
});
test("a granted folder row is ok when it exists and can be written, says it will be created when missing, and is missing with its reason when refused", async () => {
  const t = await setup([
    folder("existing", "~/existing"),
    folder("new", "~/new"),
    folder("refused", "~/Library"),
  ]);
  mkdirSync(join(t.home, "existing"));
  const rows = (await t.check()).items;
  expect(rows.at(0)).toMatchObject({ state: "ok", detail: `Ready: ${join(t.home, "existing")}.` });
  expect(rows.at(1)).toMatchObject({
    state: "ok",
    detail: `FlowDriven creates ${join(t.home, "new")} at the first run.`,
  });
  expect(existsSync(join(t.home, "new"))).toBe(false);
  expect(rows.at(2)).toMatchObject({
    state: "missing",
    detail: "FlowDriven does not grant folders inside ~/Library.",
  });
  expect((await import("node:fs")).readdirSync(join(t.home, "existing"))).toEqual([]);
});
test("a read_write folder that cannot be written is missing with This folder cannot be written.", async () => {
  if (process.getuid?.() === 0) return;
  const t = await setup([folder("locked", "~/locked")]);
  const dir = join(t.home, "locked");
  mkdirSync(dir);
  chmodSync(dir, 0o500);
  try {
    expect((await t.check()).items.at(0)).toMatchObject({
      state: "missing",
      detail: "This folder cannot be written.",
    });
  } finally {
    chmodSync(dir, 0o700);
  }
});
test("a granted path that is a file is missing with This path is not a folder., for read and for read_write", async () => {
  const t = await setup([folder("file", "~/notes.txt", "read"), folder("written", "~/notes.txt")]);
  writeFileSync(join(t.home, "notes.txt"), "x");
  const rows = (await t.check()).items;
  for (const row of rows.slice(0, 2))
    expect(row).toMatchObject({ state: "missing", detail: "This path is not a folder." });
});
test("rows of other types keep their present states", async () => {
  const t = await setup([
    folder("project", "notes"),
    { id: "harness", type: "harness" },
    skill("skill", "flow:bundled"),
  ]);
  const rows = (await t.check()).items;
  expect(rows.slice(0, 2).map((r) => r.state)).toEqual(["unchecked", "unchecked"]);
  const row = {
    id: t.manifest.id,
    version: t.manifest.version,
    hash,
    manifest: t.manifest,
    files: {},
    registeredAt: date,
  };
  expect(toReadinessReport(row, date).items.every((r) => r.state === "unchecked")).toBe(true);
});
test("readiness.check runs no command and sends no prompt", async () => {
  const t = await setup([{ id: "cmd", type: "cli_tool", commands: ["fake check"] }]);
  const marker = join(t.root, "executed");
  for (const name of ["fake", "claude"])
    writeFileSync(join(t.bin, name), `#!/bin/sh\n: > '${marker}'\n`, { mode: 0o755 });
  expect((await t.check()).items.at(0)?.state).toBe("ok");
  expect(existsSync(marker)).toBe(false);
  expect(t.harness.calls).toEqual([]);
  expect(t.harness.replanCalls).toEqual([]);
  expect(t.harness.judgeCalls).toEqual([]);
});
