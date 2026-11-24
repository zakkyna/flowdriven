import { z } from "zod";
import type { OperationInput, OperationName, OperationOutput } from "./operations";

export const RunnerTopic = z.enum(["flows", "runs", "approvals", "readiness", "harnesses", "settings"]);
export type RunnerTopic = z.infer<typeof RunnerTopic>;
export const RunnerEvent = z.object({ type: z.literal("changed"), topics: z.array(RunnerTopic) });
export type RunnerEvent = z.infer<typeof RunnerEvent>;
export interface RunnerClient {
  call<N extends OperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}
