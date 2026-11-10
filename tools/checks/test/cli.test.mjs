import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../hidden-chars.mjs";
import { run as runGate } from "../dependency-gate.mjs";
import { repoRoot } from "../lib/repo-files.mjs";
import { makeRepo, removeRepo } from "./helpers/temp-repo.mjs";

const cp = String.fromCodePoint;

function withRepo(files, check) {
  const root = makeRepo(files);
  try {
    check(root);
  } finally {
    removeRepo(root);
  }
}

test("a hidden character fails with its line", () => {
  withRepo({ "AGENTS.md": `rule ${cp(0x202e)}\n` }, (root) => {
    assert.deepEqual(run(root, []), {
      code: 1,
      lines: ["AGENTS.md:1:6 U+202E bidi-control", "hidden-chars: FAIL, 1 findings"],
    });
  });
});

test("a NUL byte does not hide a file", () => {
  const content = Buffer.concat([Buffer.from([0]), Buffer.from(`text${cp(0xe0041)}`)]);
  withRepo({ "AGENTS.md": content }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("AGENTS.md: NUL byte in a text file"));
  });
});

test("UTF-16 text is refused", () => {
  withRepo({ "CLAUDE.md": Buffer.from([0xff, 0xfe, 0x68, 0, 0x69, 0]) }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("CLAUDE.md: NUL byte in a text file"));
  });
});

test("invalid UTF-8 is refused", () => {
  withRepo({ "a.md": Buffer.from([0x61, 0xff]) }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("a.md: not valid UTF-8"));
  });
});

test("a binary extension is skipped", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xe2, 0x80, 0xae]);
  withRepo({ "logo.png": png }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 0);
    assert.equal(result.lines.at(-1), "hidden-chars: OK, 0 findings in 0 files");
  });
});

test("a hidden character in a file name fails and is shown", () => {
  withRepo({ [`cl${cp(0x202e)}ean.md`]: "ok" }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("cl<U+202E>ean.md: hidden character in file name"));
  });
});

test("a line break in a file name cannot forge a line", () => {
  withRepo({ "nl\nname.md": `a${cp(0x200b)}` }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.deepEqual(result.lines, [
      "nl<U+000A>name.md: control character in file name",
      "nl<U+000A>name.md:1:2 U+200B zero-width",
      "hidden-chars: FAIL, 2 findings",
    ]);
  });
});

test("a deleted tracked file is skipped", () => {
  withRepo({ "a.md": "ok" }, (root) => {
    execFileSync("git", ["add", "a.md"], { cwd: root });
    unlinkSync(join(root, "a.md"));
    const result = run(root, []);
    assert.equal(result.code, 0);
    assert.equal(result.lines.at(-1), "hidden-chars: OK, 0 findings in 0 files");
  });
});

test("a symbolic link is refused", () => {
  const outside = mkdtempSync(join(tmpdir(), "flowdriven-outside-"));
  try {
    const target = join(outside, "target");
    writeFileSync(target, "outside");
    withRepo({}, (root) => {
      symlinkSync(target, join(root, "out.md"));
      const result = run(root, []);
      assert.equal(result.code, 1);
      assert.ok(result.lines.includes("out.md: symbolic link is not allowed"));
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("a submodule link and .gitmodules are refused", () => {
  withRepo({ ".gitmodules": "" }, (root) => {
    execFileSync("git", ["update-index", "--add", "--cacheinfo",
      "160000,1111111111111111111111111111111111111111,sub"], { cwd: root });
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("sub: submodules are not allowed"));
    assert.ok(result.lines.includes(".gitmodules: submodules are not allowed"));
  });
});

test("a skip-worktree entry missing from disk is reported", () => {
  withRepo({ "a.md": "ok" }, (root) => {
    execFileSync("git", ["add", "a.md"], { cwd: root });
    execFileSync("git", ["update-index", "--skip-worktree", "a.md"], { cwd: root });
    unlinkSync(join(root, "a.md"));
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("a.md: listed by git but not readable"));
  });
});

test("an image extension without its signature is scanned as text", () => {
  withRepo({ "notes.png": `x${cp(0x200b)}` }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("notes.png:1:2 U+200B zero-width"));
  });
});

test("a hidden character in the name of an image is reported", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xe2, 0x80, 0xae]);
  withRepo({ [`lo${cp(0x202e)}go.png`]: png }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("lo<U+202E>go.png: hidden character in file name"));
  });
});

