import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { prepareDataDir } from "./data-dir.ts";

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("creates a missing folder with mode 0700", () => {
  const path = join(temp(), "nested", "data");
  expect(prepareDataDir(path)).toBe(path);
  expect(statSync(path).mode & 0o777).toBe(0o700);
});
test("accepts an existing folder it owns and returns the resolved path", () => {
  const dir = temp();
  expect(prepareDataDir(join(dir, "."))).toBe(dir);
});
test("refuses what is not a folder owned by the user and writable only by it", () => {
  const dir = temp();
  const file = join(dir, "file");
  const link = join(dir, "link");
  const wide = join(dir, "wide");
  writeFileSync(file, "");
  symlinkSync(dir, link);
  mkdirSync(wide);
  chmodSync(wide, 0o777);
  for (const path of [file, link])
    expect(() => prepareDataDir(path)).toThrow(
      expect.objectContaining({ code: "invalid_input", message: "The data folder is not a folder." }),
    );
  expect(() => prepareDataDir(wide)).toThrow(
    expect.objectContaining({
      code: "invalid_input",
      message: "The data folder must not be writable by group or others.",
    }),
  );
  expect(() => prepareDataDir(dir, { uid: (process.getuid?.() ?? 0) + 1 })).toThrow(
    expect.objectContaining({ code: "invalid_input", message: "The data folder belongs to someone else." }),
  );
});
test("refuses a relative path", () => {
  expect(() => prepareDataDir("relative")).toThrow(
    expect.objectContaining({ code: "invalid_input", message: "The data folder must be an absolute path." }),
  );
});
