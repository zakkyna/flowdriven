import { z } from "zod";
import type { LiveOperationName, OperationInput, OperationOutput } from "./operations";
import { checkContractVersion } from "./version.ts";

export const RunnerTopic = z.enum([
  "flows",
  "runs",
  "approvals",
  "readiness",
  "settings",
  "chats",
  "rules",
  "activity",
  "agents",
  "skills",
]);
export type RunnerTopic = z.infer<typeof RunnerTopic>;
export const RunnerEvent = z.strictObject({ type: z.literal("changed"), topics: z.array(RunnerTopic) });
export type RunnerEvent = z.infer<typeof RunnerEvent>;
export interface RunnerClient {
  call<N extends LiveOperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

export async function startupCheck(
  client: RunnerClient,
): Promise<{ ok: true; info: OperationOutput<"runner.info"> } | { ok: false; reason: "contract_mismatch" }> {
  const info = await client.call("runner.info", {});
  return checkContractVersion(info.contractVersion) === "ok"
    ? { ok: true, info }
    : { ok: false, reason: "contract_mismatch" };
}
