import {
  encodeFrame,
  FrameError,
  LineFramer,
  MAX_FRAME_BYTES,
  parseFrame,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RpcRequest,
  RUNNER_ERROR_CODES,
  type RunnerErrorCode,
  type RunnerEvent,
  rpcFailure,
  rpcResult,
} from "@flowdriven/contracts";
export type RpcServerOptions = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  knows: (method: string) => boolean;
  maxFrameBytes?: number;
  endWaitMs?: number;
};
export type RpcServer = { notify(event: RunnerEvent): void; done: Promise<"end" | "protocol_error"> };
export function serveRpc(options: RpcServerOptions): RpcServer {
  const { input, output } = options;
  const max = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  const framer = new LineFramer(max);
  const pending = new Set<Promise<void>>();
  let stopped = false;
  let resolved = false;
  let finish: (reason: "end" | "protocol_error") => void = () => {};
  const done = new Promise<"end" | "protocol_error">((resolve) => {
    finish = (reason) => {
      if (!resolved) {
        resolved = true;
        resolve(reason);
      }
    };
  });
  output.on("error", () => {});
  function write(value: unknown, fallbackId?: string | number, fixed = false): Promise<void> {
    let frame: string;
    try {
      frame = encodeFrame(value, fixed ? MAX_FRAME_BYTES : max);
    } catch (error) {
      if (!(error instanceof FrameError) || error.code !== "too_long" || fallbackId === undefined)
        return Promise.resolve();
      frame = encodeFrame(rpcFailure(fallbackId, "unavailable", "The answer is too large."));
    }
    return new Promise((resolve) => {
      try {
        output.write(frame, () => resolve());
      } catch {
        resolve();
      }
    });
  }
  function protocolError() {
    if (stopped) return;
    stopped = true;
    input.removeListener("data", onData);
    void write(rpcFailure(null, "invalid_input", "Invalid frame", RPC_INVALID_REQUEST), undefined, true).then(
      () => finish("protocol_error"),
    );
  }
  function handle(line: string) {
    let frame: Record<string, unknown>;
    try {
      frame = parseFrame(line);
    } catch {
      protocolError();
      return;
    }
    const parsed = RpcRequest.safeParse(frame);
    if (!parsed.success) {
      void write(rpcFailure(null, "invalid_input", "Invalid request", RPC_INVALID_REQUEST), undefined, true);
      return;
    }
    const { id, method, params } = parsed.data;
    if (id === undefined) return;
    if (!options.knows(method)) {
      void write(rpcFailure(id, "not_found", "Method not found", RPC_METHOD_NOT_FOUND), id, true);
      return;
    }
    const task = Promise.resolve()
      .then(() => options.call(method, params ?? {}))
      .then(
        (result) => write(rpcResult(id, result), id),
        (error: unknown) => {
          const candidate = error as { code?: unknown; message?: unknown } | null;
          const code = candidate?.code;
          if (
            typeof code === "string" &&
            (RUNNER_ERROR_CODES as readonly string[]).includes(code) &&
            typeof candidate?.message === "string"
          )
            return write(rpcFailure(id, code as RunnerErrorCode, candidate.message), id);
          return write(rpcFailure(id, "unavailable", "Internal error"), id, true);
        },
      )
      .then(() => {});
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  function onData(chunk: string) {
    if (stopped) return;
    try {
      for (const line of framer.push(chunk)) {
        handle(line);
        if (stopped) break;
      }
    } catch {
      protocolError();
    }
  }
  input.setEncoding("utf8");
  input.on("data", onData);
  input.on("end", () => {
    if (stopped) return;
    stopped = true;
    input.removeListener("data", onData);
    let timer: ReturnType<typeof setTimeout>;
    void Promise.race([
      Promise.all([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.endWaitMs ?? 2000);
      }),
    ]).then(() => {
      clearTimeout(timer);
      finish("end");
    });
  });
  return {
    done,
    notify(event) {
      if (!resolved) void write({ jsonrpc: "2.0", method: "event", params: event });
    },
  };
}
