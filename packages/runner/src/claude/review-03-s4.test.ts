// Belongs in packages/runner/src/claude/review-03-s4.test.ts
// S4: after the step is aborted (the engine's time limit), the channel keeps answering "allow" during the grace,
// so a Claude Code that does not end on SIGTERM at once still writes. The engine has already moved on (raceAbort).
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test } from "vitest";
import { FAKE_CLAUDE_PATH, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
test("S4 a tool call that comes after the abort is not allowed", { timeout: 20_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const project = join(root, "proj dir");
  const notes = join(project, "notes");
  mkdirSync(notes, { recursive: true });
  const late = join(notes, "late.txt");
  const home = makeFakeHome({
    plays: [
      {
        when: "",
        actions: [
          { do: "ignore_sigterm" },
          { do: "pause", ms: 1500 },
          {
            do: "tool",
            id: "t1",
            name: "Write",
            input: { file_path: late, content: "x" },
            write: { path: late, text: "x" },
          },
          { do: "result", result: "done" },
        ],
      },
    ],
  });
  roots.push(home);
  let n = 0;
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u" }),
    controlRoot: join(root, "app data", "control"),
    audit: () => {},
    newId: () => `cc-${++n}`,
    rounds: 20,
    graceMs: 4000,
  });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 300);
  const result = await adapter.runStep({
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Write",
    uses: ["notes"],
    project,
    requirements: [Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read_write" })],
    outputs: [],
    maxDurationMs: 10000,
    signal: ctl.signal,
  });
  expect({ text: result.text, wroteAfterAbort: existsSync(late) }).toEqual({
    text: "The step was aborted.",
    wroteAfterAbort: false,
  });
});

test("S4b a tool that runs without the check after the abort still trips the wire and blocks", {
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const project = join(root, "proj dir");
  const notes = join(project, "notes");
  mkdirSync(notes, { recursive: true });
  const late = join(notes, "late.txt");
  const home = makeFakeHome({
    plays: [
      {
        when: "",
        actions: [
          { do: "ignore_sigterm" },
          { do: "pause", ms: 1500 },
          {
            do: "ungated",
            id: "u1",
            name: "Write",
            input: { file_path: late },
            write: { path: late, text: "x" },
          },
          { do: "pause", ms: 30000 },
        ],
      },
    ],
  });
  roots.push(home);
  let n = 0;
  const audits: string[] = [];
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u" }),
    controlRoot: join(root, "app data", "control"),
    audit: (kind) => audits.push(kind),
    newId: () => `cc-${++n}`,
    rounds: 20,
    graceMs: 4000,
  });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 300);
  const result = await adapter.runStep({
    runId: "r1",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Write",
    uses: ["notes"],
    project,
    requirements: [Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read_write" })],
    outputs: [],
    maxDurationMs: 10000,
    signal: ctl.signal,
  });
  expect({
    ran: existsSync(late),
    block: result.block,
    unchecked: audits.includes("tool_unchecked"),
  }).toEqual({
    ran: true,
    block: "A tool ran without FlowDriven's check (Write). The step was stopped.",
    unchecked: true,
  });
});
