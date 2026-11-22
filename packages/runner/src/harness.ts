import type { Requirement, Value } from "@flowdriven/sdk";
import type { Routed } from "./router/types.ts";
import type { ExitClass, RiskyAction } from "./states.ts";
import type { ModelUsage } from "./storage.ts";
export type LimitWindow = { utilization?: number; resetsAt?: number; status?: string };
export type HeldCall = {
  requirementId: string;
  tool: string;
  input: Value;
  digest: string;
  action?: RiskyAction;
  effect?: import("./rules/effects.ts").Effect;
  touchId?: string;
  place?: NonNullable<import("@flowdriven/sdk").Touch["place"]>;
  fixedPlace?: boolean;
};
export type RateLimit = {
  status: string;
  type?: string;
  utilization?: number;
  resetsAt?: number;
  windows: { five_hour?: LimitWindow; seven_day?: LimitWindow };
};
export type CallInfo = {
  models: ModelUsage[];
  turns: number;
  costUsd?: number;
  wallMs: number;
  limits: RateLimit[];
};
export class HarnessCallError extends Error {
  exit: ExitClass;
  call?: CallInfo;
  constructor(message: string, exit: ExitClass, call?: CallInfo) {
    super(message);
    this.exit = exit;
    this.call = call;
  }
}
export type StepRequest = {
  pickTools?: string[];
  runId: string;
  stepId: string;
  itemKey: string;
  attempt: number;
  replan: boolean;
  kind: "worker" | "agent" | "skill";
  title: string;
  instructions: string;
  uses: string[];
  project: string;
  requirements: Requirement[];
  routes?: Routed[];
  approvedCalls?: { tool: string; input: Value }[];
  takesOutside?: boolean;
  onOutside?: () => void;
  effort?: "low" | "medium" | "high";
  skill?: string;
  outputs: { id: string; type: string }[];
  lastFailure?: string;
  pauseLimit?: () => () => void;
  onStart?: (pid: number) => void;
  maxDurationMs: number;
  signal: AbortSignal;
};
export type StepResult = {
  exit: ExitClass;
  text: string;
  outputs: Record<string, Value>;
  workFolder?: string;
  site?: string;
  block?: string;
  cause?: import("./storage.ts").RunRow["cause"];
  noteLine?: import("./storage.ts").StepRow["noteLine"];
  noRetry?: string;
  hold?: HeldCall;
  outside?: boolean;
  call?: CallInfo;
};
export type ReplanRequest = {
  runId: string;
  stepId: string;
  itemKey: string;
  instructions: string;
  failures: string[];
  signal: AbortSignal;
};
export type JudgeRequest = {
  runId: string;
  stepId: string;
  itemKey?: string;
  pauseLimit?: () => () => void;
  onStart?: (pid: number) => void;
  rubric: string;
  output: string;
  signal: AbortSignal;
};
export type JudgeResult = {
  verdict: "passed" | "failed";
  reasons: string;
  evidence: string;
  call?: CallInfo;
};
export type ProbeRequest = { runId: string; stepId: string; tool: string; args: Record<string, Value> };
export type ProbeResult = { ok: boolean; detail: string };
export interface HarnessAdapter {
  readonly id: string;
  readonly name: string;
  stop?(): void;
  runStep(req: StepRequest): Promise<StepResult>;
  replan(req: ReplanRequest): Promise<{ instructions: string } | undefined>;
  judge(req: JudgeRequest): Promise<JudgeResult>;
  probe(req: ProbeRequest): Promise<ProbeResult>;
}
