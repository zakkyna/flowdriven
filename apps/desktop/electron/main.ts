import path from "node:path";
import { app, BrowserWindow } from "electron";
import { createMainWindow, lockDownSession, registerAppScheme, serveApp } from "./window";

registerAppScheme();
const preloadPath = path.join(__dirname, "preload.js");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
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
    createMainWindow({ preloadPath, show: true });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow({ preloadPath, show: true });
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
