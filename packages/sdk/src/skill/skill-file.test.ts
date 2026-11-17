import { expect, test } from "vitest";
import { parseSkillFile, skillCopyText } from "./skill-file.ts";

const file = (front: string, body = "Body\n") => `---\n${front}\n---\n${body}`;
const front = 'name: example\ndescription: "A skill"';

test("a SKILL.md with name, description and other keys parses to the name, the description, the body and the list of keys", () => {
  expect(parseSkillFile(file(`${front}\nmodel: test`))).toEqual({
    ok: true,
    skill: {
      name: "example",
      description: "A skill",
      body: "Body\n",
      keys: ["name", "description", "model"],
    },
  });
  expect(parseSkillFile(file(front).replaceAll("\n", "\r\n"))).toEqual(parseSkillFile(file(front)));
});
test("R14: the copy text holds only name and description in its front matter: allowed-tools, hooks, model, license and metadata are gone", () => {
  const result = parseSkillFile(
    file(`${front}\nallowed-tools: Bash\nhooks: {}\nmodel: test\nlicense: MIT\nmetadata: {a: b}`),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(skillCopyText(result.skill)).toBe('---\nname: "example"\ndescription: "A skill"\n---\nBody\n');
});
test("the copy text parses back to the same name, description and body", () => {
  const skill = { name: "example", description: 'A "quoted" skill\nnext', body: "Body\n---\nmore" };
  expect(parseSkillFile(skillCopyText(skill))).toEqual({
    ok: true,
    skill: { ...skill, keys: ["name", "description"] },
  });
});
test("a file without front matter on its first line, or whose front matter is not closed, is refused", () => {
  for (const text of ["text\n---\n", `---\n${front}\n`, "\n---\n---\n"])
    expect(parseSkillFile(text)).toEqual({ ok: false, reason: "This skill's SKILL.md has no front matter." });
});
test("a name that is not lowercase letters, digits and single hyphens, or is longer than 64, is refused", () => {
  for (const name of ["A", "a--b", "-a", "a-", "a_b", "a".repeat(65), ""])
    expect(parseSkillFile(file(`name: '${name}'\ndescription: x`))).toEqual({
      ok: false,
      reason: "This skill's name is invalid.",
    });
  expect(parseSkillFile(file(`name: ${"a".repeat(64)}\ndescription: x`)).ok).toBe(true);
});
test("a missing description, or one longer than 1,024 characters, is refused", () => {
  for (const value of ["", `description: ${"a".repeat(1025)}`, "description: 12", "description: ''"])
    expect(parseSkillFile(file(`name: example\n${value}`))).toEqual({
      ok: false,
      reason: "This skill's description is invalid.",
    });
  expect(parseSkillFile(file(`name: example\ndescription: ${"a".repeat(1024)}`)).ok).toBe(true);
});
test("a body over 60,000 characters is refused, and a body of 27,433 characters is read", () => {
  expect(parseSkillFile(file(front, "x".repeat(60001)))).toEqual({
    ok: false,
    reason: "This skill's text is longer than 60,000 characters.",
  });
  const result = parseSkillFile(file(front, "x".repeat(27433)));
  expect(result.ok && result.skill.body.length).toBe(27433);
  expect(parseSkillFile(file(front, "x".repeat(60000))).ok).toBe(true);
});
test("a file with a bidi control, a zero-width character or a control character other than tab and line break is refused", () => {
  for (const code of [0x202e, 0x200b, 0x00, 0x7f, 0x85, 0xfeff])
    expect(parseSkillFile(file(front, String.fromCodePoint(code)))).toEqual({
      ok: false,
      reason: "This skill's SKILL.md contains hidden characters.",
    });
  expect(parseSkillFile(file(front, "a\tb\nc")).ok).toBe(true);
});
test("front matter with an anchor, an alias, a tag or a duplicate key is refused with its reason, and a file over 256 KiB is refused", () => {
  for (const [extra, reason] of [
    ["x: &a value", "YAML anchor is not allowed"],
    ["x: *a", "YAML alias is not allowed"],
    ["x: !!str value", "YAML tag is not allowed"],
    ["name: other", "Duplicate YAML key: name"],
  ])
    expect(parseSkillFile(file(`${front}\n${extra}`))).toEqual({ ok: false, reason });
  expect(parseSkillFile(file(front, "x".repeat(262145)))).toEqual({
    ok: false,
    reason: "This skill's SKILL.md is larger than 256 KiB.",
  });
  for (const invalid of ["[]", "null", "42"]) expect(parseSkillFile(file(invalid)).ok).toBe(false);
});
