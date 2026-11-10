import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseRange, satisfies, checkManifests, checkInstallScripts, checkLockfile, checkNpmrc, checkAllowlist } from "../dependency-gate.mjs";

const allow = { registry: "https://registry.npmjs.org/", installScripts: ["electron"], packageManager: "pnpm@10.9.0", engines: { node: ">=24.14.0" },
  npmrc: ["registry=https://registry.npmjs.org/", "engine-strict=true", "save-exact=true"],
  workspaceGlobs: ["apps/*", "packages/*"],
  workspaces: { "flowdriven-workspace": ".", "@flowdriven/contracts": "packages/contracts",
    "@flowdriven/desktop": "apps/desktop", "@flowdriven/fixtures": "packages/fixtures" },
  rootScripts: JSON.parse(readFileSync(new URL("../allowlist.json", import.meta.url), "utf8")).rootScripts,
  guardTests: ["cli.test.mjs"],
  packages: [{ name: "electron", range: "^45.1.0", packages: ["@flowdriven/desktop"], why: "Shell" }, { name: "react", range: "^19.3.1", packages: ["@flowdriven/desktop"], why: "UI" }] };
const root = { name: "flowdriven-workspace", packageManager: allow.packageManager, engines: allow.engines,
  scripts: allow.rootScripts, pnpm: { onlyBuiltDependencies: allow.installScripts } };
const contracts = { path: "packages/contracts/package.json", json: { name: "@flowdriven/contracts" } };
const desktop = (deps, field = "dependencies") => ({ path: "apps/desktop/package.json", json: { name: "@flowdriven/desktop", [field]: deps } });

test("satisfies caret and exact ranges", () => {
  assert.equal(satisfies("45.1.0", "^45.1.0"), true);
  assert.equal(satisfies("45.9.9", "^45.1.0"), true);
  assert.equal(satisfies("46.0.0", "^45.1.0"), false);
  assert.equal(satisfies("45.0.9", "^45.1.0"), false);
  assert.equal(satisfies("0.3.5", "^0.3.1"), true);
  assert.equal(satisfies("0.4.0", "^0.3.1"), false);
  assert.equal(satisfies("19.3.1", "19.3.1"), true);
  assert.equal(satisfies("19.3.2", "19.3.1"), false);
  assert.equal(satisfies("45.1.0-beta.1", "^45.1.0"), false);
  assert.throws(() => parseRange("~1.2.3"), /unsupported range ~1.2.3/);
});

test("accepts allowlisted exact versions and workspace links", () => {
  assert.deepEqual(checkManifests([desktop({ react: "19.3.1", "@flowdriven/contracts": "workspace:*" }), contracts], allow), []);
});

test("rejects unlisted, loose, out-of-range, misplaced and unknown workspace dependencies", () => {
  assert.deepEqual(checkManifests([desktop({ "left-pad": "1.3.0" }), contracts], allow), ["apps/desktop/package.json: left-pad is not on the allowlist"]);
  assert.deepEqual(checkManifests([desktop({ react: "^19.3.1" }), contracts], allow), ["apps/desktop/package.json: react@^19.3.1 must be an exact version"]);
  assert.deepEqual(checkManifests([desktop({ react: "20.0.0" }), contracts], allow), ["apps/desktop/package.json: react@20.0.0 is outside the allowed range ^19.3.1"]);
  assert.deepEqual(checkManifests([desktop({ react: "19.3.1" }, "devDependencies"), contracts], allow), []);
  assert.deepEqual(checkManifests([{ path: "package.json", json: { ...root, devDependencies: { react: "19.3.1" } } }], allow), ["package.json: react is not allowed in package flowdriven-workspace"]);
  assert.deepEqual(checkManifests([desktop({ "@flowdriven/nope": "workspace:*" }), contracts], allow), ["apps/desktop/package.json: @flowdriven/nope@workspace:* is not a workspace package"]);
});

test("rejects fields that can replace an allowlisted package", () => {
  const m = (json) => ({ path: "package.json", json: { ...root, ...json } });
  assert.deepEqual(checkManifests([m({ overrides: { react: "1.0.0" } })], allow), ["package.json: overrides is not allowed"]);
  assert.deepEqual(checkManifests([m({ resolutions: {} })], allow), ["package.json: resolutions is not allowed"]);
  assert.deepEqual(checkManifests([m({ dependenciesMeta: {} })], allow), ["package.json: dependenciesMeta is not allowed"]);
  assert.deepEqual(checkManifests([m({ pnpm: { overrides: {} } })], allow), ["package.json: pnpm.overrides is not allowed"]);
  assert.deepEqual(checkManifests([m({ pnpm: { patchedDependencies: {} } })], allow), ["package.json: pnpm.patchedDependencies is not allowed"]);
  assert.deepEqual(checkManifests([m({ pnpm: { packageExtensions: {} } })], allow), ["package.json: pnpm.packageExtensions is not allowed"]);
});

