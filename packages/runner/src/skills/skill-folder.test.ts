import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash } from "@flowdriven/sdk/node";
import { afterEach, expect, test } from "vitest";
import { bundledSkill, readSkillFolder, skillSource, writeSkillCopy } from "./skill-folder.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const text = "---\nname: demo\ndescription: Example\nallowed-tools: Bash\n---\nBody\n";
function folder() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "skill-")));
  roots.push(dir);
  writeFileSync(join(dir, "SKILL.md"), text);
  return dir;
}
function loaded(dir: string) {
  const result = readSkillFolder(dir, "demo");
  if (!result.ok) throw new Error(result.reason);
  return result.skill;
}
test("skillSource reads claude-code:<name> as the folder ~/.claude/skills/<name> and flow:<name> as skills/<name>/ of the flow; any other ref or a bad name is undefined", () => {
  expect(skillSource("claude-code:demo", { home: "/home/test" })).toEqual({
    kind: "installed",
    name: "demo",
    dir: "/home/test/.claude/skills/demo",
  });
  expect(skillSource("flow:demo", { home: "/home/test" })).toEqual({
    kind: "bundled",
    name: "demo",
    prefix: "skills/demo/",
  });
  for (const ref of [undefined, "demo", "flow:../bad", `flow:${"a".repeat(65)}`])
    expect(skillSource(ref, { home: "/home/test" })).toBeUndefined();
});
test("an installed skill folder reads into its files, its parsed text and a hash equal to contentHash of its files", () => {
  const dir = folder();
  writeFileSync(join(dir, "ref"), "hello");
  const skill = loaded(dir);
  expect(skill).toMatchObject({
    name: "demo",
    description: "Example",
    body: "Body\n",
    hash: contentHash(skill.files),
  });
  expect([...skill.files.keys()].sort()).toEqual(["SKILL.md", "ref"]);
  expect(Number.isNaN(Date.parse(skill.modifiedAt))).toBe(false);
});
test("R9: changing one byte of SKILL.md or of a reference changes the hash", () => {
  const dir = folder();
  writeFileSync(join(dir, "ref"), "a");
  const first = loaded(dir).hash;
  writeFileSync(join(dir, "ref"), "b");
  const second = loaded(dir).hash;
  writeFileSync(join(dir, "SKILL.md"), `${text}x`);
  expect(new Set([first, second, loaded(dir).hash]).size).toBe(3);
});
test("R14: the copy keeps only name, description and the body in SKILL.md and keeps every other file byte for byte", () => {
  const dir = folder();
  const bytes = Buffer.from([0, 255, 10]);
  writeFileSync(join(dir, "ref"), bytes);
  const skill = loaded(dir);
  const dest = join(dir, "copy");
  writeSkillCopy(dest, skill);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe(
    '---\nname: "demo"\ndescription: "Example"\n---\nBody\n',
  );
  expect(readFileSync(join(dest, "ref"))).toEqual(bytes);
});
test("a symlink anywhere in the folder, or the folder itself as a symlink, is refused", () => {
  const dir = folder();
  const link = `${dir}-link`;
  roots.push(link);
  symlinkSync(dir, link);
  expect(readSkillFolder(link, "demo").ok).toBe(false);
  mkdirSync(join(dir, "sub"));
  symlinkSync(join(dir, "SKILL.md"), join(dir, "sub", "link"));
  expect(readSkillFolder(dir, "demo").ok).toBe(false);
});
test("more than 1,000 files, a file over 2 MiB or more than 64 MiB in all is refused, and 231 files of 16 MiB are read", () => {
  const dir = folder();
  const block = Buffer.alloc(73_000);
  for (let i = 0; i < 230; i++) writeFileSync(join(dir, `f${i}`), block);
  expect(readSkillFolder(dir, "demo").ok).toBe(true);
  writeFileSync(join(dir, "big"), Buffer.alloc(2_097_153));
  expect(readSkillFolder(dir, "demo").ok).toBe(false);
  rmSync(join(dir, "big"));
  for (let i = 230; i < 920; i++) writeFileSync(join(dir, `f${i}`), block);
  expect(readSkillFolder(dir, "demo").ok).toBe(false);
  for (let i = 0; i < 920; i++) rmSync(join(dir, `f${i}`));
  for (let i = 0; i < 1000; i++) writeFileSync(join(dir, `f${i}`), "");
  expect(readSkillFolder(dir, "demo").ok).toBe(false);
});
test("a folder without SKILL.md at its top, or whose SKILL.md names another skill, is refused", () => {
  const dir = folder();
  expect(readSkillFolder(dir, "other").ok).toBe(false);
  rmSync(join(dir, "SKILL.md"));
  expect(readSkillFolder(dir, "demo").ok).toBe(false);
});
test("entries whose name starts with a dot, and .DS_Store, are not read, not hashed and not copied", () => {
  const dir = folder();
  const before = loaded(dir).hash;
  mkdirSync(join(dir, ".hidden"));
  symlinkSync("missing", join(dir, ".hidden", "link"));
  writeFileSync(join(dir, ".DS_Store"), "x");
  const skill = loaded(dir);
  expect(skill.hash).toBe(before);
  expect([...skill.files.keys()]).toEqual(["SKILL.md"]);
  const dest = join(dir, "copy");
  writeSkillCopy(dest, skill);
  expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe(skill.copyText);
});
test("a bundled skill reads from the flow's stored files under skills/<name>/", () => {
  const result = bundledSkill(
    { "skills/demo/SKILL.md": text, "skills/demo/ref": "hi", "skills/demo/.hidden": "x", other: "x" },
    "demo",
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect([...result.skill.files.keys()].sort()).toEqual(["SKILL.md", "ref"]);
    expect(result.skill.hash).toBe(contentHash(result.skill.files));
  }
  expect(bundledSkill({}, "demo").ok).toBe(false);
});
test("writeSkillCopy creates folders 0700 and files 0600 and refuses a destination that exists", () => {
  const dir = folder();
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "ref"), "x");
  const skill = loaded(dir);
  const dest = join(dir, "copy");
  writeSkillCopy(dest, skill);
  expect(statSync(dest).mode & 0o777).toBe(0o700);
  expect(statSync(join(dest, "sub")).mode & 0o777).toBe(0o700);
  expect(statSync(join(dest, "sub", "ref")).mode & 0o777).toBe(0o600);
  expect(() => writeSkillCopy(dest, skill)).toThrow();
});
