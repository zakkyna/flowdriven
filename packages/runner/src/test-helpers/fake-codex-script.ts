// synthetic: written by hand, never recorded
// Synthetic fake script, written by hand; no real agent output is recorded.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProfile } from "./agent-profiles.ts";

export type FakeCodexScript = {
  profile: AgentProfile;
  version?: string;
  signedIn?: boolean;
  events?: unknown[];
};
export type FakeCodexCall = { kind: "call"; args: string[]; cwd: string; env: string[]; prompt?: string };
export const FAKE_CODEX_PATH = fileURLToPath(new URL("./fake-codex.ts", import.meta.url));
export function makeFakeCodexHome(script: FakeCodexScript): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-codex-")));
  writeFakeCodexScript(home, script);
  return home;
}
export function writeFakeCodexScript(home: string, script: FakeCodexScript): void {
  writeFileSync(join(home, "fake-codex.json"), JSON.stringify(script));
}
export function readFakeCodexCalls(home: string): FakeCodexCall[] {
  const path = join(home, "fake-codex.calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCodexCall);
}
