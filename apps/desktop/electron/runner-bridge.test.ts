import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { startRunnerBridge } from "./runner-bridge";
import type { ChildLike } from "./runner-link";

function setup() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const spawn = vi.fn((): ChildLike => child);
  const handle = vi.fn();
  const send = vi.fn();
  const bridge = startRunnerBridge({
    ipc: { handle },
    spawn,
    env: { FLOWDRIVEN_DEMO: "1" },
    appData: "/a",
    dirname: "/r/apps/desktop/dist-electron",
    windows: () => [
      { isDestroyed: () => false, webContents: { mainFrame: { url: "app://flowdriven/index.html" }, send } },
    ],
  });
  return { child, spawn, handle, send, bridge };
}
test("uses the data folder, the demo flag and the runner entry of its environment", () => {
  const { spawn, bridge } = setup();
  const args = spawn.mock.calls.at(0)?.at(1) as string[] | undefined;
  expect(args?.at(0)).toMatch(/packages\/runner\/src\/main\.ts$/);
  expect(args?.slice(1)).toEqual(["--stdio", "--data-dir", "/a/FlowDriven-demo", "--demo"]);
  expect(bridge.dataDir).toBe("/a/FlowDriven-demo");
});
test("registers the call handler and forwards runner events to the windows", () => {
  const { handle, child, send } = setup();
  expect(handle).toHaveBeenCalledWith("runner:call", expect.any(Function));
  child.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "changed", topics: ["runs"] } })}\n`,
  );
  expect(send).toHaveBeenCalledWith("runner:event", { type: "changed", topics: ["runs"] });
});
test("stop ends the runner", async () => {
  const { bridge, child } = setup();
  const stop = bridge.stop();
  expect(child.stdin.writableEnded).toBe(true);
  child.emit("exit", 0, null);
  await expect(stop).resolves.toBeUndefined();
});
