import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { parseManifest } from "../index.ts";
import { contentHash, loadFlowFolder, parseFlowYaml } from "../node.ts";
import { upworkJobReview } from "../test-data/upwork.ts";
import { upworkYaml } from "../test-data/upwork-yaml.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});
function folder(files: Record<string, string | Uint8Array>) {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  for (const [name, data] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
  return dir;
}
function ok(raw: unknown) {
  const result = parseManifest(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.manifest;
}
test("loads the Upwork example from YAML", () => {
  const dir = folder({
    "flow.yaml": upworkYaml,
    "README.md": "r\n",
    "checks/alerts.schema.json": "{}",
    "checks/score.schema.json": "{}",
    "checks/verdict.schema.json": "{}",
    "checks/human.md": "rubric\n",
  });
  const loaded = loadFlowFolder(dir);
  expect(loaded.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(loaded.manifest).toEqual(ok(upworkJobReview));
  expect(loaded.hash).toBe(contentHash(loaded.files));
  expect([...loaded.files.keys()].sort()).toContain("checks/human.md");
});
test("reports a check file that is missing", () =>
  expect(loadFlowFolder(folder({ "flow.yaml": upworkYaml, "README.md": "r\n" })).issues).toContainEqual(
    expect.objectContaining({ code: "missing_file", path: "steps.0.checks.0.file" }),
  ));
test("requires flow.yaml and README.md", () => {
  expect(() => loadFlowFolder(folder({ "README.md": "r" }))).toThrowError(
    expect.objectContaining({ code: "missing_file" }),
  );
  expect(() => loadFlowFolder(folder({ "flow.yaml": upworkYaml }))).toThrowError(
    expect.objectContaining({ code: "missing_file" }),
  );
});
test("refuses a symbolic link", () => {
  const dir = folder({ "flow.yaml": upworkYaml, "README.md": "r" });
  symlinkSync("/etc/hosts", join(dir, "x.md"));
  expect(() => loadFlowFolder(dir)).toThrowError(expect.objectContaining({ code: "symlink" }));
});
test("refuses a file over 2 MB and a package over 10 MB", () => {
  expect(() =>
    loadFlowFolder(folder({ "flow.yaml": upworkYaml, "README.md": "r", big: new Uint8Array(2_097_153) })),
  ).toThrowError(expect.objectContaining({ code: "too_large" }));
  const files: Record<string, string | Uint8Array> = { "flow.yaml": upworkYaml, "README.md": "r" };
  for (let i = 0; i < 6; i++) files[`file${i}`] = new Uint8Array(1_900_000);
  expect(() => loadFlowFolder(folder(files))).toThrowError(expect.objectContaining({ code: "too_large" }));
});
test("ignores .git, node_modules and .DS_Store but hashes everything else", () => {
  const dir = folder({ "flow.yaml": upworkYaml, "README.md": "r" });
  const before = loadFlowFolder(dir).hash;
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, ".git", "x"), "x");
  writeFileSync(join(dir, "node_modules", "x"), "x");
  writeFileSync(join(dir, ".DS_Store"), "x");
  expect(loadFlowFolder(dir).hash).toBe(before);
  writeFileSync(join(dir, ".flowignore"), "x");
  expect(loadFlowFolder(dir).hash).not.toBe(before);
});
test("YAML: no aliases, no duplicate keys, no tags; yes and dates stay strings", () => {
  for (const text of [
    "a: &x 1\nb: *x\n",
    "a: 1\na: 2\n",
    "a: !!binary AAAA\n",
    "a: !!set {x: null}\n",
    "a: !custom 1\n",
    "a: {b: ${x}}\n",
  ])
    expect(() => parseFlowYaml(text)).toThrowError(expect.objectContaining({ code: "yaml" }));
  expect(parseFlowYaml("on: yes\nd: 2026-11-11\nn: 1.0\nt: 'a !b'\n")).toEqual({
    on: "yes",
    d: "2026-11-11",
    n: 1,
    t: "a !b",
  });
});
test("returns schema issues without exposing an invalid manifest", () => {
  const loaded = loadFlowFolder(folder({ "flow.yaml": "format: wrong\n", "README.md": "r" }));
  expect(loaded.issues).toContainEqual(
    expect.objectContaining({ severity: "error", code: "unsupported_format" }),
  );
  expect(() => loaded.manifest).toThrow("Flow manifest is invalid");
});
test("refuses invalid UTF-8 in flow.yaml as YAML", () => {
  expect(() => loadFlowFolder(folder({ "flow.yaml": new Uint8Array([255]), "README.md": "r" }))).toThrowError(
    expect.objectContaining({ code: "yaml" }),
  );
});
