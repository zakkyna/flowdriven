import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification, nativeTheme } from "electron";
import { type Appearance, createAppearance } from "./appearance";
import languages from "./languages.json";
import { electronNoticeHandler, noticeWord } from "./notifier";
import { startRunnerBridge } from "./runner-bridge";
import { APP_ORIGIN } from "./security";
import {
  createMainWindow,
  lockDownSession,
  registerAppScheme,
  registerWebContentsSecurity,
  serveApp,
} from "./window";

export type MainWindowLike = {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
};

export type MainAppLike = {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<void>;
  on(event: "second-instance", listener: () => void): unknown;
  on(event: "before-quit", listener: (event: { preventDefault(): void }) => void): unknown;
  on(event: "activate", listener: () => void): unknown;
  on(event: "window-all-closed", listener: () => void): unknown;
};

export type StartMainDeps = {
  app: MainAppLike;
  BrowserWindow: {
    getAllWindows(): MainWindowLike[];
  };
  nativeTheme: {
    themeSource: "light" | "system" | "dark";
  };
  appearance: Pick<Appearance, "load" | "track">;
  createWindow: (options?: { hash?: string }) => MainWindowLike;
  startBridge: () => { stop(): Promise<void> };
  onReady?: () => void;
  platform?: NodeJS.Platform;
};

export function startMain(deps: StartMainDeps): Promise<void> {
  if (!deps.app.requestSingleInstanceLock()) {
    deps.app.quit();
    return Promise.resolve();
  }

  let stopping = false;
  deps.app.on("second-instance", () => {
    const window = deps.BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  deps.app.on("window-all-closed", () => {
    if ((deps.platform ?? process.platform) !== "darwin") deps.app.quit();
  });

  return deps.app.whenReady().then(() => {
    deps.onReady?.();
    const { colorMode } = deps.appearance.load();
    if (deps.nativeTheme.themeSource !== colorMode) {
      deps.nativeTheme.themeSource = colorMode;
    }
    const bridge = deps.startBridge();
    deps.app.on("before-quit", (event) => {
      if (stopping) return;
      stopping = true;
      event.preventDefault();
      void bridge.stop().then(() => deps.app.quit());
    });
    const openWindow = (options?: { hash?: string }) => {
      const window = deps.createWindow(options);
      deps.appearance.track(window);
      return window;
    };
    openWindow();
    deps.app.on("activate", () => {
      if (deps.BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });
}

if (typeof process.versions.electron === "string") {
  registerAppScheme();
  registerWebContentsSecurity();
  const preloadPath = path.join(__dirname, "preload.js");
  const appearance = createAppearance({
    fs: { readFileSync, mkdir, writeFile, rename, rm },
    nativeTheme,
    userDataDir: app.getPath("userData"),
  });
  void startMain({
    app,
    BrowserWindow,
    nativeTheme,
    appearance,
    createWindow: (options) =>
      createMainWindow({ preloadPath, show: true, runner: true, hash: options?.hash }),
    onReady: () => {
      lockDownSession();
      serveApp(path.join(__dirname, "../dist"));
    },
    startBridge: () => {
      const onNotice = electronNoticeHandler({
        Notification,
        words: noticeWord,
        windows: () => BrowserWindow.getAllWindows(),
        open: (hash) => {
          const window = BrowserWindow.getAllWindows()[0];
          if (!window) {
            const created = createMainWindow({ preloadPath, show: true, runner: true, hash });
            appearance.track(created);
            return;
          }
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
          void window.loadURL(`${APP_ORIGIN}/index.html#${hash}`);
        },
      });
      return startRunnerBridge({
        ipc: ipcMain,
        languages,
        onNotice,
        spawn: (command, args, options) => spawn(command, args, options),
        env: process.env,
        appData: app.getPath("appData"),
        dirname: __dirname,
        windows: () => BrowserWindow.getAllWindows(),
      });
    },
  });
}
