import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import screens from "./screens.json";
import { createMainWindow, lockDownSession, registerAppScheme, serveApp } from "./window";

registerAppScheme();
void app
  .whenReady()
  .then(async () => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const output = path.resolve(__dirname, "../../../.workflow/scratch/screens");
    await mkdir(output, { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      for (const entry of screens) {
        const window = createMainWindow({
          preloadPath: path.join(__dirname, "preload.js"),
          show: process.env.FLOWDRIVEN_CAPTURE_SHOW === "1",
          theme,
          scenario: entry.scenario,
          hash: entry.hash,
        });
        const deadline = Date.now() + 10_000;
        let ready = false;
        while (Date.now() < deadline) {
          ready = (await window.webContents.executeJavaScript(
            `document.querySelector('[data-screen-ready="true"]') !== null`,
          )) as boolean;
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready) {
          console.error(`screen ${entry.name} never became ready`);
          app.exit(1);
          return;
        }
        const image = await window.webContents.capturePage();
        await writeFile(path.join(output, `${entry.name}-${theme}.png`), image.toPNG());
        window.close();
      }
    }
    console.log("captured 16 screens to .workflow/scratch/screens");
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
