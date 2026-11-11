import type { Value } from "@flowdriven/sdk";
import { buildClaudeArgs, type ClaudeModel } from "./args.ts";
import { startChannel } from "./channel.ts";
import { startChild } from "./child.ts";
import { createControlDir, removeControlDir } from "./control.ts";
import { DENY, decide } from "./decide.ts";
import { childEnv } from "./env.ts";
import type { Policy } from "./policy.ts";
import {
  checkFirstEvent,
  createTripwire,
  isAuthFailure,
  isRateLimited,
  LIMITS_NOT_APPLIED,
  LineReader,
  parseEvent,
  parseResult,
  type ResultInfo,
  tripSentence,
} from "./stream.ts";
export const MAX_DENIED_ENTRIES = 50;
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
  maxDeniedEntries?: number;
  register?: (stop: () => void) => () => void;
};
export async function runClaude(input: RunInput, deps: RunDeps): Promise<Outcome> {
  const id = deps.newId("cc");
  const sessionId = deps.newSessionId();
  const dir = createControlDir({ root: deps.controlRoot, id, rounds: deps.rounds });
  let channel: ReturnType<typeof startChannel> | undefined;
  let child: ReturnType<typeof startChild> | undefined;
  let interrupted = false;
  let abort = false;
  let forced: Outcome | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  const detail = { stepId: input.stepId, itemKey: input.itemKey, attempt: input.attempt };
  const audit = (kind: string, data: Value) => {
    try {
      deps.audit(kind, input.runId, data);
    } catch {}
  };
  const unregister = deps.register?.(() => {
    interrupted = true;
    child?.kill();
    channel?.stop();
    removeControlDir(dir);
  });
  const onAbort = () => {
    abort = true;
    child?.stop();
  };
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
    let deniedEntries = 0;
    channel = startChannel({
      dir,
      decide: (call) => {
        const decision = decide(policy, call);
        if (
          !decision.allow &&
          (decision.tool === "Write" || decision.tool === "Edit") &&
          !policy.tools.includes(decision.tool)
        ) {
          const checked = decide({ ...policy, tools: [...policy.tools, decision.tool] }, call);
          if (!checked.allow && checked.reason === DENY.readOnly) return checked;
        }
        return decision;
      },
      pollMs: deps.pollMs,
      onCall: ({ decision }) => {
        if (!decision.allow && deniedEntries < (deps.maxDeniedEntries ?? MAX_DENIED_ENTRIES)) {
          deniedEntries++;
          audit("tool_denied", {
            ...detail,
            tool: decision.tool,
            reason: decision.reason,
            ...(decision.target === undefined ? {} : { target: decision.target }),
          });
        }
      },
    });
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
    const tripwire = createTripwire(channel.allowedIds);
    let first = true;
    let result: ResultInfo | undefined;
    let auth = false;
    let quota = false;
    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    child.stdout.on("data", (chunk: Buffer) => {
      if (forced || interrupted || abort) return;
      const read = reader.push(chunk);
      if (read.overflow) {
        forced = { kind: "failed", text: "Claude Code sent a line that was too long." };
        child?.kill();
        return;
      }
      for (const line of read.lines) {
        if (line.trim() === "") continue;
        const event = parseEvent(line);
        if (first) {
          first = false;
          const proof = checkFirstEvent(event, {
            tools: policy.tools,
            schema: input.schema !== undefined,
            sessionId,
            started: channel?.started() ?? false,
          });
          if (!proof.ok) {
            audit("limits_not_applied", {
              ...detail,
              why: proof.why === "The start hook did not run." ? "the start hook did not run" : proof.why,
            });
            forced = { kind: "block", sentence: LIMITS_NOT_APPLIED };
            child?.kill();
            break;
          }
          continue;
        }
        if (!event) continue;
        const trip = tripwire.check(event);
        if (trip.tripped) {
          audit("tool_unchecked", { ...detail, tool: trip.tool });
          forced = { kind: "block", sentence: tripSentence(trip.tool) };
          child?.kill();
          break;
        }
        auth ||= isAuthFailure(event);
        quota ||= isRateLimited(event);
        if (event.type === "result") {
          result = parseResult(event);
          if (exitTimer === undefined)
            exitTimer = setTimeout(() => {
              forced = { kind: "failed", text: "Claude Code did not exit after its result." };
              child?.kill();
            }, deps.exitWaitMs);
        }
      }
    });
    child.send(input.makePrompt(policy));
    const done = await child.done;
    if (interrupted) return { kind: "interrupted" };
    if (abort) return { kind: "failed", text: "The step was aborted." };
    if (forced) return forced;
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
    input.signal.removeEventListener("abort", onAbort);
    if (exitTimer !== undefined) clearTimeout(exitTimer);
    channel?.stop();
    audit("tool_calls", { ...detail, ...(channel?.counts() ?? { allowed: 0, denied: 0 }) });
    child?.kill();
    removeControlDir(dir);
    unregister?.();
  }
}
