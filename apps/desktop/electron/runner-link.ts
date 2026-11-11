import type { Readable, Writable } from "node:stream";
import { runnerEnv } from "./runner-paths";

export const MAX_FRAME_BYTES = 1_048_576;
export const ALL_TOPICS_EVENT: { type: "changed"; topics: string[] } = {
  type: "changed",
  topics: ["flows", "runs", "approvals", "readiness", "harnesses", "settings"],
};
export class LinkError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export type ChildLike = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: "SIGTERM" | "SIGKILL"): boolean;
};
export type SpawnFn = (
  command: string,
  args: string[],
  options: { env: Record<string, string>; stdio: ["pipe", "pipe", "pipe"] },
) => ChildLike;
export type RunnerLinkOptions = {
  spawn: SpawnFn;
  execPath: string;
  entry: string;
  dataDir: string;
  demo: boolean;
  env: Record<string, string | undefined>;
  onEvent: (event: unknown) => void;
  onNotice?: (params: Record<string, unknown>) => void;
  log?: (line: string) => void;
  now?: () => number;
  stopWaitMs?: number;
};
type Pending = { resolve: (value: unknown) => void; reject: (error: LinkError) => void };
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stopped(): LinkError {
  return new LinkError("unavailable", "The engine stopped.");
}
export class RunnerLink {
  private options: RunnerLinkOptions;
  private child: ChildLike | undefined;
  private starts: number[] = [];
  private exhausted = false;
  private stopping = false;
  private nextId = 1;
  private pending = new Map<string | number, Pending>();
  private stopPromise: Promise<void> | undefined;
  constructor(options: RunnerLinkOptions) {
    this.options = options;
  }
  start(): void {
    if (this.child || this.stopping || this.exhausted) return;
    const now = (this.options.now ?? Date.now)();
    this.starts = this.starts.filter((time) => now - time <= 60_000);
    if (this.starts.length >= 3) {
      this.exhausted = true;
      return;
    }
    this.starts.push(now);
    let child: ChildLike;
    try {
      child = this.options.spawn(
        this.options.execPath,
        [
          this.options.entry,
          "--stdio",
          "--data-dir",
          this.options.dataDir,
          ...(this.options.demo ? ["--demo"] : []),
        ],
        { env: runnerEnv(this.options.env), stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      return;
    }
    this.child = child;
    let ended = false;
    const fail = (kill: boolean) => {
      if (ended) return;
      ended = true;
      if (kill) {
        try {
          child.kill();
        } catch {}
      }
      if (this.child === child) this.child = undefined;
      for (const pending of this.pending.values()) pending.reject(stopped());
      this.pending.clear();
      if (!this.stopping) this.options.onEvent(ALL_TOPICS_EVENT);
    };
    child.on("exit", () => fail(false));
    child.on("error", () => fail(true));
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", () => fail(true));
    let buffer = Buffer.alloc(0);
    child.stdout.on("data", (chunk: Buffer | string) => {
      if (ended) return;
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      for (;;) {
        const index = buffer.indexOf(10);
        if (index < 0) {
          if (buffer.length > MAX_FRAME_BYTES) fail(true);
          return;
        }
        if (index > MAX_FRAME_BYTES) {
          fail(true);
          return;
        }
        const line = buffer.subarray(0, index);
        buffer = buffer.subarray(index + 1);
        let value: unknown;
        try {
          value = JSON.parse(line.toString("utf8"));
        } catch {
          fail(true);
          return;
        }
        if (!object(value) || value.jsonrpc !== "2.0") {
          fail(true);
          return;
        }
        if (
          (typeof value.id === "string" || typeof value.id === "number") &&
          ((Object.hasOwn(value, "result") && !Object.hasOwn(value, "error")) ||
            (!Object.hasOwn(value, "result") &&
              object(value.error) &&
              typeof value.error.message === "string" &&
              object(value.error.data) &&
              typeof value.error.data.code === "string"))
        ) {
          const pending = this.pending.get(value.id);
          if (!pending) continue;
          this.pending.delete(value.id);
          if (Object.hasOwn(value, "result")) pending.resolve(value.result);
          else if (
            object(value.error) &&
            typeof value.error.message === "string" &&
            object(value.error.data) &&
            typeof value.error.data.code === "string"
          )
            pending.reject(new LinkError(value.error.data.code, value.error.message));
        } else if (!Object.hasOwn(value, "id") && value.method === "event" && object(value.params))
          this.options.onEvent(value.params);
        else if (!Object.hasOwn(value, "id") && value.method === "notice" && object(value.params))
          this.options.onNotice?.(value.params);
        else {
          fail(true);
          return;
        }
      }
    });
    let stderr = Buffer.alloc(0);
    let dropping = false;
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = Buffer.concat([stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      for (;;) {
        const index = stderr.indexOf(10);
        if (!dropping && (index >= 0 || stderr.length > 4096)) {
          const line = stderr.subarray(0, Math.min(index < 0 ? stderr.length : index, 4096)).toString("utf8");
          (this.options.log ?? ((text) => process.stderr.write(`${text}\n`)))(`[runner] ${line}`);
          dropping = true;
        }
        if (index < 0) {
          if (dropping) stderr = Buffer.alloc(0);
          break;
        }
        stderr = stderr.subarray(index + 1);
        dropping = false;
      }
    });
  }
  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    let text: string;
    try {
      text = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    } catch {
      return Promise.reject(new LinkError("invalid_input", "The request cannot be sent."));
    }
    if (Buffer.byteLength(text) > MAX_FRAME_BYTES)
      return Promise.reject(new LinkError("invalid_input", "The request is too large."));
    this.start();
    if (this.exhausted)
      return Promise.reject(
        new LinkError("unavailable", "The engine stopped and cannot be restarted. Restart FlowDriven."),
      );
    const child = this.child;
    if (!child) return Promise.reject(stopped());
    this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        child.stdin.write(`${text}\n`, (error) => {
          if (error) {
            this.pending.delete(id);
            reject(stopped());
          }
        });
      } catch {
        this.pending.delete(id);
        reject(stopped());
      }
    });
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopPromise = new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      child.on("exit", finish);
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        if (!done) timer = setTimeout(finish, 1000);
      }, this.options.stopWaitMs ?? 3000);
      try {
        child.stdin.end();
      } catch {}
    });
    return this.stopPromise;
  }
}
