import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { CHANNEL, type Channel, MAX_REQUEST_BYTES, startChannel } from "./channel.ts";
import { type ControlDir, createControlDir, removeControlDir } from "./control.ts";
import { hookCommand } from "./hook-script.ts";

const roots: string[] = [];
const channels: Channel[] = [];
function setup(rounds = 20) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "flowdriven- ")));
  roots.push(root);
  return createControlDir({ root: join(root, "control"), id: "cc-1", rounds });
}
afterEach(() => {
  for (const c of channels.splice(0)) c.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function start(
  dir: ControlDir,
  decide: (call: unknown) => import("./decide.ts").Decision,
  onCall?: Parameters<typeof startChannel>[0]["onCall"],
  pollMs = 5,
) {
  const c = startChannel({ dir, decide, ...(onCall ? { onCall } : {}), pollMs });
  channels.push(c);
  return c;
}
function request(dir: ControlDir, name: string, body: string) {
  const tmp = join(dir.req, `.${name}`);
  writeFileSync(tmp, body);
  renameSync(tmp, join(dir.req, `${name}.json`));
}
async function waitFor(fn: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Timed out");
}
const allow = () => ({ allow: true as const, tool: "Read" });
test("an allowed call gets allow and a denied one gets deny with its reason; the request is deleted and only allowed ids are kept", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const onCall = vi.fn();
  const c = start(
    dir,
    (call) =>
      (call as { tool_use_id: string }).tool_use_id === "t1"
        ? allow()
        : { allow: false, tool: "Read", reason: "No." },
    onCall,
  );
  request(dir, "aaaaaaaaaaaaaaaa", JSON.stringify({ tool_use_id: "t1" }));
  request(dir, "bbbbbbbbbbbbbbbb", JSON.stringify({ tool_use_id: "t2" }));
  await waitFor(() => existsSync(join(dir.res, "bbbbbbbbbbbbbbbb")));
  expect(readFileSync(join(dir.res, "aaaaaaaaaaaaaaaa"), "utf8")).toBe("allow\n");
  expect(readFileSync(join(dir.res, "bbbbbbbbbbbbbbbb"), "utf8")).toBe("deny\nNo.\n");
  expect(readdirSync(dir.req)).toEqual([]);
  expect([...c.allowedIds]).toEqual(["t1"]);
  expect(c.counts()).toEqual({ allowed: 1, denied: 1 });
  expect(onCall).toHaveBeenCalledTimes(2);
  expect(c.started()).toBe(false);
  writeFileSync(dir.started, "");
  expect(c.started()).toBe(true);
});
test("two requests at once are both answered in one pass", { timeout: 20_000 }, async () => {
  const dir = setup();
  request(dir, "aaaaaaaaaaaaaaaa", "{}");
  request(dir, "bbbbbbbbbbbbbbbb", "{}");
  vi.useFakeTimers();
  const c = start(dir, allow, undefined, 50);
  vi.advanceTimersByTime(50);
  expect(c.counts()).toEqual({ allowed: 2, denied: 0 });
  vi.useRealTimers();
  expect(readdirSync(dir.res).sort()).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
});
test("a request still being written is not read until it is renamed", { timeout: 20_000 }, async () => {
  const dir = setup();
  const decide = vi.fn(allow);
  start(dir, decide);
  writeFileSync(join(dir.req, ".cccccccccccccccc"), "x".repeat(100));
  await new Promise((r) => setTimeout(r, 150));
  expect(decide).not.toHaveBeenCalled();
  expect(readdirSync(dir.res)).toEqual([]);
  writeFileSync(join(dir.req, ".cccccccccccccccc"), "{}");
  renameSync(join(dir.req, ".cccccccccccccccc"), join(dir.req, "cccccccccccccccc.json"));
  await waitFor(() => existsSync(join(dir.res, "cccccccccccccccc")));
  expect(decide).toHaveBeenCalledTimes(1);
});
test("a request over 8 MiB is denied unread", { timeout: 20_000 }, async () => {
  const dir = setup();
  const decide = vi.fn(allow);
  start(dir, decide);
  request(dir, "aaaaaaaaaaaaaaaa", "x".repeat(MAX_REQUEST_BYTES + 1));
  await waitFor(() => existsSync(join(dir.res, "aaaaaaaaaaaaaaaa")));
  expect(readFileSync(join(dir.res, "aaaaaaaaaaaaaaaa"), "utf8")).toBe("deny\nThis request is too large.\n");
  expect(decide).not.toHaveBeenCalled();
});
test("a request that is not JSON, a name of the wrong form and a request that is not a regular file are denied", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const outside = join(roots.at(-1) ?? "", "outside");
  writeFileSync(outside, "secret");
  const decide = vi.fn(allow);
  const onCall = vi.fn();
  const c = start(dir, decide, onCall, 100);
  request(dir, "bbbbbbbbbbbbbbbb", "not json");
  for (const n of ["x.json", "aaaaaaaaaaaaaaaa.txt", "aaaaaaaaaaaaaaa.json", "aaaaaaaaaaaaaaaaa.json"])
    writeFileSync(join(dir.req, n), "x");
  writeFileSync(join(dir.req, ".dddddddddddddddd"), "x");
  symlinkSync(outside, join(dir.req, "llllllllllllllll.json"));
  mkdirSync(join(dir.req, "ffffffffffffffff.json"));
  await waitFor(() => c.counts().denied === 7);
  for (const n of ["bbbbbbbbbbbbbbbb", "llllllllllllllll", "ffffffffffffffff"])
    expect(readFileSync(join(dir.res, n), "utf8")).toBe(`deny\n${CHANNEL.unreadable}\n`);
  expect(readdirSync(dir.req)).toEqual([".dddddddddddddddd"]);
  expect(readdirSync(dir.res)).toHaveLength(3);
  expect(onCall).toHaveBeenCalledTimes(7);
  expect(onCall.mock.calls.every(([record]) => record.decision.tool === "unknown")).toBe(true);
  expect(readFileSync(outside, "utf8")).toBe("secret");
  expect(decide).not.toHaveBeenCalled();
});
test("a tool_use_id used twice is denied the second time, also when the first was denied", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const c = start(dir, (v) =>
    (v as { tool_use_id: string }).tool_use_id === "yes"
      ? allow()
      : { allow: false, tool: "Read", reason: "No." },
  );
  for (const [name, id] of [
    ["aaaaaaaaaaaaaaaa", "yes"],
    ["bbbbbbbbbbbbbbbb", "yes"],
    ["cccccccccccccccc", "no"],
    ["dddddddddddddddd", "no"],
  ]) {
    if (!name || !id) throw new Error("missing");
    request(dir, name, JSON.stringify({ tool_use_id: id }));
    await waitFor(() => existsSync(join(dir.res, name)));
  }
  for (const n of ["bbbbbbbbbbbbbbbb", "dddddddddddddddd"])
    expect(readFileSync(join(dir.res, n), "utf8")).toBe(`deny\n${CHANNEL.reused}\n`);
  expect([...c.allowedIds]).toEqual(["yes"]);
  expect(c.counts()).toEqual({ allowed: 1, denied: 3 });
});
test("a decide that throws denies the call, and after stop nothing is answered", {
  timeout: 20_000,
}, async () => {
  const dir = setup();
  const c = start(dir, () => {
    throw new Error("oops");
  });
  request(dir, "aaaaaaaaaaaaaaaa", "{}");
  await waitFor(() => existsSync(join(dir.res, "aaaaaaaaaaaaaaaa")));
  expect(readFileSync(join(dir.res, "aaaaaaaaaaaaaaaa"), "utf8")).toBe(`deny\n${CHANNEL.checkFailed}\n`);
  c.stop();
  request(dir, "bbbbbbbbbbbbbbbb", "{}");
  await new Promise((r) => setTimeout(r, 150));
  expect(existsSync(join(dir.res, "bbbbbbbbbbbbbbbb"))).toBe(false);
  expect(existsSync(join(dir.req, "bbbbbbbbbbbbbbbb.json"))).toBe(true);
});
test("removing the folder under a waiting hook blocks the call and the channel writes nothing and does not throw", {
  timeout: 20_000,
}, async () => {
  const dir = setup(5);
  const onCall = vi.fn();
  start(dir, allow, onCall, 1000);
  const child = spawn("/bin/sh", ["-c", hookCommand(dir.path, false)], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end("{}");
  const result = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await waitFor(() => readdirSync(dir.req).some((n) => n.endsWith(".json")));
  const removedAt = performance.now();
  removeControlDir(dir);
  expect(await result).toBe(2);
  expect(performance.now() - removedAt).toBeLessThan(2000);
  await new Promise((r) => setTimeout(r, 1100));
  expect(onCall).not.toHaveBeenCalled();
  expect(existsSync(dir.path)).toBe(false);
});

test("a request that cannot be removed is decided and counted once", { timeout: 20_000 }, async () => {
  const dir = setup();
  const onCall = vi.fn();
  const decide = vi.fn(allow);
  const child = spawn("/bin/sh", ["-c", hookCommand(dir.path, false)], {
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({ tool_use_id: "t1" }));
  const result = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  await waitFor(() => readdirSync(dir.req).some((name) => name.endsWith(".json")));
  chmodSync(dir.req, 0o500);
  try {
    const c = start(dir, decide, onCall, 20);
    expect(await result).toBe(0);
    expect(readdirSync(dir.req).some((name) => name.endsWith(".json"))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(c.counts()).toEqual({ allowed: 1, denied: 0 });
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(1);
  } finally {
    chmodSync(dir.req, 0o700);
  }
});
