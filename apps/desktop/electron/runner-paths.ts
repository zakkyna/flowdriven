import { join, resolve } from "node:path";

export function isDemo(env: Record<string, string | undefined>): boolean {
  return env.FLOWDRIVEN_DEMO === "1";
}
export function dataDirFor(env: Record<string, string | undefined>, appData: string): string {
  return env.FLOWDRIVEN_DATA_DIR
    ? resolve(env.FLOWDRIVEN_DATA_DIR)
    : join(appData, isDemo(env) ? "FlowDriven-demo" : "FlowDriven");
}
export function runnerEntry(dirname: string): string {
  return resolve(dirname, "../../../packages/runner/src/main.ts");
}
export function runnerEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) {
    const value = env[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}
