import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { RUNNER_CALL_CHANNEL, RUNNER_EVENT_CHANNEL } from "./runner-ipc";
import {
  WINDOW_GET_PREFS_CHANNEL,
  WINDOW_OPEN_LINK_CHANNEL,
  WINDOW_QUIT_CHANNEL,
  WINDOW_SET_COLOR_MODE_CHANNEL,
} from "./window-api";

const mocks = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  remove: vi.fn(),
}));

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
    call(method: unknown, input: unknown): Promise<unknown>;
    subscribe(listener: (event: unknown) => void): () => void;
  };
  window: {
    getPrefs(): Promise<unknown>;
    setColorMode(mode: unknown): Promise<unknown>;
    openLink(url: unknown): Promise<unknown>;
    quit(): Promise<unknown>;
  };
};

async function load(flag: boolean): Promise<Bridge> {
  vi.resetModules();
  mocks.expose.mockClear();
  process.argv = flag
    ? [...originalArgv, "--flowdriven-runner=on"]
    : originalArgv.filter((arg) => arg !== "--flowdriven-runner=on");
  await import("./preload");
  expect(mocks.expose).toHaveBeenCalledTimes(1);
  expect(mocks.expose).toHaveBeenCalledWith("flowdrivenShell", expect.any(Object));
  return mocks.expose.mock.calls.at(0)?.at(1) as Bridge;
}

test("TC-IPC-01 TC-j28-39 preload exposes exactly one frozen object with the documented shape", async () => {
  const api = await load(true);
  expect(Object.keys(api)).toEqual(["kind", "runner", "window"]);
  expect(api.kind).toBe("electron");
  expect(Object.keys(api.runner ?? {})).toEqual(["call", "subscribe"]);
  expect(Object.keys(api.window)).toEqual(["getPrefs", "setColorMode", "openLink", "quit"]);

  for (const value of Object.values(api.runner ?? {})) {
    expect(typeof value).toBe("function");
  }
  for (const value of Object.values(api.window)) {
    expect(typeof value).toBe("function");
  }

  const forbidden = ["fs", "shell", "dialog", "process", "require", ["set", "Background"].join("")];
  for (const target of [api, api.runner, api.window]) {
    for (const key of forbidden) {
      expect(Object.hasOwn(target as object, key), key).toBe(false);
    }
  }
});

test("TC-IPC-02 the exposed object is frozen at every level", async () => {
  const api = await load(true);

  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.isFrozen(api.runner)).toBe(true);
  expect(Object.isFrozen(api.window)).toBe(true);

  expect(Object.getPrototypeOf(api)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(api.runner)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(api.window)).toBe(Object.prototype);

  const mutableApi = api as unknown as Record<string, unknown>;
  const mutableRunner = api.runner as unknown as Record<string, unknown>;
  const mutableWindow = api.window as unknown as Record<string, unknown>;
  const noop = () => {};

  expect(() => {
    mutableApi.kind = "x";
  }).toThrow(TypeError);
  expect(() => {
    mutableApi.extra = 1;
  }).toThrow(TypeError);
  expect(() => {
    delete mutableApi.runner;
  }).toThrow(TypeError);
  expect(() => {
    mutableRunner.call = noop;
  }).toThrow(TypeError);
  expect(() => {
    mutableWindow.hack = noop;
  }).toThrow(TypeError);
  expect(() => {
    mutableWindow.openLink = noop;
  }).toThrow(TypeError);
});

test("TC-IPC-03 without the runner flag there is no runner, but the window API stays", async () => {
  const api = await load(false);
  expect(Object.keys(api)).toEqual(["kind", "window"]);
  expect(api.runner).toBeUndefined();
  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.isFrozen(api.window)).toBe(true);
  expect(Object.keys(api.window)).toEqual(["getPrefs", "setColorMode", "openLink", "quit"]);
  for (const value of Object.values(api.window)) {
    expect(typeof value).toBe("function");
  }
});

