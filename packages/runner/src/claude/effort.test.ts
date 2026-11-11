import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { StepRequest } from "../harness.ts";
import { FAKE_CLAUDE_PATH, makeFakeHome, readFakeCalls } from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(withTable: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  const home = makeFakeHome({ plays: [{ when: "", actions: [{ do: "result" }] }] });
  roots.push(home);
  const project = join(root, "project");
  mkdirSync(project);
  let n = 0;
  const adapter = createClaudeAdapter({
    claudePath: () => FAKE_CLAUDE_PATH,
    env: () => ({ HOME: home, PATH: process.env.PATH, USER: "u", TMPDIR: "/tmp", LANG: "C" }),
    controlRoot: join(root, "control"),
    audit: () => {},
    newId: () => `cc-${++n}`,
    newSessionId: () => "session-1",
    ...(withTable ? { effortModels: () => ({ low: "tiny-1", medium: "mid-2", high: "big-3" }) } : {}),
  });
  const request: StepRequest = {
    runId: "r",
    stepId: "s",
    itemKey: "",
    attempt: 1,
    replan: false,
    kind: "worker",
    title: "t",
    instructions: "test",
    uses: [],
    project,
    requirements: [],
    outputs: [],
    maxDurationMs: 10000,
    signal: new AbortController().signal,
  };
  return { adapter, request, home };
}
for (const [withTable, models] of [
  [true, ["tiny-1", "big-3", "mid-2"]],
  [false, ["haiku", "opus", "sonnet"]],
] as const) {
  test(`effort chooses ${withTable ? "the configured models" : "the default aliases"}`, {
    timeout: 20_000,
  }, async () => {
    const t = setup(withTable);
    for (const [i, effort] of (["low", "high", undefined] as const).entries()) {
      await t.adapter.runStep({ ...t.request, ...(effort === undefined ? {} : { effort }) });
      const calls = readFakeCalls(t.home).filter((entry) => entry.kind === "call");
      const args = calls.at(i)?.args;
      expect(args?.at((args?.indexOf("--model") ?? -2) + 1)).toBe(models.at(i));
    }
  });
}
