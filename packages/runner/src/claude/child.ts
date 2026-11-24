import { spawn } from "node:child_process";
import { assertSafeArgs } from "./args.ts";
export type Child = {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream;
  send(text: string): void;
  stderrTail(): string;
  stop(): void;
  kill(): void;
  destroyPipes(): void;
  done: Promise<{ code: number | null; signal: string | null }>;
};
export function startChild(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    graceMs?: number;
    killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  },
): Child {
  assertSafeArgs(args);
  if (process.platform === "win32") throw new Error("Windows is not supported.");
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let tail: Buffer = Buffer.alloc(0);
  let spawnFailed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const append = (data: Buffer) => {
    tail = Buffer.concat([tail, data]).subarray(-65536);
  };
  child.stderr.on("data", (data: Buffer) => append(data));
  child.stdin.on("error", () => {});
  child.on("error", (error) => {
    spawnFailed = true;
    append(Buffer.from(error.message));
  });
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => {
      resolve({ code: spawnFailed ? null : code, signal });
    });
  });
  function signalGroup(signal: NodeJS.Signals) {
    if (child.pid !== undefined) {
      try {
        (options.killGroup ?? ((pid, sig) => process.kill(-pid, sig)))(child.pid, signal);
      } catch {
        /* The process group could not be signalled. */
      }
    }
  }
  return {
    get pid() {
      return child.pid;
    },
    stdout: child.stdout,
    send(text) {
      child.stdin.end(text);
    },
    stderrTail() {
      return tail.toString("utf8");
    },
    stop() {
      signalGroup("SIGTERM");
      if (timer === undefined) timer = setTimeout(() => signalGroup("SIGKILL"), options.graceMs ?? 1000);
    },
    kill() {
      signalGroup("SIGKILL");
    },
    destroyPipes() {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    },
    done,
  };
}
