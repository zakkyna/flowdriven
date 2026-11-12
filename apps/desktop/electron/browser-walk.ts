import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  BROWSER_WALK_FLOW,
  BROWSER_WALK_FLOW_ID,
  BROWSER_WALK_README,
  BROWSER_WALK_STEPS,
  browserWalkPaths,
  isPageRunDone,
} from "./browser-walk-steps";
import { pageHasAll, stepFileName, waitForLoad } from "./demo-walk-steps";
import { startRunnerBridge } from "./runner-bridge";
import {
  createMainWindow,
  lockDownSession,
  registerAppScheme,
  registerWebContentsSecurity,
  serveApp,
} from "./window";

// The chair runs this walk with the owner's Chrome open (plan 05, Task 29). It reads only https://example.com/.
registerAppScheme();
registerWebContentsSecurity();
app.on("window-all-closed", () => {});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const positive = (text: string | undefined, fallback: number) => {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const preloadPath = path.join(__dirname, "preload.js");
const PRESS_ALLOW = `(() => { const button = Array.from(document.querySelectorAll('button')).find(n => n.textContent?.trim() === 'Allow'); if (!(button instanceof HTMLElement) || button.hasAttribute('disabled')) return false; button.click(); return true; })()`;

void app
  .whenReady()
  .then(async () => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const { output, dataDir, flowDir } = browserWalkPaths(path.resolve(__dirname, "../../.."));
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await mkdir(flowDir, { recursive: true });
    await writeFile(path.join(flowDir, "flow.yaml"), BROWSER_WALK_FLOW);
    await writeFile(path.join(flowDir, "README.md"), BROWSER_WALK_README);
    const env: Record<string, string | undefined> = { ...process.env, FLOWDRIVEN_DATA_DIR: dataDir };
    delete env.FLOWDRIVEN_DEMO;
    const bridge = startRunnerBridge({
      ipc: ipcMain,
      spawn: (command, args, options) => spawn(command, args, options),
      env,
      appData: app.getPath("appData"),
      dirname: __dirname,
      windows: () => BrowserWindow.getAllWindows(),
    });
    try {
      const deadline = Date.now() + 10_000;
      let imported = false;
      while (Date.now() < deadline) {
        try {
          const result = await bridge.link.call("flows.import", { path: flowDir });
          if (typeof result === "object" && result !== null && "flow" in result && result.flow) {
            imported = true;
            break;
          }
        } catch {}
        await delay(500);
      }
      if (!imported) throw new Error("Could not import the check flow.");
      const first = BROWSER_WALK_STEPS.at(0);
      const second = BROWSER_WALK_STEPS.at(1);
      const third = BROWSER_WALK_STEPS.at(2);
      if (!first || !second || !third) throw new Error("Walk steps are missing.");
      async function capture(target: BrowserWindow, step: NonNullable<typeof first>, index: number) {
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          const body = (await target.webContents.executeJavaScript(
            'document.body?.innerText ?? ""',
          )) as string;
          if (pageHasAll(body, step.waitFor)) {
            if (step.shot)
              await writeFile(
                path.join(output, stepFileName(index, step.name)),
                (await target.webContents.capturePage()).toPNG(),
              );
            return;
          }
          await delay(100);
        }
        throw new Error(`Walk step ${step.name} did not become ready.`);
      }
      const window = createMainWindow({ preloadPath, show: true, runner: true, hash: first.hash.slice(1) });
      await waitForLoad(window.webContents, 10_000);
      await capture(window, first, 0);
      const allowed = await window.webContents.executeJavaScript(PRESS_ALLOW);
      if (allowed !== true) throw new Error("Could not press Allow.");
      await capture(window, second, 1);
      window.close();
      const started = await bridge.link.call("flows.run", { flowId: BROWSER_WALK_FLOW_ID });
      const runId =
        typeof started === "object" && started !== null && "id" in started && typeof started.id === "string"
          ? started.id
          : undefined;
      if (runId === undefined) throw new Error("The run did not start.");
      // BROWSER_WALK_WAIT_MS lets the chair allow for a slow Chrome (plan 05, Task 29).
      const until = Date.now() + positive(process.env.BROWSER_WALK_WAIT_MS, 180_000);
      let finalState = "";
      while (Date.now() < until && finalState === "") {
        const result = await bridge.link.call("runs.list", {});
        if (!Array.isArray(result)) throw new Error("Invalid runs list.");
        const list: unknown[] = result;
        const mine = list.filter(
          (run) => typeof run === "object" && run !== null && "id" in run && run.id === runId,
        );
        const run = mine.at(0);
        if (isPageRunDone(mine) && typeof run === "object" && run !== null && "state" in run)
          finalState = typeof run.state === "string" ? run.state : "unknown";
        else await delay(1000);
      }
      if (finalState === "") throw new Error("Timed out waiting for the page run.");
      process.stdout.write(`run ${runId} ended ${finalState}\n`);
      const runsWindow = createMainWindow({
        preloadPath,
        show: true,
        runner: true,
        hash: third.hash.slice(1),
      });
      await waitForLoad(runsWindow.webContents, 10_000);
      await capture(runsWindow, third, 2);
      process.stdout.write(`Pictures: ${output}\n`);
      await bridge.stop();
      app.exit(0);
    } catch (error) {
      await bridge.stop();
      throw error;
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
