import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { buildPolicy } from "./policy.ts";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const common = { required: true, sensitive: false, why: "" };
const notes: Requirement = { ...common, id: "n", type: "path", access: "read_write", ref: "notes" };
const skill: Requirement = { ...common, id: "s", type: "skill", ref: "claude-code:writer" };

test("a skill copy folder reached through a symlink is compared by its resolved path, so it is never the working folder", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(base);
  const project = join(base, "project");
  const controlRoot = join(base, "control");
  mkdirSync(project);
  mkdirSync(controlRoot);
  mkdirSync(join(base, "data"));
  symlinkSync(join(base, "data"), join(base, "link"));
  const skillFolder = join(base, "link", "skill-copies", "cc-1", "writer");
  const policy = buildPolicy({
    kind: "worker",
    requirements: [notes, skill],
    project,
    controlRoot,
    controlCwd: join(controlRoot, "cwd"),
    sessionId: "session",
    schema: false,
    skillFolder,
  });
  const resolved = join(base, "data", "skill-copies", "cc-1", "writer");
  expect(policy.cwd).toBe(join(project, "notes"));
  expect(policy.addDirs).toEqual([resolved]);
  expect(policy.folders).toContainEqual({ path: resolved, write: false });
  const alone = buildPolicy({
    kind: "worker",
    requirements: [skill],
    project,
    controlRoot,
    controlCwd: join(controlRoot, "cwd"),
    sessionId: "session",
    schema: false,
    skillFolder,
  });
  expect(alone.cwd).toBe(join(controlRoot, "cwd"));
  expect(alone.addDirs).toEqual([resolved]);
  expect(alone.tools).toEqual(["Read", "Glob", "Grep"]);
});
