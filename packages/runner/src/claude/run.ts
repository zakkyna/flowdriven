import type { Value } from "@flowdriven/sdk";
import { buildClaudeArgs, type ClaudeModel } from "./args.ts";
import { startChannel } from "./channel.ts";
import { startChild } from "./child.ts";
import { createControlDir, removeControlDir } from "./control.ts";
import { decide } from "./decide.ts";
import { childEnv } from "./env.ts";
import type { Policy } from "./policy.ts";
import {
  isAuthFailure,
  isRateLimited,
  LineReader,
  parseEvent,
  parseResult,
  type ResultInfo,
} from "./stream.ts";
export type RunInput = {
  runId: string;
  stepId: string;
  itemKey: string;
  attempt: number;
  model: ClaudeModel;
  schema?: object;
  signal: AbortSignal;
  makePolicy: (control: { root: string; cwd: string }, sessionId: string) => Policy;
  makePrompt: (policy: Policy) => string;
};
export type Outcome =
  | { kind: "ok"; text: string; structured?: unknown }
  | { kind: "auth" }
  | { kind: "quota" }
  | { kind: "interrupted" }
  | { kind: "block"; sentence: string }
  | { kind: "failed"; text: string };
export type RunDeps = {
  claudePath: string;
  env: Record<string, string | undefined>;
  controlRoot: string;
  newId: (prefix: string) => string;
  newSessionId: () => string;
  audit: (kind: string, runId: string, detail: Value) => void;
  rounds: number;
  pollMs: number;
  graceMs: number;
  exitWaitMs: number;
  maxLineBytes: number;
};
export async function runClaude(input: RunInput, deps: RunDeps): Promise<Outcome> {
  const id = deps.newId("cc");
  const sessionId = deps.newSessionId();
  const dir = createControlDir({ root: deps.controlRoot, id, rounds: deps.rounds });
  let channel: ReturnType<typeof startChannel> | undefined;
  let child: ReturnType<typeof startChild> | undefined;
  try {
    let policy: Policy;
    try {
      policy = input.makePolicy({ root: deps.controlRoot, cwd: dir.cwd }, sessionId);
    } catch (error) {
      return {
        kind: "block",
        sentence: error instanceof Error ? error.message : "FlowDriven could not check this step.",
      };
    }
    channel = startChannel({ dir, decide: (call) => decide(policy, call), pollMs: deps.pollMs });
    const args = buildClaudeArgs({
      model: input.model,
      sessionId,
      tools: policy.tools,
      settingsPath: dir.settings,
      addDirs: policy.addDirs,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
    });
    child = startChild(deps.claudePath, args, {
      cwd: policy.cwd,
      env: childEnv(deps.env),
      graceMs: deps.graceMs,
    });
    const reader = new LineReader(deps.maxLineBytes);
    let result: ResultInfo | undefined;
    let auth = false;
    let quota = false;
    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of reader.push(chunk).lines) {
        const event = parseEvent(line);
        if (!event) continue;
        auth ||= isAuthFailure(event);
        quota ||= isRateLimited(event);
        if (event.type === "result") result = parseResult(event);
      }
    });
    child.send(input.makePrompt(policy));
    const done = await child.done;
    if (auth || result?.authFailed) return { kind: "auth" };
    if (result?.ok && done.code === 0)
      return {
        kind: "ok",
        text: result.text,
        ...(result.structured === undefined ? {} : { structured: result.structured }),
      };
    if (quota || result?.apiErrorStatus === 429) return { kind: "quota" };
    return {
      kind: "failed",
      text:
        child.stderrTail().slice(-2000).trim() ||
        (result === undefined ? "Claude Code ended without a result." : "Claude Code reported an error."),
    };
  } finally {
    channel?.stop();
    child?.kill();
    removeControlDir(dir);
  }
}
