import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { validateManifest } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { runDemo } from "./demo.ts";
import { demoFlow } from "./demo-flow.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("the demo writes two reports and the second skips what the first saw", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  const { reports, files } = await runDemo({
    outDir: join(dir, "out"),
    dbDir: join(dir, "db"),
    now: () => new Date("2026-11-11T09:00:00Z"),
  });
  expect(files.map((f) => basename(f))).toEqual(["run-1.md", "run-2.md"]);
  expect(readFileSync(files[0], "utf8")).toBe(reports[0]);
  expect(reports[0]).toContain("Sample job review: done. 4 of 4 steps passed.");
  expect(reports[0]).toContain("Items: 5 processed, 0 skipped as seen, 0 failed.");
  expect(reports[1]).toContain("Items: 2 processed, 2 skipped as seen, 0 failed.");
  expect(reports[1].split("skipped: seen in an earlier run").length - 1).toBe(2);
  expect(reports[1]).toMatch(/\| j5 \| passed \|/);
});
test("the demo flow is valid", () =>
  expect(validateManifest(demoFlow().manifest, { files: new Set(Object.keys(demoFlow().files)) })).toEqual(
    [],
  ));
