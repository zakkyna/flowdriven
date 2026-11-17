import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { DENY, decide } from "./decide.ts";
import { buildPolicy, FOLDER_STOP } from "./policy.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup(access: "read" | "read_write" = "read_write") {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "folder-call-")));
  homes.push(home);
  const project = join(home, "project");
  const data = join(home, "data");
  mkdirSync(project);
  mkdirSync(data);
  const req = Requirement.parse({ id: "extra", type: "path", ref: "~/work", access });
  const input = {
    kind: "worker" as const,
    requirements: [req],
    project,
    home,
    controlRoot: join(data, "control"),
    controlCwd: join(data, "control", "cwd"),
    sessionId: "session",
    schema: false,
    grantedFolders: { extra: { path: join(home, "work"), access } },
  };
  return { home, project, req, input };
}
test("a granted folder becomes a folder of the call with its access, and an --add-dir when it is not the first", () => {
  const t = setup();
  const projectReq = Requirement.parse({ id: "project", type: "path", ref: ".", access: "read" });
  const p = buildPolicy({ ...t.input, requirements: [projectReq, t.req] });
  expect(p.folders).toEqual([
    { path: t.project, write: false },
    { path: join(t.home, "work"), write: true },
  ]);
  expect(p.addDirs).toEqual([join(t.home, "work")]);
});
test("an extra folder the consent does not pin is refused with FOLDER_STOP.notGranted", () => {
  const t = setup();
  expect(() => buildPolicy({ ...t.input, grantedFolders: {} })).toThrow(FOLDER_STOP.notGranted("extra"));
  expect(() =>
    buildPolicy({ ...t.input, grantedFolders: { extra: { path: join(t.home, "work"), access: "read" } } }),
  ).toThrow(FOLDER_STOP.notGranted("extra"));
});
test("a granted folder whose symlink now points elsewhere is refused at the call with FOLDER_STOP.moved", () => {
  const t = setup();
  mkdirSync(join(t.home, "one"));
  mkdirSync(join(t.home, "two"));
  symlinkSync(join(t.home, "one"), join(t.home, "work"));
  const input = {
    ...t.input,
    grantedFolders: { extra: { path: join(t.home, "one"), access: "read_write" as const } },
  };
  rmSync(join(t.home, "work"));
  symlinkSync(join(t.home, "two"), join(t.home, "work"));
  expect(() => buildPolicy(input)).toThrow(FOLDER_STOP.moved("extra"));
});
test("a granted folder that holds the run's project folder is refused with FOLDER_STOP.project", () => {
  const t = setup();
  mkdirSync(join(t.home, "work"));
  const project = join(t.home, "work", "project");
  mkdirSync(project);
  expect(() => buildPolicy({ ...t.input, project })).toThrow(FOLDER_STOP.project("extra"));
});
test("a granted folder that does not exist is created with mode 0700 and checked again", () => {
  const t = setup();
  const p = buildPolicy(t.input);
  expect(statSync(join(t.home, "work")).mode & 0o777).toBe(0o700);
  expect(p.folders[0]?.path).toBe(realpathSync.native(join(t.home, "work")));
});
test("a Write outside the granted folder is denied by the hook, .git inside it stays protected, and a read grant gives no Write and no Edit", () => {
  const t = setup();
  const p = buildPolicy(t.input);
  const call = (tool_name: string, file_path: string) => ({
    hook_event_name: "PreToolUse",
    session_id: "session",
    tool_use_id: "1",
    tool_name,
    tool_input: { file_path },
  });
  expect(decide(p, call("Write", join(t.home, "outside")))).toMatchObject({
    allow: false,
    reason: DENY.outside,
  });
  for (const protectedName of [".git/config", ".claude/settings.json", ".mcp.json"])
    expect(decide(p, call("Write", join(t.home, "work", protectedName)))).toMatchObject({
      allow: false,
      reason: DENY.protectedPath,
    });
  const read = buildPolicy({
    ...t.input,
    requirements: [Requirement.parse({ id: "extra", type: "path", ref: "~/work", access: "read" })],
    grantedFolders: { extra: { path: join(t.home, "work"), access: "read" } },
  });
  expect(read.tools).not.toContain("Write");
  expect(read.tools).not.toContain("Edit");
  expect(decide(read, call("Write", join(t.home, "work", "x"))).allow).toBe(false);
});
