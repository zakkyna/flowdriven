import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { findPrivateTraces } from "./test/repo-rules";
import { makeTempRepo } from "./test/temp-repo";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const folders = [
  "packages/fixtures",
  "packages/runner/src/test-helpers",
  "apps/desktop/src/test",
  "apps/desktop/electron/test-helpers",
  "tools/checks/test/helpers",
  "flows/upwork-job-review",
];
const oldFakeScripts = new Set(["fake-claude.ts", "fake-claude-script.ts"]);
const nonCliFakes = new Set(["fake-brain.ts", "fake-chrome.ts"]);
const header = "// synthetic: written by hand, never recorded";

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

function missingHeader(path: string, text: string): string[] {
  const name = path.split("/").at(-1) ?? "";
  if (
    !/\/test-helpers\/fake-.*\.ts$/.test(path) ||
    name.endsWith(".test.ts") ||
    oldFakeScripts.has(name) ||
    nonCliFakes.has(name)
  )
    return [];
  const firstLine = text.startsWith("#!") ? text.split("\n")[1] : text.split("\n")[0];
  return firstLine === header ? [] : [path];
}

test("TC-REPO-11 detects private traces and accepts synthetic examples", () => {
  const rejected = [
    "/" + "Users" + "/sam/x",
    "/" + "home" + "/sam",
    "/" + "Volumes" + "/disk/x",
    "C:" + "\\" + "Users" + "\\sam",
    "sam" + "@" + "example.org",
    "A1".repeat(20),
  ];
  const allowed = [
    "~" + "/notes",
    "sam" + "@" + "example.test",
    "sha256:" + "a".repeat(64),
    "@flowdriven/contracts",
    "@types/node",
    `import item from "./${"a".repeat(40)}"`,
    "/home/test/file",
    "/home/example/file",
    "donotreply" + "@" + "upwork.com",
  ];
  for (const value of rejected) expect(findPrivateTraces(value), value).not.toEqual([]);
  for (const value of allowed) expect(findPrivateTraces(value), value).toEqual([]);
});

test("TC-REPO-11 scans every fixture and test helper and requires synthetic fake scripts", () => {
  const errors = folders
    .flatMap((folder) => filesUnder(join(root, folder)))
    .flatMap((file) => {
      const path = relative(root, file);
      const text = readFileSync(file, "utf8");
      return [...findPrivateTraces(text).map((trace) => `${path}: ${trace}`), ...missingHeader(path, text)];
    });
  expect(errors).toEqual([]);
  expect(missingHeader("packages/runner/src/test-helpers/fake-new.ts", "// missing")).toEqual([
    "packages/runner/src/test-helpers/fake-new.ts",
  ]);
});

test("TC-REPO-01 rejects unapproved dependencies and accepts the unchanged repository", () => {
  const scenarios = [
    ["apps/desktop/package.json", "dependencies", "left-pad", "1.3.0", "left-pad is not on the allowlist"],
    [
      "packages/contracts/package.json",
      "dependencies",
      "react",
      "19.3.1",
      "react is not allowed in package @flowdriven/contracts",
    ],
    [
      "apps/desktop/package.json",
      "devDependencies",
      "vitest-fake-font",
      "1.0.0",
      "vitest-fake-font is not on the allowlist",
    ],
  ] as const;
  for (const [path, field, name, version, message] of scenarios) {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    manifest[field] = { ...manifest[field], [name]: version };
    const result = makeTempRepo({ [path]: JSON.stringify(manifest) }, "dependency-gate.mjs");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`${path}: ${message}`);
  }
  const clean = makeTempRepo({}, "dependency-gate.mjs");
  expect(clean.status).toBe(0);
  expect(clean.stdout).toContain("dependency-gate: OK");
});

