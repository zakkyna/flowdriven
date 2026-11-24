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
test("TC-AGT-33 the run model overrides effort for each call", { timeout: 20_000 }, async () => {
  const t = setup(true);
  for (const effort of ["low", "high"] as const) {
    await t.adapter.runStep({ ...t.request, effort, model: "opus-5.5" });
  }
  await t.adapter.judge({
    runId: "r",
    stepId: "s",
    rubric: "test",
    output: "test",
    model: "opus-5.5",
    signal: t.request.signal,
  });
  const calls = readFakeCalls(t.home).filter((entry) => entry.kind === "call");
  expect(calls).toHaveLength(3);
  expect(calls.map(({ args }) => args[args.indexOf("--model") + 1])).toEqual([
    "opus-5.5",
    "opus-5.5",
    "opus-5.5",
  ]);
});

test("TC-AGT-33 stored run model reaches every retry", async () => {
  const { setup: setupEngine } = await import("../test-helpers/engine.ts");
  const { oneStepFlow } = await import("../test-helpers/flows.ts");
  const t = await setupEngine(oneStepFlow("local.models", { retry: 1, effort: "low" }), {
    steps: { a: [{ exit: "failed" }, { text: "x", outputs: { draft: "x" } }] },
  });
  try {
    for (const model of ["opus-5.5", "sonnet-5.5"]) {
      const begun = t.engine.beginStart("local.models", { project: tmpdir() });
      t.store.updateRun(begun.run.id, {
        agent: { agent: "claude-code", model, choice: model === "opus-5.5" ? "chat" : "main" },
      });
      await begun.settled;
      expect(t.harness.calls.filter((call) => call.runId === begun.run.id).map((call) => call.model)).toEqual(
        model === "opus-5.5" ? [model, model] : [model],
      );
    }
  } finally {
    t.engine.shutdown();
    t.store.close();
  }
});
