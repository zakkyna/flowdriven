import { FlowFileError } from "../hash/canonical.ts";
import { parseFlowYaml } from "../load/parse-yaml.ts";
import { hasHiddenText } from "../validate/hidden.ts";

export const SKILL_LIMITS = { nameMax: 64, descriptionMax: 1024, bodyMax: 60000, fileBytes: 262144 };
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type SkillFile = { name: string; description: string; body: string; keys: string[] };

export function parseSkillFile(text: string): { ok: true; skill: SkillFile } | { ok: false; reason: string } {
  if (new TextEncoder().encode(text).length > SKILL_LIMITS.fileBytes)
    return { ok: false, reason: "This skill's SKILL.md is larger than 256 KiB." };
  const normalized = text.replaceAll("\r\n", "\n");
  if (hasHiddenText(normalized))
    return { ok: false, reason: "This skill's SKILL.md contains hidden characters." };
  const lines = normalized.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1)
    return { ok: false, reason: "This skill's SKILL.md has no front matter." };
  let value: unknown;
  try {
    value = parseFlowYaml(lines.slice(1, end).join("\n"));
  } catch (error) {
    if (error instanceof FlowFileError) return { ok: false, reason: error.message };
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, reason: "This skill's front matter must be a map." };
  const fields = value as Record<string, unknown>;
  const { name, description } = fields;
  if (typeof name !== "string" || name.length > SKILL_LIMITS.nameMax || !SKILL_NAME.test(name))
    return { ok: false, reason: "This skill's name is invalid." };
  if (
    typeof description !== "string" ||
    description.trim().length === 0 ||
    description.length > SKILL_LIMITS.descriptionMax
  )
    return { ok: false, reason: "This skill's description is invalid." };
  if (hasHiddenText(description))
    return { ok: false, reason: "This skill's SKILL.md contains hidden characters." };
  const body = lines.slice(end + 1).join("\n");
  if (body.length > SKILL_LIMITS.bodyMax)
    return { ok: false, reason: "This skill's text is longer than 60,000 characters." };
  return { ok: true, skill: { name, description, body, keys: Object.keys(fields) } };
}

export function skillCopyText(skill: Pick<SkillFile, "name" | "description" | "body">): string {
  return `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n${skill.body}`;
}
