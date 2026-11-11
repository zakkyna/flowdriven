import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startChannel } from "./channel.ts";
import { controlRoot, createControlDir, removeControlDir, sweepControlRoot } from "./control.ts";
import { ALLOW_JSON, hookCommand, hookScript, settingsJson } from "./hook-script.ts";

const roots: string[] = [];
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
test("createControlDir makes the folder, req, res and cwd with mode 0700 and writes the script and the settings", () => {
  const root = controlRoot(setup());
  const dir = createControlDir({ root, id: "cc-1" });
  for (const path of [root, dir.path, dir.req, dir.res, dir.cwd])
    expect(statSync(path).mode & 0o777).toBe(0o700);
  expect(readFileSync(join(dir.path, "hook.sh"), "utf8")).toBe(hookScript({ rounds: 50 }));
  expect(readFileSync(dir.settings, "utf8")).toBe(settingsJson(dir.path));
  expect(existsSync(dir.started)).toBe(false);
  expect(statSync(dir.settings).mode & 0o777).toBe(0o600);
  expect(statSync(join(dir.path, "hook.sh")).mode & 0o777).toBe(0o600);
});
test("an id with a slash, dots, capitals or nothing, and a second folder of the same id, are refused", () => {
  const root = controlRoot(setup());
  for (const id of ["a/b", "..", "CC-1", ""])
    expect(() => createControlDir({ root, id })).toThrow("The control id is not valid.");
  createControlDir({ root, id: "cc-1" });
  expect(() => createControlDir({ root, id: "cc-1" })).toThrow("The control folder exists.");
  expect(() => createControlDir({ root: join(root, "a'b"), id: "cc-2" })).toThrow(
    "The control folder path is not safe.",
  );
});
test("sweepControlRoot removes every folder left under the root and returns the count, and a missing root is zero", () => {
  const root = controlRoot(setup());
  mkdirSync(join(root, "a"), { recursive: true });
  mkdirSync(join(root, "b"));
  writeFileSync(join(root, "a", "file"), "x");
  writeFileSync(join(root, "stray"), "x");
  expect(sweepControlRoot(root)).toBe(3);
  expect(sweepControlRoot(join(root, "missing"))).toBe(0);
  expect(() => removeControlDir(join(root, "missing"))).not.toThrow();
});
test("a control root under a path with a space works end to end with the hook", {
  timeout: 20_000,
}, async () => {
  const dir = createControlDir({ root: controlRoot(setup()), id: "cc-1", rounds: 20 });
  const channel = startChannel({ dir, decide: () => ({ allow: true, tool: "Read" }), pollMs: 5 });
  const child = spawn("/bin/sh", ["-c", hookCommand(dir.path, false)], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  child.stdin.end("{}");
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  channel.stop();
  expect(code).toBe(0);
  expect(out).toBe(`${ALLOW_JSON}\n`);
});
