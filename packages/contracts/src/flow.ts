import { z } from "zod";
import {
  CheckType,
  ContentHash,
  Id,
  IsoDateTime,
  OutputType,
  RouteOption,
  SemVer,
  StepDo,
} from "./common.ts";
import { RunState, StepRunState } from "./run.ts";

export const FlowKind = z.enum(["build", "light"]);
export type FlowKind = z.infer<typeof FlowKind>;
export const Check = z.object({ type: CheckType, required: z.boolean().default(true), summary: z.string() });
export type Check = z.infer<typeof Check>;
export const Effort = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof Effort>;
export const WorkerPreference = z.object({
  effort: Effort.optional(),
  prefer: z.array(z.string()).optional(),
  needs: z.array(z.string()).optional(),
});
export type WorkerPreference = z.infer<typeof WorkerPreference>;
export const OutputDecl = z.object({
  id: Id,
  type: OutputType,
  path: z.string().optional(),
  from_step: Id.optional(),
});
export type OutputDecl = z.infer<typeof OutputDecl>;
export const InputType = z.enum([
  "text",
  "number",
  "bool",
  "enum",
  "date",
  "url",
  "file",
  "folder",
  "secret_ref",
  "list<text>",
]);
export type InputType = z.infer<typeof InputType>;
export const InputDecl = z.object({
  id: Id,
  type: InputType,
  label: z.string(),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  remember: z.boolean().optional(),
});
export type InputDecl = z.infer<typeof InputDecl>;
export const RequirementType = z.enum([
  "harness",
  "skill",
  "plugin",
  "mcp_server",
  "cli_tool",
  "gui_app",
  "account",
  "browser_session",
  "path",
]);
export type RequirementType = z.infer<typeof RequirementType>;
export const Requirement = z.object({
  id: Id,
  type: RequirementType,
  ref: z.string(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false),
  why: z.string(),
  connect: z.enum(["native", "gateway"]).optional(),
  tools: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
  access: z.enum(["read", "read_write"]).optional(),
  routes: z.array(RouteOption).default([]),
});
export type Requirement = z.infer<typeof Requirement>;
export const Step = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string(),
  do: StepDo,
  instructions: z.string(),
  uses: z.array(Id).default([]),
  skills: z.array(z.string()).optional(),
  connectors: z.array(z.string()).optional(),
  worker: WorkerPreference.optional(),
  outputs: z.array(OutputDecl).default([]),
  checks: z.array(Check).min(1),
  retry: z.number().int().min(0).default(2),
  risky: z.array(z.string()).optional(),
  idempotent: z.boolean().optional(),
});
export type Step = z.infer<typeof Step>;
export const FlowManifest = z.object({
  format: z.literal("flowdriven-flow/1"),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  version: SemVer,
  publisher: z.string().optional(),
  license: z.string(),
  kind: FlowKind,
  inputs: z.array(InputDecl),
  outputs: z.array(OutputDecl),
  requirements: z.array(Requirement),
  defaults: z.object({
    skills: z.array(z.string()).optional(),
    connectors: z.array(z.string()).optional(),
    worker: WorkerPreference.optional(),
  }),
  steps: z.array(Step).min(1),
});
export type FlowManifest = z.infer<typeof FlowManifest>;
export const SignOffState = z.enum(["approved", "stale", "none"]);
export type SignOffState = z.infer<typeof SignOffState>;
export const FlowSignOff = z.object({ state: SignOffState, version: SemVer.optional() });
export type FlowSignOff = z.infer<typeof FlowSignOff>;
export const Playback = z.object({
  goal: z.string(),
  touches: z.array(z.string()),
  asksApprovalFor: z.array(z.string()),
});
export type Playback = z.infer<typeof Playback>;
export const ClarifyQuestion = z.object({
  id: Id,
  text: z.string(),
  suggestions: z.array(z.string()).min(1).max(4),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestion>;
export const ChatMessage = z.object({
  id: Id,
  role: z.enum(["user", "agent"]),
  text: z.string(),
  at: IsoDateTime,
  questions: z.array(ClarifyQuestion).max(3).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
export const FlowSummary = z.object({
  id: Id,
  name: z.string(),
  summary: z.string(),
  version: SemVer,
  kind: FlowKind,
  saved: z.boolean(),
  signOff: FlowSignOff,
  stepCount: z.number(),
  lastRun: z.object({ runId: Id, state: RunState, startedAt: IsoDateTime }).optional(),
});
export type FlowSummary = z.infer<typeof FlowSummary>;
export const FlowDetail = z.object({
  manifest: FlowManifest,
  hash: ContentHash,
  saved: z.boolean(),
  signOff: FlowSignOff,
  playback: Playback,
  conversation: z.array(ChatMessage),
  stepStatus: z.record(z.string(), StepRunState),
  canUndo: z.boolean(),
});
export type FlowDetail = z.infer<typeof FlowDetail>;
export const FlowEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), stepId: Id, direction: z.enum(["up", "down"]) }),
  z.object({ kind: z.literal("duplicate"), stepId: Id }),
  z.object({ kind: z.literal("delete"), stepId: Id }),
  z.object({ kind: z.literal("add"), title: z.string().min(1) }),
  z.object({ kind: z.literal("undo") }),
]);
export type FlowEdit = z.infer<typeof FlowEdit>;
export function isJudgedOnly(checks: Check[]): boolean {
  const required = checks.filter((check) => check.required);
  return required.length > 0 && required.every((check) => check.type === "judge");
}
