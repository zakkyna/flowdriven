import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function makeRepo(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven-checks-")));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return root;
  } catch (error) {
    removeRepo(root);
    throw error;
  }
}

export function removeRepo(root) {
  rmSync(root, { recursive: true, force: true });
}
