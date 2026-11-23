import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function makeTempRepo(changes: Record<string, string>, script: string) {
  const folder = mkdtempSync(join(root, ".workflow/scratch/temp-repo-"));
  try {
    const paths = ["tools/checks", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"];
    for (const parent of ["apps", "packages"]) {
      for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
        if (entry.isDirectory()) paths.push(`${parent}/${entry.name}/package.json`);
      }
    }
    for (const path of paths) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      cpSync(join(root, path), join(folder, path), { recursive: true });
    }
    const init = spawnSync("git", ["init", "--quiet"], { cwd: folder, encoding: "utf8" });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
    for (const [path, contents] of Object.entries(changes)) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), contents);
    }
    return spawnSync(process.execPath, [join("tools/checks", script)], { cwd: folder, encoding: "utf8" });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