test("TC-IPC-04 each window function uses its own channel and the right arguments", async () => {
  mocks.invoke.mockResolvedValue({ ok: true, result: {} });
  const api = await load(true);
  const runner = api.runner;
  if (!runner) throw new Error("Missing runner");

  await api.window.getPrefs();
  await api.window.setColorMode("dark");
  await api.window.openLink("https://example.com/a");
  await api.window.quit();
  await runner.call("flows.list", {});

  expect(mocks.invoke.mock.calls).toEqual([
    ["window:getPrefs"],
    ["window:setColorMode", "dark"],
    ["window:openLink", "https://example.com/a"],
    ["window:quit"],
    ["runner:call", "flows.list", {}],
  ]);
});

test("TC-IPC-05 the preload knows no other channel", async () => {
  mocks.invoke.mockResolvedValue({ ok: true, result: {} });
  const api = await load(true);
  const runner = api.runner;
  if (!runner) throw new Error("Missing runner");

  await api.window.getPrefs();
  await api.window.setColorMode("dark");
  await api.window.openLink("https://example.com/a");
  await api.window.quit();
  await runner.call("flows.list", {});
  const unsubscribe = runner.subscribe(() => {});
  unsubscribe();

  const usedChannels = new Set<string>([
    ...mocks.invoke.mock.calls.map((args) => args[0] as string),
    ...mocks.on.mock.calls.map((args) => args[0] as string),
    ...mocks.remove.mock.calls.map((args) => args[0] as string),
  ]);
  const expectedChannels = new Set<string>([
    RUNNER_CALL_CHANNEL,
    RUNNER_EVENT_CHANNEL,
    WINDOW_GET_PREFS_CHANNEL,
    WINDOW_SET_COLOR_MODE_CHANNEL,
    WINDOW_OPEN_LINK_CHANNEL,
    WINDOW_QUIT_CHANNEL,
  ]);
  expect(usedChannels).toEqual(expectedChannels);
  expect(expectedChannels).toEqual(
    new Set([
      "runner:call",
      "runner:event",
      "window:getPrefs",
      "window:setColorMode",
      "window:openLink",
      "window:quit",
    ]),
  );

  const source = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  const literalChannels = new Set<string>();
  for (const match of source.matchAll(/["']([^"'\n]+)["']/g)) {
    const candidate = match[1];
    if (candidate && /^[a-z]+:[A-Za-z]+$/.test(candidate)) {
      literalChannels.add(candidate);
    }
  }
  expect(literalChannels).toEqual(expectedChannels);
});

test("TC-IPC-06 subscribe passes only the payload and unsubscribes the same listener", async () => {
  const api = await load(true);
  const runner = api.runner;
  if (!runner) throw new Error("Missing runner");

  const listener = vi.fn();
  const unsubscribe = runner.subscribe(listener);

  expect(mocks.on).toHaveBeenCalledTimes(1);
  const handler = mocks.on.mock.calls.at(0)?.at(1) as (_event: unknown, event: unknown) => void;
  expect(mocks.on).toHaveBeenCalledWith("runner:event", handler);

  const payload = { type: "changed", topics: ["flows"] };
  handler({ sender: { id: 1 }, secret: true }, payload);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]).toEqual([payload]);

  unsubscribe();
  unsubscribe();
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect(mocks.remove).toHaveBeenCalledWith("runner:event", handler);

  for (const badListener of [null, "x", {}]) {
    expect(() => runner.subscribe(badListener as never)).toThrow(TypeError);
  }
  expect(mocks.on).toHaveBeenCalledTimes(1);
});

test("TC-IPC-07 the preload refuses a method that is not a string or an input that is not a plain object", async () => {
  mocks.invoke.mockResolvedValue({ ok: true, result: {} });
  const api = await load(true);
  const runner = api.runner;
  if (!runner) throw new Error("Missing runner");

  for (const [method, input] of [
    [5, {}],
    ["flows.list", []],
    ["flows.list", null],
    ["flows.list", "x"],
    ["flows.list", new Map()],
  ] as const) {
    const reply = await runner.call(method, input);
    expect(reply).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  }
  expect(mocks.invoke).not.toHaveBeenCalled();

  await runner.call("flows.list", {});
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith("runner:call", "flows.list", {});
});
