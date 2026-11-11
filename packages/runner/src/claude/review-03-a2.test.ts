// Belongs in: packages/runner/src/claude/review-03-a2.test.ts
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FAKE_HELP } from "../test-helpers/fake-claude-script.ts";
import { scanClaude } from "./scan.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("a signed-out Claude Code that prints its answer and exits 1 is logged_out, not unknown", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const bin = join(root, "claude");
  // Like most `auth status` commands: the JSON answer is printed, the exit code says "not signed in".
  writeFileSync(
    bin,
    `#!/bin/sh
case "$1" in
  --version) echo "2.1.318 (Claude Code)" ;;
  --help) printf '%s\\n' ${FAKE_HELP.trim().split("\n").join(" ")} ;;
  auth) echo '{"loggedIn":false,"authMethod":"none"}'; exit 1 ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  const scan = await scanClaude({
    explicit: bin,
    cwd: root,
    env: { HOME: root, PATH: "/usr/bin:/bin" },
    now: () => new Date("2026-11-11T00:00:00.000Z"),
    timeoutMs: 5000,
  });
  expect(scan.login).toBe("logged_out");
});
