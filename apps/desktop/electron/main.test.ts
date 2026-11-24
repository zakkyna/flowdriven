import path from "node:path";
import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    getPath: vi.fn(() => "U"),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  nativeTheme: {
    themeSource: "system",
    shouldUseDarkColors: false,
    on: vi.fn(),
  },
  Notification: class {},
  shell: {
    openExternal: vi.fn(),
  },
}));

import { createAppearance } from "./appearance";
import { type MainAppLike, startMain } from "./main";
import type { FrameLike } from "./runner-ipc";
import { fakeFs, fakeNativeTheme, fakeWindow } from "./test-helpers/fakes";
import { WINDOW_CHANNELS } from "./window-api";
import { windowBackground } from "./window-colors";

type AppEventMap = {
  "second-instance": (() => void)[];
  "before-quit": ((event: { preventDefault(): void }) => void)[];
  activate: (() => void)[];
  "window-all-closed": (() => void)[];
};

function createFakeApp(options?: { singleInstanceLock?: boolean }) {
  const listeners: AppEventMap = {
    "second-instance": [],
    "before-quit": [],
    activate: [],
    "window-all-closed": [],
  };
  const quit = vi.fn();
  const app: MainAppLike = {
    requestSingleInstanceLock: () => options?.singleInstanceLock ?? true,
    quit,
    whenReady: () => Promise.resolve(),
    on(event: keyof AppEventMap, listener: never) {
      listeners[event].push(listener);
      return app;
    },
  };
  return { app, listeners, quit };
}

test("TC-ELE-11 TC-j12-04 startMain loads saved color mode and sets themeSource before creating the first window", async () => {
  const windowPath = path.join("U", "window.json");
  const fs = fakeFs({
    files: { [windowPath]: JSON.stringify({ version: 1, colorMode: "dark" }) },
  });
  const callLog: string[] = [];
  const nativeTheme = fakeNativeTheme({
    themeSource: "system",
    shouldUseDarkColors: false,
    onThemeSource: (value) => {
      callLog.push(`nativeTheme.themeSource = "${value}"`);
    },
  });
  const realAppearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });
  const appearance = {
    load() {
      callLog.push("appearance.load");
      return realAppearance.load();
    },
    set: realAppearance.set,
    track: realAppearance.track,
  };

  const createdWindows: ReturnType<typeof fakeWindow>[] = [];
  let initialBackground = "";
  const linkCall = vi.fn();
  const { app } = createFakeApp();

  await startMain({
    app,
    BrowserWindow: { getAllWindows: () => createdWindows },
    nativeTheme,
    appearance,
    createWindow: () => {
      callLog.push("createWindow");
      initialBackground = windowBackground(nativeTheme.shouldUseDarkColors);
      const win = fakeWindow();
      createdWindows.push(win);
      return win;
    },
    startBridge: () => ({
      stop: async () => {},
    }),
  });

  expect(callLog).toEqual(["appearance.load", 'nativeTheme.themeSource = "dark"', "createWindow"]);
  expect(initialBackground).toBe(windowBackground(true));
  expect(createdWindows).toHaveLength(1);
  expect(createdWindows[0]?.backgroundColors).toEqual(["#212121"]);
  expect(linkCall).not.toHaveBeenCalled();

  nativeTheme.shouldUseDarkColors = false;
  nativeTheme.emitUpdated();
  expect(createdWindows[0]?.backgroundColors).toEqual(["#212121", "#ffffff"]);
});

