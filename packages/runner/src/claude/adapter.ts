import { randomBytes, randomUUID } from "node:crypto";
import type { Value } from "@flowdriven/sdk";
import { type CallInfo, type HarnessAdapter, HarnessCallError } from "../harness.ts";
import { buildPolicy } from "./policy.ts";
import {
  buildPrompt,
  JUDGE_SCHEMA,
  judgePrompt,
  modelFor,
  outputSchema,
  readOutputs,
  readVerdict,
} from "./prompt.ts";
import { MAX_DENIED_ENTRIES, type RunInput, runClaude } from "./run.ts";
import { MAX_LINE_BYTES } from "./stream.ts";
export type ClaudeAdapterOptions = {
  nowMs?: () => number;
  claudePath: () => string | undefined;
  env: () => Record<string, string | undefined>;
  controlRoot: string;
  audit: (kind: string, runId: string, detail: Value) => void;
  newId: (prefix: string) => string;
  newSessionId?: () => string;
  newToken?: () => string;
  rounds?: number;
  pollMs?: number;
  graceMs?: number;
  exitWaitMs?: number;
  maxLineBytes?: number;
  maxDeniedEntries?: number;
  allowed?: () => string | undefined;
};
export type ClaudeAdapter = HarnessAdapter & { interrupt(sentence: string): void };
export function createClaudeAdapter(options: ClaudeAdapterOptions): ClaudeAdapter {
  const active = new Set<(sentence?: string) => void>();
  let stopped = false;
  const guard = () => (stopped ? "FlowDriven is stopping." : options.allowed?.());
  const withCall = <T extends object>(result: T, call: CallInfo | undefined): T & { call?: CallInfo } =>
    call === undefined ? result : { ...result, call };
  const run = (input: RunInput, claudePath: string, onCall: (call: CallInfo) => void) =>
    runClaude(input, {
      claudePath,
      onCall,
      nowMs: options.nowMs ?? Date.now,
      env: options.env(),
      controlRoot: options.controlRoot,
      audit: options.audit,
      newId: options.newId,
      newSessionId: options.newSessionId ?? randomUUID,
      rounds: options.rounds ?? 50,
      pollMs: options.pollMs ?? 25,
      graceMs: options.graceMs ?? 2000,
      exitWaitMs: options.exitWaitMs ?? 10000,
      maxLineBytes: options.maxLineBytes ?? MAX_LINE_BYTES,
      maxDeniedEntries: options.maxDeniedEntries ?? MAX_DENIED_ENTRIES,
      register: (stop) => {
        active.add(stop);
        return () => active.delete(stop);
      },
    });
  return {
    id: "claude-code",
    name: "Claude Code",
    stop() {
      stopped = true;
      for (const stop of active) stop();
    },
    interrupt(sentence) {
      for (const stop of active) stop(sentence);
    },
    async runStep(req) {
      const reason = guard();
      if (stopped) return { exit: "interrupted", text: "", outputs: {} };
      if (reason !== undefined) return { exit: "failed", text: reason, outputs: {}, block: reason };
      if (req.kind === "skill")
        return { exit: "failed", text: "", outputs: {}, block: "Skill steps are not run yet." };
      const path = options.claudePath();
      if (path === undefined)
        return { exit: "failed", text: "", outputs: {}, block: "Claude Code was not found." };
      const schema = outputSchema(req.outputs);
      let call: CallInfo | undefined;
      const result = await run(
        {
          runId: req.runId,
          stepId: req.stepId,
          itemKey: req.itemKey,
          attempt: req.attempt,
          model: modelFor(req.effort),
          ...(schema === undefined ? {} : { schema }),
          signal: req.signal,
          onStart: req.onStart,
          makePolicy: (control, sessionId) =>
            buildPolicy({
              kind: req.kind === "agent" ? "agent" : "worker",
              requirements: req.requirements,
              project: req.project,
              controlRoot: control.root,
              controlCwd: control.cwd,
              sessionId,
              schema: schema !== undefined,
            }),
          makePrompt: (policy) =>
            buildPrompt({
              ...(policy.tools.length ? { cwd: policy.cwd } : {}),
              instructions: req.instructions,
              outputs: req.outputs,
              ...(req.lastFailure === undefined ? {} : { lastFailure: req.lastFailure }),
            }),
        },
        path,
        (info) => {
          call = info;
        },
      );
      if (result.kind === "ok") {
        if (schema === undefined) return withCall({ exit: "ok", text: result.text, outputs: {} }, call);
        const parsed = readOutputs(result.structured, req.outputs);
        return withCall(
          parsed
            ? { exit: "ok" as const, text: parsed.report, outputs: parsed.outputs }
            : {
                exit: "failed" as const,
                text: "Claude Code returned no valid structured output.",
                outputs: {},
              },
          call,
        );
      }
      if (result.kind === "block")
        return withCall({ exit: "failed", text: result.sentence, outputs: {}, block: result.sentence }, call);
      if (result.kind === "failed") return withCall({ exit: "failed", text: result.text, outputs: {} }, call);
      return withCall({ exit: result.kind, text: "", outputs: {} }, call);
    },
    async judge(req) {
      const reason = guard();
      if (reason !== undefined) throw new HarnessCallError(reason, "failed");
      const path = options.claudePath();
      if (path === undefined) throw new HarnessCallError("Claude Code was not found.", "failed");
      let prompt: string | undefined;
      for (let i = 0; i < 3; i++) {
        const token = (options.newToken ?? (() => randomBytes(8).toString("hex")))();
        const candidate = judgePrompt({ rubric: req.rubric, output: req.output, token });
        if (!req.rubric.includes(token) && !req.output.includes(token)) {
          prompt = candidate;
          break;
        }
      }
      if (prompt === undefined)
        throw new HarnessCallError("FlowDriven could not mark the judge's data.", "failed");
      const markedPrompt = prompt;
      let call: CallInfo | undefined;
      const result = await run(
        {
          runId: req.runId,
          stepId: req.stepId,
          itemKey: req.itemKey ?? "",
          attempt: 0,
          model: "sonnet",
          schema: JUDGE_SCHEMA,
          signal: req.signal,
          onStart: req.onStart,
          makePolicy: (control, sessionId) =>
            buildPolicy({
              kind: "agent",
              requirements: [],
              project: control.cwd,
              controlRoot: control.root,
              controlCwd: control.cwd,
              sessionId,
              schema: true,
            }),
          makePrompt: () => markedPrompt,
        },
        path,
        (info) => {
          call = info;
        },
      );
      if (result.kind !== "ok")
        throw new HarnessCallError(
          result.kind === "block" ? result.sentence : result.kind === "failed" ? result.text : result.kind,
          result.kind === "block" ? "failed" : result.kind,
          call,
        );
      return withCall(
        readVerdict(result.structured) ?? {
          verdict: "failed",
          reasons: "Claude Code returned no valid verdict.",
          evidence: "",
        },
        call,
      );
    },
    async replan() {
      return undefined;
    },
    async probe() {
      return { ok: false, detail: "Probe checks are not connected yet." };
    },
  };
}
