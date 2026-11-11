import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
// main.ts logs through process.stderr inside the uncaught-error guard, and
// process.stderr has no 'error' listener. Once the reader of stderr is gone,
// one logged error gives EPIPE, which is itself an uncaught error, which is
// logged again: the runner spins in a busy loop of EPIPE reports.
test("review P1: one error after stderr is closed is reported once, not in a loop", {
  timeout: 20_000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  const log = join(dir, "guard.log");
  writeFileSync(log, "");
  const script = join(dir, "child.mjs");
  const target = new URL("./run-process.ts", import.meta.url).href;
  writeFileSync(
    script,
    [
      'import { appendFileSync } from "node:fs";',
      `import { guardProcess } from ${JSON.stringify(target)};`,
      `const errors = (line) => { appendFileSync(${JSON.stringify(log)}, "x\\n"); process.stderr.write(line + "\\n"); };`,
      "guardProcess(process, errors);",
      'setTimeout(() => { throw new Error("first"); }, 300);',
      "setTimeout(() => process.exit(0), 1500);",
    ].join("\n"),
  );
  const child = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  child.stderr.destroy();
  await new Promise((resolve) => child.on("exit", resolve));
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length;
  expect(calls).toBeLessThanOrEqual(3);
});
