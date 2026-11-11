import type { Requirement, Value } from "@flowdriven/sdk";
import type { ExitClass } from "./states.ts";
export type StepRequest = {
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
  effort?: "low" | "medium" | "high";
  skill?: string;
  outputs: { id: string; type: string }[];
  lastFailure?: string;
  maxDurationMs: number;
  signal: AbortSignal;
};
export type StepResult = { exit: ExitClass; text: string; outputs: Record<string, Value>; block?: string };
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
  rubric: string;
  output: string;
  signal: AbortSignal;
};
export type JudgeResult = { verdict: "passed" | "failed"; reasons: string; evidence: string };
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
