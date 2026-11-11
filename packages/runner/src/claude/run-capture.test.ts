import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  type FakeScript,
  makeFakeHome,
  readFakeCalls,
} from "../test-helpers/fake-claude-script.ts";
import { runCapture } from "./run-capture.ts";

const homes: string[] = [];
function home(script: FakeScript = {}) {
  const h = makeFakeHome(script);
  homes.push(h);
  return h;
}
function env(h: string) {
  return { HOME: h, PATH: process.env.PATH ?? "" };
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
test("a process that outlives its time limit is killed", { timeout: 20_000 }, async () => {
  const h = home({ hang: ["version"] });
  const start = performance.now();
  const result = await runCapture(FAKE_CLAUDE_PATH, ["--version"], {
    env: env(h),
    timeoutMs: 300,
    maxBytes: 1000,
  });
  expect(result.timedOut).toBe(true);
  expect(performance.now() - start).toBeLessThan(5000);
});
test("output over the cap is cut, the process is killed and truncated is true", {
  timeout: 20_000,
}, async () => {
  const h = home({ mcp: "x".repeat(2 * 1024 * 1024) });
  const result = await runCapture(FAKE_CLAUDE_PATH, ["mcp", "list"], {
    env: env(h),
    timeoutMs: 5000,
    maxBytes: 1000,
  });
  expect(Buffer.byteLength(result.stdout)).toBe(1000);
  expect(result.truncated).toBe(true);
  expect(result.timedOut).toBe(false);
});
test("a missing binary gives code null and a sentence, and only the given environment reaches the child", {
  timeout: 20_000,
}, async () => {
  const h = home();
  const missing = await runCapture(`${h}/missing`, [], { env: env(h), timeoutMs: 5000, maxBytes: 1000 });
  expect(missing.code).toBeNull();
  expect(missing.stderr.length).toBeGreaterThan(0);
  await runCapture(FAKE_CLAUDE_PATH, ["--version"], { env: env(h), cwd: h, timeoutMs: 5000, maxBytes: 1000 });
  expect(readFakeCalls(h).at(0)).toMatchObject({ env: ["HOME", "PATH"] });
});

test("the hard deadline closes pipes held by a detached descendant", { timeout: 20_000 }, async () => {
  const h = home();
  const script = join(h, "holder");
  writeFileSync(
    script,
    `#!/bin/sh
/usr/bin/perl -e 'use POSIX; if (fork() == 0) { setsid(); $|=1; print "ready\\n"; sleep 6; exit 0 } sleep 6'
`,
  );
  chmodSync(script, 0o755);
  const started = performance.now();
  const result = await runCapture(script, [], { env: env(h), cwd: h, timeoutMs: 1000, maxBytes: 1000 });
  expect(result.stdout).toContain("ready");
  expect(result.timedOut).toBe(true);
  expect(performance.now() - started).toBeLessThan(3000);
});