test("control characters in content are findings", () => {
  withRepo({ "a.md": `a${cp(0x1b)}[8m` }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("a.md:1:2 U+001B control"));
  });
});

test("a file over 8 MB is refused", () => {
  withRepo({ "big.txt": Buffer.alloc(8388609, 0x61) }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.ok(result.lines.includes("big.txt: file too large to scan"));
  });
});

test("findings are capped per file", () => {
  withRepo({ "many.md": cp(0x200b).repeat(200000) }, (root) => {
    const result = run(root, []);
    assert.equal(result.code, 1);
    assert.equal(result.lines.length, 22);
    assert.equal(result.lines[19], "many.md:1:20 U+200B zero-width");
    assert.equal(result.lines[20], "many.md: and 199980 more");
    assert.equal(result.lines[21], "hidden-chars: FAIL, 200000 findings");
  });
});

test("a byte-order mark at the start of a file fails", () => {
  const content = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hi\n")]);
  withRepo({ "AGENTS.md": content }, (root) => {
    assert.deepEqual(run(root, []).lines, [
      "AGENTS.md:1:1 U+FEFF zero-width", "hidden-chars: FAIL, 1 findings",
    ]);
  });
});

test("the size limit is exact", () => {
  for (const [size, code] of [[8388608, 0], [8388609, 1]]) {
    withRepo({ "a.md": Buffer.alloc(size, 0x61) }, (root) => assert.equal(run(root, []).code, code));
  }
});

test("the count is the number of text files scanned", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  withRepo({ "a": "a", "b": "b", "c": "c", "logo.png": png }, (root) => {
    assert.equal(run(root, []).lines.at(-1), "hidden-chars: OK, 0 findings in 3 files");
  });
});

