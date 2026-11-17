import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LimitWindow } from "../harness.ts";
import type { ModelUsage } from "../storage.ts";

export type FakeAction =
  | { do: "text"; text: string }
  | {
      do: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      write?: { path: string; text: string };
      result?: string;
      blocks?: unknown[];
    }
  | {
      do: "ungated";
      id: string;
      name: string;
      input?: Record<string, unknown>;
      write?: { path: string; text: string };
    }
  | { do: "pause"; ms: number }
  | { do: "hold"; file: string }
  | {
      do: "rate_limit";
      status: string;
      limit?: {
        type?: string;
        utilization?: number;
        resetsAt?: number;
        fiveHour?: LimitWindow;
        sevenDay?: LimitWindow;
      };
    }
  | { do: "ignore_sigterm" }
  | { do: "raw"; line: string; newline?: boolean }
  | {
      do: "result";
      result?: string;
      structured?: unknown;
      isError?: boolean;
      apiErrorStatus?: number;
      usage?: { models: ModelUsage[]; turns?: number; costUsd?: number };
    }
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
  chrome?: boolean;
  pages?: Record<string, { final?: string; title: string; text: string }>;
  help?: string;
  auth?: { loggedIn: boolean; authMethod?: string } | { raw: string };
  plugins?: unknown[] | { raw: string };
  mcp?: string;
  connectors?: Record<
    string,
    {
      url: string;
      id: string;
      status?: "connected" | "needs-auth" | "failed" | "pending";
      tools: { name: string; readOnly?: boolean }[];
    }
  >;
  connectorPending?: number;
  connectorAbsent?: number;
  hang?: ("version" | "help" | "auth" | "plugins" | "mcp" | "status")[];
  plays?: FakePlay[];
};
export type FakeCall =
  | {
      kind: "call";
      pid: number;
      args: string[];
      cwd: string;
      env: string[];
      skillFiles?: Record<string, string>;
      prompt?: string;
    }
  | { kind: "post"; id: string; name: string; hookExit: number | null; replaced: boolean }
  | { kind: "control"; subtype: string; restricted: boolean }
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
    "--no-chrome",
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
    .map((line) => {
      const call = JSON.parse(line) as FakeCall;
      if (call.kind === "call" && call.skillFiles && Object.keys(call.skillFiles).length === 0) {
        const { skillFiles: _skillFiles, ...rest } = call;
        return rest;
      }
      return call;
    });
}
