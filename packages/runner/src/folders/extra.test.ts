import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FOLDER_REASON, resolveExtraFolder } from "./extra.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "folders-")));
  roots.push(root);
  const home = join(root, "home");
  mkdirSync(home);
  return { root, home, dataDir: join(home, "AppData", "FlowDriven") };
}
test("~, ~/, /x, ../x, ~/a/../b, ~/.ssh, ~/a/.git and a part with a control or bidi character are refused with FOLDER_REASON.form", () => {
  const o = setup();
  for (const ref of [
    "~",
    "~/",
    "/x",
    "../x",
    "~/a/../b",
    "~/.ssh",
    "~/a/.git",
    `~/a${String.fromCodePoint(1)}`,
    `~/a${String.fromCodePoint(0x202e)}`,
    `~/a${String.fromCodePoint(0x200b)}b`,
    `~/a${String.fromCodePoint(0xfeff)}`,
    "~/a\\b",
    `~/${Array(17).fill("a").join("/")}`,
  ])
    expect(resolveExtraFolder(ref, o)).toEqual({ ok: false, reason: FOLDER_REASON.form });
});
test("a folder that resolves to a hidden folder, ~/Library in any case, or FlowDriven's data folder is refused", () => {
  const o = setup();
  for (const path of [".ssh", "Library", "AppData/FlowDriven"])
    mkdirSync(join(o.home, path), { recursive: true });
  for (const [target, link, reason] of [
    [".ssh", "docs", FOLDER_REASON.hidden],
    ["Library", "liblink", FOLDER_REASON.library],
    ["AppData/FlowDriven", "datalink", FOLDER_REASON.own],
  ] as const) {
    symlinkSync(join(o.home, target), join(o.home, link));
    expect(resolveExtraFolder(`~/${link}`, o)).toEqual({ ok: false, reason });
  }
  expect(resolveExtraFolder("~/library", o)).toEqual({ ok: false, reason: FOLDER_REASON.library });
  expect(resolveExtraFolder("~/AppData", o)).toEqual({ ok: false, reason: FOLDER_REASON.own });
});
test("a symlink that leads out of the home folder is refused, and a home folder that is itself a symlink is resolved first", () => {
  const o = setup();
  symlinkSync(o.root, join(o.home, "out"));
  expect(resolveExtraFolder("~/out", o)).toEqual({ ok: false, reason: FOLDER_REASON.outsideHome });
  symlinkSync(o.home, join(o.root, "home-link"));
  expect(resolveExtraFolder("~/work", { ...o, home: join(o.root, "home-link") })).toEqual({
    ok: true,
    path: join(o.home, "work"),
    exists: false,
  });
});
test("a folder that does not exist yet resolves with exists false", () => {
  const o = setup();
  expect(resolveExtraFolder("~/new/work", o)).toEqual({
    ok: true,
    path: join(o.home, "new/work"),
    exists: false,
  });
});
