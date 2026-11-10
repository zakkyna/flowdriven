import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { charClass, HIDDEN_RANGES } from "./lib/ranges.mjs";
import {
  decodeText,
  deletedPaths,
  isBinaryFile,
  listRepoEntries,
  repoRoot,
  showText,
} from "./lib/repo-files.mjs";

export { HIDDEN_RANGES };

/**
 * @param {string} text
 * @param {string} path
 * @returns {{path: string, line: number, column: number, codePoint: number, cls: string}[]}
 */
export function scanText(text, path) {
  const findings = [];
  let line = 1;
  let column = 1;
  let offset = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    offset += ch.length;
    const cls = charClass(codePoint, text.codePointAt(offset));
    if (cls) findings.push({ path, line, column, codePoint, cls });
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return findings;
}

/**
 * @param {{path: string, line: number, column: number, codePoint: number, cls: string}} f
 * @returns {string}
 */
export function formatFinding(f) {
  const hex = f.codePoint.toString(16).toUpperCase().padStart(4, "0");
  return `${f.path}:${f.line}:${f.column} U+${hex} ${f.cls}`;
}

const MAX_BYTES = 8388608;

function getFileInfo(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function addNameFindings(path, lines) {
  const display = showText(path);
  const kinds = new Set();
  for (const char of path) {
    const point = char.codePointAt(0);
    const cls = point < 0x20 || point === 0x7f ? "control" : charClass(point);
    if (!cls) continue;
    if (cls === "control") kinds.add("control character");
    else if (cls === "format" || HIDDEN_RANGES.some((range) => range.cls === cls))
      kinds.add("hidden character");
    else kinds.add("character not allowed");
  }
  for (const kind of kinds) lines.push(`${display}: ${kind} in file name`);
}

function scanFile(path, fullPath, info, lines) {
  const display = showText(path);
  if (info.size > MAX_BYTES) {
    lines.push(`${display}: file too large to scan`);
    return 1;
  }
  const buffer = readFileSync(fullPath);
  if (buffer.length > MAX_BYTES) {
    lines.push(`${display}: file too large to scan`);
    return 1;
  }
  const decoded = decodeText(buffer);
  if ("error" in decoded) {
    lines.push(`${display}: ${showText(decoded.error)}`);
    return 1;
  }
  const findings = scanText(decoded.text, display);
  for (const finding of findings.slice(0, 20)) {
    lines.push(formatFinding(finding));
  }
  if (findings.length > 20) lines.push(`${display}: and ${findings.length - 20} more`);
  return findings.length;
}

function readHead(path) {
  const descriptor = openSync(path, "r");
  try {
    const head = Buffer.alloc(12);
    return head.subarray(0, readSync(descriptor, head, 0, 12, 0));
  } finally {
    closeSync(descriptor);
  }
}

function entryFailure(entry, info, deleted) {
  if (!entry.validName) return "file name is not valid UTF-8";
  if (entry.mode === "120000" || info?.isSymbolicLink()) return "symbolic link is not allowed";
  if (entry.mode === "160000" || entry.path.split("/").at(-1) === ".gitmodules") {
    return "submodules are not allowed";
  }
  if (!info && !deleted.has(entry.path)) return "listed by git but not readable";
  return null;
}

/**
 * @param {string} root
 * @param {string[]} _argv
 * @returns {{lines: string[], code: 0 | 1 | 2}}
 */
export function run(root, _argv) {
  try {
    const lines = [];
    const entries = listRepoEntries(root);
    const deleted = deletedPaths(root);
    let count = 0;
    let total = 0;
    for (const entry of entries) {
      const fullPath = join(root, entry.path);
      const info = getFileInfo(fullPath);
      const failure = entryFailure(entry, info, deleted);
      if (failure) {
        lines.push(`${showText(entry.path)}: ${failure}`);
        total++;
        continue;
      }
      if (!info || info.isDirectory()) continue;
      const beforeNames = lines.length;
      addNameFindings(entry.path, lines);
      total += lines.length - beforeNames;
      if (isBinaryFile(entry.path, readHead(fullPath))) continue;
      count++;
      total += scanFile(entry.path, fullPath, info, lines);
    }
    if (total > 0) {
      lines.push(`hidden-chars: FAIL, ${total} findings`);
      return { lines, code: 1 };
    }
    return { lines: [`hidden-chars: OK, 0 findings in ${count} files`], code: 0 };
  } catch (error) {
    const message = String(error.message)
      .split(/\r\n|\r|\n/, 1)[0]
      .trim();
    return { lines: [`hidden-chars: ERROR ${showText(message)}`], code: 2 };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = run(repoRoot(), process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  process.exitCode = result.code;
}
