import {
  type ErrorParams,
  type ErrorReason,
  encodeFrame,
  FrameError,
  LineFramer,
  MAX_FRAME_BYTES,
  type Notice,
  parseFrame,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RpcRequest,
  RUNNER_ERROR_CODES,
  type RunnerErrorCode,
  rpcFailure,
  rpcResult,
} from "@flowdriven/contracts";
import type { RunnerEvent } from "@flowdriven/contracts/v1";
export type RpcServerOptions = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream & { readonly writableNeedDrain?: boolean };
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  knows: (method: string) => boolean;
  maxFrameBytes?: number;
  endWaitMs?: number;
};
export type RpcServer = {
  notice(notice: Notice): void;
  clearNotice(id: string): void;
  notify(event: RunnerEvent): void;
  done: Promise<"end" | "protocol_error">;
};
export function serveRpc(options: RpcServerOptions): RpcServer {
  const { input, output } = options;
  const max = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  const framer = new LineFramer(max);
  const pending = new Set<Promise<void>>();
  let stopped = false;
  let resolved = false;
  let pendingEvent: RunnerEvent | undefined;
  const pendingNotices: Notice[] = [];
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
      if (
        typeof value === "object" &&
        value !== null &&
        Object.hasOwn(value, "result") &&
        !Object.hasOwn(JSON.parse(frame) as object, "result")
      )
        throw new Error("Result cannot be encoded");
    } catch (error) {
      if (fallbackId === undefined) return Promise.resolve();
      const message =
        error instanceof FrameError && error.code === "too_long"
          ? "The answer is too large."
          : "Internal error";
      try {
        frame = encodeFrame(rpcFailure(fallbackId, "unavailable", message));
      } catch {
        try {
          frame = encodeFrame(rpcFailure(null, "unavailable", "The answer is too large."));
        } catch {
          return Promise.resolve();
        }
      }
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
    void write(
      rpcFailure(null, "invalid_input", "Invalid frame", { number: RPC_INVALID_REQUEST }),
      undefined,
      true,
    ).then(() => finish("protocol_error"));
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
      void write(
        rpcFailure(null, "invalid_input", "Invalid request", { number: RPC_INVALID_REQUEST }),
        undefined,
        true,
      );
      return;
    }
    const { id, method, params } = parsed.data;
    if (id === undefined) return;
    if (!options.knows(method)) {
      void write(rpcFailure(id, "not_found", "Method not found", { number: RPC_METHOD_NOT_FOUND }), id, true);
      return;
    }
    const task = Promise.resolve()
      .then(() => options.call(method, params ?? {}))
      .then(
        (result) =>
          write(
            result === undefined ? rpcFailure(id, "unavailable", "Internal error") : rpcResult(id, result),
            id,
          ),
        (error: unknown) => {
          const candidate = error as {
            code?: unknown;
            message?: unknown;
            reason?: ErrorReason;
            params?: ErrorParams;
          } | null;
          const code = candidate?.code;
          if (
            typeof code === "string" &&
            (RUNNER_ERROR_CODES as readonly string[]).includes(code) &&
            typeof candidate?.message === "string"
          )
            return write(
              rpcFailure(id, code as RunnerErrorCode, candidate.message, {
                reason: candidate.reason,
                params: candidate.params,
              }),
              id,
            );
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
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.endWaitMs ?? 2000);
      }),
    ]).then(() => {
      clearTimeout(timer);
      finish("end");
    });
  });
  output.on("drain", () => {
    while (!resolved && !output.writableNeedDrain && pendingNotices.length > 0) {
      const notice = pendingNotices.shift();
      if (notice) void write({ jsonrpc: "2.0", method: "notice", params: notice });
    }
    if (pendingEvent && !resolved) {
      const event = pendingEvent;
      pendingEvent = undefined;
      void write({ jsonrpc: "2.0", method: "event", params: event });
    }
  });
  return {
    done,
    notice(notice) {
      if (resolved) return;
      if (output.writableNeedDrain || pendingNotices.length > 0) {
        if (pendingNotices.length < 20) pendingNotices.push(notice);
      } else void write({ jsonrpc: "2.0", method: "notice", params: notice });
    },
    clearNotice(id) {
      const index = pendingNotices.findIndex((notice) => notice.id === id);
      if (index >= 0) pendingNotices.splice(index, 1);
      if (!resolved) void write({ jsonrpc: "2.0", method: "notice_clear", params: { id } });
    },
    notify(event) {
      if (resolved) return;
      if (output.writableNeedDrain) {
        pendingEvent = {
          type: "changed",
          topics: [...new Set([...(pendingEvent?.topics ?? []), ...event.topics])],
        };
      } else {
        void write({ jsonrpc: "2.0", method: "event", params: event });
      }
    },
  };
}
