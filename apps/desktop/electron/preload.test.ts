import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { RUNNER_CALL_CHANNEL, RUNNER_EVENT_CHANNEL } from "./runner-ipc";

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), on: vi.fn(), remove: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: mocks.on, removeListener: mocks.remove },
}));
const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.clearAllMocks();
});
type Bridge = {
  kind: string;
  runner?: {
    call(method: string, input: object): unknown;
    subscribe(listener: (event: unknown) => void): () => void;
  };
};
async function load(flag: boolean): Promise<Bridge> {
  vi.resetModules();
  mocks.expose.mockClear();
  process.argv = flag
    ? [...originalArgv, "--flowdriven-runner=on"]
    : originalArgv.filter((arg) => arg !== "--flowdriven-runner=on");
  await import("./preload");
  expect(mocks.expose).toHaveBeenCalledWith("flowdrivenShell", expect.any(Object));
  return mocks.expose.mock.calls.at(0)?.at(1) as Bridge;
}
test("the bridge exists only with the runner flag and exposes only call and subscribe", async () => {
  const without = await load(false);
  expect(Object.keys(without)).toEqual(["kind"]);
  expect(Object.isFrozen(without)).toBe(true);
  const withRunner = await load(true);
  expect(Object.keys(withRunner)).toEqual(["kind", "runner"]);
  expect(Object.isFrozen(withRunner)).toBe(true);
  expect(Object.keys(withRunner.runner ?? {})).toEqual(["call", "subscribe"]);
  expect(Object.isFrozen(withRunner.runner)).toBe(true);
});
test("call invokes the channel with the method and the input and subscribe returns an unsubscribe", async () => {
  const shell = await load(true);
  const runner = shell.runner;
  expect(runner).toBeDefined();
  if (!runner) throw new Error("Missing runner");
  runner.call("flows.list", { x: 1 });
  expect(mocks.invoke).toHaveBeenCalledWith("runner:call", "flows.list", { x: 1 });
  const listener = vi.fn();
  const unsubscribe = runner.subscribe(listener);
  const handler = mocks.on.mock.calls.at(0)?.at(1) as (_event: unknown, event: unknown) => void;
  expect(mocks.on).toHaveBeenCalledWith("runner:event", handler);
  handler({ secret: true }, { type: "changed" });
  expect(listener).toHaveBeenCalledWith({ type: "changed" });
  unsubscribe();
  expect(mocks.remove).toHaveBeenCalledWith("runner:event", handler);
});
test("the channel names equal those of runner-ipc.ts", () => {
  const source = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  expect(source).toContain(`"${RUNNER_CALL_CHANNEL}"`);
  expect(source).toContain(`"${RUNNER_EVENT_CHANNEL}"`);
});
