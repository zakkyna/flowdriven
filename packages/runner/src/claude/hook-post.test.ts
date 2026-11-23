import { spawn } from "node:child_process";
import {
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
import { POST_TEXT, postLine } from "./browser-post.ts";
import { createControlDir } from "./control.ts";
import {
  ALLOW_JSON,
  HOOK_TIMEOUT_SECONDS,
  hookScript,
  POST_WITHHELD_LINE,
  postCommand,
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
  timers.push(
    setInterval(() => {
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
    }, 5),
  );
}
function run(args: string[], input = "request", home = "/tmp") {
  const child = spawn("/bin/sh", args, { env: { HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
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
const fixed = () => ({ code: 0, stdout: `${postLine(POST_TEXT.unchecked)}\n`, stderr: "" });

test("post mode prints the runner's line verbatim and exits 0", { timeout: 20_000 }, async () => {
  const dir = setup();
  answerer(dir, () => `${postLine("Hello")}\n`);
  expect(await run([join(dir, "hook.sh"), "post"], "request", dir).result).toEqual({
    code: 0,
    stdout: `${postLine("Hello")}\n`,
    stderr: "",
  });
});
test("post mode with no answer prints the fixed replacement after the rounds and exits 0", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  expect(await run([join(dir, "hook.sh"), "post"], "request", dir).result).toEqual(fixed());
});
test("post mode with an answer that does not start with `{` prints the fixed replacement", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  answerer(dir, () => "deny\n");
  expect(await run([join(dir, "hook.sh"), "post"], "request", dir).result).toEqual(fixed());
});
test("post mode with no req or res folder, with a $0 whose folder cannot be found, and with a signal prints the fixed replacement and exits 0, never exit 2", {
  timeout: 20_000,
}, async () => {
  for (const folder of ["req", "res"]) {
    const dir = setup();
    rmSync(join(dir, folder), { recursive: true });
    expect(await run([join(dir, "hook.sh"), "post"], "request", dir).result).toEqual(fixed());
  }
  const dir = setup();
  expect(
    await run(
      ["-c", `dirname() { return 1; }\n${hookScript({ rounds: 3 })}`, "/missing/hook.sh", "post"],
      "request",
      dir,
    ).result,
  ).toEqual(fixed());
  const waiting = setup(50);
  const seen = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (readdirSync(join(waiting, "req")).some((name) => name.endsWith(".json"))) {
        clearInterval(timer);
        resolve();
      }
    }, 5);
    timers.push(timer);
  });
  const process = run([join(waiting, "hook.sh"), "post"], "request", waiting);
  await seen;
  process.child.kill("SIGTERM");
  expect(await process.result).toEqual(fixed());
});
test("post mode is independent of pre mode: the same request body gets its answer through its own file and a pre request still gets allow or deny as before", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  let count = 0;
  answerer(dir, (body) => {
    expect(body).toBe("same request");
    return count++ === 0 ? `${postLine("Hello")}\n` : "allow\n";
  });
  expect(await run([join(dir, "hook.sh"), "post"], "same request", dir).result).toEqual({
    code: 0,
    stdout: `${postLine("Hello")}\n`,
    stderr: "",
  });
  expect(await run([join(dir, "hook.sh")], "same request", dir).result).toEqual({
    code: 0,
    stdout: `${ALLOW_JSON}\n`,
    stderr: "",
  });
});
test("a long line of 200,000 characters comes back intact", { timeout: 20_000 }, async () => {
  const dir = setup();
  const line = postLine("x".repeat(200_000));
  answerer(dir, () => `${line}\n`);
  expect(await run([join(dir, "hook.sh"), "post"], "request", dir).result).toEqual({
    code: 0,
    stdout: `${line}\n`,
    stderr: "",
  });
});
test("the fixed replacement line is exactly postLine(POST_TEXT.unchecked)", () => {
  expect(POST_WITHHELD_LINE).toBe(postLine(POST_TEXT.unchecked));
  expect(POST_WITHHELD_LINE).not.toContain("'");
});
test("the settings with browser add exactly one PostToolUse entry with the matcher and the post command, and the settings without it are byte-identical to the present ones", () => {
  const dir = "/tmp/a b/$x`";
  const original = {
    autoMemoryEnabled: false, // TC-AGT-41
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: `/bin/sh '${dir}/hook.sh' start || exit 2`, timeout: 120 }] },
      ],
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: `/bin/sh '${dir}/hook.sh' || exit 2`, timeout: 120 }],
        },
      ],
    },
  };
  expect(settingsJson(dir)).toBe(`${JSON.stringify(original, null, 2)}\n`);
  expect(settingsJson(dir, {})).toBe(settingsJson(dir));
  expect(postCommand(dir)).toBe(`/bin/sh '${dir}/hook.sh' post || exit 2`);
  expect(() => postCommand("/tmp/'")).toThrow("The control folder path is not safe.");
  expect(JSON.parse(settingsJson(dir, { browser: true }))).toEqual({
    autoMemoryEnabled: false,
    hooks: {
      ...original.hooks,
      PostToolUse: [
        {
          matcher: "mcp__claude-in-chrome__.*",
          hooks: [{ type: "command", command: postCommand(dir), timeout: HOOK_TIMEOUT_SECONDS }],
        },
      ],
    },
  });
});
test("createControlDir with browser writes the PostToolUse entry; without it the file equals settingsJson(path)", () => {
  const root = setup();
  const browser = createControlDir({ root, id: "browser", browser: true });
  const plain = createControlDir({ root, id: "plain" });
  expect(readFileSync(browser.settings, "utf8")).toBe(settingsJson(browser.path, { browser: true }));
  expect(JSON.parse(readFileSync(browser.settings, "utf8")).hooks.PostToolUse).toHaveLength(1);
  expect(readFileSync(plain.settings, "utf8")).toBe(settingsJson(plain.path));
});
test("the script text has no exec, no eval and still passes the checks of the present hook tests", () => {
  const text = hookScript({ rounds: 3 });
  expect(text.split("\n").at(0)).toBe("PATH=/usr/bin:/bin");
  expect(text).toContain("-lt 3");
  for (const rounds of [0, 1.5, 601, Number.NaN])
    expect(() => hookScript({ rounds })).toThrow("The number of rounds is not valid.");
  expect(text).not.toContain("exec");
  expect(text).not.toContain("eval");
});
