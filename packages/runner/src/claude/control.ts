import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hookScript, isSafeControlPath, settingsJson } from "./hook-script.ts";

export type ControlDir = {
  id: string;
  path: string;
  req: string;
  res: string;
  cwd: string;
  settings: string;
  started: string;
};
export function controlRoot(dataDir: string): string {
  return join(dataDir, "control");
}
export function createControlDir(options: { root: string; id: string; rounds?: number }): ControlDir {
  const { root, id } = options;
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) throw new Error("The control id is not valid.");
  const path = join(root, id);
  if (!isSafeControlPath(path)) throw new Error("The control folder path is not safe.");
  const script = hookScript({ rounds: options.rounds ?? 50 });
  const settings = settingsJson(path);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("The control folder exists.");
    throw error;
  }
  const dir = {
    id,
    path,
    req: join(path, "req"),
    res: join(path, "res"),
    cwd: join(path, "cwd"),
    settings: join(path, "settings.json"),
    started: join(path, "started"),
  };
  try {
    for (const folder of [dir.req, dir.res, dir.cwd]) mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(path, "hook.sh"), script, { mode: 0o600 });
    writeFileSync(dir.settings, settings, { mode: 0o600 });
  } catch (error) {
    removeControlDir(dir);
    throw error;
  }
  return dir;
}
export function removeControlDir(dir: { path: string } | string): void {
  try {
    rmSync(typeof dir === "string" ? dir : dir.path, { recursive: true, force: true });
  } catch {}
}
export function sweepControlRoot(root: string): number {
  try {
    const names = readdirSync(root);
    let count = 0;
    for (const name of names) {
      try {
        rmSync(join(root, name), { recursive: true, force: true });
        count++;
      } catch {}
    }
    return count;
  } catch {
    return 0;
  }
}
