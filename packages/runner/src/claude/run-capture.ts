import { startChild } from "./child.ts";
export type Captured = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};
export async function runCapture(
  command: string,
  args: readonly string[],
  options: { env: Record<string, string>; cwd?: string; timeoutMs: number; maxBytes: number },
): Promise<Captured> {
  const child = startChild(command, args, { cwd: options.cwd ?? process.cwd(), env: options.env });
  let output: Buffer = Buffer.alloc(0);
  let timedOut = false;
  let truncated = false;
  child.stdout.on("data", (chunk: Buffer) => {
    const remaining = Math.max(0, options.maxBytes - output.length);
    output = Buffer.concat([output, chunk.subarray(0, remaining)]);
    if (chunk.length > remaining) {
      truncated = true;
      child.kill();
    }
  });
  child.send("");
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, options.timeoutMs);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const { code } = await Promise.race([
    child.done,
    new Promise<{ code: null }>((resolve) => {
      deadline = setTimeout(() => {
        timedOut = true;
        child.kill();
        child.destroyPipes();
        resolve({ code: null });
      }, options.timeoutMs + 1000);
    }),
  ]);
  clearTimeout(timer);
  if (deadline !== undefined) clearTimeout(deadline);
  return { code, stdout: output.toString("utf8"), stderr: child.stderrTail(), timedOut, truncated };
}
