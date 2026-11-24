import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowManifest, Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { routeRequirement } from "../router/route.ts";
import { gate } from "../service/claude-harness.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { decide } from "./decide.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const cli = Requirement.parse({ id: "cli", type: "cli_tool", commands: ["git status"] });
const folder = Requirement.parse({ id: "folder", type: "path", access: "read" });
const route = routeRequirement(cli, { hooks: true, chrome: false });
if (!route?.routed) throw new Error("Missing route");
test("an allowed and a refused Bash call are written to the audit log, and the refusal is counted under Blocked calls", {
  timeout: 20000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-")));
  roots.push(root);
  const home = makeFakeHome({
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "a", name: "Bash", input: { command: "git status", description: "status" } },
          { do: "tool", id: "b", name: "Bash", input: { command: "git log", description: "log" } },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  const audits: { kind: string; detail: unknown }[] = [];
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: (kind, _run, detail) => audits.push({ kind, detail }),
    newId: () => "cc-1",
    newSessionId: () => "s",
  });
  const request: StepRequest = {
    runId: "r",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "work",
    uses: ["cli", "folder"],
    project,
    requirements: [cli, folder],
    routes: [route],
    takesOutside: false,
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  expect(await adapter.runStep(request)).toMatchObject({ exit: "ok" });
  expect(readFakeCalls(home)).toContainEqual(expect.objectContaining({ kind: "tool", id: "a", ran: true }));
  expect(audits).toContainEqual(
    expect.objectContaining({
      kind: "command_run",
      detail: expect.objectContaining({ command: "git status" }),
    }),
  );
  expect(audits).toContainEqual(
    expect.objectContaining({ kind: "tool_denied", detail: expect.objectContaining({ tool: "Bash" }) }),
  );
  expect(audits).toContainEqual(
    expect.objectContaining({ kind: "tool_calls", detail: expect.objectContaining({ held: 0, refused: 1 }) }),
  );
});
test("the gate passes a step with a routed cli_tool, and Bash in a step without one is refused as today", () => {
  expect(
    decide(
      { tools: [], folders: [], cwd: "", addDirs: [], schema: false, sessionId: "s" },
      {
        hook_event_name: "PreToolUse",
        session_id: "s",
        tool_name: "Bash",
        tool_use_id: "1",
        tool_input: { command: "git status" },
      },
    ).allow,
  ).toBe(false);
  const manifest = FlowManifest.parse({
    format: "flowdriven-flow/1.1",
    id: "local.test",
    name: "Test",
    kind: "light",
    requirements: [cli, folder],
    steps: [{ id: "s", do: "worker", instructions: "work", uses: ["cli", "folder"] }],
  });
  const scan = {
    detected: true,
    path: "/bin/claude",
    version: "2.1.318",
    missingFlags: [],
    configFolder: true,
    login: "logged_in" as const,
    scannedAt: "2026-11-11T00:00:00.000Z",
    chrome: true,
  };
  expect(
    gate({
      platform: "darwin",
      dataDir: "/tmp/data",
      scan,
      finished: true,
      fileExists: () => true,
      permission: "on",
      manifest,
      facts: { hooks: true, chrome: false },
      allowed: true,
    }),
  ).toEqual({ ready: true });
});
