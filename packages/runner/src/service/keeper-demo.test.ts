import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runKeeperDemo } from "../test-helpers/keeper-demo-run.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("two runs started together with the ceiling at 1: one runs, the other waits and says why, then both report tokens per step", {
  timeout: 30_000,
}, async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  const lines = await runKeeperDemo({ releaseFile: join(dir, "release") });
  expect(lines[0]).toMatch(/^ceiling 1: run-\w+ running, run-\w+ waiting: Waiting: 1 of 1 running$/);
  expect(lines[1]).toBe("queue: 1 step running, 1 waiting");
  expect(lines[2]).toMatch(/^run-\w+ running$/);
  expect(lines[3]).toMatch(/^run-\w+ running, waiting: ceiling$/);
  expect(lines[4]).toMatch(/^run-\w+ done, run-\w+ done$/);
  expect(lines[5]).toBe("usage a: input 4, output 384, cache read 8454, cache write 156");
  expect(lines[6]).toMatch(/^\| a \| 1 \| 4 \| 384 \| 8454 \| 156 \| 2 \| /);
});
