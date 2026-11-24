#!/usr/bin/env node
// synthetic: written by hand, never recorded
// Synthetic fake command, written by hand; no real agent output is recorded.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeCodexScript } from "./fake-codex-script.ts";

const home = process.env.HOME;
if (!home) throw new Error("HOME is required");
const script = JSON.parse(readFileSync(join(home, "fake-codex.json"), "utf8")) as FakeCodexScript;
const args = process.argv.slice(2);
const matches = (prefix: string[]) => prefix.length > 0 && prefix.every((value, i) => args[i] === value);
const isStatus = args.length === script.profile.status.args.length && matches(script.profile.status.args);
const isModels = args.length === script.profile.modelsCommand.length && matches(script.profile.modelsCommand);
const isRun = matches(script.profile.run);
let prompt: string | undefined;
if (isRun) {
  prompt = "";
  for await (const chunk of process.stdin) prompt += String(chunk);
}
appendFileSync(
  join(home, "fake-codex.calls.jsonl"),
  `${JSON.stringify({
    kind: "call",
    args,
    cwd: process.cwd(),
    env: Object.keys(process.env)
      .filter((key) => key !== "__CF_USER_TEXT_ENCODING")
      .sort(),
    ...(prompt === undefined ? {} : { prompt }),
  })}\n`,
);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write(`${script.version ?? "0.166.0"}\n`);
} else if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("fake codex\n");
} else if (isStatus) {
  const status = script.signedIn === false ? script.profile.status.signedOut : script.profile.status.signedIn;
  process.stdout.write(status.stdout);
  process.exitCode = status.exitCode;
} else if (isModels) {
  process.stdout.write(`${script.profile.models.join("\n")}\n`);
} else if (isRun) {
  for (const event of script.events ?? []) process.stdout.write(`${JSON.stringify(event)}\n`);
} else {
  process.stderr.write("fake-codex: unknown command");
  process.exitCode = 3;
}
