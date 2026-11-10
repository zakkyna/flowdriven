import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { charClass } from "./ranges.mjs";

export const BINARY_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "ico", "icns"];

/** @returns {string} */
export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** @param {string} root @returns {string[]} */
export function listRepoFiles(root) {
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
    });
    return output.toString("utf8").split("\0").filter(Boolean).sort();
  } catch (error) {
    throw new Error(`git ls-files failed: ${error.stderr?.toString() ?? ""}`);
  }
}

function gitFiles(root, args) {
  try {
    return execFileSync("git", ["ls-files", "-z", ...args], { cwd: root, maxBuffer: 1 << 29 });
  } catch (error) {
    throw new Error(`git ls-files failed: ${error.stderr?.toString() ?? ""}`);
  }
}

function splitBytes(buffer) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] === 0) {
      parts.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  return parts;
}

function nameEntry(bytes, mode) {
  let validName = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    validName = false;
  }
  return { path: bytes.toString("utf8"), mode, validName };
}

/** @param {string} root @returns {{path: string, mode: string, validName: boolean}[]} */
export function listRepoEntries(root) {
  const entries = [];
  for (const record of splitBytes(gitFiles(root, ["-s"]))) {
    const tab = record.indexOf(0x09);
    const mode = record.subarray(0, 6).toString("ascii");
    entries.push(nameEntry(record.subarray(tab + 1), mode));
  }
  for (const name of splitBytes(gitFiles(root, ["--others", "--exclude-standard"]))) {
    const fullPath = Buffer.concat([Buffer.from(`${root}/`), name]);
    const info = lstatSync(fullPath);
    const mode = info.isSymbolicLink() ? "120000" : info.isDirectory() ? "040000" : "100644";
    entries.push(nameEntry(name, mode));
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** @param {string} root @returns {Set<string>} */
export function deletedPaths(root) {
  return new Set(splitBytes(gitFiles(root, ["--deleted"])).map((name) => name.toString("utf8")));
}

/** @param {string} path @param {Buffer} head @returns {boolean} */
export function isBinaryFile(path, head) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  if (!BINARY_EXTENSIONS.includes(ext)) return false;
  const signatures = {
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    jpg: Buffer.from([0xff, 0xd8, 0xff]),
    jpeg: Buffer.from([0xff, 0xd8, 0xff]),
    gif: Buffer.from("GIF8"),
    webp: Buffer.from("RIFF"),
    ico: Buffer.from([0, 0, 1, 0]),
    icns: Buffer.from("icns"),
  };
  const signature = signatures[ext];
  if (head.length < signature.length || !head.subarray(0, signature.length).equals(signature)) return false;
  return ext !== "webp" || head.subarray(8, 12).equals(Buffer.from("WEBP"));
}

/** @param {Buffer} buf @returns {{text: string} | {error: string}} */
export function decodeText(buf) {
  if (buf.includes(0)) return { error: "NUL byte in a text file" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf) };
  } catch {
    return { error: "not valid UTF-8" };
  }
}

/** @param {string} text @returns {string} */
export function showText(text) {
  let result = "";
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point < 0x20 || point === 0x7f || charClass(point) !== null) {
      result += `<U+${point.toString(16).toUpperCase().padStart(4, "0")}>`;
    } else {
      result += char;
    }
  }
  return result;
}

/** @type {typeof showText} */
export const showPath = showText;
