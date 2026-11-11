import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { type ChildLike, RunnerLink } from "./runner-link";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn((_signal?: "SIGTERM" | "SIGKILL") => true);
}
// The link cuts a stderr line to 4,096 bytes only when the newline arrives;
// until then every chunk is concatenated onto one buffer, so a child that
// writes stderr without a newline grows Electron main's memory without limit
// (and copies the whole buffer per chunk).
test("review L1: a long stderr line without a newline keeps the link's buffer bounded", async () => {
  const child = new FakeChild();
  const lines: string[] = [];
  const link = new RunnerLink({
    spawn: () => child as ChildLike,
    execPath: "node",
    entry: "entry",
    dataDir: "/data",
    demo: false,
    env: {},
    onEvent: () => {},
    log: (line) => lines.push(line),
  });
  link.start();
  let largest = 0;
  const original = Buffer.concat;
  const spy = vi.spyOn(Buffer, "concat").mockImplementation((list, total) => {
    const result = original(list, total);
    largest = Math.max(largest, result.length);
    return result;
  });
  const chunk = Buffer.alloc(16_384, 0x61);
  for (let i = 0; i < 256; i++) child.stderr.write(chunk); // 4 MiB, no newline
  await new Promise((resolve) => setImmediate(resolve));
  spy.mockRestore();
  expect(largest).toBeLessThanOrEqual(64 * 1024);
  child.emit("exit", 0, null);
  await link.stop();
});
