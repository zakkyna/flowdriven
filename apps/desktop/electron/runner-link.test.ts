import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { MAX_FRAME_BYTES as CONTRACT_MAX } from "@flowdriven/contracts";
import { afterEach, expect, test, vi } from "vitest";
import {
  ALL_TOPICS_EVENT,
  type ChildLike,
  MAX_FRAME_BYTES,
  RunnerLink,
  type RunnerLinkOptions,
} from "./runner-link";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: "SIGTERM" | "SIGKILL") => true);
}
const dirs: string[] = [];
const links: RunnerLink[] = [];
function options(extra: Partial<RunnerLinkOptions> = {}): RunnerLinkOptions {
  return {
    spawn: () => new FakeChild() as ChildLike,
    execPath: "node",
    entry: "entry",
    dataDir: "/data",
    demo: false,
    env: {},
    onEvent: () => {},
    ...extra,
  };
}
function make(extra: Partial<RunnerLinkOptions> = {}) {
  const link = new RunnerLink(options(extra));
  links.push(link);
  return link;
}
function real(onEvent: (event: unknown) => void = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "flowdriven-"));
  dirs.push(dir);
  return make({
    spawn: (c, a, o) => spawn(c, a, o),
    execPath: process.execPath,
    entry: fileURLToPath(new URL("../../../packages/runner/src/main.ts", import.meta.url)),
    dataDir: dir,
    demo: true,
    env: process.env,
    onEvent,
  });
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(links.splice(0).map((link) => link.stop()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("a call round-trips to the real runner and a failure keeps its code", { timeout: 20_000 }, async () => {
  const link = real();
  expect(await link.call("flows.list", {})).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "local.sample-job-review" })]),
  );
  await expect(link.call("runs.status", { runId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  expect(MAX_FRAME_BYTES).toBe(CONTRACT_MAX);
});
test("events from the runner reach onEvent", { timeout: 20_000 }, async () => {
  let resolveEvent: () => void = () => {};
  const event = new Promise<void>((resolve) => {
    resolveEvent = resolve;
  });
  const link = real((value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "topics" in value &&
      Array.isArray(value.topics) &&
      value.topics.includes("runs")
    )
      resolveEvent();
  });
  await link.call("flows.run", { flowId: "local.sample-job-review" });
  await event;
});
test("a start passes the entry, the flags and the exact environment to spawn", () => {
  const child = new FakeChild();
  const spawnFn = vi.fn(() => child);
  const link = make({ spawn: spawnFn, demo: true, env: { PATH: "p", SECRET: "x" }, stopWaitMs: 1 });
  link.start();
  link.start();
  expect(spawnFn).toHaveBeenCalledOnce();
  expect(spawnFn).toHaveBeenCalledWith("node", ["entry", "--stdio", "--data-dir", "/data", "--demo"], {
    env: { ELECTRON_RUN_AS_NODE: "1", PATH: "p" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.emit("exit", 0, null);
});
test("when the runner exits, waiting calls fail with The engine stopped. and the next call starts it again", async () => {
  const children: FakeChild[] = [];
  const events = vi.fn();
  const link = make({
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    onEvent: events,
    stopWaitMs: 1,
  });
  const first = link.call("x", {});
  children.at(0)?.emit("exit", 1, null);
  await expect(first).rejects.toMatchObject({ code: "unavailable", message: "The engine stopped." });
  expect(events).toHaveBeenCalledExactlyOnceWith(ALL_TOPICS_EVENT);
  const second = link.call("x", {});
  expect(children).toHaveLength(2);
  const rejected = expect(second).rejects.toMatchObject({ code: "unavailable" });
  expect(() => children.at(1)?.stdin.emit("error", new Error("EPIPE"))).not.toThrow();
  await rejected;
  expect(children.at(1)?.kill).toHaveBeenCalled();
  expect(events).toHaveBeenCalledTimes(2);
});
test("at most three starts in 60 seconds, then unavailable until the app restarts", async () => {
  let now = 0;
  const children: FakeChild[] = [];
  const link = make({
    now: () => now,
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
  });
  for (let i = 0; i < 3; i++) {
    const call = link.call("x", {});
    children.at(i)?.emit("exit", 1, null);
    await expect(call).rejects.toMatchObject({ code: "unavailable" });
  }
  await expect(link.call("x", {})).rejects.toMatchObject({
    code: "unavailable",
    message: "The engine stopped and cannot be restarted. Restart FlowDriven.",
  });
  now = 100_000;
  await expect(link.call("x", {})).rejects.toMatchObject({ code: "unavailable" });
  expect(children).toHaveLength(3);
});
test("stderr lines are prefixed and cut at 4,096 bytes", () => {
  const child = new FakeChild();
  const log = vi.fn();
  const link = make({ spawn: () => child, log });
  link.start();
  child.stderr.write(`${"a".repeat(5000)}\nshort\n`);
  expect(log).toHaveBeenCalledWith(`[runner] ${"a".repeat(4096)}`);
  expect(log).toHaveBeenCalledWith("[runner] short");
  child.emit("exit", 0, null);
});
test("a line over the limit ends the connection and fails the waiting calls", async () => {
  const child = new FakeChild();
  const link = make({ spawn: () => child });
  const call = link.call("x", {});
  const rejected = expect(call).rejects.toMatchObject({ code: "unavailable" });
  child.stdout.write("a".repeat(1_048_577));
  await rejected;
  expect(child.kill).toHaveBeenCalled();
  const spawnFn = vi.fn(() => new FakeChild());
  const fresh = make({ spawn: spawnFn });
  await expect(fresh.call("x", { x: "a".repeat(1_048_576) })).rejects.toMatchObject({
    code: "invalid_input",
    message: "The request is too large.",
  });
  expect(spawnFn).not.toHaveBeenCalled();
});
test("a frame that is not a JSON-RPC object ends the connection", async () => {
  for (const frame of ["[1]\n", '{"id":1}\n']) {
    const child = new FakeChild();
    const link = make({ spawn: () => child });
    const call = link.call("x", {});
    const rejected = expect(call).rejects.toMatchObject({ code: "unavailable" });
    child.stdout.write(frame);
    await rejected;
    expect(child.kill).toHaveBeenCalled();
  }
});
test("stop ends stdin, waits for the exit and kills a runner that does not leave in 3 seconds", {
  timeout: 20_000,
}, async () => {
  vi.useFakeTimers();
  const child = new FakeChild();
  const link = make({ spawn: () => child });
  link.start();
  const stopped = link.stop();
  expect(child.stdin.writableEnded).toBe(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  await vi.advanceTimersByTimeAsync(1000);
  await stopped;
  const other = new FakeChild();
  const link2 = make({ spawn: () => other });
  link2.start();
  const stopped2 = link2.stop();
  other.emit("exit", 0, null);
  await stopped2;
  expect(other.kill).not.toHaveBeenCalled();
});

test("a notice frame reaches onNotice and an event frame still reaches onEvent; a notice with no handler is ignored; a notification with any other method still fails the link", async () => {
  const child = new FakeChild();
  const onNotice = vi.fn();
  const onEvent = vi.fn();
  const link = make({ spawn: () => child, onNotice, onEvent });
  const pending = link.call("x", {});
  const rejected = expect(pending).rejects.toMatchObject({ code: "unavailable" });
  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notice", params: { id: "n" } })}\n`);
  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "changed" } })}\n`);
  expect(onNotice).toHaveBeenCalledExactlyOnceWith({ id: "n" });
  expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: "changed" });
  child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "unknown", params: {} })}\n`);
  await rejected;
  expect(child.kill).toHaveBeenCalled();
  const other = new FakeChild();
  const without = make({ spawn: () => other });
  without.start();
  other.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notice", params: {} })}\n`);
  expect(other.kill).not.toHaveBeenCalled();
  other.emit("exit", 0, null);
});
