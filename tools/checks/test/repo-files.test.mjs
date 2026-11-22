import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  decodeText,
  deletedPaths,
  isBinaryFile,
  listRepoEntries,
  listRepoFiles,
  repoRoot,
  showPath,
  showText,
} from "../lib/repo-files.mjs";
import { makeRepo, removeRepo } from "./helpers/temp-repo.mjs";

test("lists tracked and untracked files, sorted, without ignored ones", () => {
  const root = makeRepo({ ".gitignore": "*.log\n", "b.md": "", "a b.md": "", "ignored.log": "" });
  try {
    execFileSync("git", ["add", "b.md"], { cwd: root });
    assert.deepEqual(listRepoFiles(root), [".gitignore", "a b.md", "b.md"]);
  } finally {
    removeRepo(root);
  }
});

test("listRepoEntries gives modes and marks names", () => {
  const root = makeRepo({ "a.md": "", "b.md": "" });
  try {
    execFileSync("git", ["add", "a.md"], { cwd: root });
    symlinkSync("a.md", join(root, "l"));
    assert.deepEqual(listRepoEntries(root), [
      { path: "a.md", mode: "100644", validName: true },
      { path: "b.md", mode: "100644", validName: true },
      { path: "l", mode: "120000", validName: true },
    ]);
  } finally {
    removeRepo(root);
  }
});

test("listRepoEntries reports a submodule link", () => {
  const root = makeRepo({});
  try {
    execFileSync(
      "git",
      ["update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,sub"],
      { cwd: root },
    );
    assert.deepEqual(listRepoEntries(root), [{ path: "sub", mode: "160000", validName: true }]);
  } finally {
    removeRepo(root);
  }
});

test("deletedPaths lists tracked files gone from disk", () => {
  const root = makeRepo({ "a.md": "" });
  try {
    execFileSync("git", ["add", "a.md"], { cwd: root });
    rmSync(join(root, "a.md"));
    assert.deepEqual(deletedPaths(root), new Set(["a.md"]));
  } finally {
    removeRepo(root);
  }
});

test("isBinaryFile needs the extension and the signature", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const cases = [
    ["logo.png", png],
    ["a.jpg", Buffer.from([0xff, 0xd8, 0xff])],
    ["a.jpeg", Buffer.from([0xff, 0xd8, 0xff])],
    ["a.gif", Buffer.from("GIF8")],
    ["a.webp", Buffer.from("RIFF1234WEBP")],
    ["a.ico", Buffer.from([0, 0, 1, 0])],
    ["a.icns", Buffer.from("icns")],
  ];
  for (const [path, head] of cases) {
    assert.equal(isBinaryFile(path, head), true, path);
    assert.equal(isBinaryFile(path, Buffer.from("text")), false, path);
  }
  assert.equal(isBinaryFile("logo.png", Buffer.from("text")), false);
  assert.equal(isBinaryFile("notes.md", png), false);
  assert.equal(isBinaryFile("a.pdf", Buffer.from("%PDF")), false);
});

test("TrueType files need the TrueType signature", () => {
  assert.equal(isBinaryFile("font.ttf", Buffer.from([0x00, 0x01, 0x00, 0x00])), true);
  assert.equal(isBinaryFile("font.ttf", Buffer.from([0x00, 0x02, 0x00, 0x00])), false);
});

test("showText escapes every refused code point", () => {
  assert.equal(showText(`a${String.fromCodePoint(0x9b)}b`), "a<U+009B>b");
  assert.equal(showText(`a${String.fromCodePoint(0x1b)}[8m`), "a<U+001B>[8m");
  assert.equal(showText(`x${String.fromCodePoint(0xa0)}y`), "x<U+00A0>y");
  assert.equal(showText("plain text"), "plain text");
});

test("decodeText refuses NUL bytes and invalid UTF-8", () => {
  assert.deepEqual(decodeText(Buffer.from([0x61, 0])), { error: "NUL byte in a text file" });
  assert.deepEqual(decodeText(Buffer.from([0x61, 0xff])), { error: "not valid UTF-8" });
  assert.deepEqual(decodeText(Buffer.from("ok")), { text: "ok" });
});

test("showPath makes control and hidden characters visible", () => {
  assert.equal(showPath(`a${String.fromCodePoint(0x202e)}b\n.md`), "a<U+202E>b<U+000A>.md");
  assert.equal(showPath(`x${String.fromCodePoint(0xe0041)}`), "x<U+E0041>");
  assert.equal(showPath("plain.md"), "plain.md");
});

test("repoRoot is the folder that holds tools/checks", () => {
  assert.equal(existsSync(join(repoRoot(), "tools/checks/allowlist.json")), true);
});
