import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const outside = (root: string, path: string) => {
  const r = relative(root, path);
  return r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r);
};
type Token = { char: string; wildcard: boolean };
function patternParts(pattern: string, bind: (text: string) => string): Token[][] {
  const parts: Token[][] = [[]];
  const add = (char: string, wildcard: boolean) => {
    if (!wildcard && (char === "/" || char === "\\")) {
      parts.push([]);
    } else parts.at(-1)?.push({ char, wildcard });
  };
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith("$${", i)) {
      for (const char of "${") add(char, false);
      i += 3;
    } else if (pattern.startsWith("${", i)) {
      const end = pattern.indexOf("}", i + 2);
      if (end < 0) throw new Error("unclosed template expression");
      const value = bind(pattern.slice(i, end + 1));
      if (value.includes("/") || value.includes("\\") || value.includes(String.fromCodePoint(0)))
        throw new Error("invalid bound file path");
      for (const char of value) add(char, false);
      i = end + 1;
    } else {
      const char = pattern.charAt(i++);
      add(char, char === "*" || char === "?");
    }
  }
  return parts;
}
function matches(part: Token[], name: string): boolean {
  const chars = Array.from(name);
  let p = 0;
  let n = 0;
  let star = -1;
  let retry = 0;
  while (n < chars.length) {
    const token = part[p];
    if (token?.wildcard && token.char === "*") {
      star = p++;
      retry = n;
    } else if (token && ((token.wildcard && token.char === "?") || token.char === chars[n])) {
      p++;
      n++;
    } else if (star >= 0) {
      p = star + 1;
      n = ++retry;
    } else return false;
  }
  while (part[p]?.wildcard && part[p]?.char === "*") p++;
  return p === part.length;
}
export function matchFiles(
  folder: string,
  patterns: string[],
  bind: (text: string) => string = (s) => s,
): { path: string; size: number }[] {
  const root = realpathSync(folder);
  const found = new Map<string, number>();
  if (patterns.length === 0) throw new Error("missing file paths");
  for (const pattern of patterns) {
    let matched = false;
    if (isAbsolute(pattern)) throw new Error("outside the project folder");
    const parts = patternParts(pattern, bind);
    if (parts.some((p) => p.length === 0 || p.map((t) => t.char).join("") === ".."))
      throw new Error("outside the project folder");
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
      if (part.length === 2 && part.every((t) => t.wildcard && t.char === "*")) {
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
      if (!part.some((t) => t.wildcard)) {
        walk(resolve(dir, part.map((t) => t.char).join("")), index + 1);
        return;
      }
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) if (matches(part, name)) walk(resolve(dir, name), index + 1);
    }
    walk(resolve(folder), 0);
    if (!matched) throw new Error(`no files match ${pattern}`);
  }
  return Array.from(found, ([path, size]) => ({ path, size }));
}
