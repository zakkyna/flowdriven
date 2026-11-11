import { spawn } from "node:child_process";
export type CommandRunner = (
  cmd: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
) => Promise<{ code: number; stderr: string }>;
export function defaultCommandRunner(): CommandRunner {
  return (cmd, args, options) =>
    new Promise((resolve) => {
      if (process.platform === "win32") {
        resolve({ code: 1, stderr: "process group termination is unavailable" });
        return;
      }
      if (options.signal.aborted) {
        resolve({ code: 1, stderr: "command aborted" });
        return;
      }
      const child = spawn(cmd, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });
      let stderr = Buffer.alloc(0);
      let errorMessage = "";
      let stopped = false;
      const stop = () => {
        stopped = true;
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            // The process group may already have exited.
          }
        }
      };
      const timer = setTimeout(stop, options.timeoutMs);
      options.signal.addEventListener("abort", stop, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = Buffer.concat([stderr, chunk]).subarray(-65536);
      });
      child.on("error", (error) => {
        errorMessage = error.message;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", stop);
        resolve({ code: stopped ? 1 : (code ?? 1), stderr: stderr.toString() || errorMessage });
      });
    });
}
