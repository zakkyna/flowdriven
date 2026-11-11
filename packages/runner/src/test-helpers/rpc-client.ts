import {
  encodeFrame,
  LineFramer,
  type OperationInput,
  type OperationName,
  type OperationOutput,
  parseFrame,
  RpcAnswer,
  RpcNotification,
  type RunnerClient,
  RunnerError,
  type RunnerEvent,
} from "@flowdriven/contracts";
export function connectRpcClient(streams: {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): RunnerClient & { close(): void; closed: Promise<void> } {
  let next = 1;
  let ended = false;
  const pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  const listeners = new Set<(event: RunnerEvent) => void>();
  const framer = new LineFramer();
  let finish: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  streams.input.setEncoding("utf8");
  streams.input.on("data", (chunk: string) => {
    try {
      for (const line of framer.push(chunk)) {
        const frame = parseFrame(line);
        const event = RpcNotification.safeParse(frame);
        if (event.success) {
          for (const listener of listeners) listener(event.data.params);
          continue;
        }
        const answer = RpcAnswer.safeParse(frame);
        if (!answer.success || answer.data.id === null) continue;
        const entry = pending.get(answer.data.id);
        if (!entry) continue;
        pending.delete(answer.data.id);
        if ("error" in answer.data)
          entry.reject(new RunnerError(answer.data.error.data.code, answer.data.error.message));
        else entry.resolve(answer.data.result);
      }
    } catch {}
  });
  streams.input.on("end", () => {
    ended = true;
    for (const entry of pending.values()) entry.reject(new RunnerError("unavailable", "The engine stopped."));
    pending.clear();
    finish();
  });
  return {
    call<N extends OperationName>(name: N, input: OperationInput<N>): Promise<OperationOutput<N>> {
      if (ended) return Promise.reject(new RunnerError("unavailable", "The engine stopped."));
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as OperationOutput<N>), reject });
        streams.output.write(encodeFrame({ jsonrpc: "2.0", id, method: name, params: input }));
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      streams.output.end();
    },
    closed,
  };
}
