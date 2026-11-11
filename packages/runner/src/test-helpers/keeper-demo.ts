#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKeeperDemo } from "./keeper-demo-run.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
try {
  for (const line of await runKeeperDemo({ releaseFile: join(dir, "release") }))
    process.stdout.write(`${line}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