test("install-script list must match the allowlist", () => {
  assert.deepEqual(checkInstallScripts({ pnpm: { onlyBuiltDependencies: ["electron"] } }, allow), []);
  const msg = "package.json: pnpm.onlyBuiltDependencies must equal allowlist installScripts [electron]";
  assert.deepEqual(checkInstallScripts({}, allow), [msg]);
  assert.deepEqual(checkInstallScripts({ pnpm: { onlyBuiltDependencies: ["electron", "esbuild"] } }, allow), [msg]);
});

const lock = (pkgLines, importerLines = ["      react:", "        specifier: 19.3.1", "        version: 19.3.1"]) => [
  "lockfileVersion: '9.0'", "", "importers:", "", "  apps/desktop:", "    dependencies:",
  "      '@flowdriven/contracts':", "        specifier: workspace:*", "        version: link:../../packages/contracts",
  ...importerLines, "", "packages:", "", "  react@19.3.1:", ...pkgLines,
].join("\n");

test("lockfile from the registry passes", () => {
  assert.deepEqual(checkLockfile(lock(["    resolution: {integrity: sha512-AAAA}"])), []);
});

test("lockfile rejects non-registry sources", () => {
  assert.deepEqual(checkLockfile(lock(["    resolution: {tarball: https://evil.example.com/react.tgz}"])), ["pnpm-lock.yaml:17: tarball outside https://registry.npmjs.org/"]);
  assert.deepEqual(checkLockfile(lock(["    resolution: {commit: abc, repo: https://github.com/x/y, type: git}"])), ["pnpm-lock.yaml:17: non-registry resolution"]);
  assert.deepEqual(checkLockfile(lock(["    resolution: {foo: bar}"])), ["pnpm-lock.yaml:17: resolution without integrity"]);
  assert.deepEqual(checkLockfile(lock(["    resolution: {integrity: sha512-AAAA}"], ["      x:", "        specifier: file:../x", "        version: file:../x"])), ["pnpm-lock.yaml:11: non-registry specifier file:../x", "pnpm-lock.yaml:12: non-registry specifier file:../x"]);
  assert.deepEqual(checkLockfile(lock(["    resolution: {integrity: sha512-AAAA}"], ["      y:", "        specifier: link:../y", "        version: link:../y"])), ["pnpm-lock.yaml:12: non-registry specifier link:../y"]);
  assert.deepEqual(checkLockfile("lockfileVersion: '6.0'\n"), ["pnpm-lock.yaml: lockfileVersion must be '9.0'"]);
});

test("lockfile rejects overrides and patches", () => {
  assert.deepEqual(checkLockfile("lockfileVersion: '9.0'\noverrides:\n  react: 1.0.0\n"), ["pnpm-lock.yaml:2: overrides is not allowed"]);
  assert.deepEqual(checkLockfile("lockfileVersion: '9.0'\npatchedDependencies:\n  x: y\n"), ["pnpm-lock.yaml:2: patchedDependencies is not allowed"]);
});

test(".npmrc must point at the official registry", () => {
  assert.deepEqual(checkNpmrc("registry=https://registry.npmjs.org/\nengine-strict=true\n"), []);
  assert.deepEqual(checkNpmrc("registry=https://npm.evil.example/\n"), [".npmrc:1: registry must be https://registry.npmjs.org/"]);
  assert.deepEqual(checkNpmrc("engine-strict=true\n@acme:registry=https://x.example/\n"), [".npmrc:2: registry must be https://registry.npmjs.org/"]);
});

test("allowlist entries are complete", () => {
  assert.deepEqual(checkAllowlist(allow), []);
  assert.deepEqual(checkAllowlist({ ...allow, installScripts: [], packages: [{ name: "x", range: "~1.0.0", packages: ["a"], why: "y" }] }), ["allowlist.json: invalid entry x"]);
});

test("the Task 3 script map is a valid rootScripts", () => {
  const rootScripts = {
    ...allow.rootScripts,
    lint: "biome check .",
    format: "biome check --write .",
    typecheck: "tsc -p packages/contracts && tsc -p packages/fixtures && tsc -p apps/desktop",
    test: "TZ=UTC vitest run && pnpm test:tools",
    check: "pnpm lint && pnpm typecheck && pnpm test && pnpm check:hidden && pnpm check:deps",
  };
  assert.deepEqual(checkAllowlist({ ...allow, rootScripts }), []);
});

