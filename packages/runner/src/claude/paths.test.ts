import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { hasParentPart, isInside, resolveDeep } from "./paths.ts";

const roots: string[] = [];
function root() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("resolveDeep resolves what exists and keeps a missing tail", () => {
  const dir = root();
  const outside = root();
  const file = join(dir, "file");
  writeFileSync(file, "x");
  writeFileSync(join(outside, "file"), "x");
  symlinkSync(join(outside, "file"), join(dir, "link"));
  expect(resolveDeep(file)).toBe(file);
  expect(resolveDeep(join(dir, "new/deep/file.txt"))).toBe(join(dir, "new/deep/file.txt"));
  expect(resolveDeep(join(dir, "link"))).toBe(join(outside, "file"));
  expect(resolveDeep(join(file, "sub"))).toBe(join(file, "sub"));
  expect(resolveDeep("relative")).toBeUndefined();
  expect(resolveDeep(`${dir}/${String.fromCodePoint(0)}`)).toBeUndefined();
});
test("a dangling link, also in the middle of a path, is refused", () => {
  const dir = root();
  symlinkSync(join(root(), "missing"), join(dir, "dangling"));
  expect(resolveDeep(join(dir, "dangling"))).toBeUndefined();
  expect(resolveDeep(join(dir, "dangling/x/y"))).toBeUndefined();
});
test("hasParentPart finds a .. part and nothing else", () => {
  for (const p of ["/a/b/../c", "/a/link/../x", "/a\\..\\b"]) expect(hasParentPart(p)).toBe(true);
  for (const p of ["/a/..b/c", "/a/b.."]) expect(hasParentPart(p)).toBe(false);
});
test("isInside is true for the root and below it and false for a sibling that shares the prefix", () => {
  for (const p of ["/a/proj", "/a/proj/x"]) expect(isInside("/a/proj", p)).toBe(true);
  for (const p of ["/a/proj2/x", "/a", "/a/pro"]) expect(isInside("/a/proj", p)).toBe(false);
});
test("a path that differs only in case resolves to the same place on a case-insensitive volume and is a different path on a case-sensitive one", () => {
  const dir = root();
  const upper = join(dirname(dir), basename(dir).toUpperCase());
  expect(resolveDeep(upper) === resolveDeep(dir)).toBe(existsSync(upper));
  if (!existsSync(upper)) {
    expect(resolveDeep(upper)).toBe(upper);
    const resolved = resolveDeep(dir);
    const child = resolveDeep(join(upper, "x"));
    expect(resolved).toBeDefined();
    expect(child).toBeDefined();
    if (resolved !== undefined && child !== undefined) expect(isInside(resolved, child)).toBe(false);
  }
});
