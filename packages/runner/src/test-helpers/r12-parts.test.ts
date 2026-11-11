import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { firstControlDir, listRequests, parsePs, startSeen, verdict } from "./r12-parts.ts";

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
test("startSeen detects the start hook marker", () => {
  const root = temp();
  expect(startSeen(root)).toBe(false);
  writeFileSync(join(root, "started"), "");
  expect(startSeen(root)).toBe(true);
});
test("verdict", () => {
  const kill = {
    mode: "kill" as const,
    startSeen: true,
    requestLeft: true,
    allowed: 0,
    refused: 0,
    fileExists: false,
    claudeAlive: true,
  };
  const remove = { ...kill, mode: "remove" as const, requestLeft: false, refused: 1, claudeAlive: false };
  for (const [report, pass] of [
    [kill, true],
    [{ ...kill, startSeen: false }, false],
    [{ ...kill, requestLeft: false }, false],
    [{ ...kill, fileExists: true }, false],
    [remove, true],
    [{ ...remove, refused: 0 }, false],
    [{ ...remove, allowed: 1 }, false],
    [{ ...remove, fileExists: true }, false],
    [{ ...remove, startSeen: false }, false],
  ] as const)
    expect(verdict(report).pass).toBe(pass);
  expect(verdict(kill).lines).toEqual([
    "start hook ran: yes",
    "request left unanswered: yes",
    "calls the runner allowed: 0",
    "calls Claude Code reports as refused: 0",
    "notes/hello.txt exists: no",
    "claude process still alive: yes",
    "R12 (kill): PASS",
  ]);
  expect(verdict(remove).lines).toEqual([
    "start hook ran: yes",
    "request left unanswered: no",
    "calls the runner allowed: 0",
    "calls Claude Code reports as refused: 1",
    "notes/hello.txt exists: no",
    "claude process still alive: no",
    "R12 (remove): PASS",
  ]);
});
