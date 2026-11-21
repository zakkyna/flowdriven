import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { findPrivateTraces } from "./test/repo-rules";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const folders = [
  "packages/fixtures",
  "packages/runner/src/test-helpers",
  "apps/desktop/src/test",
  "apps/desktop/electron/test-helpers",
  "tools/checks/test/helpers",
  "flows/upwork-job-review",
];
const oldFakeScripts = new Set(["fake-claude.ts", "fake-claude-script.ts"]);
const nonCliFakes = new Set(["fake-brain.ts", "fake-chrome.ts"]);
const header = "// synthetic: written by hand, never recorded";

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

function missingHeader(path: string, text: string): string[] {
  const name = path.split("/").at(-1) ?? "";
  if (
    !/\/test-helpers\/fake-.*\.ts$/.test(path) ||
    name.endsWith(".test.ts") ||
    oldFakeScripts.has(name) ||
    nonCliFakes.has(name)
  )
    return [];
  const firstLine = text.startsWith("#!") ? text.split("\n")[1] : text.split("\n")[0];
  return firstLine === header ? [] : [path];
}

test("TC-REPO-11 detects private traces and accepts synthetic examples", () => {
  const rejected = [
    "/" + "Users" + "/sam/x",
    "/" + "home" + "/sam",
    "/" + "Volumes" + "/disk/x",
    "C:" + "\\" + "Users" + "\\sam",
    "sam" + "@" + "example.org",
    "A1".repeat(20),
  ];
  const allowed = [
    "~" + "/notes",
    "sam" + "@" + "example.test",
    "sha256:" + "a".repeat(64),
    "@flowdriven/contracts",
    "@types/node",
    `import item from "./${"a".repeat(40)}"`,
    "/home/test/file",
    "/home/example/file",
    "donotreply" + "@" + "upwork.com",
  ];
  for (const value of rejected) expect(findPrivateTraces(value), value).not.toEqual([]);
  for (const value of allowed) expect(findPrivateTraces(value), value).toEqual([]);
});

test("TC-REPO-11 scans every fixture and test helper and requires synthetic fake scripts", () => {
  const errors = folders
    .flatMap((folder) => filesUnder(join(root, folder)))
    .flatMap((file) => {
      const path = relative(root, file);
      const text = readFileSync(file, "utf8");
      return [...findPrivateTraces(text).map((trace) => `${path}: ${trace}`), ...missingHeader(path, text)];
    });
  expect(errors).toEqual([]);
  expect(missingHeader("packages/runner/src/test-helpers/fake-new.ts", "// missing")).toEqual([
    "packages/runner/src/test-helpers/fake-new.ts",
  ]);
});
