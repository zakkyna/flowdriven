import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const outside = (root: string, path: string) => {
  const r = relative(root, path);
  return r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r);
};
export function matchFiles(folder: string, patterns: string[]): { path: string; size: number }[] {
  const root = realpathSync(folder);
  const found = new Map<string, number>();
  if (patterns.length === 0) throw new Error("missing file paths");
  for (const pattern of patterns) {
    let matched = false;
    if (isAbsolute(pattern) || outside(resolve(folder), resolve(folder, pattern)))
      throw new Error("outside the project folder");
    const parts = pattern.split(/[\\/]/);
    if (parts.some((p) => p === ".." || p === "")) throw new Error("outside the project folder");
    function walk(dir: string, index: number): void {
      if (index === parts.length) {
        let real: string;
        try {
          real = realpathSync(dir);
        } catch {
          return;
        }
        if (outside(root, real)) throw new Error("outside the project folder");
        const stat = statSync(dir);
        if (stat.isFile()) {
          matched = true;
          found.set(dir, stat.size);
        }
        return;
      }
      const part = parts.at(index);
      if (part === undefined) throw new Error("invalid path");
      let real: string;
      try {
        real = realpathSync(dir);
      } catch {
        return;
      }
      if (outside(root, real)) throw new Error("outside the project folder");
      if (part === "**") {
        walk(dir, index + 1);
        let names: string[];
        try {
          names = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of names) {
          const child = resolve(dir, name);
          const st = lstatSync(child);
          if (st.isDirectory()) walk(child, index);
          else if (st.isSymbolicLink()) {
            const target = realpathSync(child);
            if (outside(root, target)) throw new Error("outside the project folder");
          }
        }
        return;
      }
      if (!part.includes("*") && !part.includes("?")) {
        walk(resolve(dir, part), index + 1);
        return;
      }
      const regex = new RegExp(
        `^${part
          .split("")
          .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")))
          .join("")}$`,
      );
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) if (regex.test(name)) walk(resolve(dir, name), index + 1);
    }
    walk(resolve(folder), 0);
    if (!matched) throw new Error(`no files match ${pattern}`);
  }
  return Array.from(found, ([path, size]) => ({ path, size }));
}
