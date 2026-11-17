import { randomBytes, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describeTemplate, type Value } from "@flowdriven/sdk";
import { CONNECTORS, type ConnectorEntry } from "../connectors/catalog.ts";
import type { GrantBook } from "../connectors/grants.ts";
import { type CallInfo, type HarnessAdapter, HarnessCallError, type StepRequest } from "../harness.ts";
import { type LoadedSkill, skillSource } from "../skills/skill-folder.ts";
import type { ConsentPins } from "../storage.ts";
import { CONNECTOR_DENY } from "./connector.ts";
import type { ConnectorFact } from "./connector-scan.ts";
import type { PageCounter } from "./pages.ts";
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
import { prepareSkillStep, SKILL_STOP } from "./skill-step.ts";
import { MAX_LINE_BYTES } from "./stream.ts";
export type ClaudeAdapterOptions = {
  grantedFolders?: (runId: string) => ConsentPins["folders"] | undefined;
  skillPin?: (runId: string, requirementId: string) => string | undefined;
  home?: string;
  flowFiles?: (runId: string) => Record<string, string>;
  copyRoot?: string;
  admit?: (req: StepRequest) => string | undefined;
  pages?: PageCounter;
  grants?: GrantBook;
  connectors?: () => ConnectorFact[];
  catalog?: ConnectorEntry[];
  effortModels?: () => { low: string; medium: string; high: string } | undefined;
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
  closeWaitMs?: number;
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
      pages: options.pages,
      grants: options.grants,
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
      closeWaitMs: options.closeWaitMs ?? 8000,
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
      const admission = options.admit?.(req);
      if (admission !== undefined) return { exit: "failed", text: admission, outputs: {}, block: admission };
      const skillRequirement =
        req.kind === "skill"
          ? req.requirements.find((r) => r.id === req.skill && r.type === "skill" && req.uses.includes(r.id))
          : undefined;
      if (req.kind === "skill" && !skillRequirement)
        return { exit: "failed", text: "", outputs: {}, block: SKILL_STOP.undeclared };
      const home = options.home ?? homedir();
      const source = skillRequirement && skillSource(skillRequirement.ref, { home });
      if (skillRequirement && !source)
        return { exit: "failed", text: "", outputs: {}, block: SKILL_STOP.undeclared };
      const copyRoot = options.copyRoot ?? join(dirname(options.controlRoot), "skill-copies");
      let copyParent: string | undefined;
      let prepared: { folder: string; skill: LoadedSkill } | undefined;
      const path = options.claudePath();
      if (path === undefined)
        return { exit: "failed", text: "", outputs: {}, block: "Claude Code was not found." };
      const catalog = options.catalog ?? CONNECTORS;
      const connectorPrefix = req.requirements
        .flatMap((r) => (r.type === "mcp_server" ? catalog.filter((entry) => entry.ref === r.ref) : []))
        .at(0)?.prefix;
      const schema = outputSchema(req.outputs);
      let call: CallInfo | undefined;
      let outside = false;
      const result = await (async () => {
        try {
          return await run(
            {
              runId: req.runId,
              stepId: req.stepId,
              itemKey: req.itemKey,
              attempt: req.attempt,
              model: options.effortModels?.()?.[req.effort ?? "medium"] ?? modelFor(req.effort),
              ...(schema === undefined ? {} : { schema }),
              signal: req.signal,
              onStart: req.onStart,
              browser: req.requirements.some((r) => r.type === "web"),
              ...(connectorPrefix === undefined ? {} : { connectorPrefix }),
              onOutside: () => {
                outside = true;
                req.onOutside?.();
              },
              makePolicy: (control, sessionId) => {
                const id = basename(control.cwd === "" ? "" : dirname(control.cwd));
                const folder = source ? join(copyRoot, id, source.name) : undefined;
                const policy = buildPolicy({
                  kind: req.kind === "agent" ? "agent" : "worker",
                  requirements: req.requirements,
                  takesOutside: req.takesOutside,
                  routes: req.routes ?? [],
                  connectors: options.connectors?.() ?? [],
                  catalog,
                  project: req.project,
                  home,
                  grantedFolders: options.grantedFolders?.(req.runId),
                  controlRoot: control.root,
                  controlCwd: control.cwd,
                  sessionId,
                  schema: schema !== undefined,
                  ...(folder ? { skillFolder: folder } : {}),
                });
                if (skillRequirement) {
                  const result = prepareSkillStep({
                    requirement: skillRequirement,
                    pin: options.skillPin?.(req.runId, skillRequirement.id),
                    home,
                    flowFiles: options.flowFiles?.(req.runId) ?? {},
                    copyRoot,
                    id,
                  });
                  if (!result.ok) throw new Error(result.block);
                  copyParent = join(copyRoot, id);
                  prepared = result;
                }
                return policy;
              },
              makePrompt: (policy) => {
                let pagesLeft = 0;
                if (policy.browser) {
                  try {
                    const count = options.pages?.count(req.runId, policy.browser.requirementId);
                    if (
                      count &&
                      Number.isSafeInteger(count.run) &&
                      count.run >= 0 &&
                      Number.isSafeInteger(count.day) &&
                      count.day >= 0
                    )
                      pagesLeft = Math.max(
                        0,
                        Math.min(policy.browser.perRun - count.run, policy.browser.perDay - count.day),
                      );
                  } catch {}
                }
                return buildPrompt({
                  ...(policy.commands
                    ? { commands: { patterns: policy.commands.patterns, cwd: policy.cwd } }
                    : {}),
                  ...(policy.connector
                    ? {
                        connector: {
                          label: policy.connector.label,
                          tools: policy.connector.tools.map((t) => `${policy.connector?.prefix ?? ""}${t}`),
                          approved: (req.approvedCalls ?? [])
                            .filter((call) => policy.connector?.tools.includes(call.tool))
                            .map((call) => ({
                              ...call,
                              tool: `${policy.connector?.prefix ?? ""}${call.tool}`,
                            })),
                        },
                      }
                    : {}),
                  ...(policy.browser
                    ? { browser: { templates: policy.browser.templates.map(describeTemplate), pagesLeft } }
                    : {}),
                  ...(policy.tools.length ? { cwd: policy.cwd } : {}),
                  ...(prepared ? { skill: { ...prepared.skill, folder: prepared.folder } } : {}),
                  instructions: req.instructions,
                  outputs: req.outputs,
                  ...(req.lastFailure === undefined ? {} : { lastFailure: req.lastFailure }),
                });
              },
            },
            path,
            (info) => {
              call = info;
            },
          );
        } finally {
          if (copyParent) {
            try {
              rmSync(copyParent, { recursive: true, force: true });
            } catch {}
          }
        }
      })();
      const mark = outside ? { outside: true as const } : {};
      if (result.kind === "hold")
        return withCall(
          { exit: "failed", text: CONNECTOR_DENY.held, outputs: {}, hold: result.held, ...mark },
          call,
        );
      if (result.kind === "ok") {
        if (schema === undefined)
          return withCall({ exit: "ok", text: result.text, outputs: {}, ...mark }, call);
        const parsed = readOutputs(result.structured, req.outputs);
        return withCall(
          {
            ...mark,
            ...(parsed
              ? { exit: "ok" as const, text: parsed.report, outputs: parsed.outputs }
              : {
                  exit: "failed" as const,
                  text: "Claude Code returned no valid structured output.",
                  outputs: {},
                }),
          },
          call,
        );
      }
      if (result.kind === "block")
        return withCall(
          { exit: "failed", text: result.sentence, outputs: {}, block: result.sentence, ...mark },
          call,
        );
      if (result.kind === "stop")
        return withCall(
          { exit: "failed", text: result.sentence, outputs: {}, noRetry: result.sentence, ...mark },
          call,
        );
      if (result.kind === "failed")
        return withCall({ exit: "failed", text: result.text, outputs: {}, ...mark }, call);
      return withCall({ exit: result.kind, text: "", outputs: {}, ...mark }, call);
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
          model: options.effortModels?.()?.medium ?? "sonnet",
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
          result.kind === "hold"
            ? CONNECTOR_DENY.held
            : result.kind === "block" || result.kind === "stop"
              ? result.sentence
              : result.kind === "failed"
                ? result.text
                : result.kind,
          result.kind === "block" || result.kind === "stop" || result.kind === "hold"
            ? "failed"
            : result.kind,
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
