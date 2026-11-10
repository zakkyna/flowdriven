import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { formatConsoleErrors, formatNotReady, recordConsoleError } from "./capture-diagnostics";
import screens from "./screens.json";
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
    const output = path.resolve(__dirname, "../../../.workflow/scratch/screens");
    await mkdir(output, { recursive: true });
    const errors: { screen: string; message: string }[] = [];
    for (const theme of ["light", "dark"] as const) {
      for (const entry of screens) {
        const window = createMainWindow({
          preloadPath: path.join(__dirname, "preload.js"),
          show: process.env.FLOWDRIVEN_CAPTURE_SHOW === "1",
          theme,
          scenario: entry.scenario,
          hash: entry.hash,
        });
        window.webContents.on("console-message", (event) =>
          recordConsoleError(errors, `${entry.name}-${theme}`, event),
        );
        const deadline = Date.now() + 10_000;
        let ready = false;
        while (Date.now() < deadline) {
          ready = (await window.webContents.executeJavaScript(
            `document.querySelector('[data-screen-ready="true"]') !== null && !Array.from(document.querySelectorAll('[role="status"]')).some((node) => node.textContent?.trim() === "Loading")`,
          )) as boolean;
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready) {
          const body = (await window.webContents.executeJavaScript(
            'document.body?.innerText ?? ""',
          )) as string;
          console.error(formatNotReady(entry.name, window.webContents.getURL(), body));
          app.exit(1);
          return;
        }
        const image = await window.webContents.capturePage();
        await writeFile(path.join(output, `${entry.name}-${theme}.png`), image.toPNG());
        window.close();
      }
    }
    if (errors.length > 0) {
      for (const error of formatConsoleErrors(errors)) console.error(error);
      app.exit(1);
      return;
    }
    console.log("captured 16 screens to .workflow/scratch/screens");
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
