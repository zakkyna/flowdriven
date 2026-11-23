import { spawn } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification } from "electron";
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

registerAppScheme();
registerWebContentsSecurity();
let stopping = false;
const preloadPath = path.join(__dirname, "preload.js");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  void app.whenReady().then(() => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const onNotice = electronNoticeHandler({
      Notification,
      words: noticeWord,
      windows: () => BrowserWindow.getAllWindows(),
      open: (hash) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) {
          createMainWindow({ preloadPath, show: true, runner: true, hash });
          return;
        }
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        void window.loadURL(`${APP_ORIGIN}/index.html#${hash}`);
      },
    });
    const bridge = startRunnerBridge({
      ipc: ipcMain,
      languages,
      onNotice,
      spawn: (command, args, options) => spawn(command, args, options),
      env: process.env,
      appData: app.getPath("appData"),
      dirname: __dirname,
      windows: () => BrowserWindow.getAllWindows(),
    });
    app.on("before-quit", (event) => {
      if (stopping) return;
      stopping = true;
      event.preventDefault();
      void bridge.stop().then(() => app.quit());
    });
    createMainWindow({ preloadPath, show: true, runner: true });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0)
        createMainWindow({ preloadPath, show: true, runner: true });
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
