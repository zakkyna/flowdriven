import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

function child(name: string) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(`./test-helpers/${name}.ts`, import.meta.url))], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
}
test("silences only the SQLite warning", () => {
  const out = child("warn-child");
  expect(out.status).toBe(0);
  expect(out.stderr).toContain("keep me");
  expect(out.stderr).not.toContain("SQLite is an experimental feature");
});
test("without the silencer the warning is printed (the check can see it)", () => {
  const out = child("plain-child");
  expect(out.status).toBe(0);
  expect(out.stderr).toContain("SQLite is an experimental feature");
});
