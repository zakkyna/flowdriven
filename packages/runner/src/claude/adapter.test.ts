import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { afterEach, expect, test, vi } from "vitest";
import type { StepRequest } from "../harness.ts";
import {
  FAKE_CLAUDE_PATH,
  type FakeAction,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { createClaudeAdapter } from "./adapter.ts";
import { buildClaudeArgs } from "./args.ts";
import { buildPrompt, JUDGE_SCHEMA, judgePrompt, outputSchema } from "./prompt.ts";

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
const call = (home: string) => readFakeCalls(home).find((entry) => entry.kind === "call");
const note = () => Requirement.parse({ id: "notes", type: "path", ref: "notes", access: "read" });

test("a declared read passes and the argument list, folder, environment and prompt are exactly what was decided", {
  timeout: 20_000,
}, async () => {
  const t = setup([]);
  const cwd = join(t.project, "notes");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "note.txt"), "KIWI");
  writeFakeScript(t.home, {
    plays: [
      {
        when: "",
        actions: [
          { do: "tool", id: "t1", name: "Read", input: { file_path: join(cwd, "note.txt") } },
          { do: "text", text: "KIWI" },
          { do: "result" },
        ],
      },
    ],
  });
  t.request.uses = ["notes"];
  t.request.requirements = [note()];
  const pending = t.adapter.runStep(t.request);
  let settings = "";
  for (let i = 0; i < 100; i++) {
    try {
      settings = readFileSync(join(t.controlRoot, "cc-1", "settings.json"), "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  expect(settings).toContain(`/bin/sh '${join(t.controlRoot, "cc-1", "hook.sh")}'`);
  expect(await pending).toEqual({ exit: "ok", text: "KIWI", outputs: {} });
  expect(call(t.home)).toMatchObject({
    args: buildClaudeArgs({
      model: "sonnet",
      sessionId: "session-1",
      tools: ["Read", "Glob", "Grep"],
      settingsPath: join(t.controlRoot, "cc-1", "settings.json"),
      addDirs: [],
    }),
    cwd,
    env: ["HOME", "LANG", "PATH", "TMPDIR", "USER"],
    prompt: buildPrompt({ cwd, instructions: t.request.instructions, outputs: [] }),
  });
  expect(readFakeCalls(t.home)).toContainEqual({
    kind: "tool",
    id: "t1",
    name: "Read",
    hookExit: 0,
    ran: true,
  });
});
test("the control folder is gone when the attempt ends, however it ends", { timeout: 20_000 }, async () => {
  const t = setup([{ do: "result", result: "ok" }]);
  await t.adapter.runStep(t.request);
  expect(readdirSync(t.controlRoot)).toEqual([]);
  writeFakeScript(t.home, { plays: [{ when: "", actions: [{ do: "exit", code: 1 }] }] });
  await t.adapter.runStep(t.request);
  expect(readdirSync(t.controlRoot)).toEqual([]);
  t.request.requirements = [Requirement.parse({ id: "n", type: "path", ref: "../x", access: "read" })];
  await t.adapter.runStep(t.request);
  expect(readdirSync(t.controlRoot)).toEqual([]);
});
test("outputs go through the schema: the report is the text and every output is returned", {
  timeout: 20_000,
}, async () => {
  const structured = { report: "all done", outputs: { summary: "s", data: { a: [1] } } };
  const t = setup([
    { do: "tool", id: "t1", name: "StructuredOutput", input: structured },
    { do: "result", structured },
  ]);
  t.request.outputs = [
    { id: "summary", type: "text" },
    { id: "data", type: "json" },
  ];
  expect(await t.adapter.runStep(t.request)).toEqual({
    exit: "ok",
    text: "all done",
    outputs: structured.outputs,
  });
  const c = call(t.home);
  expect(c).toMatchObject({ cwd: join(t.controlRoot, "cc-1", "cwd") });
  if (c?.kind !== "call") throw Error("missing call");
  expect(c.args.slice(-2)).toEqual(["--json-schema", JSON.stringify(outputSchema(t.request.outputs))]);
  expect(c.args[c.args.indexOf("--tools") + 1]).toBe("");
  for (const bad of [{ report: "x" }, { report: "x", outputs: { summary: 5, data: 1 } }]) {
    writeFakeScript(t.home, { plays: [{ when: "", actions: [{ do: "result", structured: bad }] }] });
    expect(await t.adapter.runStep(t.request)).toEqual({
      exit: "failed",
      text: "Claude Code returned no valid structured output.",
      outputs: {},
    });
  }
});
test("not signed in gives exit auth", { timeout: 20_000 }, async () => {
  const t = setup([{ do: "auth_failure" }]);
  expect(await t.adapter.runStep(t.request)).toEqual({ exit: "auth", text: "", outputs: {} });
});
test("a stream with no result event is a failure with a sentence", { timeout: 20_000 }, async () => {
  const t = setup([{ do: "text", text: "x" }]);
  expect(await t.adapter.runStep(t.request)).toEqual({
    exit: "failed",
    text: "Claude Code ended without a result.",
    outputs: {},
  });
});
test("quota: a rejected rate limit and a 429 give exit quota, an allowed warning does not", {
  timeout: 20_000,
}, async () => {
  const t = setup([
    { do: "rate_limit", status: "rejected" },
    { do: "exit", code: 1 },
  ]);
  expect((await t.adapter.runStep(t.request)).exit).toBe("quota");
  writeFakeScript(t.home, {
    plays: [{ when: "", actions: [{ do: "result", isError: true, apiErrorStatus: 429 }] }],
  });
  expect((await t.adapter.runStep(t.request)).exit).toBe("quota");
  writeFakeScript(t.home, {
    plays: [
      {
        when: "",
        actions: [
          { do: "rate_limit", status: "allowed_warning" },
          { do: "result", result: "ok" },
        ],
      },
    ],
  });
  expect((await t.adapter.runStep(t.request)).exit).toBe("ok");
});
test("a non-zero exit gives failed with the tail of standard error", { timeout: 20_000 }, async () => {
  const t = setup([{ do: "exit", code: 2, stderr: "boom" }]);
  expect(await t.adapter.runStep(t.request)).toEqual({ exit: "failed", text: "boom", outputs: {} });
  const stderr = `${"a".repeat(98000)}${"b".repeat(2000)}`;
  writeFakeScript(t.home, { plays: [{ when: "", actions: [{ do: "exit", code: 2, stderr }] }] });
  expect((await t.adapter.runStep(t.request)).text).toBe("b".repeat(2000));
});
test("what the adapter will not run is blocked with a sentence", { timeout: 20_000 }, async () => {
  const t = setup([]);
  const skill = await t.adapter.runStep({ ...t.request, kind: "skill" });
  expect(skill).toMatchObject({ exit: "failed", block: "Skill steps are not run yet." });
  expect(
    await createClaudeAdapter({ ...t.options, claudePath: () => undefined }).runStep(t.request),
  ).toMatchObject({ exit: "failed", block: "Claude Code was not found." });
  for (const [req, block] of [
    [{ id: "n", type: "path", ref: "../x", access: "read" }, "The folder ../x is not inside the project."],
    [
      { id: "host", type: "mcp_server", tools: ["publish"] },
      "This step uses something FlowDriven cannot enforce yet (host).",
    ],
  ] as const)
    expect(await t.adapter.runStep({ ...t.request, requirements: [Requirement.parse(req)] })).toMatchObject({
      exit: "failed",
      block,
    });
  expect(readFakeCalls(t.home)).toEqual([]);
});
test("judge, replan and probe", { timeout: 20_000 }, async () => {
  const verdict = { verdict: "passed", reasons: "yes", evidence: "word" };
  const t = setup([{ do: "result", structured: verdict }]);
  const signal = t.request.signal;
  expect(
    await t.adapter.judge({ runId: "r", stepId: "s", rubric: "rubric", output: "word", signal }),
  ).toEqual(verdict);
  const c = call(t.home);
  if (c?.kind !== "call") throw Error("missing call");
  expect(c.args[c.args.indexOf("--tools") + 1]).toBe("");
  expect(c.args[c.args.indexOf("--model") + 1]).toBe("sonnet");
  expect(c.args.slice(-2)).toEqual(["--json-schema", JSON.stringify(JUDGE_SCHEMA)]);
  expect(c.prompt).toBe(judgePrompt({ rubric: "rubric", output: "word", token: "0123456789abcdef" }));
  writeFakeScript(t.home, { plays: [{ when: "", actions: [{ do: "result", structured: {} }] }] });
  expect(
    await t.adapter.judge({ runId: "r", stepId: "s", rubric: "rubric", output: "word", signal }),
  ).toEqual({ verdict: "failed", reasons: "Claude Code returned no valid verdict.", evidence: "" });
  expect(
    await t.adapter.replan({ runId: "r", stepId: "s", itemKey: "", instructions: "", failures: [], signal }),
  ).toBeUndefined();
  expect(await t.adapter.probe({ runId: "r", stepId: "s", tool: "", args: {} })).toEqual({
    ok: false,
    detail: "Probe checks are not connected yet.",
  });
});

test("judge retries marker collisions and fails closed after three", { timeout: 20_000 }, async () => {
  const t = setup([{ do: "result", structured: { verdict: "passed", reasons: "yes", evidence: "word" } }]);
  const req = {
    runId: "r",
    stepId: "s",
    rubric: "0123456789abcdef",
    output: "word",
    signal: t.request.signal,
  };
  const newToken = vi.fn().mockReturnValueOnce("0123456789abcdef").mockReturnValueOnce("fedcba9876543210");
  await createClaudeAdapter({ ...t.options, newToken }).judge(req);
  expect(newToken).toHaveBeenCalledTimes(2);
  expect(call(t.home)).toMatchObject({
    prompt: judgePrompt({ rubric: req.rubric, output: req.output, token: "fedcba9876543210" }),
  });
  const collision = vi.fn(() => "0123456789abcdef");
  await expect(createClaudeAdapter({ ...t.options, newToken: collision }).judge(req)).rejects.toThrow(
    "FlowDriven could not mark the judge's data.",
  );
  expect(collision).toHaveBeenCalledTimes(3);
});
