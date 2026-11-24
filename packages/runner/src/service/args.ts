import { isAbsolute } from "node:path";

export type ProcessOptions = { dataDir: string; demo: boolean; languages: string[] };
export function parseArguments(
  argv: string[],
): { ok: true; options: ProcessOptions } | { ok: false; message: string } {
  const fail = {
    ok: false,
    message: "Usage: main.ts --stdio --data-dir <absolute path> [--demo] [--languages=en,id]",
  } as const;
  let stdio = false;
  let demo = false;
  let languages: string[] | undefined;
  let dataDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv.at(i);
    if (arg === "--stdio" && !stdio) stdio = true;
    else if (arg === "--demo" && !demo) demo = true;
    else if (arg === "--data-dir" && dataDir === undefined) {
      dataDir = argv.at(++i);
      if (!dataDir || !isAbsolute(dataDir)) return fail;
    } else if (arg?.startsWith("--languages=") && languages === undefined) {
      languages = arg.slice("--languages=".length).split(",");
      if (
        !languages.includes("en") ||
        new Set(languages).size !== languages.length ||
        languages.some((code) => !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code))
      )
        return fail;
    } else return fail;
  }
  return stdio && dataDir ? { ok: true, options: { dataDir, demo, languages: languages ?? ["en"] } } : fail;
}
export function scrubEnvironment(env: NodeJS.ProcessEnv): void {
  delete env.ELECTRON_RUN_AS_NODE;
}
