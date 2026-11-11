import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";

const pkgs = fileURLToPath(new URL("../../", import.meta.url));
const sources = (pkg: string) =>
  readdirSync(join(pkgs, pkg, "src"), { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))
    .map((p) => join(pkgs, pkg, "src", p));

test("the SDK and the runner load on plain Node", () => {
  const urls = ["sdk/src/index.ts", "sdk/src/node.ts", "runner/src/index.ts"].map(
    (p) => pathToFileURL(join(pkgs, p)).href,
  );
  const out = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", urls.map((u) => `await import(${JSON.stringify(u)});`).join("")],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  expect(out.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(out.status).toBe(0);
});
test("no eval and no Function constructor in the SDK and runner sources", () => {
  for (const f of [...sources("sdk"), ...sources("runner")])
    expect(readFileSync(f, "utf8")).not.toMatch(/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/);
});
test("runner sources never import the contracts", () => {
  for (const f of sources("runner")) expect(readFileSync(f, "utf8")).not.toContain("@flowdriven/contracts");
});
test("the SDK main entry stays free of node: modules", () => {
  for (const f of sources("sdk").filter((p) => !/[\\/](hash|load)[\\/]|[\\/]node\.ts$/.test(p)))
    expect(readFileSync(f, "utf8")).not.toMatch(/from "node:/);
});
