import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];
export function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  return join(dir, "store.sqlite");
}
export function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
