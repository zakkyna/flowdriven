import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Requirement } from "@flowdriven/sdk";
import {
  bundledSkill,
  type LoadedSkill,
  readSkillFolder,
  skillSource,
  writeSkillCopy,
} from "../skills/skill-folder.ts";
import { sweepControlRoot } from "./control.ts";

export const SKILL_STOP = {
  changed: (name: string) =>
    `Your skill ${name} changed since you allowed this flow. Allow it again on the flow's screen.`,
  undeclared: "This step's skill is not declared.",
};
export function sweepSkillCopies(copyRoot: string): number {
  return sweepControlRoot(copyRoot);
}
export function prepareSkillStep(input: {
  requirement: Requirement;
  pin: string | undefined;
  home: string;
  flowFiles: Record<string, string>;
  copyRoot: string;
  id: string;
}): { ok: true; folder: string; skill: LoadedSkill } | { ok: false; block: string } {
  const source = skillSource(input.requirement.ref, { home: input.home });
  if (!source || input.requirement.type !== "skill") return { ok: false, block: SKILL_STOP.undeclared };
  const loaded =
    source.kind === "installed"
      ? readSkillFolder(source.dir, source.name)
      : bundledSkill(input.flowFiles, source.name);
  if (!loaded.ok) return { ok: false, block: loaded.reason };
  if (!input.pin || loaded.skill.hash !== input.pin)
    return { ok: false, block: SKILL_STOP.changed(source.name) };
  const parent = join(input.copyRoot, input.id);
  const folder = join(parent, source.name);
  let created = false;
  try {
    mkdirSync(input.copyRoot, { recursive: true, mode: 0o700 });
    mkdirSync(parent, { mode: 0o700 });
    created = true;
    writeSkillCopy(folder, loaded.skill);
    return { ok: true, folder, skill: loaded.skill };
  } catch {
    if (created) {
      try {
        rmSync(parent, { recursive: true, force: true });
      } catch {}
    }
    return { ok: false, block: "This skill copy folder could not be created." };
  }
}
