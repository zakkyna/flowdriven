import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentHash, parseSkillFile, SKILL_NAME, skillCopyText } from "@flowdriven/sdk/node";

export const SKILL_FOLDER_LIMITS = { files: 1000, fileBytes: 2097152, totalBytes: 67108864 };
export type LoadedSkill = {
  name: string;
  description: string;
  body: string;
  copyText: string;
  files: Map<string, Uint8Array>;
  hash: string;
  modifiedAt: string;
};
type Result = { ok: true; skill: LoadedSkill } | { ok: false; reason: string };
const validName = (name: string) => name.length <= 64 && SKILL_NAME.test(name);
export function skillSource(
  ref: string | undefined,
  o: { home: string },
):
  | { kind: "installed"; name: string; dir: string }
  | { kind: "bundled"; name: string; prefix: string }
  | undefined {
  const match = /^(claude-code|flow):(.+)$/.exec(ref ?? "");
  const name = match?.[2];
  if (!name || !validName(name)) return undefined;
  return match?.[1] === "claude-code"
    ? { kind: "installed", name, dir: join(o.home, ".claude", "skills", name) }
    : { kind: "bundled", name, prefix: `skills/${name}/` };
}
function finish(files: Map<string, Uint8Array>, name: string, modifiedAt: string): Result {
  if (!validName(name)) return { ok: false, reason: "This skill's name is invalid." };
  const source = files.get("SKILL.md");
  if (!source) return { ok: false, reason: "This skill has no SKILL.md file." };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    return { ok: false, reason: "This skill's SKILL.md is not valid UTF-8." };
  }
  const parsed = parseSkillFile(text);
  if (!parsed.ok) return parsed;
  if (parsed.skill.name !== name)
    return { ok: false, reason: "This skill's name does not match its folder." };
  try {
    return {
      ok: true,
      skill: {
        ...parsed.skill,
        copyText: skillCopyText(parsed.skill),
        files,
        hash: contentHash(files),
        modifiedAt,
      },
    };
  } catch {
    return { ok: false, reason: "This skill has an invalid file path." };
  }
}
export function readSkillFolder(dir: string, name: string): Result {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let newest = 0;
  try {
    function walk(path: string, relative: string): void {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("This skill contains a symbolic link.");
      if (stat.isDirectory()) {
        for (const entry of readdirSync(path))
          if (!entry.startsWith(".")) walk(join(path, entry), relative ? `${relative}/${entry}` : entry);
      } else if (stat.isFile()) {
        if (
          files.size >= SKILL_FOLDER_LIMITS.files ||
          stat.size > SKILL_FOLDER_LIMITS.fileBytes ||
          total + stat.size > SKILL_FOLDER_LIMITS.totalBytes
        )
          throw new Error("This skill folder is too large.");
        const bytes = readFileSync(path);
        total += bytes.length;
        if (bytes.length > SKILL_FOLDER_LIMITS.fileBytes || total > SKILL_FOLDER_LIMITS.totalBytes)
          throw new Error("This skill folder is too large.");
        files.set(relative, bytes);
        newest = Math.max(newest, stat.mtimeMs);
      } else throw new Error("This skill contains an unsupported entry.");
    }
    walk(dir, "");
    return finish(files, name, new Date(newest).toISOString());
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error &&
        [
          "This skill contains a symbolic link.",
          "This skill folder is too large.",
          "This skill contains an unsupported entry.",
        ].includes(error.message)
          ? error.message
          : "This skill folder could not be read.",
    };
  }
}
export function bundledSkill(source: Record<string, string>, name: string): Result {
  if (!validName(name)) return { ok: false, reason: "This skill's name is invalid." };
  const prefix = `skills/${name}/`;
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [path, text] of Object.entries(source)) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (relative.split("/").some((part) => part.startsWith("."))) continue;
    const bytes = new TextEncoder().encode(text);
    total += bytes.length;
    if (
      files.size >= SKILL_FOLDER_LIMITS.files ||
      bytes.length > SKILL_FOLDER_LIMITS.fileBytes ||
      total > SKILL_FOLDER_LIMITS.totalBytes
    )
      return { ok: false, reason: "This skill folder is too large." };
    files.set(relative, bytes);
  }
  return finish(files, name, new Date(0).toISOString());
}
export function writeSkillCopy(dest: string, skill: LoadedSkill): void {
  try {
    mkdirSync(dest, { mode: 0o700 });
  } catch {
    throw new Error("This skill copy folder could not be created.");
  }
  for (const [path, bytes] of skill.files) {
    const target = join(dest, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, path === "SKILL.md" ? skill.copyText : bytes, { mode: 0o600, flag: "wx" });
  }
}
