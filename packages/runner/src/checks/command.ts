import { execFile } from "node:child_process";
export type CommandRunner = (
  cmd: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
) => Promise<{ code: number; stderr: string }>;
export function defaultCommandRunner(): CommandRunner {
  return (cmd, args, options) =>
    new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          signal: options.signal,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
        },
        (error, _stdout, stderr) => {
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stderr: String(stderr || error?.message || ""),
          });
        },
      );
    });
}
