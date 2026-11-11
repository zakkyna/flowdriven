import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const runner = fileURLToPath(new URL("..", import.meta.url));
const contracts = fileURLToPath(new URL("../../contracts/", import.meta.url));

test("the contracts load on plain Node from the runner package", () => {
  const code =
    "const m = await import('@flowdriven/contracts'); process.stdout.write(typeof m.operations['flows.list'] + ' ' + new m.RunnerError('not_found', 'x').code)";
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: runner,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  expect(out.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  expect(out.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(out.status).toBe(0);
  expect(out.stdout).toBe("object not_found");
});

test("relative imports in the contracts sources name their .ts file", () => {
  const src = join(contracts, "src");
  const offenders: string[] = [];
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".test.ts"),
  )) {
    for (const line of readFileSync(join(src, file), "utf8").split("\n")) {
      if (line.startsWith("import type ")) continue;
      const match = line.match(/^(?:import|export)\s+(?:.*\s+from\s+)?["'](\.\/[^"']+)["']/);
      const specifier = match?.at(1);
      if (specifier && !specifier.endsWith(".ts")) offenders.push(`${file}: ${line}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the base compiler settings keep the contracts erasable", () => {
  const base = JSON.parse(readFileSync(new URL("../../../tsconfig.base.json", import.meta.url), "utf8")) as {
    compilerOptions: {
      allowImportingTsExtensions?: boolean;
      rewriteRelativeImportExtensions?: boolean;
      erasableSyntaxOnly?: boolean;
    };
  };
  expect([
    base.compilerOptions.allowImportingTsExtensions,
    base.compilerOptions.rewriteRelativeImportExtensions,
    base.compilerOptions.erasableSyntaxOnly,
  ]).toEqual([true, true, true]);
});
