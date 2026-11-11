import { mkdirSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cleanup, tempPath } from "../test-helpers/tmp.ts";
import { diffSnapshot, globMatches, mergeHandled, parseSnapshot, resolveRoot, scanFolder } from "./scan.ts";

afterEach(cleanup);
function setup() {
  const base = dirname(tempPath());
  const project = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(project);
  mkdirSync(outside);
  return { project, outside };
}
function scan(root: string, within = root, glob = "**/*", maxEntries = 5000) {
  return scanFolder(root, { glob, maxEntries, within });
}
test("scans relative paths with size and floored mtime, sorted, and keeps only files that match the glob", () => {
  const { project } = setup();
  mkdirSync(join(project, "docs"));
  for (const path of ["z.pdf", "abc.md", "file.txt", "docs/a.pdf"]) {
    writeFileSync(join(project, path), "abc");
    utimesSync(join(project, path), 1000.123, 1000.123);
  }
  const pdf = scan(project, project, "**/*.pdf");
  expect(Object.keys(pdf.files)).toEqual(["docs/a.pdf", "z.pdf"]);
  expect(pdf.files["z.pdf"]).toEqual([3, 1000123]);
  expect(Object.keys(scan(project, project, "*.txt").files)).toEqual(["file.txt"]);
  expect(Object.keys(scan(project, project, "a?c.md").files)).toEqual(["abc.md"]);
  expect(Object.keys(scan(project, project, "docs/**").files)).toEqual(["docs/a.pdf"]);
});
test("a symlinked file and a symlinked folder inside the root are skipped", () => {
  const { project, outside } = setup();
  writeFileSync(join(outside, "file"), "x");
  symlinkSync(join(outside, "file"), join(project, "link"));
  symlinkSync(outside, join(project, "dir"));
  expect(scan(project).files).toEqual({});
});
test("the cap stops the scan, says capped, and the same files are kept on a second scan", () => {
  const { project } = setup();
  for (const name of ["c", "a", "b"]) writeFileSync(join(project, name), name);
  const first = scan(project, project, "**/*", 2);
  expect(first.capped).toBe(true);
  expect(Object.keys(first.files)).toEqual(["a", "b"]);
  expect(scan(project, project, "**/*", 2)).toEqual(first);
});
test("a root whose real path is outside within scans nothing and says outside", () => {
  const { project, outside } = setup();
  writeFileSync(join(outside, "file"), "x");
  symlinkSync(outside, join(project, "link"));
  expect(scan(join(project, "link"), project)).toEqual({ files: {}, capped: false, outside: true });
});
test("resolveRoot accepts a relative and an absolute folder inside the project, and refuses .., a symlink out, a missing folder, a file and a NUL byte, each with its reason", () => {
  const { project, outside } = setup();
  mkdirSync(join(project, "dir"));
  writeFileSync(join(project, "file"), "x");
  symlinkSync(outside, join(project, "link"));
  expect(resolveRoot(project, "dir")).toEqual({ ok: true, root: realpathSync(join(project, "dir")) });
  expect(resolveRoot(project, join(project, "dir"))).toEqual({
    ok: true,
    root: realpathSync(join(project, "dir")),
  });
  for (const path of ["..", "link"])
    expect(resolveRoot(project, path)).toEqual({
      ok: false,
      reason: "Only folders inside the project folder can be watched for now.",
    });
  expect(resolveRoot(project, "missing")).toEqual({ ok: false, reason: "That folder does not exist." });
  expect(resolveRoot(project, "file")).toEqual({ ok: false, reason: "That path is not a folder." });
  for (const path of ["", `bad${String.fromCodePoint(0)}path`])
    expect(resolveRoot(project, path)).toEqual({ ok: false, reason: "That folder path is not valid." });
  expect(resolveRoot(join(project, "missing"), ".")).toEqual({
    ok: false,
    reason: "The project folder is missing.",
  });
});
test("globMatches handles ** with zero segments, a pattern of 40 stars without hanging, a literal dot, dot-files, case, and a**b as two stars", () => {
  expect(globMatches("**/*.pdf", "a.pdf")).toBe(true);
  expect(globMatches("**/*.pdf", "a/b.pdf")).toBe(true);
  expect(globMatches(`${"*".repeat(40)}z`, "a".repeat(100))).toBe(false);
  expect(globMatches("a.b", "axb")).toBe(false);
  expect(globMatches("*", ".hidden")).toBe(true);
  expect(globMatches("?.txt", ".txt")).toBe(false);
  expect(globMatches("A", "a")).toBe(false);
  expect(globMatches("a**b", "axxb")).toBe(true);
  expect(globMatches("a**b", "a/x/b")).toBe(false);
});
test("diffSnapshot finds new, resized and re-dated paths and the removed ones", () => {
  expect(
    diffSnapshot(
      { old: [1, 1], size: [1, 1], date: [1, 1], same: [1, 1] },
      { size: [2, 1], date: [1, 2], same: [1, 1], new: [0, 0] },
    ),
  ).toEqual({ changed: ["date", "new", "size"], removed: ["old"] });
});
test("parseSnapshot refuses a wrong shape, a non-finite number and more than 5,000 keys", () => {
  for (const value of [
    null,
    [],
    { a: [1] },
    { a: [-1, 0] },
    { a: [Infinity, 0] },
    Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [String(i), [0, 0]])),
  ])
    expect(parseSnapshot(value)).toBeUndefined();
  expect(parseSnapshot({ a: [1, 2] })).toEqual({ a: [1, 2] });
});
test("mergeHandled keeps the old value of a changed path that is not in the batch", () => {
  expect(
    mergeHandled(
      { a: [1, 1], b: [1, 1], removed: [1, 1], same: [1, 1] },
      { a: [2, 2], b: [2, 2], new: [3, 3], same: [1, 1] },
      ["a"],
    ),
  ).toEqual({ a: [2, 2], b: [1, 1], same: [1, 1] });
});
