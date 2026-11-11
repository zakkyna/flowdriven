import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { EngineError } from "../errors.ts";

export function prepareDataDir(path: string, options?: { uid?: number }): string {
  if (!isAbsolute(path)) throw new EngineError("invalid_input", "The data folder must be an absolute path.");
  const resolved = resolve(path);
  try {
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
    const stat = lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new EngineError("invalid_input", "The data folder is not a folder.");
    const uid = options?.uid ?? process.getuid?.();
    if (uid !== undefined && stat.uid !== uid)
      throw new EngineError("invalid_input", "The data folder belongs to someone else.");
    if ((stat.mode & 0o022) !== 0)
      throw new EngineError("invalid_input", "The data folder must not be writable by group or others.");
    return resolved;
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError("invalid_input", "The data folder is not a folder.");
  }
}
