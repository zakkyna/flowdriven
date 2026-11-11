import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { buildPolicy, isProjectRef } from "./policy.ts";

const roots: string[] = [];
function root() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const common = { required: true, sensitive: false, why: "" };
function path(ref?: string, access: "read" | "read_write" = "read"): Requirement {
  return { ...common, id: "n", type: "path", access, ...(ref === undefined ? {} : { ref }) };
}
function setup() {
  const base = root();
  const project = join(base, "project");
  const controlRoot = join(base, "control");
  mkdirSync(project);
  mkdirSync(controlRoot);
  return {
    kind: "worker" as const,
    requirements: [] as Requirement[],
    project,
    controlRoot,
    controlCwd: join(controlRoot, "cwd"),
    sessionId: "session",
    schema: false,
  };
}
test("a read requirement gives Read, Glob and Grep in the project, read_write adds Write and Edit, and ref notes is created", () => {
  const o = setup();
  expect(buildPolicy({ ...o, requirements: [path()] })).toEqual({
    tools: ["Read", "Glob", "Grep"],
    folders: [{ path: o.project, write: false }],
    cwd: o.project,
    addDirs: [],
    schema: false,
    sessionId: "session",
  });
  const policy = buildPolicy({ ...o, requirements: [path("notes", "read_write")] });
  expect(existsSync(join(o.project, "notes"))).toBe(true);
  expect(policy.folders).toEqual([{ path: join(o.project, "notes"), write: true }]);
  expect(policy.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit"]);
});
test("the first path is the working folder, the others are added, and the same folder twice merges", () => {
  const o = setup();
  const p = buildPolicy({ ...o, requirements: [path("a"), path("b")], schema: true });
  expect(p.cwd).toBe(join(o.project, "a"));
  expect(p.addDirs).toEqual([join(o.project, "b")]);
  expect(p.schema).toBe(true);
  expect(buildPolicy({ ...o, requirements: [path("a"), path("a", "read_write")] }).folders).toEqual([
    { path: join(o.project, "a"), write: true },
  ]);
});
test("a step with no path, an agent step and a harness requirement get no tool", () => {
  const o = setup();
  for (const input of [
    { ...o, requirements: [{ ...common, id: "h", type: "harness" as const }] },
    { ...o, kind: "agent" as const, requirements: [path("x", "read_write")] },
  ]) {
    expect(buildPolicy(input)).toEqual({
      tools: [],
      folders: [],
      addDirs: [],
      cwd: o.controlCwd,
      schema: false,
      sessionId: "session",
    });
  }
});
test("refs that leave the project are refused with the sentence, and so is what cannot be enforced", () => {
  const o = setup();
  for (const ref of ["/etc", "~/x", "../x", "a/../b", "", `a${String.fromCodePoint(10)}`]) {
    const shown = ref.replace(String.fromCodePoint(10), "<U+000A>");
    expect(() => buildPolicy({ ...o, requirements: [path(ref)] })).toThrow(
      `The folder ${shown} is not inside the project.`,
    );
  }
  const outside = root();
  symlinkSync(outside, join(o.project, "notes"));
  symlinkSync(outside, join(o.project, "lnk"));
  symlinkSync(join(outside, "missing"), join(o.project, "dang"));
  for (const ref of ["notes", "lnk/created", "dang"])
    expect(() => buildPolicy({ ...o, requirements: [path(ref)] })).toThrow(
      `The folder ${ref} is not inside the project.`,
    );
  expect(existsSync(join(outside, "created"))).toBe(false);
  try {
    buildPolicy({ ...o, requirements: [path("dang")] });
  } catch (error) {
    expect(String(error)).not.toContain("ENOENT");
  }
  expect(() =>
    buildPolicy({ ...o, requirements: [{ ...common, id: "host", type: "mcp_server", tools: ["x"] }] }),
  ).toThrow("This step uses something FlowDriven cannot enforce yet (host).");
  const message = "A folder of this step overlaps FlowDriven's control folder.";
  expect(() =>
    buildPolicy({ ...o, controlRoot: join(o.project, "control"), requirements: [path()] }),
  ).toThrow(message);
  expect(() => buildPolicy({ ...o, project: o.controlRoot, requirements: [path()] })).toThrow(message);
});
test("isProjectRef", () => {
  for (const ref of [undefined, ".", "notes", "a/b", "a b"]) expect(isProjectRef(ref)).toBe(true);
  for (const ref of [
    "",
    "/x",
    "~",
    "~/x",
    "..",
    "a/../b",
    `a${String.fromCodePoint(10)}`,
    `a${String.fromCodePoint(0)}`,
  ])
    expect(isProjectRef(ref)).toBe(false);
});
