import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  decodeText,
  deletedPaths,
  listRepoEntries,
  repoRoot,
  showPath,
  showText,
} from "./lib/repo-files.mjs";

/** @typedef {{registry: string, installScripts: string[], packages: {name: string, range: string, packages: string[], why: string}[]}} Allowlist */
const registry = "https://registry.npmjs.org/";
const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @param {string} range @returns {{kind: "caret" | "exact", major: number, minor: number, patch: number}} */
export function parseRange(range) {
  const caret = typeof range === "string" && range.startsWith("^");
  const match = typeof range === "string" && (caret ? range.slice(1) : range).match(exact);
  if (!match) throw new Error(`unsupported range ${range}`);
  return {
    kind: caret ? "caret" : "exact",
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** @param {string} version @param {string} range @returns {boolean} */
export function satisfies(version, range) {
  if (typeof version !== "string" || !exact.test(version)) return false;
  const v = parseRange(version);
  const r = parseRange(range);
  const cmp = v.major - r.major || v.minor - r.minor || v.patch - r.patch;
  if (r.kind === "exact" || (r.major === 0 && r.minor === 0)) return cmp === 0;
  return cmp >= 0 && v.major === r.major && (r.major !== 0 || v.minor === r.minor);
}

const rootFields = [
  "name",
  "private",
  "type",
  "license",
  "packageManager",
  "engines",
  "scripts",
  "dependencies",
  "devDependencies",
  "pnpm",
];
const packageFields = [
  "name",
  "version",
  "private",
  "type",
  "license",
  "main",
  "exports",
  "dependencies",
  "devDependencies",
];
const forbiddenFields = ["overrides", "resolutions", "dependenciesMeta"];

function checkManifestFields(path, json, allowlist) {
  const errors = [];
  const folder = posix.dirname(path);
  const expected = Object.keys(allowlist.workspaces).find((name) => allowlist.workspaces[name] === folder);
  if (expected && json.name !== expected) errors.push(`${path}: name must be ${expected}`);
  const allowed = path === "package.json" ? rootFields : packageFields;
  for (const key of Object.keys(json)) {
    if (forbiddenFields.includes(key)) errors.push(`${path}: ${key} is not allowed`);
    else if (!allowed.includes(key)) errors.push(`${path}: field ${key} is not allowed`);
  }
  if (path === "package.json") {
    if (plainObject(json.pnpm)) {
      for (const key of ["overrides", "patchedDependencies", "packageExtensions"]) {
        if (Object.hasOwn(json.pnpm, key)) errors.push(`${path}: pnpm.${key} is not allowed`);
      }
    }
    if (json.packageManager !== allowlist.packageManager) {
      errors.push("package.json: packageManager must be pnpm@10.9.0");
    }
    if (!isDeepStrictEqual(json.engines, allowlist.engines)) {
      errors.push('package.json: engines must be {"node":">=24.14.0"}');
    }
    if (!isDeepStrictEqual(json.scripts, allowlist.rootScripts)) {
      const scripts = plainObject(json.scripts) ? json.scripts : {};
      const keys = [...new Set([...Object.keys(scripts), ...Object.keys(allowlist.rootScripts)])].sort();
      const name = keys.find((key) => scripts[key] !== allowlist.rootScripts[key]);
      errors.push(`package.json: scripts must equal allowlist rootScripts (first difference: ${name})`);
    }
  }
  return errors;
}

/** Check manifest fields and dependencies against the allowlist. */
export function checkManifests(manifests, allowlist) {
  const errors = [];
  const names = new Set(manifests.map(({ json }) => json.name));
  for (const { path, json } of manifests) {
    errors.push(...checkManifestFields(path, json, allowlist));
    for (const field of fields) {
      for (const [name, spec] of Object.entries(json[field] ?? {})) {
        if (typeof spec === "string" && spec.startsWith("workspace:")) {
          if (!Object.hasOwn(allowlist.workspaces, name) || !names.has(name)) {
            errors.push(`${path}: ${name}@${spec} is not a workspace package`);
          }
          continue;
        }
        const entry = allowlist.packages.find((item) => item.name === name);
        if (!entry) {
          errors.push(`${path}: ${name} is not on the allowlist`);
          continue;
        }
        if (typeof spec !== "string" || !exact.test(spec)) {
          errors.push(`${path}: ${name}@${spec} must be an exact version`);
        } else if (!satisfies(spec, entry.range)) {
          errors.push(`${path}: ${name}@${spec} is outside the allowed range ${entry.range}`);
        }
        if (!entry.packages.includes(json.name)) {
          errors.push(`${path}: ${name} is not allowed in package ${json.name}`);
        }
      }
    }
  }
  return errors;
}

export function checkInstallScripts(rootManifest, allowlist) {
  const list = rootManifest.pnpm?.onlyBuiltDependencies;
  const expected = new Set(allowlist.installScripts);
  const valid = Array.isArray(list) && list.every((item) => typeof item === "string");
  const actual = new Set(valid ? list : []);
  if (
    plainObject(rootManifest.pnpm) &&
    Object.keys(rootManifest.pnpm).length === 1 &&
    valid &&
    actual.size === expected.size &&
    [...expected].every((name) => actual.has(name))
  )
    return [];
  return [
    `package.json: pnpm.onlyBuiltDependencies must equal allowlist installScripts [${[...expected].sort().join(", ")}]`,
  ];
}

const resolutionPattern =
  /^\s+resolution: \{integrity: sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*(?:, tarball: https:\/\/registry\.npmjs\.org\/[^\s,}]+)?\}$/;

/** Check lockfile sources and importer folders. */
export function checkLockfile(text, allowlist) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  if (/\r(?!\n)/.test(text)) errors.push("pnpm-lock.yaml: lone carriage return is not allowed");
  if (!lines.some((line) => /^lockfileVersion:\s*'9\.0'\s*$/.test(line))) {
    errors.push("pnpm-lock.yaml: lockfileVersion must be '9.0'");
  }
  let inImporters = false;
  for (const [index, line] of lines.entries()) {
    if (/^[^\s#][^:]*:/.test(line)) inImporters = /^importers:/.test(line);
    const loc = `pnpm-lock.yaml:${index + 1}`;
    const importer = inImporters && line.match(/^ {2}([^\s][^:]*):\s*$/);
    if (importer && allowlist && !Object.values(allowlist.workspaces).includes(importer[1])) {
      errors.push(`${loc}: unknown importer ${importer[1]}`);
    }
    const prohibited = line.match(/^(overrides|patchedDependencies|packageExtensionsChecksum):/);
    if (prohibited) errors.push(`${loc}: ${prohibited[1]} is not allowed`);
    const tarball = line.match(/(?:\btarball|["']tarball["'])\s*:\s*["']?([^\s,}'"]+)/);
    if (tarball && !tarball[1].startsWith(registry)) {
      errors.push(`${loc}: tarball outside ${registry}`);
      continue;
    }
    if (/['"](?:specifier|version|resolution|tarball|integrity)['"]\s*:/.test(line)) {
      errors.push(`${loc}: quoted key is not allowed`);
      continue;
    }
    if (/\bresolution\s*:/.test(line) && !resolutionPattern.test(line)) {
      if (/(?:\b(?:type|directory|repo|commit)|["'](?:type|directory|repo|commit)["'])\s*:/.test(line)) {
        errors.push(`${loc}: non-registry resolution`);
      } else errors.push(`${loc}: resolution without integrity`);
    }
    const entry = line.match(/^\s*(specifier|version):\s*['"]?([^\s'"]+)/);
    if (entry) {
      const [, key, value] = entry;
      const invalid = /^(?:npm:|jsr:|catalog:|file:|git\+|git:|github:|http:|https:)/i.test(value);
      const workspace = /^\s*specifier:\s*['"]?workspace:/.test(lines[index - 1] ?? "");
      if (invalid || (key === "version" && value.startsWith("link:") && !workspace)) {
        errors.push(`${loc}: non-registry specifier ${value}`);
      } else if (inImporters && key === "version" && !/^(?:\d|link:)/.test(value)) {
        errors.push(`${loc}: aliased version ${value}`);
      }
    }
  }
  return errors;
}

export function checkNpmrc(text) {
  const errors = [];
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || /^[#;]/.test(trimmed)) continue;
    const [rawKey, ...parts] = trimmed.split("=");
    const key = rawKey.trim();
    const value = parts.join("=").trim();
    const loc = `.npmrc:${index + 1}`;
    if (key === "registry" || /^@[^:]+:registry$/.test(key)) {
      if (key !== "registry" || value !== registry) errors.push(`${loc}: registry must be ${registry}`);
    } else if (key === "engine-strict" || key === "save-exact") {
      if (value !== "true") errors.push(`${loc}: ${key} must be true`);
    } else errors.push(`${loc}: setting ${key} is not allowed`);
  }
  return errors;
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim());
}

function isValidEntry(entry) {
  try {
    parseRange(entry?.range);
  } catch {
    return false;
  }
  return (
    typeof entry?.name === "string" &&
    !!entry.name.trim() &&
    strings(entry.packages) &&
    entry.packages.length > 0 &&
    typeof entry.why === "string" &&
    !!entry.why.trim()
  );
}

export function checkAllowlist(allowlist) {
  const errors = [];
  if (
    allowlist?.lockfileSha256 !== undefined &&
    (typeof allowlist.lockfileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(allowlist.lockfileSha256))
  )
    errors.push("allowlist.json: invalid lockfileSha256");
  if (allowlist?.registry !== registry) errors.push(`allowlist.json: registry must be ${registry}`);
  const entries = Array.isArray(allowlist?.packages) ? allowlist.packages : [];
  const names = new Set(entries.map((entry) => entry?.name));
  if (!strings(allowlist?.installScripts) || !allowlist.installScripts.every((name) => names.has(name))) {
    errors.push("allowlist.json: invalid installScripts");
  }
  if (allowlist?.packageManager !== "pnpm@10.9.0") errors.push("allowlist.json: invalid packageManager");
  if (!isDeepStrictEqual(allowlist?.engines, { node: ">=24.14.0" })) {
    errors.push("allowlist.json: invalid engines");
  }
  const npmrc = [`registry=${registry}`, "engine-strict=true", "save-exact=true"];
  if (!isDeepStrictEqual(allowlist?.npmrc, npmrc)) errors.push("allowlist.json: invalid npmrc");
  if (!isDeepStrictEqual(allowlist?.workspaceGlobs, ["apps/*", "packages/*"])) {
    errors.push("allowlist.json: invalid workspaceGlobs");
  }
  const workspaces = allowlist?.workspaces;
  const folders = plainObject(workspaces) ? Object.values(workspaces) : [];
  const validWorkspaces =
    plainObject(workspaces) &&
    Object.keys(workspaces).length > 0 &&
    Object.entries(workspaces).every(
      ([name, folder]) =>
        name.trim() &&
        !names.has(name) &&
        typeof folder === "string" &&
        (folder === "." || /^(apps|packages)\/[^/]+(?:\/[^/]+)*$/.test(folder)) &&
        (folder === "." || !folder.split("/").some((part) => part === "." || part === "..")),
    ) &&
    new Set(folders).size === folders.length;
  if (!validWorkspaces) errors.push("allowlist.json: invalid workspaces");
  const scripts = allowlist?.rootScripts;
  const commands = {
    "test:tools": 'node --test "tools/checks/test/*.test.mjs"',
    "check:hidden": "node tools/checks/hidden-chars.mjs",
    "check:deps": "node tools/checks/dependency-gate.mjs",
  };
  const lifecycle = new Set([
    "preinstall",
    "install",
    "postinstall",
    "preprepare",
    "prepare",
    "postprepare",
    "prepublish",
    "prepublishOnly",
    "prepack",
    "postpack",
    "publish",
    "postpublish",
  ]);
  const validScripts =
    plainObject(scripts) &&
    Object.entries(scripts).every(
      ([name, value]) =>
        typeof value === "string" &&
        !name.startsWith("pnpm:") &&
        !lifecycle.has(name) &&
        !["pre", "post"].some(
          (prefix) => name.startsWith(prefix) && Object.hasOwn(scripts, name.slice(prefix.length)),
        ),
    ) &&
    Object.entries(commands).every(([name, value]) => scripts[name] === value) &&
    typeof scripts.check === "string" &&
    ["pnpm check:hidden", "pnpm check:deps"].every((command) => scripts.check.includes(command)) &&
    (scripts.check.includes("pnpm test:tools") ||
      (/\bpnpm test(?= |&&|$)/.test(scripts.check) && scripts.test?.includes("pnpm test:tools")));
  if (!validScripts) errors.push("allowlist.json: invalid rootScripts");
  if (
    !strings(allowlist?.guardTests) ||
    !allowlist.guardTests.length ||
    !allowlist.guardTests.every((name) => /^[^/\\]+\.test\.mjs$/.test(name))
  ) {
    errors.push("allowlist.json: invalid guardTests");
  }
  if (!Array.isArray(allowlist?.packages)) errors.push("allowlist.json: invalid entry 0");
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!isValidEntry(entry) || seen.has(entry?.name))
      errors.push(`allowlist.json: invalid entry ${entry?.name || index}`);
    seen.add(entry?.name);
  }
  return errors;
}

export function checkWorkspaceYaml(text) {
  const errors = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const key = line.match(/^([^\s:#][^:]*):/);
    if (key && key[1] !== "packages")
      errors.push(`pnpm-workspace.yaml:${index + 1}: ${key[1]} is not allowed`);
  }
  return errors;
}

/** Check listed files against workspace and guard rules. */
export function checkFiles(entries, allowlist) {
  const errors = [];
  for (const name of allowlist.guardTests) {
    const path = `tools/checks/test/${name}`;
    if (!entries.some((entry) => entry.path === path && /^100(644|755)$/.test(entry.mode))) {
      errors.push(`${path}: missing guard test`);
    }
  }
  const folders = Object.values(allowlist.workspaces);
  const forbidden = [
    "package.yaml",
    "package.yml",
    "package.json5",
    "pnpm-workspace.yml",
    ".pnpmfile.cjs",
    ".pnpmfile.mjs",
    "pnpmfile.cjs",
    "pnpmfile.mjs",
    ".pnpmrc",
  ];
  for (const entry of entries) {
    const { path, mode, validName } = entry;
    if (!validName) {
      errors.push(`${showPath(path)}: file name is not valid UTF-8`);
      continue;
    }
    if (mode === "120000") {
      errors.push(`${showPath(path)}: symbolic link is not allowed`);
      continue;
    }
    if (mode === "160000" || posix.basename(path) === ".gitmodules") {
      errors.push(`${showPath(path)}: submodules are not allowed`);
      continue;
    }
    const name = posix.basename(path);
    const lower = name.toLowerCase();
    const folder = posix.dirname(path);
    if (lower === "package.json" && name === lower && !folders.includes(folder)) {
      errors.push(`${showPath(path)}: package.json is not in an approved workspace folder`);
    }
    const special = ["package.json", ".npmrc", "pnpm-workspace.yaml", "pnpm-lock.yaml"];
    if (
      forbidden.includes(lower) ||
      (special.includes(lower) && name !== lower) ||
      (["pnpm-workspace.yaml", "pnpm-lock.yaml"].includes(lower) && folder !== ".")
    ) {
      errors.push(`${showPath(path)}: is not allowed`);
    } else if (name === ".npmrc" && path !== ".npmrc") {
      errors.push(`${showPath(path)}: only the root .npmrc is allowed`);
    }
  }
  return errors;
}

function isRegularFile(root, path) {
  try {
    return lstatSync(join(root, path)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function readText(root, path) {
  const full = join(root, path);
  try {
    if (!lstatSync(full).isFile()) return null;
    return decodeText(readFileSync(full));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(root, path, invalid) {
  const data = readText(root, path);
  if (!data) return { error: `${showPath(path)}: missing` };
  try {
    if (data.error) throw new Error(data.error);
    return { value: JSON.parse(data.text) };
  } catch {
    return { error: `${showPath(path)}: ${invalid}` };
  }
}

function validManifest(json) {
  return (
    plainObject(json) && fields.every((field) => !Object.hasOwn(json, field) || plainObject(json[field]))
  );
}

function readManifests(root, paths, errors) {
  const manifests = [];
  for (const path of paths) {
    if (path !== "package.json" && !path.endsWith("/package.json")) continue;
    const data = readText(root, path);
    if (!data) continue;
    try {
      if (data.error) throw new Error(data.error);
      const json = JSON.parse(data.text);
      if (!validManifest(json)) throw new Error("invalid manifest");
      manifests.push({ path: showPath(path), json });
    } catch {
      errors.push(`${showPath(path)}: invalid package.json`);
    }
  }
  return manifests;
}

function checkTextFile(root, path, checker, errors, required) {
  const data = readText(root, path);
  if (!data) {
    if (required) errors.push(`${showPath(path)}: missing`);
  } else if (data.error) {
    errors.push(`${showPath(path)}: ${data.error}`);
  } else {
    errors.push(...checker(data.text));
  }
}

function finish(errors, manifests, lock) {
  if (errors.length) {
    return { lines: [...errors, `dependency-gate: FAIL, ${errors.length} problems`], code: 1 };
  }
  let count = 0;
  for (const { json } of manifests) {
    for (const field of fields) count += Object.keys(json[field] ?? {}).length;
  }
  const line = `dependency-gate: OK, ${count} direct dependencies in ${manifests.length} manifests, ${lock}`;
  return { lines: [line], code: 0 };
}

/** Run the dependency gate for a repository. */
export function run(root, argv) {
  try {
    const allow = readJson(root, "tools/checks/allowlist.json", "invalid JSON");
    if (allow.error) return finish([allow.error], [], "");
    const errors = checkAllowlist(allow.value);
    if (errors.length) return finish(errors.map(showText), [], "");
    const deleted = deletedPaths(root);
    const entries = listRepoEntries(root).filter(
      (entry) => entry.mode === "160000" || !deleted.has(entry.path),
    );
    errors.push(...checkFiles(entries, allow.value));
    const paths = [];
    for (const entry of entries) {
      if (entry.mode === "120000" || entry.mode === "160000" || !entry.validName) continue;
      if (isRegularFile(root, entry.path)) paths.push(entry.path);
      else if (entry.mode !== "040000") {
        errors.push(`${showPath(entry.path)}: listed by git but not readable`);
      }
    }
    const manifests = readManifests(root, paths, errors);
    const rootManifest = manifests.find((manifest) => manifest.path === "package.json")?.json;
    errors.push(...checkManifests(manifests, allow.value));
    if (rootManifest) errors.push(...checkInstallScripts(rootManifest, allow.value));
    else if (!paths.includes("package.json")) errors.push("package.json: missing");
    checkTextFile(
      root,
      ".npmrc",
      (text) => {
        const problems = checkNpmrc(text);
        if (!problems.length && text !== `${allow.value.npmrc.join("\n")}\n`) {
          problems.push(".npmrc: must hold exactly the approved lines");
        }
        return problems;
      },
      errors,
      true,
    );
    checkTextFile(
      root,
      "pnpm-workspace.yaml",
      (text) => {
        const problems = checkWorkspaceYaml(text);
        const expected = `packages:\n${allow.value.workspaceGlobs.map((glob) => `  - "${glob}"\n`).join("")}`;
        if (text !== expected) {
          problems.push("pnpm-workspace.yaml: must hold exactly the approved packages list");
        }
        return problems;
      },
      errors,
      false,
    );
    let lock = "lockfile checked";
    if (paths.includes("pnpm-lock.yaml")) {
      if (allow.value.lockfileSha256 === undefined) errors.push("allowlist.json: lockfileSha256 is missing");
      else {
        const hash = createHash("sha256")
          .update(readFileSync(join(root, "pnpm-lock.yaml")))
          .digest("hex");
        if (hash !== allow.value.lockfileSha256)
          errors.push(`pnpm-lock.yaml: content does not match allowlist lockfileSha256 (found ${hash})`);
      }
      checkTextFile(root, "pnpm-lock.yaml", (text) => checkLockfile(text, allow.value), errors, true);
    } else if (argv.includes("--manifests-only")) {
      lock = "lockfile skipped (--manifests-only)";
    } else {
      const hasExternal = manifests.some(({ json }) =>
        fields.some((field) =>
          Object.values(json[field] ?? {}).some(
            (spec) => typeof spec !== "string" || !spec.startsWith("workspace:"),
          ),
        ),
      );
      if (hasExternal) errors.push("pnpm-lock.yaml: missing");
      else lock = "lockfile skipped (no dependencies)";
    }
    return finish(errors.map(showText), manifests, lock);
  } catch (error) {
    const message = showText(
      String(error.message)
        .split(/\r\n|\r|\n/)[0]
        .trim(),
    );
    return { lines: [`dependency-gate: ERROR ${message}`], code: 2 };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = run(repoRoot(), process.argv.slice(2));
  for (const line of result.lines) console.log(line);
  process.exitCode = result.code;
}
