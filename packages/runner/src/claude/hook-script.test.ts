import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  ALLOW_JSON,
  HOOK_TIMEOUT_SECONDS,
  hookCommand,
  hookScript,
  isSafeControlPath,
  settingsJson,
} from "./hook-script.ts";

const roots: string[] = [];
const timers: NodeJS.Timeout[] = [];
function setup(rounds = 3) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(dir);
  mkdirSync(join(dir, "req"));
  mkdirSync(join(dir, "res"));
  writeFileSync(join(dir, "hook.sh"), hookScript({ rounds }));
  return dir;
}
afterEach(() => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function answerer(dir: string, reply: (body: string) => string) {
  const timer = setInterval(() => {
    for (const file of readdirSync(join(dir, "req")).filter(
      (name) => name.endsWith(".json") && !name.startsWith("."),
    )) {
      const request = join(dir, "req", file);
      const name = file.slice(0, -5);
      const temporary = join(dir, "res", `.${name}.tmp`);
      writeFileSync(temporary, reply(readFileSync(request, "utf8")));
      renameSync(temporary, join(dir, "res", name));
      rmSync(request);
    }
  }, 5);
  timers.push(timer);
}
function run(args: string[], input = "request", env: Record<string, string> = {}) {
  const child = spawn("/bin/sh", args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  return { child, result };
}
async function waitForRequest(dir: string) {
  for (let i = 0; i < 200; i++) {
    if (readdirSync(join(dir, "req")).some((name) => name.endsWith(".json"))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Request did not appear.");
}

test("an answer allow prints the allow JSON and exits 0", { timeout: 20_000 }, async () => {
  const dir = setup(20);
  answerer(dir, () => "allow\n");
  for (const env of [{}, { PATH: "/nonexistent" }] as Record<string, string>[])
    expect(await run([join(dir, "hook.sh")], "request", env).result).toEqual({
      code: 0,
      stdout: `${ALLOW_JSON}\n`,
      stderr: "",
    });
});
test("an answer deny with a reason exits 2 with the reason on standard error and prints nothing", {
  timeout: 20_000,
}, async () => {
  const dir = setup(20);
  answerer(dir, () => "deny\nThis path is outside the folders this step declares.\n");
  expect(await run([join(dir, "hook.sh")]).result).toEqual({
    code: 2,
    stdout: "",
    stderr: "This path is outside the folders this step declares.\n",
  });
});
test("every other answer exits 2 with the generic sentence", { timeout: 20_000 }, async () => {
  const dir = setup(20);
  let answer = "";
  answerer(dir, () => answer);
  for (const value of ["deny\n", "yes\n", "ALLOW\n", " allow\n", "allowed\n", "\n", ""]) {
    answer = value;
    expect(await run([join(dir, "hook.sh")]).result).toEqual({
      code: 2,
      stdout: "",
      stderr: "FlowDriven did not allow this call.\n",
    });
  }
  answer = "allow";
  expect(await run([join(dir, "hook.sh")]).result).toEqual({
    code: 0,
    stdout: `${ALLOW_JSON}\n`,
    stderr: "",
  });
});
test("no answer in 3 rounds exits 2 with the time-out sentence and leaves its request", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const start = performance.now();
  expect(await run([join(dir, "hook.sh")], "the input").result).toEqual({
    code: 2,
    stdout: "",
    stderr: "FlowDriven did not answer in time, so this call is blocked.\n",
  });
  expect(performance.now() - start).toBeLessThan(3000);
  const files = readdirSync(join(dir, "req"));
  expect(files).toHaveLength(1);
  const file = files.at(0);
  expect(file).toMatch(/^[^.].*\.json$/);
  if (file === undefined) throw new Error("Missing request.");
  expect(readFileSync(join(dir, "req", file), "utf8")).toBe("the input");
});
test("a missing req or res folder exits 2", { timeout: 20_000 }, async () => {
  for (const name of ["req", "res"]) {
    const dir = setup();
    rmSync(join(dir, name), { recursive: true });
    expect(await run([join(dir, "hook.sh")]).result).toEqual({
      code: 2,
      stdout: "",
      stderr: "FlowDriven is not running this step, so this call is blocked.\n",
    });
  }
});
test("the settings command turns a missing script into exit 2", { timeout: 20_000 }, async () => {
  const dir = setup();
  const command = hookCommand(dir, false);
  rmSync(dir, { recursive: true });
  expect((await run(["-c", command]).result).code).toBe(2);
  expect((await run(["-c", `/bin/sh '${dir}/hook.sh'`]).result).code).toBe(127);
  const waiting = setup(20);
  const process = run(["-c", hookCommand(waiting, false)]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  rmSync(waiting, { recursive: true });
  const result = await process.result;
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("FlowDriven did not answer in time, so this call is blocked.\n");
});
test("start creates the empty file started and prints nothing, and with the folder gone exits 2", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const command = hookCommand(dir, true);
  expect(await run(["-c", command]).result).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(readFileSync(join(dir, "started"), "utf8")).toBe("");
  rmSync(dir, { recursive: true });
  expect((await run(["-c", command]).result).code).toBe(2);
});
test("the request is the standard input byte for byte and appears under its .json name only when complete", {
  timeout: 20_000,
}, async () => {
  const dir = setup(20);
  const body = `${String.fromCodePoint(0xe9).repeat(99_998)}end!`;
  const sizes: number[] = [];
  let received = "";
  let answering = false;
  const timer = setInterval(() => {
    for (const name of readdirSync(join(dir, "req")).filter((n) => n.endsWith(".json"))) {
      sizes.push(readFileSync(join(dir, "req", name)).length);
      if (!answering) {
        answering = true;
        answerer(dir, (text) => {
          received = text;
          return "allow\n";
        });
      }
    }
  }, 1);
  timers.push(timer);
  expect((await run([join(dir, "hook.sh")], body).result).code).toBe(0);
  expect(received).toBe(body);
  expect(sizes.length).toBeGreaterThan(0);
  expect(sizes.every((size) => size === Buffer.byteLength(body))).toBe(true);
});
test("two hooks at once each get their own answer", { timeout: 20_000 }, async () => {
  const dir = setup(20);
  answerer(dir, (body) => (body.includes('"a"') ? "allow\n" : "deny\nno\n"));
  const [a, b] = await Promise.all([
    run([join(dir, "hook.sh")], '"a"').result,
    run([join(dir, "hook.sh")], '"b"').result,
  ]);
  expect(a).toEqual({ code: 0, stdout: `${ALLOW_JSON}\n`, stderr: "" });
  expect(b).toEqual({ code: 2, stdout: "", stderr: "no\n" });
});
test("a signal while waiting exits 2 with the stop sentence", { timeout: 20_000 }, async () => {
  const dir = setup(50);
  const process = run([join(dir, "hook.sh")]);
  await waitForRequest(dir);
  process.child.kill("SIGTERM");
  expect(await process.result).toEqual({
    code: 2,
    stdout: "",
    stderr: "FlowDriven stopped this check, so this call is blocked.\n",
  });
});
test("the script text", () => {
  const text = hookScript({ rounds: 3 });
  expect(text.split("\n").at(0)).toBe("PATH=/usr/bin:/bin");
  expect(text).toContain("-lt 3");
  for (const rounds of [0, 1.5, 601, Number.NaN])
    expect(() => hookScript({ rounds })).toThrow("The number of rounds is not valid.");
  expect(text).not.toContain("exec");
  expect(text).not.toContain("eval");
});
test("the settings quote the path, hold only the two hooks and refuse an unsafe path", () => {
  const dir = "/tmp/a b/$x`";
  const start = `/bin/sh '${dir}/hook.sh' start || exit 2`;
  const pre = `/bin/sh '${dir}/hook.sh' || exit 2`;
  expect(HOOK_TIMEOUT_SECONDS).toBe(120);
  expect(hookCommand(dir, true)).toBe(start);
  expect(hookCommand(dir, false)).toBe(pre);
  const json = settingsJson(dir);
  expect(json.endsWith("\n")).toBe(true);
  expect(JSON.parse(json)).toEqual({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: start, timeout: 120 }] }],
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: pre, timeout: 120 }] }],
    },
  });
  expect(json).toBe(`${JSON.stringify(JSON.parse(json), null, 2)}\n`);
  for (const path of [
    "/tmp/'",
    ...[10, 9, 0x7f, 0].map((point) => `/tmp/${String.fromCodePoint(point)}`),
    "relative/x",
  ]) {
    expect(isSafeControlPath(path)).toBe(false);
    expect(() => settingsJson(path)).toThrow("The control folder path is not safe.");
  }
  expect(isSafeControlPath(dir)).toBe(true);
  expect(existsSync(dir)).toBe(false);
});
