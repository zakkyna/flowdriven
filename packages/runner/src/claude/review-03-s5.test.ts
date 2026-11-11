// Belongs in packages/runner/src/claude/review-03-s5.test.ts
// S5: the attempt kills the process group only while the leader has not closed; a member of the group that
// outlives the leader (and does not hold its pipes) is left running after the attempt ended.
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createClaudeAdapter } from "./adapter.ts";

const roots: string[] = [];
const left: number[] = [];
afterEach(() => {
  for (const pid of left.splice(0))
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("S5 no member of the child's process group is alive when the attempt has ended", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const pidFile = join(root, "helper.pid");
  const fake = join(root, "claude");
  writeFileSync(
    fake,
    [
      "#!/bin/sh",
      "cat > /dev/null",
      `( trap '' TERM; sleep 30 ) </dev/null >/dev/null 2>&1 &`,
      `echo $! > '${pidFile}'`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
  let n = 0;
  const adapter = createClaudeAdapter({
    claudePath: () => fake,
    env: () => ({ HOME: root, PATH: "/usr/bin:/bin", USER: "u" }),
    controlRoot: join(root, "app data", "control"),
    audit: () => {},
    newId: () => `cc-${++n}`,
    rounds: 3,
  });
  const result = await adapter.runStep({
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "x",
    uses: [],
    project: root,
    requirements: [],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  });
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  left.push(pid);
  await new Promise((r) => setTimeout(r, 200));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  expect({ exit: result.exit, alive }).toEqual({ exit: "failed", alive: false });
});
