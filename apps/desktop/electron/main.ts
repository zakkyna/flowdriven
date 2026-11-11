import { spawn } from "node:child_process";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { startRunnerBridge } from "./runner-bridge";
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
    const bridge = startRunnerBridge({
      ipc: ipcMain,
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