test("check must reach the tools tests", () => {
  const rootScripts = { ...allow.rootScripts, test: "vitest run",
    check: "pnpm test && pnpm check:hidden && pnpm check:deps" };
  const invalid = ["allowlist.json: invalid rootScripts"];
  assert.deepEqual(checkAllowlist({ ...allow, rootScripts }), invalid);
  rootScripts.test = "pnpm test:tools";
  rootScripts.check = "pnpm test:unit && pnpm check:hidden && pnpm check:deps";
  assert.deepEqual(checkAllowlist({ ...allow, rootScripts }), invalid);
});

test("hook names are refused only when they hook a script", () => {
  const rootScripts = { ...allow.rootScripts, test: "pnpm test:tools" };
  const invalid = ["allowlist.json: invalid rootScripts"];
  for (const name of ["precheck", "posttest", "pnpm:devPreinstall", "prepare"]) {
    const scripts = { ...rootScripts, [name]: "echo x" };
    assert.deepEqual(checkAllowlist({ ...allow, rootScripts: scripts }), invalid);
  }
  const scripts = { ...rootScripts, "preview:web": "vite preview" };
  assert.deepEqual(checkAllowlist({ ...allow, rootScripts: scripts }), []);
});

test("CLI passes on this repository in manifests-only mode", () => {
  const r = spawnSync(process.execPath, ["tools/checks/dependency-gate.mjs", "--manifests-only"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^dependency-gate: OK, \d+ direct dependencies in \d+ manifests, lockfile skipped \(--manifests-only\)$/m);
});

test("optional and peer dependencies are checked", () => {
  for (const field of ["optionalDependencies", "peerDependencies"]) {
    assert.deepEqual(checkManifests([desktop({ evil: "1.0.0" }, field)], allow),
      [`apps/desktop/package.json: field ${field} is not allowed`,
        "apps/desktop/package.json: evil is not on the allowlist"]);
  }
});

test("install scripts compare as sets and the message is sorted", () => {
  assert.deepEqual(checkInstallScripts({ pnpm: { onlyBuiltDependencies: ["esbuild"] } }, allow),
    ["package.json: pnpm.onlyBuiltDependencies must equal allowlist installScripts [electron]"]);
  assert.match(checkInstallScripts({ pnpm: { onlyBuiltDependencies: ["a"] } },
    { ...allow, installScripts: ["b", "a"] })[0], /\[a, b\]$/);
});

test("each non-registry specifier prefix fails", () => {
  for (const value of ["git+ssh://x", "git://x", "github:x/y", "http://x", "https://x"]) {
    assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n  specifier: ${value}`),
      [`pnpm-lock.yaml:2: non-registry specifier ${value}`]);
  }
});

test("each non-registry resolution key fails", () => {
  for (const part of ["type: git", "directory: x", "repo: x", "commit: x"]) {
    assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n  resolution: {integrity: sha512-AAAA, ${part}}`),
      ["pnpm-lock.yaml:2: non-registry resolution"]);
  }
});

test("quoted keys inside a resolution fail", () => {
  const prefix = "lockfileVersion: '9.0'\n  resolution: {integrity: sha512-AAAA, ";
  assert.deepEqual(checkLockfile(`${prefix}"type": "git", "repo": "https://github.com/x/y", "commit": "abc"}`),
    ["pnpm-lock.yaml:2: non-registry resolution"]);
  assert.deepEqual(checkLockfile(`${prefix}"tarball": "https://evil.example/x.tgz"}`),
    ["pnpm-lock.yaml:2: tarball outside https://registry.npmjs.org/"]);
});

test("a quoted lockfile key fails", () => {
  assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n      "specifier": file:../x`),
    ["pnpm-lock.yaml:2: quoted key is not allowed"]);
});

test("a resolution needs integrity", () => {
  const url = "https://registry.npmjs.org/react/-/react-19.3.1.tgz";
  assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n  resolution: {tarball: ${url}}`),
    ["pnpm-lock.yaml:2: resolution without integrity"]);
  assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n  resolution: {integrity: sha512-AAAA, tarball: ${url}}`), []);
});

test("registry look-alike tarballs fail", () => {
  for (const url of ["https://evil.example/https://registry.npmjs.org/x.tgz", "https://registry.npmjs.org.evil.example/x.tgz"]) {
    assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n  resolution: {integrity: sha512-AAAA, tarball: ${url}}`),
      ["pnpm-lock.yaml:2: tarball outside https://registry.npmjs.org/"]);
  }
});

