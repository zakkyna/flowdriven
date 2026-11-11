import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { firstControlDir, listRequests, parsePs, verdict } from "./r12-parts.ts";

const roots: string[] = [];
function temp() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
test("parsePs returns the pids whose command holds the needle, paths with spaces included", () => {
  expect(
    parsePs(
      "  12 node /x/app data/control/cc-1/settings.json\n  13 other\n  14 node /x/app data/control/cc-1/settings.json",
      "/x/app data/control/cc-1/settings.json",
    ),
  ).toEqual([12, 14]);
});
test("listRequests lists only finished request names, and an absent folder is empty", () => {
  const root = temp();
  expect(listRequests(root)).toEqual([]);
  mkdirSync(join(root, "req"));
  for (const name of ["a.json", ".hidden.json", "b.tmp", "b.json"])
    writeFileSync(join(root, "req", name), "");
  expect(listRequests(root).sort()).toEqual(["a.json", "b.json"]);
});
test("firstControlDir finds the first folder and is undefined with none", () => {
  const root = temp();
  expect(firstControlDir(root)).toBeUndefined();
  mkdirSync(join(root, "control", "b"), { recursive: true });
  mkdirSync(join(root, "control", "a"));
  writeFileSync(join(root, "control", "0"), "");
  expect(firstControlDir(root)).toBe(join(root, "control", "a"));
});
test("verdict", () => {
  const base = { mode: "kill" as const, requestLeft: true, fileExists: false, claudeAlive: true };
  expect(verdict(base)).toEqual({
    pass: true,
    lines: [
      "request left unanswered: yes",
      "notes/hello.txt exists: no",
      "claude process still alive: yes",
      "R12 (kill): PASS",
    ],
  });
  expect(verdict({ ...base, requestLeft: false }).pass).toBe(false);
  expect(verdict({ ...base, fileExists: true }).pass).toBe(false);
  expect(verdict({ ...base, mode: "remove", requestLeft: false, claudeAlive: false })).toEqual({
    pass: true,
    lines: [
      "request left unanswered: no",
      "notes/hello.txt exists: no",
      "claude process still alive: no",
      "R12 (remove): PASS",
    ],
  });
  expect(verdict({ ...base, mode: "remove", requestLeft: true }).pass).toBe(true);
  expect(verdict({ ...base, mode: "remove", fileExists: true }).pass).toBe(false);
});
