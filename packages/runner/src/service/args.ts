import { isAbsolute } from "node:path";

export type ProcessOptions = { dataDir: string; demo: boolean };
export function parseArguments(
  argv: string[],
): { ok: true; options: ProcessOptions } | { ok: false; message: string } {
  const fail = { ok: false, message: "Usage: main.ts --stdio --data-dir <absolute path> [--demo]" } as const;
  let stdio = false;
  let demo = false;
  let dataDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv.at(i);
    if (arg === "--stdio" && !stdio) stdio = true;
    else if (arg === "--demo" && !demo) demo = true;
    else if (arg === "--data-dir" && dataDir === undefined) {
      dataDir = argv.at(++i);
      if (!dataDir || !isAbsolute(dataDir)) return fail;
    } else return fail;
  }
  return stdio && dataDir ? { ok: true, options: { dataDir, demo } } : fail;
}
export function scrubEnvironment(env: NodeJS.ProcessEnv): void {
  delete env.ELECTRON_RUN_AS_NODE;
}
