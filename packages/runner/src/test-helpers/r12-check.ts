import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { firstControlDir, listRequests, parsePs, type R12Mode, startSeen, verdict } from "./r12-parts.ts";
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
  const callAgents = client.call as unknown as (
    name: "agents.rescan",
    input: object,
  ) => Promise<{ agents: { id: string; state: string }[] }>;
  const { agents } = await callAgents("agents.rescan", {});
  const card = agents.find((c) => c.id === "claude-code");
  if (card?.state !== "ready") throw new Error("Claude Code was not found or is not signed in.");
  await (
    client.call as unknown as (
      name: "settings.update",
      input: { patch: { agentPermission: "on" } },
    ) => Promise<unknown>
  )("settings.update", { patch: { agentPermission: "on" } });
  const imported = await client.call("flows.import", { path: flowDir });
  if (!imported.flow) throw new Error("Could not import the check flow.");
  const run = await client.call("flows.run", { flowId: "local.claude-code-check" });
  const deadline = Date.now() + 60_000;
  while (!control && Date.now() < deadline) {
    control = firstControlDir(root);
    if (!control) await pause(100);
  }
  if (!control) throw new Error("The control folder did not appear.");
  const startDeadline = Date.now() + 30_000;
  let started = startSeen(control);
  while (!started && Date.now() < startDeadline) {
    await pause(100);
    started = startSeen(control);
  }
  await pause(300);
  let allowed = 0;
  let refused = 0;
  let fileExists: boolean;
  if (selected === "kill") {
    if (child.pid) kill(child.pid);
    await pause(15_000);
    fileExists = existsSync(join(root, "project/notes/hello.txt"));
  } else {
    rmSync(control, { recursive: true, force: true });
    const finishDeadline = Date.now() + 90_000;
    let ended = false;
    while (Date.now() < finishDeadline) {
      const status = await client.call("runs.status", { runId: run.id });
      if (status.steps.find((step) => step.stepId === "write")?.attempts.at(0)?.endedAt) {
        ended = true;
        break;
      }
      await pause(200);
    }
    if (!ended) throw new Error("The write attempt did not finish in time.");
    fileExists = existsSync(join(root, "project/notes/hello.txt"));
    const entries = await client.call("audit.list", { runId: run.id });
    for (const entry of entries) {
      if (entry.kind !== "tool_calls") continue;
      let detail: unknown;
      try {
        detail = JSON.parse(entry.detail);
      } catch {
        continue;
      }
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("stepId" in detail) ||
        !("attempt" in detail) ||
        detail.stepId !== "write" ||
        detail.attempt !== 1
      )
        continue;
      if (
        "allowed" in detail &&
        typeof detail.allowed === "number" &&
        Number.isInteger(detail.allowed) &&
        detail.allowed >= 0
      )
        allowed = detail.allowed;
      else allowed = -1;
      if (
        "refused" in detail &&
        typeof detail.refused === "number" &&
        Number.isInteger(detail.refused) &&
        detail.refused >= 0
      )
        refused = detail.refused;
      break;
    }
  }
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", env });
  if (ps.status !== 0) throw new Error("Could not inspect Claude Code processes.");
  pids = parsePs(ps.stdout, join(control, "settings.json"));
  const report = verdict({
    mode: selected,
    startSeen: started,
    requestLeft: listRequests(control).length > 0,
    allowed,
    refused,
    fileExists,
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
