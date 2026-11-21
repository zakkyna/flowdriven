import { join } from "node:path";
import type { Notice } from "@flowdriven/contracts/v1";
import { openSqliteStore } from "../sqlite-store.ts";
import type { Store } from "../storage.ts";
import { prepareDataDir } from "./data-dir.ts";
import { createChangeEmitter, wrapStore } from "./events.ts";
import { type RpcServer, serveRpc } from "./server.ts";
import { createRunnerService, type RunnerService } from "./service.ts";

export const EXIT = { ok: 0, crash: 1, usage: 2, locked: 3, protocol: 4 } as const;
export type RunProcessOptions = {
  dataDir: string;
  demo: boolean;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  errors: (line: string) => void;
  now?: () => Date;
  newId?: (prefix: string) => string;
  sweepEveryMs?: number;
  env?: Record<string, string | undefined>;
  claudePath?: string;
};
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export function guardProcess(proc: Pick<NodeJS.Process, "on">, errors: (line: string) => void): void {
  const report = (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EPIPE") return;
    try {
      errors(`Internal error: ${message(error).slice(0, 200)}`);
    } catch {}
  };
  proc.on("uncaughtException", report);
  proc.on("unhandledRejection", report);
}
export function createNoticeSink(): {
  send(notice: Notice): void;
  attach(server: Pick<RpcServer, "notice">): void;
} {
  const pending: Notice[] = [];
  let server: Pick<RpcServer, "notice"> | undefined;
  return {
    send(notice) {
      if (server) server.notice(notice);
      else if (pending.length < 20) pending.push(notice);
    },
    attach(next) {
      server = next;
      for (const notice of pending.splice(0)) next.notice(notice);
    },
  };
}
export async function runProcess(options: RunProcessOptions): Promise<number> {
  let dir: string;
  try {
    dir = prepareDataDir(options.dataDir);
  } catch (error) {
    options.errors(message(error));
    return EXIT.usage;
  }
  let store: Store;
  try {
    store = await openSqliteStore(join(dir, "flowdriven.sqlite"), { now: options.now, exclusive: true });
  } catch (error) {
    const text = message(error);
    options.errors(text);
    return text === "Another FlowDriven runner is using this data folder." ? EXIT.locked : EXIT.crash;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  let service: RunnerService | undefined;
  try {
    let server: RpcServer | undefined;
    const sink = createNoticeSink();
    const emitter = createChangeEmitter((event) => server?.notify(event));
    service = createRunnerService({
      ...{ notify: sink.send },
      store: wrapStore(store, emitter.mark),
      markChanged: emitter.mark,
      dataDir: dir,
      mode: options.demo ? "demo" : "live",
      now: options.now,
      newId: options.newId,
      env: options.env,
      claudePath: options.claudePath,
    });
    service.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    server = serveRpc({
      input: options.input,
      output: options.output,
      call: service.call,
      knows: service.knows,
    });
    sink.attach(server);
    const engine = service.engine;
    timer = setInterval(() => {
      void engine
        .sweepExpired()
        .catch((error: unknown) => options.errors(`The sweep failed: ${message(error)}`));
    }, options.sweepEveryMs ?? 60_000);
    timer.unref();
    const result = await server.done;
    clearInterval(timer);
    timer = undefined;
    service.stop();
    service = undefined;
    store.close();
    await new Promise<void>((resolve) => {
      options.output.write("", () => resolve());
    });
    return result === "end" ? EXIT.ok : EXIT.protocol;
  } catch (error) {
    if (timer) clearInterval(timer);
    try {
      service?.stop();
    } catch {}
    try {
      store.close();
    } catch {}
    options.errors(message(error));
    return EXIT.crash;
  }
}
