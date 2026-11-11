import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type FakeAction =
  | { do: "text"; text: string }
  | {
      do: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      write?: { path: string; text: string };
      result?: string;
    }
  | {
      do: "ungated";
      id: string;
      name: string;
      input?: Record<string, unknown>;
      write?: { path: string; text: string };
    }
  | { do: "pause"; ms: number }
  | { do: "rate_limit"; status: string }
  | { do: "ignore_sigterm" }
  | { do: "raw"; line: string; newline?: boolean }
  | { do: "result"; result?: string; structured?: unknown; isError?: boolean; apiErrorStatus?: number }
  | { do: "auth_failure" }
  | { do: "exit"; code: number; stderr?: string };
export type FakePlay = {
  when: string;
  startHook?: boolean;
  startEvents?: number;
  startExitCode?: number;
  init?: false | Record<string, unknown>;
  actions: FakeAction[];
};
export type FakeScript = {
  version?: string;
  help?: string;
  auth?: { loggedIn: boolean; authMethod?: string } | { raw: string };
  plugins?: unknown[] | { raw: string };
  mcp?: string;
  hang?: ("version" | "help" | "auth" | "plugins" | "mcp")[];
  plays?: FakePlay[];
};
export type FakeCall =
  | { kind: "call"; pid: number; args: string[]; cwd: string; env: string[]; prompt?: string }
  | { kind: "init" }
  | { kind: "tool"; id: string; name: string; hookExit: number | null; ran: boolean };
export const FAKE_CLAUDE_PATH = fileURLToPath(new URL("./fake-claude.ts", import.meta.url));
export const FAKE_HELP =
  [
    "--output-format",
    "--verbose",
    "--no-session-persistence",
    "--session-id",
    "--model",
    "--restricted",
    "--strict-mcp-config",
    "--mcp-config",
    "--tools",
    "--disable-slash-commands",
    "--permission-prompts",
    "--settings",
    "--add-dir",
    "--json-schema",
  ].join("\n") + "\n";
export function makeFakeHome(script: FakeScript = {}): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  writeFakeScript(home, script);
  return home;
}
export function writeFakeScript(home: string, script: FakeScript): void {
  writeFileSync(join(home, "fake-claude.json"), JSON.stringify(script));
}
export function readFakeCalls(home: string): FakeCall[] {
  const path = join(home, "fake-claude.calls.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeCall);
}
