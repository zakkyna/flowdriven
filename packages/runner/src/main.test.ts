import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@flowdriven/contracts";
import { parseFrame } from "@flowdriven/contracts/v1";
import { afterEach, expect, test } from "vitest";
import { connectRpcClient } from "./test-helpers/rpc-client.ts";

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  return dir;
}
function launch(dir: string, extra: string[] = []) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./main.ts", import.meta.url)), "--stdio", "--data-dir", dir, "--demo", ...extra],
    { env: { ...process.env, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (s: string) => {
    stdout += s;
  });
  child.stderr.on("data", (s: string) => {
    stderr += s;
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return {
    child,
    exit,
    stdout: () => stdout,
    stderr: () => stderr,
    client: connectRpcClient({ input: child.stdout, output: child.stdin }),
  };
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.stdin.end();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("the real process answers runner.info over its pipes, prints nothing else on stdout and exits 0 when stdin ends", {
  timeout: 20_000,
}, async () => {
  const p = launch(temp());
  expect(await p.client.call("runner.info", {})).toEqual({
    contractVersion: CONTRACT_VERSION,
    appVersion: (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
    ).version,
    storeVersion: 7,
    mode: "demo",
  });
  p.child.stdin.end();
  expect(await p.exit).toBe(0);
  const lines = p.stdout().trim().split("\n");
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(() => parseFrame(line)).not.toThrow();
  expect(p.stderr()).toBe("");
});
test("a second real process on the same folder exits 3 while the first runs", {
  timeout: 20_000,
}, async () => {
  const dir = temp();
  const first = launch(dir);
  await first.client.call("runner.info", {});
  const second = launch(dir);
  expect(await second.exit).toBe(3);
  expect(second.stderr()).toBe("Another FlowDriven runner is using this data folder.\n");
});

test("TC-AGT-40 the process forwards registered languages to the service", async () => {
  const p = launch(temp(), ["--languages=en,id"]);
  const call = p.client.call as (name: string, input: unknown) => Promise<unknown>;
  expect(await call("settings.update", { patch: { language: "id" } })).toMatchObject({
    language: "id",
  });
  p.child.stdin.end();
  expect(await p.exit).toBe(0);
});