test("startMain keeps single-instance, activate, before-quit and window-all-closed lifecycle", async () => {
  const refused = createFakeApp({ singleInstanceLock: false });
  const refusedWhenReady = vi.fn(() => Promise.resolve());
  refused.app.whenReady = refusedWhenReady;
  await startMain({
    app: refused.app,
    BrowserWindow: { getAllWindows: () => [] },
    nativeTheme: fakeNativeTheme(),
    appearance: { load: () => ({ colorMode: "system" }), set: async () => "system", track: () => {} },
    createWindow: () => fakeWindow(),
    startBridge: () => ({ stop: async () => {} }),
  });
  expect(refused.quit).toHaveBeenCalledOnce();
  expect(refusedWhenReady).not.toHaveBeenCalled();

  const events: string[] = [];
  const { app, listeners, quit } = createFakeApp();
  const windows: ReturnType<typeof fakeWindow>[] = [];
  let resolveStop: (() => void) | undefined;

  await startMain({
    app,
    BrowserWindow: { getAllWindows: () => windows },
    nativeTheme: fakeNativeTheme(),
    appearance: createAppearance({ fs: fakeFs(), nativeTheme: fakeNativeTheme(), userDataDir: "U" }),
    createWindow: () => {
      const win = fakeWindow({ minimized: true });
      windows.push(win);
      return win;
    },
    startBridge: () => {
      events.push("startBridge");
      expect(listeners["before-quit"]).toHaveLength(0);
      return {
        stop: () =>
          new Promise<void>((resolve) => {
            events.push("bridge.stop");
            resolveStop = resolve;
          }),
      };
    },
    platform: "darwin",
  });

  expect(events).toEqual(["startBridge"]);
  expect(listeners["before-quit"]).toHaveLength(1);

  listeners["second-instance"][0]?.();
  expect(windows[0]?.isMinimized()).toBe(false);
  expect(windows[0]?.isFocused()).toBe(true);

  listeners["window-all-closed"][0]?.();
  expect(quit).not.toHaveBeenCalled();

  windows.length = 0;
  listeners.activate[0]?.();
  expect(windows).toHaveLength(1);
  expect(windows[0]?.backgroundColors).toEqual(["#ffffff"]);

  const preventDefault = vi.fn();
  listeners["before-quit"][0]?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(events).toEqual(["startBridge", "bridge.stop"]);
  expect(quit).not.toHaveBeenCalled();

  resolveStop?.();
  await Promise.resolve();
  expect(quit).toHaveBeenCalledOnce();

  listeners["before-quit"][0]?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();

  const linux = createFakeApp();
  await startMain({
    app: linux.app,
    BrowserWindow: { getAllWindows: () => [] },
    nativeTheme: fakeNativeTheme(),
    appearance: { load: () => ({ colorMode: "system" }), set: async () => "system", track: () => {} },
    createWindow: () => fakeWindow(),
    startBridge: () => ({ stop: async () => {} }),
    platform: "linux",
  });
  linux.listeners["window-all-closed"][0]?.();
  expect(linux.quit).toHaveBeenCalledOnce();
});

test("TC-ELE-26 startMain registers the four window API channels once, not per window", async () => {
  const { app, listeners, quit } = createFakeApp();
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const handlers = new Map<string, (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown>();
  const ipc = {
    handle: vi.fn(
      (channel: string, listener: (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      },
    ),
  };

  await startMain({
    app,
    ipc,
    openLink: async () => ({ opened: true }),
    BrowserWindow: { getAllWindows: () => windows },
    nativeTheme: fakeNativeTheme(),
    appearance: createAppearance({ fs: fakeFs(), nativeTheme: fakeNativeTheme(), userDataDir: "U" }),
    createWindow: () => {
      const win = fakeWindow();
      windows.push(win);
      return win;
    },
    startBridge: () => ({ stop: async () => {} }),
    platform: "darwin",
  });

  expect(windows).toHaveLength(1);
  expect(ipc.handle).toHaveBeenCalledTimes(4);
  expect(ipc.handle.mock.calls.map((call) => call[0])).toEqual([...WINDOW_CHANNELS]);

  windows.length = 0;
  listeners.activate[0]?.();
  expect(windows).toHaveLength(1);
  expect(ipc.handle).toHaveBeenCalledTimes(4);

  const quitHandler = handlers.get("window:quit");
  if (!quitHandler) throw new Error("Missing window:quit handler");
  const ownFrame: FrameLike = { url: "app://flowdriven/index.html", parent: null };
  expect(await quitHandler({ senderFrame: ownFrame })).toEqual({ ok: true, result: {} });
  expect(quit).toHaveBeenCalledOnce();
});
