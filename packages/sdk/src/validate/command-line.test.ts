import { expect, test } from "vitest";
import { COMMAND_LIMITS, commandLineAllowed, parseCommandLine } from "./command-line.ts";

test("an exact pattern allows exactly its words and nothing more", () => {
  expect(commandLineAllowed(["git status"], ["git", "status"])).toBe(true);
  expect(commandLineAllowed(["git status"], ["git", "status", "extra"])).toBe(false);
  expect(commandLineAllowed(["git status"], ["git"])).toBe(false);
  expect(commandLineAllowed([], ["git"])).toBe(false);
});

test("a pattern ending in ' *' allows more words that are relative values or paths", () => {
  expect(commandLineAllowed(["git add *"], ["git", "add"])).toBe(true);
  expect(commandLineAllowed(["git add *"], ["git", "add", "src/file.ts", "name=value"])).toBe(true);
  expect(commandLineAllowed(["git status", "git add *"], ["git", "add", "file"])).toBe(true);
});

test("a wildcard word that is a flag (--output=/x, -o/x, -c core.fsmonitor=x, --exec-path), starts with /, holds .., or has / after = or : (of=/x, a:/x) is refused", () => {
  for (const word of [
    "--output=/x",
    "-o/x",
    "-c",
    "--exec-path",
    "/x",
    "a..b",
    "of=/x",
    "a:/x",
    "a,/x",
    "a@/x",
    "a%/x",
    "a+/x",
  ])
    expect(commandLineAllowed(["git add *"], ["git", "add", word])).toBe(false);
  expect(commandLineAllowed(["git add -c *"], ["git", "add", "-c", "core.fsmonitor=x"])).toBe(true);
});

test("each of ; & | $ ` > < ( ) ' \" \\ * ? # ~ ! { } [ ] and a tab or a line break in a line is refused", () => {
  for (const char of [
    ";",
    "&",
    "|",
    "$",
    "`",
    ">",
    "<",
    "(",
    ")",
    "'",
    '"',
    "\\",
    "*",
    "?",
    "#",
    "~",
    "!",
    "{",
    "}",
    "[",
    "]",
    String.fromCodePoint(9),
    String.fromCodePoint(10),
    String.fromCodePoint(13),
  ])
    expect(parseCommandLine(`git a${char}b`).ok).toBe(false);
});

test("a word that starts with = is refused", () => {
  for (const line of ["=git", "git =x"]) expect(parseCommandLine(line).ok).toBe(false);
  expect(commandLineAllowed(["git =x"], ["git", "=x"])).toBe(false);
});

test("two spaces in a row, a leading or trailing space, and an empty line are refused", () => {
  for (const line of ["git  status", " git", "git ", ""]) expect(parseCommandLine(line).ok).toBe(false);
  expect(parseCommandLine("git status")).toEqual({ ok: true, words: ["git", "status"] });
});

test("a path as the program (/usr/bin/git, ./x) is refused", () => {
  for (const line of ["/usr/bin/git status", "./x"]) expect(parseCommandLine(line).ok).toBe(false);
});

test("a line over 1,000 characters or 64 words is refused", () => {
  expect(COMMAND_LIMITS).toEqual({ chars: 1000, words: 64 });
  expect(parseCommandLine("x".repeat(1000)).ok).toBe(true);
  expect(parseCommandLine("x".repeat(1001)).ok).toBe(false);
  expect(parseCommandLine(Array(64).fill("x").join(" ")).ok).toBe(true);
  expect(parseCommandLine(Array(65).fill("x").join(" ")).ok).toBe(false);
});
