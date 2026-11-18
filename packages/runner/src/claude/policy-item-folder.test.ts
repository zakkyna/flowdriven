import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { resolveExtraFolder } from "../folders/extra.ts";
import { routeRequirement } from "../router/route.ts";
import { DENY, decide } from "./decide.ts";
import { buildPolicy } from "./policy.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function setup() {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), "item-folder-")));
  homes.push(home);
  const project = join(home, "project"),
    data = join(home, "data");
  mkdirSync(project);
  mkdirSync(data);
  const resolved = resolveExtraFolder("~/work", { home, dataDir: data });
  if (!resolved.ok) throw new Error(resolved.reason);
  const req = Requirement.parse({
    id: "work",
    type: "path",
    ref: "~/work",
    access: "read_write",
    per_item: true,
  });
  return {
    home,
    project,
    data,
    req,
    input: {
      kind: "worker" as const,
      requirements: [req],
      project,
      home,
      controlRoot: join(data, "control"),
      controlCwd: join(data, "control", "cwd"),
      sessionId: "session",
      schema: false,
      grantedFolders: { work: { path: resolved.path, access: "read_write" as const } },
      itemKey: "job1",
    },
  };
}

test("a per_item folder is <granted folder>/<item key>, created with mode 0700, and the step's commands run there", () => {
  const t = setup();
  const cli = Requirement.parse({ id: "cli", type: "cli_tool", commands: ["git status"] });
  const route = routeRequirement(cli, { hooks: true, chrome: false });
  if (!route) throw new Error("missing command route");
  const p = buildPolicy({
    ...t.input,
    requirements: [t.req, cli],
    takesOutside: false,
    routes: [route],
  });
  const folder = join(t.home, "work", "job1");
  expect(p.cwd).toBe(folder);
  expect(p.workFolder).toBe(folder);
  expect(p.folders).toEqual([{ path: folder, write: true }]);
  expect(p.commands?.patterns).toEqual(["git status"]);
  expect(statSync(folder).mode & 0o777).toBe(0o700);
});
test("a write to the granted folder itself, or to another item's folder, is denied by the hook", () => {
  const t = setup();
  const p = buildPolicy(t.input);
  for (const file_path of [join(t.home, "work", "x"), join(t.home, "work", "other", "x")])
    expect(
      decide(p, {
        hook_event_name: "PreToolUse",
        session_id: "session",
        tool_use_id: "1",
        tool_name: "Write",
        tool_input: { file_path },
      }),
    ).toMatchObject({ allow: false, reason: DENY.outside });
});
test("an item key with a slash, two dots, a leading dot, an upper-case letter or a hash (#1) blocks the step and creates nothing", () => {
  for (const key of ["a/b", "..", ".a", "Job", "#1", ""]) {
    const t = setup();
    expect(() => buildPolicy({ ...t.input, itemKey: key })).toThrow(
      "This step's item has no name that can be a folder (work).",
    );
    expect(existsSync(join(t.home, "work"))).toBe(false);
  }
});
test("an item folder that is a symlink, or a file, is refused", () => {
  for (const kind of ["symlink", "file"]) {
    const t = setup();
    mkdirSync(join(t.home, "work"));
    if (kind === "symlink") symlinkSync(t.project, join(t.home, "work", "job1"));
    else writeFileSync(join(t.home, "work", "job1"), "x");
    expect(() => buildPolicy(t.input)).toThrow("The folder work now leads somewhere else.");
  }
});
test("two granted folders, one of them per_item, keep the order of uses", () => {
  const t = setup();
  const other = Requirement.parse({ id: "other", type: "path", ref: "~/other", access: "read_write" });
  const grantedFolders = {
    ...t.input.grantedFolders,
    other: { path: join(t.home, "other"), access: "read_write" as const },
  };
  for (const requirements of [
    [other, t.req],
    [t.req, other],
  ]) {
    const p = buildPolicy({ ...t.input, requirements, grantedFolders });
    const expected = requirements.map((r) =>
      r.id === "work" ? join(t.home, "work", "job1") : join(t.home, "other"),
    );
    expect(p.folders.map((f) => f.path)).toEqual(expected);
    expect(p.workFolder).toBe(expected[0]);
  }
});
