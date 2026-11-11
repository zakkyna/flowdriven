import { spawn } from "node:child_process";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { formatConsoleErrors, recordConsoleError } from "./capture-diagnostics";
import {
  actionScript,
  formatStepFailure,
  pageHasAll,
  stepFileName,
  WALK_STEPS,
  waitForLoad,
} from "./demo-walk-steps";
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
app.on("window-all-closed", () => {});
void app
  .whenReady()
  .then(async () => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const output = path.resolve(__dirname, "../../../.workflow/scratch/demo-walk");
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const log = path.join(output, "walk.log");
    const env = { ...process.env, FLOWDRIVEN_DEMO: "1", FLOWDRIVEN_DATA_DIR: path.join(output, "data") };
    const bridge = startRunnerBridge({
      ipc: ipcMain,
      spawn: (command, args, options) => spawn(command, args, options),
      env,
      appData: app.getPath("appData"),
      dirname: __dirname,
      windows: () => BrowserWindow.getAllWindows(),
    });
    try {
      const window = createMainWindow({
        preloadPath: path.join(__dirname, "preload.js"),
        show: process.env.FLOWDRIVEN_CAPTURE_SHOW === "1",
        runner: true,
        theme: "light",
      });
      const errors: { screen: string; message: string }[] = [];
      let currentStep = "sidebar";
      window.webContents.on("console-message", (event) => recordConsoleError(errors, currentStep, event));
      try {
        await waitForLoad(window.webContents, 10_000);
      } catch (error) {
        await appendFile(log, `${error instanceof Error ? error.message : String(error)}\n`);
        await bridge.stop();
        app.exit(1);
        return;
      }
      for (const [index, step] of WALK_STEPS.entries()) {
        currentStep = step.name;
        let acted = false;
        let deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          acted = (await window.webContents.executeJavaScript(actionScript(step.action))) as boolean;
          if (acted) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let body = "";
        let ready = false;
        deadline = Date.now() + 10_000;
        while (acted && Date.now() < deadline) {
          body = (await window.webContents.executeJavaScript('document.body?.innerText ?? ""')) as string;
          if (pageHasAll(body, step.waitFor)) {
            ready = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready) {
          body = (await window.webContents.executeJavaScript('document.body?.innerText ?? ""')) as string;
          const failure = formatStepFailure(step.name, window.webContents.getURL(), body);
          console.error(failure);
          await appendFile(log, `${failure}\n`);
          await bridge.stop();
          app.exit(1);
          return;
        }
        if (step.shot) {
          const image = await window.webContents.capturePage();
          await writeFile(path.join(output, stepFileName(index, step.name)), image.toPNG());
        }
        await appendFile(log, `${new Date().toISOString()} ${step.name} ok\n`);
      }
      await bridge.stop();
      if (errors.length > 0) {
        for (const error of formatConsoleErrors(errors)) {
          console.error(error);
          await appendFile(log, `${error}\n`);
        }
        app.exit(1);
        return;
      }
      await appendFile(log, "runner stopped\n");
      app.exit(0);
    } catch (error: unknown) {
      await bridge.stop();
      throw error;
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
