import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { pageHasAll, stepFileName, waitForLoad } from "./demo-walk-steps";
import { electronNoticeHandler } from "./notifier";
import { startRunnerBridge } from "./runner-bridge";
import { APP_ORIGIN } from "./security";
import { isTriggeredRunDone, TRIGGER_WALK_STEPS, triggerWalkPaths } from "./trigger-walk-steps";
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
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const positive = (text: string | undefined, fallback: number) => {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const preloadPath = path.join(__dirname, "preload.js");

void app
  .whenReady()
  .then(async () => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const { output, dataDir, flowDir } = triggerWalkPaths(path.resolve(__dirname, "../../.."));
    await mkdir(output, { recursive: true });
    const env: Record<string, string | undefined> = { ...process.env, FLOWDRIVEN_DATA_DIR: dataDir };
    delete env.FLOWDRIVEN_DEMO;
    const showNotice = electronNoticeHandler({
      Notification,
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
    // The chair reads this line as evidence that a notice reached the macOS notification call.
    const onNotice = (value: unknown) => {
      const kind = typeof value === "object" && value !== null && "kind" in value ? value.kind : undefined;
      const word = typeof kind === "string" && /^[a-z_]{1,30}$/.test(kind) ? kind : "unknown";
      const focused = BrowserWindow.getAllWindows().some((window) => window.isFocused());
      process.stdout.write(
        `notice ${word}: notifications supported ${Notification.isSupported()}, window focused ${focused}\n`,
      );
      showNotice(value);
    };
    const bridge = startRunnerBridge({
      ipc: ipcMain,
      spawn: (command, args, options) => spawn(command, args, options),
      env,
      appData: app.getPath("appData"),
      dirname: __dirname,
      windows: () => BrowserWindow.getAllWindows(),
      onNotice,
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
      const before = await bridge.link.call("runs.list", {});
      const previous = new Set(
        Array.isArray(before)
          ? before.flatMap((run: unknown) =>
              typeof run === "object" && run !== null && "id" in run && typeof run.id === "string"
                ? [run.id]
                : [],
            )
          : [],
      );
      const first = TRIGGER_WALK_STEPS.at(0);
      const second = TRIGGER_WALK_STEPS.at(1);
      const third = TRIGGER_WALK_STEPS.at(2);
      if (!first || !second || !third) throw new Error("Walk steps are missing.");
      const window = createMainWindow({ preloadPath, show: true, runner: true, hash: first.hash.slice(1) });
      await waitForLoad(window.webContents, 10_000);
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
      await capture(window, first, 0);
      const clicked = await window.webContents.executeJavaScript(
        `(() => { const row = Array.from(document.querySelectorAll('li')).find(n => n.querySelector('strong')?.textContent === 'Schedule'); const button = row?.querySelector('[role="switch"][aria-checked="false"]'); if (!(button instanceof HTMLElement) || button.hasAttribute('disabled')) return false; button.click(); return true; })()`,
      );
      if (clicked !== true) throw new Error("Could not turn on the schedule.");
      await capture(window, second, 1);
      window.close();
      // TRIGGER_WALK_RUNS and TRIGGER_WALK_WAIT_MS let the chair watch several real slots (plan 04, Task 18, step 4).
      const wanted = positive(process.env.TRIGGER_WALK_RUNS, 1);
      const waitMs = positive(process.env.TRIGGER_WALK_WAIT_MS, 240_000);
      const until = Date.now() + waitMs;
      const finished = new Set<string>();
      while (Date.now() < until && finished.size < wanted) {
        const result = await bridge.link.call("runs.list", {});
        if (!Array.isArray(result)) throw new Error("Invalid runs list.");
        const list: unknown[] = result;
        for (const run of list) {
          if (
            typeof run === "object" &&
            run !== null &&
            "id" in run &&
            typeof run.id === "string" &&
            !previous.has(run.id) &&
            !finished.has(run.id) &&
            "flowId" in run &&
            run.flowId === "local.claude-code-check" &&
            "state" in run &&
            typeof run.state === "string" &&
            isTriggeredRunDone([run])
          ) {
            finished.add(run.id);
            process.stdout.write(`run ${run.id} started by schedule: ${run.state}\n`);
            const started =
              "startedAt" in run && typeof run.startedAt === "string" ? run.startedAt : "unknown";
            process.stdout.write(`  started ${started}, seen ${new Date().toISOString()}\n`);
          }
        }
        if (finished.size < wanted) await delay(waitMs > 600_000 ? 5000 : 1000);
      }
      if (finished.size < wanted) throw new Error("Timed out waiting for a triggered run.");
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
