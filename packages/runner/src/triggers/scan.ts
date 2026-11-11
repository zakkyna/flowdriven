import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export type Snapshot = Record<string, [number, number]>;
export type ScanResult = { files: Snapshot; capped: boolean; outside: boolean };

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function resolveRoot(
  project: string,
  path: string,
): { ok: true; root: string } | { ok: false; reason: string } {
  let base: string;
  try {
    base = realpathSync(project);
    if (!lstatSync(base).isDirectory()) throw new Error();
  } catch {
    return { ok: false, reason: "The project folder is missing." };
  }
  if (!path || path.includes("\0")) return { ok: false, reason: "That folder path is not valid." };
  let root: string;
  try {
    root = realpathSync(resolve(base, path));
  } catch {
    return { ok: false, reason: "That folder does not exist." };
  }
  if (!inside(base, root))
    return { ok: false, reason: "Only folders inside the project folder can be watched for now." };
  try {
    if (!lstatSync(root).isDirectory()) return { ok: false, reason: "That path is not a folder." };
  } catch {
    return { ok: false, reason: "That folder does not exist." };
  }
  return { ok: true, root };
}

function segmentMatches(pattern: string, value: string): boolean {
  let prev = Array.from({ length: value.length + 1 }, (_, i) => i === 0);
  for (const ch of pattern) {
    const next: boolean[] = [ch === "*" && (prev[0] ?? false)];
    for (let i = 1; i <= value.length; i++) {
      next[i] =
        ch === "*"
          ? (prev[i] ?? false) || (next[i - 1] ?? false)
          : (prev[i - 1] ?? false) && (ch === "?" || ch === value[i - 1]);
    }
    prev = next;
  }
  return prev[value.length] ?? false;
}
export function globMatches(glob: string, rel: string): boolean {
  const parts = rel.split("/");
  let prev = Array.from({ length: parts.length + 1 }, (_, i) => i === 0);
  for (const pattern of glob.split("/")) {
    const next: boolean[] = [pattern === "**" && (prev[0] ?? false)];
    for (let i = 1; i <= parts.length; i++) {
      const part = parts[i - 1];
      next[i] =
        pattern === "**"
          ? (prev[i] ?? false) || (next[i - 1] ?? false)
          : (prev[i - 1] ?? false) && part !== undefined && segmentMatches(pattern, part);
    }
    prev = next;
  }
  return prev[parts.length] ?? false;
}

export function scanFolder(
  root: string,
  o: { glob: string; maxEntries: number; within: string },
): ScanResult {
  const entries: [string, [number, number]][] = [];
  let base: string;
  let rootReal: string;
  try {
    base = realpathSync(o.within);
    rootReal = realpathSync(root);
  } catch {
    return { files: {}, capped: false, outside: false };
  }
  if (!inside(base, rootReal)) return { files: {}, capped: false, outside: true };
  if (!Number.isSafeInteger(o.maxEntries) || o.maxEntries < 1)
    return { files: {}, capped: true, outside: false };
  const dirs = [{ path: root, rel: "" }];
  let count = 0;
  let capped = false;
  while (dirs.length > 0 && !capped) {
    const dir = dirs.pop();
    if (!dir) break;
    try {
      if (!inside(base, realpathSync(dir.path)) || !lstatSync(dir.path).isDirectory()) continue;
      const names = readdirSync(dir.path, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      if (!inside(base, realpathSync(dir.path)) || !lstatSync(dir.path).isDirectory()) continue;
      const children: typeof dirs = [];
      for (const item of names) {
        if (count >= o.maxEntries) {
          capped = true;
          break;
        }
        count++;
        if (item.isSymbolicLink()) continue;
        const path = join(dir.path, item.name);
        const rel = dir.rel ? `${dir.rel}/${item.name}` : item.name;
        try {
          const stat = lstatSync(path);
          if (stat.isSymbolicLink()) continue;
          if (item.isDirectory() && stat.isDirectory()) children.push({ path, rel });
          else if (item.isFile() && stat.isFile() && globMatches(o.glob, rel))
            entries.push([rel, [stat.size, Math.floor(stat.mtimeMs)]]);
        } catch {
          /* An entry disappeared. */
        }
      }
      dirs.push(...children.reverse());
      if (count >= o.maxEntries) capped = true;
    } catch {
      /* An unreadable or swapped directory is skipped. */
    }
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { files: Object.fromEntries(entries), capped, outside: false };
}

export function diffSnapshot(stored: Snapshot, scanned: Snapshot): { changed: string[]; removed: string[] } {
  const changed = Object.keys(scanned)
    .filter((key) => {
      const a = Object.hasOwn(stored, key) ? stored[key] : undefined;
      const b = scanned[key];
      return !a || !b || a[0] !== b[0] || a[1] !== b[1];
    })
    .sort();
  const removed = Object.keys(stored)
    .filter((key) => !Object.hasOwn(scanned, key))
    .sort();
  return { changed, removed };
}
export function parseSnapshot(value: unknown): Snapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 5000) return undefined;
  const result: [string, [number, number]][] = [];
  for (const [key, pair] of entries) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !pair.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0)
    )
      return undefined;
    result.push([key, [pair[0] as number, pair[1] as number]]);
  }
  return Object.fromEntries(result);
}
export function mergeHandled(stored: Snapshot, scanned: Snapshot, batch: string[]): Snapshot {
  const handled = new Set(batch);
  const result: [string, [number, number]][] = [];
  for (const [key, value] of Object.entries(scanned)) {
    const old = Object.hasOwn(stored, key) ? stored[key] : undefined;
    if (handled.has(key) || (old && old[0] === value[0] && old[1] === value[1])) result.push([key, value]);
    else if (old) result.push([key, old]);
  }
  return Object.fromEntries(result);
}
