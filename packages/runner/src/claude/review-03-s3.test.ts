// Belongs in packages/runner/src/claude/review-03-s3.test.ts
// S3: after stop() the adapter refuses runStep, but judge() still starts a new Claude Code that no one will stop.
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const roots: string[] = [];
const pids: number[] = [];
afterEach(() => {
  for (const pid of pids.splice(0))
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("S3 judge after stop() starts no child and leaves no control folder", { timeout: 20_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({ plays: [{ when: "", actions: [{ do: "pause", ms: 30000 }] }] });
  roots.push(home);
  const controlRoot = join(root, "app data", "control");
  let n = 0;
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u" }),
    controlRoot,
    audit: () => {},
    newId: () => `cc-${++n}`,
    rounds: 3,
  });
  adapter.stop?.();
  const judged = adapter
    .judge({ runId: "r", stepId: "s", rubric: "r", output: "o", signal: new AbortController().signal })
    .then(
      () => "resolved",
      () => "rejected",
    );
  const settled = await Promise.race([judged, new Promise((r) => setTimeout(() => r("pending"), 2000))]);
  const calls = readFakeCalls(home).filter((c) => c.kind === "call");
  for (const c of calls) if (c.kind === "call") pids.push(c.pid);
  let left: string[] = [];
  try {
    left = readdirSync(controlRoot);
  } catch {}
  expect({ calls: calls.length, left, settled }).toEqual({ calls: 0, left: [], settled: "rejected" });
});
