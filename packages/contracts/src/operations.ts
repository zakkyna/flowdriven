import { z } from "zod";
import { Approval, ApprovalDecision, ApprovalState } from "./approval.ts";
import type { RunnerTopic } from "./client.ts";
import { ContentHash, Id, IsoDateTime } from "./common.ts";
import { ChatMessage, FlowDetail, FlowEdit, FlowSummary } from "./flow.ts";
import { HarnessCard } from "./harness.ts";
import { QueueView, UsageSummary } from "./queue.ts";
import { ReadinessReport } from "./readiness.ts";
import { RunDetail, RunReport, RunState, RunSummary } from "./run.ts";
import { Settings, SettingsPatch } from "./settings.ts";

export const RUNNER_ERROR_CODES = ["not_found", "invalid_input", "not_allowed", "unavailable"] as const;
export type RunnerErrorCode = (typeof RUNNER_ERROR_CODES)[number];
export class RunnerError extends Error {
  readonly code: RunnerErrorCode;
  constructor(code: RunnerErrorCode, message: string) {
    super(message);
    this.name = "RunnerError";
    this.code = code;
  }
}
export const FlowIssue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  path: z.string(),
  message: z.string(),
});
export type FlowIssue = z.infer<typeof FlowIssue>;
export const AuditRecord = z.object({
  at: IsoDateTime,
  kind: z.string(),
  runId: Id.optional(),
  detail: z.string(),
});
export type AuditRecord = z.infer<typeof AuditRecord>;
export const RUNNER_MODES = ["sample", "demo", "live"] as const;
export const RunnerMode = z.enum(RUNNER_MODES);
export type RunnerMode = z.infer<typeof RunnerMode>;
export const RunParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export function isRunnerError(value: unknown): value is RunnerError {
  return value instanceof RunnerError;
}
export type McpExposure = "yes" | "restricted" | "no";
export type OperationDef = {
  input: z.ZodType;
  output: z.ZodType;
  errors: readonly RunnerErrorCode[];
  reads: readonly RunnerTopic[];
  writes: readonly RunnerTopic[];
} & ({ mcp: "restricted"; mcpRule: string } | { mcp: "yes" | "no"; mcpRule?: string });
export const operations = {
  "flows.list": {
    input: z.object({}),
    output: z.array(FlowSummary),
    mcp: "yes",
    errors: ["invalid_input"],
    reads: ["flows", "runs"],
    writes: [],
  },
  "flows.get": {
    input: z.object({ flowId: Id }),
    output: FlowDetail,
    mcp: "yes",
    errors: ["invalid_input", "not_found"],
    reads: ["flows", "runs"],
    writes: [],
  },
  "flows.build": {
    input: z.object({ flowId: Id.optional(), message: z.string().min(1) }),
    output: z.object({ flow: FlowDetail.optional(), reply: ChatMessage }),
    mcp: "yes",
    errors: ["invalid_input", "not_found", "unavailable"],
    reads: [],
    writes: ["flows"],
  },
  "flows.update": {
    input: z.object({ flowId: Id, edit: FlowEdit }),
    output: FlowDetail,
    mcp: "no",
    errors: ["invalid_input", "not_found", "not_allowed", "unavailable"],
    reads: [],
    writes: ["flows", "approvals"],
  },
  "flows.run": {
    input: z.union([
      z.object({
        flowId: Id,
        inputs: z.record(z.string(), z.string()).optional(),
        params: RunParams.optional(),
      }),
      z.object({ description: z.string().min(1) }),
    ]),
    output: RunSummary,
    mcp: "yes",
    errors: ["invalid_input", "not_found", "not_allowed", "unavailable"],
    reads: [],
    writes: ["runs", "flows"],
  },
  "runs.list": {
    input: z.object({ flowId: Id.optional(), project: z.string().optional(), state: RunState.optional() }),
    output: z.array(RunSummary),
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["runs"],
    writes: [],
  },
  "runs.status": {
    input: z.object({ runId: Id }),
    output: RunDetail,
    mcp: "yes",
    errors: ["invalid_input", "not_found"],
    reads: ["runs"],
    writes: [],
  },
  "runs.report": {
    input: z.object({ runId: Id }),
    output: RunReport,
    mcp: "yes",
    errors: ["invalid_input", "not_found", "unavailable"],
    reads: ["runs"],
    writes: [],
  },
  "runs.resume": {
    input: z.object({ runId: Id }),
    output: RunSummary,
    mcp: "no",
    errors: ["invalid_input", "not_found", "not_allowed"],
    reads: [],
    writes: ["runs", "flows"],
  },
  "readiness.check": {
    input: z.object({ flowId: Id }),
    output: ReadinessReport,
    mcp: "yes",
    errors: ["invalid_input", "not_found"],
    reads: ["readiness"],
    writes: [],
  },
  "readiness.install": {
    input: z.object({ flowId: Id, requirementId: Id }),
    output: ReadinessReport,
    mcp: "no",
    errors: ["invalid_input", "not_found", "not_allowed", "unavailable"],
    reads: [],
    writes: ["readiness"],
  },
  "approvals.list": {
    input: z.object({ state: ApprovalState.optional() }),
    output: z.array(Approval),
    mcp: "yes",
    errors: ["invalid_input"],
    reads: ["approvals"],
    writes: [],
  },
  "approvals.resolve": {
    input: z.object({
      approvalId: Id,
      decision: ApprovalDecision,
      editedText: z.string().optional(),
      applyToSimilar: z.boolean().optional(),
    }),
    output: z.array(Approval),
    mcp: "restricted",
    mcpRule:
      "Over MCP, risky actions only open the item in the app; only flow and result sign-offs resolve; applyToSimilar is refused. A weekly_limit item is never resolved over MCP.",
    errors: ["invalid_input", "not_found", "not_allowed"],
    reads: [],
    writes: ["approvals", "runs", "flows"],
  },
  "approvals.answer": {
    input: z.object({ approvalId: Id, picks: z.array(z.string()) }),
    output: z.array(Approval),
    mcp: "restricted",
    mcpRule: "Over MCP, an answer only opens the item in the app; picks are never sent over MCP.",
    errors: ["invalid_input", "not_found", "not_allowed"],
    reads: [],
    writes: ["approvals", "runs"],
  },
  "flows.import": {
    input: z.object({ path: z.string().min(1) }),
    output: z.object({
      flow: FlowDetail.optional(),
      issues: z.array(FlowIssue),
      hash: ContentHash.optional(),
    }),
    mcp: "no",
    errors: ["invalid_input", "not_found", "unavailable"],
    reads: [],
    writes: ["flows"],
  },
  "runs.export": {
    input: z.object({ runId: Id }),
    output: z.object({ markdown: z.string() }),
    mcp: "no",
    errors: ["invalid_input", "not_found", "unavailable"],
    reads: ["runs"],
    writes: [],
  },
  "audit.list": {
    input: z.object({ runId: Id.optional() }),
    output: z.array(AuditRecord),
    mcp: "no",
    errors: ["invalid_input", "not_found"],
    reads: ["runs"],
    writes: [],
  },
  "runner.info": {
    input: z.object({}),
    output: z.object({ contractVersion: z.number().int().min(0), mode: RunnerMode }),
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["settings"],
    writes: [],
  },
  "harnesses.list": {
    input: z.object({}),
    output: z.array(HarnessCard),
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["harnesses"],
    writes: [],
  },
  "harnesses.rescan": {
    input: z.object({}),
    output: z.array(HarnessCard),
    mcp: "no",
    errors: ["invalid_input", "unavailable"],
    reads: [],
    writes: ["harnesses"],
  },
  "harnesses.setConsent": {
    input: z.object({ harnessId: Id, consent: z.enum(["given", "revoked"]) }),
    output: HarnessCard,
    mcp: "no",
    errors: ["invalid_input", "not_found", "not_allowed", "unavailable"],
    reads: [],
    writes: ["harnesses", "settings"],
  },
  "queue.list": {
    input: z.object({}),
    output: QueueView,
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["runs"],
    writes: [],
  },
  "queue.move": {
    input: z.object({ runId: Id }),
    output: QueueView,
    mcp: "no",
    errors: ["invalid_input", "not_found", "not_allowed"],
    reads: [],
    writes: ["runs"],
  },
  "usage.summary": {
    input: z.object({}),
    output: UsageSummary,
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["runs", "harnesses"],
    writes: [],
  },
  "settings.get": {
    input: z.object({}),
    output: Settings,
    mcp: "no",
    errors: ["invalid_input"],
    reads: ["settings", "harnesses"],
    writes: [],
  },
  "settings.update": {
    input: z.object({ patch: SettingsPatch }),
    output: Settings,
    mcp: "no",
    errors: ["invalid_input", "not_allowed", "unavailable"],
    reads: [],
    writes: ["settings"],
  },
} as const satisfies Record<string, OperationDef>;
export type OperationName = keyof typeof operations;
export type OperationInput<N extends OperationName> = z.input<(typeof operations)[N]["input"]>;
export type OperationOutput<N extends OperationName> = z.output<(typeof operations)[N]["output"]>;
