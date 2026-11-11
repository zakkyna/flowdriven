import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

export function hasParentPart(path: string): boolean {
  return path.split(/[\\/]/).includes("..");
}

export function resolveDeep(path: string): string | undefined {
  if (!isAbsolute(path) || hasParentPart(path)) return undefined;
  let current = path;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(current), ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return undefined;
      try {
        lstatSync(current);
        return undefined;
      } catch (statError) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode !== "ENOENT" && statCode !== "ENOTDIR") return undefined;
      }
      const parent = dirname(current);
      if (parent === current) return undefined;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
