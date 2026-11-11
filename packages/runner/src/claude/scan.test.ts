import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  FAKE_CLAUDE_PATH,
  FAKE_HELP,
  makeFakeHome,
  readFakeCalls,
  writeFakeScript,
} from "../test-helpers/fake-claude-script.ts";
import { REQUIRED_FLAGS } from "./args.ts";
import { findClaude, scanClaude } from "./scan.ts";

const homes: string[] = [];
function home() {
  const h = makeFakeHome();
  homes.push(h);
  return h;
}
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const now = () => new Date("2026-11-11T00:00:00.000Z");
function opts(h: string) {
  return { explicit: FAKE_CLAUDE_PATH, cwd: h, env: { HOME: h, PATH: process.env.PATH }, now };
}

test("findClaude takes the explicit path alone, then PATH in order, then the known folders", () => {
  const h = home();
  const dirs = ["one", "two", "three"].map((x) => join(h, x));
  for (const d of dirs) mkdirSync(d);
  const [one, two, three] = dirs;
  if (!one || !two || !three) throw new Error("missing folder");
  writeFileSync(join(one, "claude"), "");
  chmodSync(join(one, "claude"), 0o644);
  mkdirSync(join(two, "claude"));
  writeFileSync(join(three, "claude"), "");
  chmodSync(join(three, "claude"), 0o755);
  const pathEnv = `relative:${dirs.join(":")}`;
  expect(findClaude({ pathEnv, home: h })).toBe(join(three, "claude"));
  expect(findClaude({ explicit: join(h, "missing"), pathEnv, home: h })).toBeUndefined();
  mkdirSync(join(h, ".local/bin"), { recursive: true });
  writeFileSync(join(h, ".local/bin/claude"), "");
  chmodSync(join(h, ".local/bin/claude"), 0o755);
  expect(findClaude({ pathEnv: "", home: h })).toBe(join(h, ".local/bin/claude"));
  expect(findClaude({ pathEnv: "", home: undefined })).toBeUndefined();
});
test("the scan reads version, flags, config folder and login from the fake", {
  timeout: 20_000,
}, async () => {
  const h = home();
  mkdirSync(join(h, ".claude"));
  expect(await scanClaude(opts(h))).toEqual({
    detected: true,
    path: FAKE_CLAUDE_PATH,
    version: "2.1.318",
    missingFlags: [],
    configFolder: true,
    login: "logged_in",
    authMethod: "claude.ai",
    scannedAt: now().toISOString(),
  });
});
test("a help text without a flag lists it and a help that hangs lists all", { timeout: 20_000 }, async () => {
  const h = home();
  writeFakeScript(h, { help: FAKE_HELP.replace("--restricted\n", "") });
  expect((await scanClaude(opts(h))).missingFlags).toEqual(["--restricted"]);
  writeFakeScript(h, { help: FAKE_HELP.replace("--tools\n", "--tools-extra\n") });
  expect((await scanClaude(opts(h))).missingFlags).toContain("--tools");
  writeFakeScript(h, { hang: ["help"] });
  expect((await scanClaude({ ...opts(h), timeoutMs: 300 })).missingFlags).toEqual(REQUIRED_FLAGS);
});
test("login: loggedIn false is logged_out, and anything else is unknown", { timeout: 20_000 }, async () => {
  const h = home();
  for (const [raw, expected] of [
    ['{"loggedIn":false}', "logged_out"],
    ['{"loggedIn":"yes"}', "unknown"],
    ["not json", "unknown"],
    ["[]", "unknown"],
    ["{}", "unknown"],
  ] as const) {
    writeFakeScript(h, { auth: { raw } });
    expect((await scanClaude(opts(h))).login).toBe(expected);
  }
});
test("a command that hangs is cut at its limit and the scan still finishes", {
  timeout: 20_000,
}, async () => {
  const h = home();
  writeFakeScript(h, { hang: ["auth", "version"] });
  const start = performance.now();
  const scan = await scanClaude({ ...opts(h), timeoutMs: 300 });
  expect(performance.now() - start).toBeLessThan(5000);
  expect(scan.detected).toBe(true);
  expect(scan.login).toBe("unknown");
  expect(scan.version).toBeUndefined();
});
test("only loggedIn and authMethod are read, and nothing found runs nothing", {
  timeout: 20_000,
}, async () => {
  const h = home();
  const scan = await scanClaude(opts(h));
  for (const value of ["a@example.test", "org-1", "Example"])
    expect(JSON.stringify(scan)).not.toContain(value);
  const empty = home();
  expect((await scanClaude({ ...opts(empty), explicit: join(empty, "missing") })).detected).toBe(false);
  expect(readFakeCalls(empty)).toEqual([]);
});

test("scan commands run in the given folder", { timeout: 20_000 }, async () => {
  const h = home();
  await scanClaude(opts(h));
  const calls = readFakeCalls(h).filter((c) => c.kind === "call");
  expect(calls.map((c) => c.args)).toEqual(
    expect.arrayContaining([["--version"], ["--help"], ["auth", "status", "--json"]]),
  );
  for (const call of calls) expect(call.cwd).toBe(realpathSync(h));
});
