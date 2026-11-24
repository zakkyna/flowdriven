import {
  type ErrorParams,
  type ErrorReason,
  type LiveOperationName,
  type OperationInput,
  type OperationOutput,
  operations,
  REASON_CODE,
  RUNNER_ERROR_CODES,
  type RunnerClient,
  RunnerError,
  type RunnerErrorCode,
  RunnerEvent,
} from "@flowdriven/contracts";
import type { RunnerBridge } from "../shell";

function parseErrorParams(value: unknown): ErrorParams | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const parsed: ErrorParams = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      (typeof entry === "number" && Number.isFinite(entry)) ||
      (Array.isArray(entry) && entry.every((item) => typeof item === "string"))
    ) {
      parsed[key] = entry;
    } else {
      return undefined;
    }
  }
  return parsed;
}

export class IpcRunnerClient implements RunnerClient {
  private readonly bridge: RunnerBridge;
  constructor(bridge: RunnerBridge) {
    this.bridge = bridge;
  }
  async call<N extends LiveOperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>> {
    if (!Object.hasOwn(operations, name))
      throw new RunnerError("not_found", `There is no operation ${name}.`);
    const operation = operations[name];
    if ("retired" in operation)
      throw new RunnerError("unavailable", `Operation ${name} is retired.`, { reason: "retired" });
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
          "error" in reply &&
          typeof reply.error === "object" &&
          reply.error !== null &&
          !Array.isArray(reply.error)
            ? reply.error
            : {};
        const message =
          "message" in error && typeof error.message === "string" ? error.message : "Unknown error";
        const validCode = "code" in error && RUNNER_ERROR_CODES.some((value) => value === error.code);
        if (!validCode) throw new RunnerError("unavailable", message, { reason: "internal_error" });
        const reason =
          "reason" in error && typeof error.reason === "string" && Object.hasOwn(REASON_CODE, error.reason)
            ? (error.reason as ErrorReason)
            : undefined;
        const params = "params" in error ? parseErrorParams(error.params) : undefined;
        throw new RunnerError(
          error.code as RunnerErrorCode,
          message,
          reason !== undefined || params !== undefined
            ? {
                ...(reason !== undefined ? { reason } : {}),
                ...(params !== undefined ? { params } : {}),
              }
            : undefined,
        );
      }
      if (reply.ok === true && "result" in reply) {
        const result = operation.output.safeParse(reply.result);
        if (result.success) return result.data as OperationOutput<N>;
      }
    }
    throw new RunnerError("unavailable", "The engine sent an answer the app cannot read.", {
      reason: "internal_error",
    });
  }
  subscribe(listener: (event: RunnerEvent) => void): () => void {
    return this.bridge.subscribe((event) => {
      const parsed = RunnerEvent.safeParse(event);
      if (parsed.success) listener(parsed.data);
    });
  }
}
