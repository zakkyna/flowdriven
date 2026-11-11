import {
  type OperationInput,
  type OperationName,
  type OperationOutput,
  operations,
  RUNNER_ERROR_CODES,
  type RunnerClient,
  RunnerError,
  type RunnerErrorCode,
  RunnerEvent,
} from "@flowdriven/contracts";
import type { RunnerBridge } from "../shell";

export class IpcRunnerClient implements RunnerClient {
  private readonly bridge: RunnerBridge;
  constructor(bridge: RunnerBridge) {
    this.bridge = bridge;
  }
  async call<N extends OperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>> {
    if (!Object.hasOwn(operations, name))
      throw new RunnerError("not_found", `There is no operation ${name}.`);
    const operation = operations[name];
    const parsed = operation.input.safeParse(input);
    if (!parsed.success)
      throw new RunnerError("invalid_input", parsed.error.issues.at(0)?.message ?? "Invalid input.");
    let reply: unknown;
    try {
      reply = await this.bridge.call(name, parsed.data);
    } catch {
      throw new RunnerError("unavailable", "The engine is not reachable.");
    }
    if (typeof reply === "object" && reply !== null && !Array.isArray(reply) && "ok" in reply) {
      if (reply.ok === false) {
        const error =
          "error" in reply && typeof reply.error === "object" && reply.error !== null ? reply.error : {};
        const code =
          "code" in error && RUNNER_ERROR_CODES.some((value) => value === error.code)
            ? (error.code as RunnerErrorCode)
            : "unavailable";
        const message =
          "message" in error && typeof error.message === "string" ? error.message : "Unknown error";
        throw new RunnerError(code, message);
      }
      if (reply.ok === true && "result" in reply) {
        const result = operation.output.safeParse(reply.result);
        if (result.success) return result.data as OperationOutput<N>;
      }
    }
    throw new RunnerError("unavailable", "The engine sent an answer the app cannot read.");
  }
  subscribe(listener: (event: RunnerEvent) => void): () => void {
    return this.bridge.subscribe((event) => {
      const parsed = RunnerEvent.safeParse(event);
      if (parsed.success) listener(parsed.data);
    });
  }
}