test("packageExtensionsChecksum and CRLF are handled", () => {
  assert.deepEqual(checkLockfile("lockfileVersion: '9.0'\npackageExtensionsChecksum: x"),
    ["pnpm-lock.yaml:2: packageExtensionsChecksum is not allowed"]);
  assert.deepEqual(checkLockfile("lockfileVersion: '9.0'\r\noverrides:\r\n"),
    ["pnpm-lock.yaml:2: overrides is not allowed"]);
});

test("npmrc comments and spacing", () => {
  assert.deepEqual(checkNpmrc("# c\n; c\n\n"), []);
  assert.deepEqual(checkNpmrc("registry = https://x.example/"),
    [".npmrc:1: registry must be https://registry.npmjs.org/"]);
  assert.deepEqual(checkNpmrc("@acme:registry=https://registry.npmjs.org/"),
    [".npmrc:1: registry must be https://registry.npmjs.org/"]);
});

test("the allowlist is validated field by field", () => {
  const entry = allow.packages[1];
  for (const [change, label] of [[{ name: undefined }, "0"], [{ why: undefined }, "react"],
    [{ packages: [] }, "react"], [{ packages: [2] }, "react"], [{ range: undefined }, "react"]]) {
    assert.deepEqual(checkAllowlist({ ...allow, installScripts: [], packages: [{ ...entry, ...change }] }),
      [`allowlist.json: invalid entry ${label}`]);
  }
  assert.deepEqual(checkAllowlist({ ...allow, packages: [...allow.packages, entry] }),
    ["allowlist.json: invalid entry react"]);
  assert.deepEqual(checkAllowlist({ ...allow, registry: "bad" }),
    ["allowlist.json: registry must be https://registry.npmjs.org/"]);
  for (const installScripts of ["electron", ["esbuild"]]) {
    assert.deepEqual(checkAllowlist({ ...allow, installScripts }), ["allowlist.json: invalid installScripts"]);
  }
  for (const workspaces of [undefined, ["react"]]) {
    assert.deepEqual(checkAllowlist({ ...allow, workspaces }), ["allowlist.json: invalid workspaces"]);
  }
});

test("caret follows npm below 0.1.0", () => {
  assert.equal(satisfies("0.0.3", "^0.0.3"), true);
  assert.equal(satisfies("0.0.4", "^0.0.3"), false);
  assert.equal(satisfies("0.2.9", "^0.2.3"), true);
  assert.equal(satisfies("0.3.0", "^0.2.3"), false);
});

test("a wrong package and a bad version give two messages in order", () => {
  const manifest = { path: "packages/fixtures/package.json", json: {
    name: "@flowdriven/fixtures", dependencies: { react: "^19.3.1" },
  } };
  assert.deepEqual(checkManifests([manifest], allow), [
    "packages/fixtures/package.json: react@^19.3.1 must be an exact version",
    "packages/fixtures/package.json: react is not allowed in package @flowdriven/fixtures",
  ]);
});


test("caret comparison edges", () => {
  assert.equal(satisfies("45.2.0", "^45.1.5"), true);
  assert.equal(satisfies("19.4.0", "^19.3.1"), true);
  assert.equal(satisfies("01.2.3", "^1.0.0"), false);
});

test("a workspace dependency needs its manifest", () => {
  const dependency = desktop({ "@flowdriven/fixtures": "workspace:*" });
  const fixtures = { path: "packages/fixtures/package.json", json: { name: "@flowdriven/fixtures" } };
  assert.deepEqual(checkManifests([dependency], allow), [
    "apps/desktop/package.json: @flowdriven/fixtures@workspace:* is not a workspace package",
  ]);
  assert.deepEqual(checkManifests([dependency, fixtures], allow), []);
});


test("real lockfile resolution shapes pass", () => {
  for (const [algorithm, hash, padding] of [["512", "+/" + "A".repeat(84), "=="],
    ["1", "+/" + "A".repeat(25), "="]]) {
    const text = `lockfileVersion: '9.0'\n  resolution: {integrity: sha${algorithm}-${hash}${padding}}\n`;
    assert.deepEqual(checkLockfile(text), []);
    assert.deepEqual(checkLockfile(text.replaceAll("\n", `${String.fromCodePoint(0x0d)}\n`)), []);
  }
  assert.deepEqual(checkLockfile("lockfileVersion: '9.0'\n  resolution: {integrity: sha512-AAAA}x"),
    ["pnpm-lock.yaml:2: resolution without integrity"]);
});

test("each quoted lockfile key fails", () => {
  for (const line of ['"version": 1', '"resolution": {type: git}', '"integrity": x',
    '"tarball": https://registry.npmjs.org/x']) {
    assert.deepEqual(checkLockfile(`lockfileVersion: '9.0'\n    ${line}`),
      ["pnpm-lock.yaml:2: quoted key is not allowed"]);
  }
});
