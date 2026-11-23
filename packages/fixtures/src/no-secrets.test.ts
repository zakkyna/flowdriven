/// <reference types="node" />
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const patterns = [
  new RegExp(["sk", "-[A-Za-z0-9]{20,}"].join("")),
  new RegExp(["ghp", "_[A-Za-z0-9]{20,}"].join("")),
  new RegExp(["Bearer", " [A-Za-z0-9._-]{20,}"].join("")),
  /[0-9]{6,}:[A-Za-z0-9_-]{30,}/,
  new RegExp(["-----BE" + "GIN", ".*PRIVATE" + " KEY"].join("")),
];

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

function secretFiles(files: string[]): string[] {
  return files.filter((file) => patterns.some((pattern) => pattern.test(readFileSync(file, "utf8"))));
}

test("TC-SR6-06 fixture and runner test files contain no secret-looking values", () => {
  const files = [
    ...filesUnder(join(root, "packages/fixtures")),
    ...filesUnder(join(root, "packages/runner/src/test-helpers")),
    ...filesUnder(join(root, "packages/runner/src")).filter((file) => file.endsWith(".test.ts")),
  ];
  expect(secretFiles(files).map((file) => relative(root, file))).toEqual([]);
  const folder = mkdtempSync(join(root, ".workflow/scratch/secrets-test-"));
  try {
    const path = join(folder, "sample.txt");
    for (const value of [
      ["sk", "-", "a".repeat(20)].join(""),
      ["ghp", "_", "a".repeat(20)].join(""),
      ["Bearer", " ", "a".repeat(20)].join(""),
      ["123456", ":", "a".repeat(30)].join(""),
      ["-----BE" + "GIN ", "PRIVATE" + " KEY-----"].join(""),
    ]) {
      writeFileSync(path, value);
      expect(secretFiles([path])).toEqual([path]);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
