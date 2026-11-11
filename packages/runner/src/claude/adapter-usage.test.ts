import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { HarnessCallError, type StepRequest } from "../harness.ts";
import { FAKE_CLAUDE_PATH, type FakeAction, makeFakeHome } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(actions: FakeAction[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({ plays: [{ when: "", actions }] });
  roots.push(home);
  const project = join(root, "proj dir");
  const controlRoot = join(root, "app data", "control");
  mkdirSync(project, { recursive: true });
  let n = 0;
  const options = {
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({
      HOME: home,
      PATH: process.env.PATH,
      USER: "u",
      TMPDIR: "/tmp",
      LANG: "C",
      LOGNAME: "x",
      SHELL: "/bin/zsh",
      ANTHROPIC_API_KEY: "k",
      CLAUDE_CONFIG_DIR: "/c",
    }),
    controlRoot,
    audit: () => {},
    newId: () => `cc-${++n}`,
    newSessionId: () => "session-1",
    newToken: () => "0123456789abcdef",
    rounds: 20,
    nowMs: () => Date.parse("2026-11-11T09:00:00.000Z"),
  };
  const request: StepRequest = {
    runId: "r",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "Read note.txt",
    uses: [],
    project,
    requirements: [],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return { root, home, project, controlRoot, options, request, adapter: createClaudeAdapter(options) };
}

test("a step's result carries the call: tokens per model, turns, cost, wall time and the rate limits", async () => {
  const { adapter, request } = setup([
    {
      do: "rate_limit",
      status: "allowed_warning",
      limit: {
        type: "seven_day",
        utilization: 0.78,
        resetsAt: 1794654000,
        fiveHour: { utilization: 0.29, resetsAt: 1794396000 },
        sevenDay: { utilization: 0.78, resetsAt: 1794654000 },
      },
    },
    { do: "text", text: "done" },
    {
      do: "result",
      result: "used 10 tokens",
      usage: {
        models: [{ model: "claude-haiku-5-5", input: 4, output: 9000, cacheRead: 8454, cacheWrite: 156 }],
        turns: 2,
        costUsd: 0.01,
      },
    },
  ]);
  const r = await adapter.runStep(request);
  expect(r.exit).toBe("ok");
  expect(r.call?.models).toEqual([
    { model: "claude-haiku-5-5", input: 4, output: 9000, cacheRead: 8454, cacheWrite: 156 },
  ]);
  expect(r.call?.turns).toBe(2);
  expect(r.call?.costUsd).toBe(0.01);
  expect(r.call?.limits.at(0)?.windows.five_hour?.utilization).toBe(0.29);
  expect(r.call?.wallMs).toBeGreaterThanOrEqual(0);
});
test("a judge that is refused throws a HarnessCallError that carries the exit class and the call", async () => {
  const { adapter } = setup([
    { do: "rate_limit", status: "rejected" },
    {
      do: "result",
      result: "x",
      isError: true,
      apiErrorStatus: 429,
      usage: { models: [{ model: "m", input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }], turns: 1 },
    },
  ]);
  const err = await adapter
    .judge({
      runId: "r",
      stepId: "s",
      itemKey: "k",
      rubric: "ok?",
      output: "x",
      signal: new AbortController().signal,
    })
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(HarnessCallError);
  expect(err).toMatchObject({ exit: "quota" });
  expect((err as HarnessCallError).call?.models.at(0)?.output).toBe(2);
});
test("a refused step still reports its call, and onStart gets the child's pid", async () => {
  const { adapter, request } = setup([
    { do: "rate_limit", status: "rejected" },
    { do: "result", result: "x", isError: true, apiErrorStatus: 429 },
  ]);
  let pid = 0;
  const r = await adapter.runStep({
    ...request,
    onStart: (p) => {
      pid = p;
    },
  });
  expect(r.exit).toBe("quota");
  expect(r.call?.limits.at(0)?.status).toBe("rejected");
  expect(pid).toBeGreaterThan(0);
});