test("scan: the process exits 1 on a finding and 2 on an error (spawn)", () => {
  const source = join(repoRoot(), "tools/checks");
  const outside = mkdtempSync(join(tmpdir(), "flowdriven-scan-"));
  try {
    withRepo({ "AGENTS.md": cp(0x202e) }, (root) => {
      const target = join(root, "tools/checks");
      cpSync(source, target, { recursive: true, filter: (path) => path !== join(source, "test") });
      const result = spawnSync(process.execPath, [join(target, "hidden-chars.mjs")], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout.trimEnd().split("\n").at(-1), "hidden-chars: FAIL, 1 findings");
    });
    const target = join(outside, "tools/checks");
    cpSync(source, target, { recursive: true, filter: (path) => path !== join(source, "test") });
    const result = spawnSync(process.execPath, [join(target, "hidden-chars.mjs")], {
      encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: outside },
    });
    assert.equal(result.status, 2);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith("hidden-chars: ERROR "));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("scan: same result from a subfolder and through a symbolic link (spawn)", () => {
  const root = repoRoot();
  const script = join(root, "tools/checks/hidden-chars.mjs");
  const temp = mkdtempSync(join(tmpdir(), "flowdriven-script-"));
  try {
    const link = join(temp, "scan.mjs");
    symlinkSync(script, link);
    for (const path of [script, link]) {
      const result = spawnSync(process.execPath, [path], { cwd: join(root, "docs"), encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout.trimEnd().split("\n").at(-1), /^hidden-chars: OK/);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

const npmrc = "registry=https://registry.npmjs.org/\nengine-strict=true\nsave-exact=true\n";
const allowlistText = readFileSync(join(repoRoot(), "tools/checks/allowlist.json"), "utf8");
const allowlist = JSON.parse(allowlistText);
const manifest = {
  name: "flowdriven-workspace",
  packageManager: allowlist.packageManager,
  engines: allowlist.engines,
  scripts: allowlist.rootScripts,
  pnpm: { onlyBuiltDependencies: allowlist.installScripts },
};

function baseRepo(extra, check) {
  const files = {
    "package.json": JSON.stringify(manifest),
    ".npmrc": npmrc,
    "tools/checks/allowlist.json": allowlistText,
    "tools/checks/test/agent-rules.test.mjs": "",
    "tools/checks/test/cli.test.mjs": "",
    "tools/checks/test/dependency-gate.test.mjs": "",
    "tools/checks/test/hidden-chars.test.mjs": "",
    "tools/checks/test/repo-files.test.mjs": "",
    ...extra,
  };
  for (const [path, value] of Object.entries(files)) {
    if (value === null) delete files[path];
  }
  withRepo(files, check);
}

function gate(extra, check, argv = ["--manifests-only"]) {
  baseRepo(extra, (root) => check(runGate(root, argv)));
}

function rootWith(changes) {
  return JSON.stringify({ ...manifest, ...changes });
}

function desktop(changes = {}) {
  return JSON.stringify({ name: "@flowdriven/desktop", ...changes });
}

test("the base repository passes", () => {
  gate({}, (r) => {
    assert.equal(r.code, 0);
    const expected = "dependency-gate: OK, 0 direct dependencies in 1 manifests, " +
      "lockfile skipped (--manifests-only)";
    assert.equal(r.lines.at(-1), expected);
  });
});

test("a range instead of an exact version fails with its line", () => {
  gate({ "apps/desktop/package.json": desktop({ dependencies: { react: "^19.3.1" } }) }, (r) => {
    assert.equal(r.code, 1);
    assert.deepEqual(r.lines, [
      "apps/desktop/package.json: react@^19.3.1 must be an exact version",
      "dependency-gate: FAIL, 1 problems",
    ]);
  });
});

test("a missing .npmrc and a missing lockfile are reported", () => {
  const files = { ".npmrc": null, "apps/desktop/package.json": desktop({ dependencies: { react: "19.3.1" } }) };
  gate(files, (r) => {
    assert.ok(r.lines.includes(".npmrc: missing"));
    assert.ok(r.lines.includes("pnpm-lock.yaml: missing"));
  }, []);
});

test("a valid lockfile is checked", () => {
  const lock = "lockfileVersion: '9.0'\n\npackages:\n\n  react@19.3.1:\n" +
    "    resolution: {integrity: sha512-AAAA}\n";
  gate({ "pnpm-lock.yaml": lock }, (r) => {
    assert.equal(r.code, 0);
    assert.ok(r.lines.at(-1).endsWith("lockfile checked"));
  }, []);
});

test("nested manifests are counted and look-alikes are not", () => {
  gate({ "apps/desktop/package.json": desktop(), "notpackage.json": "{}" }, (r) => {
    assert.match(r.lines.at(-1), /in 2 manifests/);
  });
});

test("an .npmrc setting outside the short list fails", () => {
  for (const [text, message] of [
    [npmrc + "dangerously-allow-all-builds=true\n",
      ".npmrc:4: setting dangerously-allow-all-builds is not allowed"],
    [npmrc + "strict-ssl=false\n", ".npmrc:4: setting strict-ssl is not allowed"],
    [npmrc.replace("engine-strict=true", "engine-strict=false"), ".npmrc:2: engine-strict must be true"],
  ]) {
    gate({ ".npmrc": text }, (r) => assert.ok(r.lines.includes(message)));
  }
});

test("only the root .npmrc is allowed", () => {
  gate({ "apps/desktop/.npmrc": "save-exact=true" }, (r) => {
    assert.ok(r.lines.includes("apps/desktop/.npmrc: only the root .npmrc is allowed"));
  });
});

test("pnpm hook files and stray workspace files are refused", () => {
  gate({ ".pnpmfile.cjs": "module.exports = {}", "packages/x/pnpm-workspace.yaml": "" }, (r) => {
    assert.ok(r.lines.includes(".pnpmfile.cjs: is not allowed"));
    assert.ok(r.lines.includes("packages/x/pnpm-workspace.yaml: is not allowed"));
  });
});

test("pnpm-workspace.yaml must hold exactly the approved list", () => {
  const approved = 'packages:\n  - "apps/*"\n  - "packages/*"\n';
  gate({ "pnpm-workspace.yaml": approved }, (r) => assert.equal(r.code, 0));
  const message = "pnpm-workspace.yaml: must hold exactly the approved packages list";
  for (const yaml of ['  packages:\n    - "apps/*"\n  overrides:\n    react: npm:evil@1.0.0\n',
    'packages: ["apps/*", "packages/*"]', `${approved}  - "../**"\n`]) {
    gate({ "pnpm-workspace.yaml": yaml }, (r) => assert.ok(r.lines.includes(message)));
  }
  const yaml = 'packages:\n  - "apps/*"\noverrides:\n  react: npm:evil@1.0.0\n';
  gate({ "pnpm-workspace.yaml": yaml }, (r) => {
    assert.ok(r.lines.includes(message));
    assert.ok(r.lines.includes("pnpm-workspace.yaml:3: overrides is not allowed"));
  });
});

test("the pnpm field is root-only and holds one key", () => {
  gate({ "package.json": rootWith({ pnpm: { ...manifest.pnpm, extra: true } }),
    "apps/desktop/package.json": desktop({ pnpm: {} }) }, (r) => {
    const message = "package.json: pnpm.onlyBuiltDependencies must equal allowlist installScripts " +
      `[${[...allowlist.installScripts].sort().join(", ")}]`;
    assert.ok(r.lines.includes(message));
    assert.ok(r.lines.includes("apps/desktop/package.json: field pnpm is not allowed"));
  });
});

test("install-script lists must be arrays", () => {
  gate({ "package.json": rootWith({ pnpm: { onlyBuiltDependencies: "electron" } }) }, (r) => {
    const message = "package.json: pnpm.onlyBuiltDependencies must equal allowlist installScripts " +
      `[${[...allowlist.installScripts].sort().join(", ")}]`;
    assert.ok(r.lines.includes(message));
  });
});

test("a symbolic link is refused by the gate", () => {
  for (const path of [".pnpmfile.cjs", "apps/desktop/package.json"]) {
    baseRepo({ "apps/desktop/placeholder": "" }, (root) => {
      symlinkSync("evil.json", join(root, path));
      assert.ok(runGate(root, ["--manifests-only"]).lines.includes(`${path}: symbolic link is not allowed`));
    });
  }
});

test("other manifest formats and letter cases are refused", () => {
  const paths = ["apps/evil/package.yaml", "apps/evil/package.json5",
    "apps/desktop/Package.json", "apps/desktop/.NPMRC"];
  for (const path of paths) {
    gate({ [path]: "" }, (r) => assert.ok(r.lines.includes(`${path}: is not allowed`)));
  }
});

test("a manifest outside the approved folders is refused", () => {
  gate({ "apps/evil/package.json": desktop() }, (r) => {
    const message = "apps/evil/package.json: package.json is not in an approved workspace folder";
    assert.ok(r.lines.includes(message));
  });
});

test("a manifest must carry its folder's name", () => {
  gate({ "apps/desktop/package.json": JSON.stringify({ name: "react" }) }, (r) => {
    assert.ok(r.lines.includes("apps/desktop/package.json: name must be @flowdriven/desktop"));
  });
});

test("unknown manifest fields are refused", () => {
  gate({ "apps/desktop/package.json": desktop({ scripts: {} }),
    "package.json": rootWith({ publishConfig: {} }) }, (r) => {
    assert.ok(r.lines.includes("apps/desktop/package.json: field scripts is not allowed"));
    assert.ok(r.lines.includes("package.json: field publishConfig is not allowed"));
  });
  gate({ "package.json": rootWith({ resolutions: {} }) }, (r) => {
    assert.deepEqual(r.lines, [
      "package.json: resolutions is not allowed", "dependency-gate: FAIL, 1 problems",
    ]);
  });
});

test("the root manifest is pinned", () => {
  const cases = [
    [{ packageManager: "pnpm@9.0.0" }, `package.json: packageManager must be ${allowlist.packageManager}`],
    [{ engines: { node: ">=18" } }, `package.json: engines must be ${JSON.stringify(allowlist.engines)}`],
    [{ scripts: { ...manifest.scripts, precheck: "true" } }, "precheck"],
    [{ scripts: { ...manifest.scripts, check: "echo check:hidden check:deps" } }, "check"],
    [{ scripts: { ...manifest.scripts, "pnpm:devPreinstall": "true" } }, "pnpm:devPreinstall"],
  ];
  for (const [changes, expected] of cases) {
    const message = expected.startsWith("package.json:") ? expected :
      `package.json: scripts must equal allowlist rootScripts (first difference: ${expected})`;
    gate({ "package.json": rootWith(changes) }, (r) => assert.ok(r.lines.includes(message)));
  }
});

test("the allowlist cannot approve a weakened check", () => {
  const allow = allowlist;
  for (const scripts of [{ ...allow.rootScripts, check: "pnpm test:tools" },
    { ...allow.rootScripts, precheck: "true" }]) {
    gate({ "tools/checks/allowlist.json": JSON.stringify({ ...allow, rootScripts: scripts }) }, (r) => {
      assert.deepEqual(r.lines, ["allowlist.json: invalid rootScripts", "dependency-gate: FAIL, 1 problems"]);
    });
  }
  gate({ "tools/checks/allowlist.json": JSON.stringify({ ...allow, packageManager: "pnpm@9.0.0" }) }, (r) => {
    assert.ok(r.lines.includes("allowlist.json: invalid packageManager"));
  });
});

test("a missing guard test fails the gate", () => {
  gate({ "tools/checks/test/cli.test.mjs": null }, (r) => {
    assert.ok(r.lines.includes("tools/checks/test/cli.test.mjs: missing guard test"));
  });
});

test("a broken manifest or allowlist gives one clear line", () => {
  for (const [files, message] of [
    [{ "apps/desktop/package.json": "{" }, "apps/desktop/package.json: invalid package.json"],
    [{ "tools/checks/allowlist.json": null }, "tools/checks/allowlist.json: missing"],
    [{ "tools/checks/allowlist.json": "{" }, "tools/checks/allowlist.json: invalid JSON"],
  ]) {
    gate(files, (r) => {
      assert.equal(r.code, 1);
      assert.ok(r.lines.includes(message));
      assert.ok(r.lines.every((line) => !/^    at /.test(line)));
    });
  }
});

test("gate: same result from a subfolder and through a symbolic link (spawn)", () => {
  const root = repoRoot();
  const script = join(root, "tools/checks/dependency-gate.mjs");
  const temp = mkdtempSync(join(tmpdir(), "flowdriven-gate-"));
  try {
    const link = join(temp, "gate.mjs");
    symlinkSync(script, link);
    for (const path of [script, link]) {
      const result = spawnSync(process.execPath, [path, "--manifests-only"], {
        cwd: join(root, "docs"),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout.trimEnd().split("\n").at(-1), /^dependency-gate: OK/);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("a tracked lockfile is checked even with --manifests-only", () => {
  const lock = "lockfileVersion: '9.0'\n\npackages:\n\n  react@19.3.1:\n" +
    "    resolution: {integrity: sha512-AAAA}\n";
  baseRepo({ "pnpm-lock.yaml": lock }, (root) => {
    execFileSync("git", ["add", "pnpm-lock.yaml"], { cwd: root });
    assert.ok(runGate(root, ["--manifests-only"]).lines.at(-1).endsWith("lockfile checked"));
  });
});

test(".npmrc must hold exactly the approved lines", () => {
  const cr = cp(0x0d);
  const text = `registry=https://registry.npmjs.org/\n# c${cr}@evil:registry=https://evil.example/` +
    `${cr}engine-strict=true\nsave-exact=true\n`;
  gate({ ".npmrc": text }, (r) => {
    assert.ok(r.lines.includes(".npmrc:3: registry must be https://registry.npmjs.org/"));
  });
  for (const changed of ["engine-strict=true\nregistry=https://registry.npmjs.org/\nsave-exact=true\n",
    `${npmrc}# comment\n`]) {
    gate({ ".npmrc": changed }, (r) => {
      assert.ok(r.lines.includes(".npmrc: must hold exactly the approved lines"));
    });
  }
});

test("lockfile aliases, unknown importers and lone carriage returns fail", () => {
  const prefix = "lockfileVersion: '9.0'\nimporters:\n";
  const cases = [
    ["  .:\n    dependencies:\n      react:\n        specifier: 19.3.1\n" +
      "        version: evil@1.0.0\n", "pnpm-lock.yaml:7: aliased version evil@1.0.0"],
    ["  apps/evil:\n", "pnpm-lock.yaml:3: unknown importer apps/evil"],
    [`  .:${cp(0x0d)}packages:\n`, "pnpm-lock.yaml: lone carriage return is not allowed"],
    ["  .:\n    specifier: NPM:evil@1.0.0\n", "pnpm-lock.yaml:4: non-registry specifier NPM:evil@1.0.0"],
    ["  .:\n    specifier: jsr:@x/y@1\n", "pnpm-lock.yaml:4: non-registry specifier jsr:@x/y@1"],
  ];
  for (const [body, message] of cases) {
    gate({ "pnpm-lock.yaml": prefix + body }, (r) => assert.ok(r.lines.includes(message)), []);
  }
});

test("values from files are shown escaped", () => {
  const name = `x${cp(0x0a)}y`;
  gate({ "apps/desktop/package.json": desktop({ dependencies: { [name]: "1.0.0" } }) }, (r) => {
    assert.ok(r.lines.every((line) => line.startsWith("apps/desktop/package.json:") ||
      line.startsWith("dependency-gate:")));
    assert.ok(r.lines.some((line) => line.includes("x<U+000A>y")));
  });
});

test("gate: the process exits 1 on a problem and 2 on an error (spawn)", () => {
  const source = join(repoRoot(), "tools/checks");
  const outside = mkdtempSync(join(tmpdir(), "flowdriven-gate-error-"));
  try {
    baseRepo({ "apps/desktop/package.json": desktop({ dependencies: { "left-pad": "1.3.0" } }) }, (root) => {
      const target = join(root, "tools/checks");
      cpSync(source, target, { recursive: true, filter: (path) => path !== join(source, "test") });
      const result = spawnSync(process.execPath, [join(target, "dependency-gate.mjs"), "--manifests-only"],
        { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.ok(result.stdout.trimEnd().split("\n").at(-1).startsWith("dependency-gate: FAIL"));
    });
    const target = join(outside, "tools/checks");
    cpSync(source, target, { recursive: true, filter: (path) => path !== join(source, "test") });
    const result = spawnSync(process.execPath, [join(target, "dependency-gate.mjs")], {
      encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: outside },
    });
    assert.equal(result.status, 2);
    const lines = result.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith("dependency-gate: ERROR "));
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
