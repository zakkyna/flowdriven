import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { firstControlDir, listRequests, parsePs, type R12Mode, verdict } from "./r12-parts.ts";
import { connectRpcClient } from "./rpc-client.ts";

const mode = process.argv[2];
if (mode !== "kill" && mode !== "remove") throw new Error("Usage: r12-check.ts kill|remove");
const selected: R12Mode = mode;
const root = resolve(".workflow/scratch/r12", selected, "app data");
const flowDir = resolve("packages/runner/src/claude/check-flow");
const main = resolve("packages/runner/src/main.ts");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const env = {
  HOME: process.env.HOME,
  USER: process.env.USER,
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  LANG: process.env.LANG,
};
const child = spawn(process.execPath, [main, "--stdio", "--data-dir", root], {
  env,
  stdio: ["pipe", "pipe", "pipe"],
  detached: true,
});
child.stderr.resume();
const client = connectRpcClient({ input: child.stdout, output: child.stdin });
const pause = (ms: number) => new Promise((resolvePause) => setTimeout(resolvePause, ms));
let control: string | undefined;
let pids: number[] = [];
function kill(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
try {
  const cards = await client.call("harnesses.rescan", {});
  const card = cards.find((c) => c.id === "claude-code");
  if (!card?.detected || card.login !== "logged_in")
    throw new Error("Claude Code was not found or is not signed in.");
  await client.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
  const imported = await client.call("flows.import", { path: flowDir });
  if (!imported.flow) throw new Error("Could not import the check flow.");
  await client.call("flows.run", { flowId: "local.claude-code-check" });
  const deadline = Date.now() + 60_000;
  while (!control && Date.now() < deadline) {
    control = firstControlDir(root);
    if (!control) await pause(100);
  }
  if (!control) throw new Error("The control folder did not appear.");
  await pause(1000);
  if (selected === "kill") {
    if (child.pid) kill(child.pid);
  } else rmSync(control, { recursive: true, force: true });
  await pause(15_000);
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", env });
  if (ps.status !== 0) throw new Error("Could not inspect Claude Code processes.");
  pids = parsePs(ps.stdout, join(control, "settings.json"));
  const report = verdict({
    mode: selected,
    requestLeft: listRequests(control).length > 0,
    fileExists: existsSync(join(root, "project/notes/hello.txt")),
    claudeAlive: pids.length > 0,
  });
  for (const line of report.lines) process.stdout.write(`${line}\n`);
  process.exitCode = report.pass ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (child.pid) kill(child.pid);
  if (control) {
    const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", env });
    if (ps.status === 0)
      pids = [...new Set([...pids, ...parsePs(ps.stdout, join(control, "settings.json"))])];
  }
  for (const pid of pids) kill(pid);
  if (control) rmSync(control, { recursive: true, force: true });
  client.close();
}
