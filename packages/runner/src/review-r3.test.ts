import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, expect, test } from "vitest";
import { defaultCommandRunner } from "./checks/command.ts";
import { type CheckContext, runChecks } from "./checks/run-checks.ts";
import { scriptedHarness } from "./scripted-harness.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const context = (folder: string, title: string): CheckContext => ({
  runId: "r",
  stepId: "s",
  itemKey: "k",
  folder,
  files: new Map(),
  declaredOutputs: [],
  output: { text: "anything", values: {} },
  bind: (t) => t.replace("${job.title}", title),
  harness: scriptedHarness({}),
  signal: new AbortController().signal,
  runCommand: async () => ({ code: 0, stderr: "" }),
});
test("a files pattern built from an item title cannot freeze the runner", async () => {
  const folder = tmp();
  mkdirSync(join(folder, "out"));
  writeFileSync(join(folder, "out", "a".repeat(40)), "x");
  const started = performance.now();
  const [outcome] = await runChecks(
    [{ type: "files", required: true, paths: ["out/${job.title}"] }],
    context(folder, "*a*a*a*a*a*a*a*a*b"),
  );
  expect(outcome?.verdict).toBe("failed");
  expect(performance.now() - started).toBeLessThan(1000);
}, 120_000);
test("bound wildcards are literal and unsafe path characters are refused", async () => {
  const folder = tmp();
  mkdirSync(join(folder, "out"));
  writeFileSync(join(folder, "out", "other"), "x");
  const run = async (title: string) =>
    (
      await runChecks(
        [{ type: "files", required: true, paths: ["out/${job.title}"] }],
        context(folder, title),
      )
    ).at(0);
  expect((await run("*"))?.verdict).toBe("failed");
  writeFileSync(join(folder, "out", "*"), "x");
  expect((await run("*"))?.verdict).toBe("passed");
  expect((await run("?"))?.verdict).toBe("failed");
  writeFileSync(join(folder, "out", "?"), "x");
  expect((await run("?"))?.verdict).toBe("passed");
  for (const title of ["../out/other", "a\\b", `a${String.fromCodePoint(0)}b`])
    expect((await run(title))?.verdict).toBe("failed");
});
test("flow wildcards remain wildcards alongside literal bound values", async () => {
  const folder = tmp();
  mkdirSync(join(folder, "out"));
  writeFileSync(join(folder, "out", "pre*post.txt"), "x");
  const checks = [{ type: "files" as const, required: true, paths: ["out/pre${job.title}*.txt"] }];
  expect((await runChecks(checks, context(folder, "*"))).at(0)?.verdict).toBe("passed");
  expect((await runChecks(checks, context(folder, "?"))).at(0)?.verdict).toBe("failed");
});
test("empty bound patterns fail contains and not_contains", async () => {
  const results = await runChecks(
    [
      { type: "contains", required: true, pattern: "${job.title}" },
      { type: "not_contains", required: true, pattern: "${job.title}" },
    ],
    context(tmp(), ""),
  );
  expect(results).toEqual([
    expect.objectContaining({ verdict: "failed", summary: "empty pattern" }),
    expect.objectContaining({ verdict: "failed", summary: "empty pattern" }),
  ]);
});
test("a command that exits 0 passes even when it prints more than 1 MB", async () => {
  const out = await defaultCommandRunner()(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"],
    { cwd: tmp(), timeoutMs: 10_000, signal: new AbortController().signal },
  );
  expect(out.code).toBe(0);
});
test("command stderr keeps only its last 64 KB", async () => {
  const out = await defaultCommandRunner()(
    process.execPath,
    ["-e", "process.stderr.write('x'.repeat(100000) + 'end'); process.exitCode = 2"],
    { cwd: tmp(), timeoutMs: 10000, signal: new AbortController().signal },
  );
  expect(out.code).toBe(2);
  expect(Buffer.byteLength(out.stderr)).toBeLessThanOrEqual(65536);
  expect(out.stderr.endsWith("end")).toBe(true);
});
test("a command whose child sleeps is gone after the time limit", async () => {
  const script =
    "const {spawn} = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); process.stderr.write(String(c.pid)); setInterval(() => {}, 1000)";
  const out = await defaultCommandRunner()(process.execPath, ["-e", script], {
    cwd: tmp(),
    timeoutMs: 500,
    signal: new AbortController().signal,
  });
  const pid = Number(out.stderr);
  expect(pid).toBeGreaterThan(0);
  let gone = false;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      gone = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(gone).toBe(true);
});
