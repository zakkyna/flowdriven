// Belongs in: packages/runner/src/claude/review-03-a3.test.ts
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runCapture } from "./run-capture.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("runCapture settles at its time limit even when a descendant outside the process group keeps the pipe open", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const bin = join(root, "claude");
  // The command exits at once, but leaves a process in a group of its own that holds standard output.
  writeFileSync(
    bin,
    `#!/bin/sh
/usr/bin/perl -e 'use POSIX; if (fork() == 0) { setsid(); sleep 6; exit 0 } exit 0'
`,
  );
  chmodSync(bin, 0o755);
  const started = Date.now();
  const result = await runCapture(bin, [], {
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 300,
    maxBytes: 1000,
  });
  // The scan's own limit is 10 s a command; a stuck pipe must not hold the first scan (and the recovery
  // of interrupted runs that waits for it) for longer than that limit plus a short grace.
  expect(Date.now() - started).toBeLessThan(3000);
  expect(result.timedOut || result.code === 0).toBe(true);
});
