import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Requirement } from "@flowdriven/sdk";
import { expect, test } from "vitest";
import { commandReadiness, findProgram } from "./readiness-commands.ts";

test("findProgram finds an executable file on PATH, skips a folder and a file that is not executable, and runs nothing", () => {
  const seen: string[] = [];
  expect(
    findProgram("flutter", "/one:/two:/three", (file) => {
      seen.push(file);
      return file === "/three/flutter";
    }),
  ).toBe("/three/flutter");
  expect(seen).toEqual(["/one/flutter", "/two/flutter", "/three/flutter"]);
});
test("readiness says Found flutter at <file>. or flutter is not on this Mac's PATH.", () => {
  const dir = mkdtempSync(join(tmpdir(), "flow-commands-"));
  try {
    const first = join(dir, "first");
    const second = join(dir, "second");
    mkdirSync(first);
    mkdirSync(second);
    mkdirSync(join(first, "flutter"));
    const file = join(second, "flutter");
    writeFileSync(file, "not a program");
    chmodSync(file, 0o755);
    const req = Requirement.parse({ id: "cli", type: "cli_tool", commands: ["flutter analyze"] });
    expect(commandReadiness(req, { path: `${first}:${second}` })).toEqual({
      state: "ok",
      detail: `Found flutter at ${file}.`,
    });
    chmodSync(file, 0o644);
    expect(commandReadiness(req, { path: `${first}:${second}` })).toEqual({
      state: "missing",
      detail: "flutter is not on this Mac's PATH.",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