test("TC-REPO-02 keeps the words folder out of workspaces", () => {
  const allowlist = JSON.parse(readFileSync(join(root, "tools/checks/allowlist.json"), "utf8"));
  expect(Object.keys(allowlist.workspaces)).toEqual([
    "flowdriven-workspace",
    "@flowdriven/contracts",
    "@flowdriven/fixtures",
    "@flowdriven/sdk",
    "@flowdriven/runner",
    "@flowdriven/desktop",
  ]);
  expect(existsSync(join(root, "packages/i18n"))).toBe(false);
  expect(
    filesUnder(join(root, "apps/desktop/src/i18n")).filter((path) => path.endsWith("/package.json")),
  ).toEqual([]);
  const result = spawnSync(process.execPath, ["tools/checks/dependency-gate.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("dependency-gate: OK");
  expect(result.stderr).toBe("");
});

test("TC-REPO-03 rejects look-alikes, aliases, non-registry sources and install hooks", () => {
  for (const [name, version] of [
    ["reactt", "19.3.1"],
    ["react-dom ", "19.3.1"],
    ["react", "npm:evil-react@1.0.0"],
    ["@flowdriven/contract", "workspace:*"],
    ["react", "git+https://example.com/x.git"],
  ] as const) {
    const path = "apps/desktop/package.json";
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    manifest.dependencies = { ...manifest.dependencies, [name]: version };
    const result = makeTempRepo({ [path]: JSON.stringify(manifest) }, "dependency-gate.mjs");
    expect(result.status, name).toBe(1);
    expect(result.stdout, name).toContain(name);
    expect(result.stdout).toMatch(/not on the allowlist|must be an exact version|not a workspace package/);
  }
  const path = "packages/runner/package.json";
  const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
  manifest.scripts = { postinstall: "node x.js" };
  const result = makeTempRepo({ [path]: JSON.stringify(manifest) }, "dependency-gate.mjs");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(`${path}: field scripts is not allowed`);
});

test("TC-REPO-04 detects hidden characters in words and code", () => {
  const result = makeTempRepo(
    {
      "apps/desktop/src/i18n/id.ts": `"Setujui${String.fromCodePoint(0x202e)}"`,
      "packages/runner/src/a.ts": `// ok ${String.fromCodePoint(0x2066)} x ${String.fromCodePoint(0x2069)}`,
    },
    "hidden-chars.mjs",
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toMatch(/apps\/desktop\/src\/i18n\/id\.ts:1:\d+ U\+202E bidi-control/);
  expect(result.stdout).toMatch(/packages\/runner\/src\/a\.ts:1:\d+ U\+2066 bidi-control/);
  expect(result.stdout).toMatch(/packages\/runner\/src\/a\.ts:1:\d+ U\+2069 bidi-control/);
  expect(result.stdout).toContain("hidden-chars: FAIL, 3 findings");
  const clean = makeTempRepo({}, "hidden-chars.mjs");
  expect(clean.status).toBe(0);
  expect(clean.stdout).toContain("hidden-chars: OK");
});

test("TC-REPO-10 bundles Plus Jakarta Sans locally with OFL license, fallback, and no remote fonts", () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  expect(tracked.status).toBe(0);
  const trackedFiles = tracked.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const fontFiles = trackedFiles.filter((file) => /\.(woff2?|ttf|otf|eot)$/i.test(file));
  expect(fontFiles).toEqual(["apps/desktop/src/styles/fonts/PlusJakartaSans-VariableFont.ttf"]);
  const licensePath = "apps/desktop/src/styles/fonts/OFL.txt";
  expect(trackedFiles).toContain(licensePath);
  expect(existsSync(join(root, licensePath))).toBe(true);
  expect(readFileSync(join(root, licensePath), "utf8")).toContain("SIL OPEN FONT LICENSE");

  const cssFiles = filesUnder(join(root, "apps/desktop/src")).filter((file) => file.endsWith(".css"));
  expect(cssFiles.length).toBeGreaterThan(0);
  for (const file of cssFiles) {
    const css = readFileSync(file, "utf8");
    const rel = relative(root, file);
    expect(css, rel).not.toMatch(/https?:/i);
    expect(css, rel).not.toMatch(/url\(\s*["']?\s*\/\//i);
    expect(css, rel).not.toMatch(/@import\s+/i);
    if (rel !== "apps/desktop/src/styles/base.css") {
      expect(css, rel).not.toMatch(/@font-face/i);
    }
  }

  const baseCss = readFileSync(join(root, "apps/desktop/src/styles/base.css"), "utf8");
  expect(baseCss).toMatch(
    /@font-face\s*\{[^}]*font-family:\s*"Plus Jakarta Sans";[^}]*src:\s*url\("\.\/fonts\/PlusJakartaSans-VariableFont\.ttf"\)\s*format\("truetype"\);[^}]*\}/s,
  );
  expect(baseCss).not.toMatch(/url\(\s*["']?\s*(?:https?:|\/\/|data:)/i);
  expect(existsSync(join(root, "apps/desktop/src/styles/fonts/PlusJakartaSans-VariableFont.ttf"))).toBe(true);

  const tokensCss = readFileSync(join(root, "apps/desktop/src/styles/tokens.css"), "utf8");
  expect(tokensCss).toMatch(/--font-ui:\s*"Plus Jakarta Sans",\s*[^;]*\bsystem-ui\b[^;]*\bsans-serif\s*;/);

  const csp = JSON.parse(readFileSync(join(root, "apps/desktop/electron/csp.json"), "utf8")) as {
    policy: string;
  };
  const fontSrc = csp.policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("font-src"));
  expect(fontSrc).toBe("font-src 'self'");
});
