import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  auditCounts,
  CONNECTOR_WALK_FLOW,
  CONNECTOR_WALK_FLOW_ID,
  CONNECTOR_WALK_README,
  CONNECTOR_WALK_STEPS,
  connectorWalkPaths,
  inboxHash,
  isRunInState,
  runHash,
} from "./connector-walk-steps";
import { pageHasAll, stepFileName, waitForLoad } from "./demo-walk-steps";
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
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const positive = (text: string | undefined, fallback: number) => {
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const PRESS_ALLOW = `(() => { const button = Array.from(document.querySelectorAll('button')).find(n => n.textContent?.trim() === 'Allow'); if (!(button instanceof HTMLElement) || button.hasAttribute('disabled')) return false; button.click(); return true; })()`;
void app
  .whenReady()
  .then(async () => {
    lockDownSession();
    serveApp(path.join(__dirname, "../dist"));
    const { output, dataDir, flowDir } = connectorWalkPaths(path.resolve(__dirname, "../../.."));
    await rm(output, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await mkdir(flowDir, { recursive: true });
    await writeFile(path.join(flowDir, "flow.yaml"), CONNECTOR_WALK_FLOW);
    await writeFile(path.join(flowDir, "README.md"), CONNECTOR_WALK_README);
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
      await bridge.link.call("harnesses.rescan", {});
      await bridge.link.call("harnesses.setConsent", { harnessId: "claude-code", consent: "given" });
      const first = CONNECTOR_WALK_STEPS.at(0);
      const second = CONNECTOR_WALK_STEPS.at(1);
      if (!first || !second) throw new Error("Walk steps are missing.");
      const preloadPath = path.join(__dirname, "preload.js");
      async function capture(window: BrowserWindow, name: string, waitFor: string[], index: number) {
        const until = Date.now() + 10_000;
        while (Date.now() < until) {
          const body = (await window.webContents.executeJavaScript(
            'document.body?.innerText ?? ""',
          )) as string;
          if (pageHasAll(body, waitFor)) {
            await writeFile(
              path.join(output, stepFileName(index, name)),
              (await window.webContents.capturePage()).toPNG(),
            );
            return;
          }
          await delay(100);
        }
        throw new Error(`Walk step ${name} did not become ready.`);
      }
      const window = createMainWindow({ preloadPath, show: true, runner: true, hash: first.hash.slice(1) });
      await waitForLoad(window.webContents, 10_000);
      await capture(window, first.name, first.waitFor, 0);
      if ((await window.webContents.executeJavaScript(PRESS_ALLOW)) !== true)
        throw new Error("Could not press Allow.");
      await capture(window, second.name, second.waitFor, 1);
      window.close();
      const started = await bridge.link.call("flows.run", { flowId: CONNECTOR_WALK_FLOW_ID });
      const runId =
        typeof started === "object" && started !== null && "id" in started && typeof started.id === "string"
          ? started.id
          : undefined;
      if (!runId) throw new Error("The run did not start.");
      const until = Date.now() + positive(process.env.CONNECTOR_WALK_WAIT_MS, 180_000);
      const terminal = ["done", "failed", "blocked", "interrupted", "cancelled"];
      let held = false;
      while (Date.now() < until) {
        const runs = await bridge.link.call("runs.list", {});
        if (!Array.isArray(runs)) throw new Error("Invalid runs list.");
        if (isRunInState(runs, runId, ["waiting_approval"])) {
          held = true;
          break;
        }
        if (isRunInState(runs, runId, terminal)) throw new Error("The run ended before the held call.");
        await delay(1000);
      }
      if (!held) throw new Error("Timed out waiting for the held call.");
      const approvals = await bridge.link.call("approvals.list", { state: "pending" });
      if (!Array.isArray(approvals)) throw new Error("Invalid approvals list.");
      const approval: unknown = approvals.find(
        (row: unknown) =>
          typeof row === "object" &&
          row !== null &&
          "kind" in row &&
          row.kind === "risky_action" &&
          "runId" in row &&
          row.runId === runId,
      );
      if (!approval || typeof approval !== "object" || !("id" in approval) || typeof approval.id !== "string")
        throw new Error("Missing held approval.");
      const approvalId = approval.id;
      for (const [index, hash, name] of [
        [2, runHash(runId), "run-held"],
        [3, inboxHash(approvalId), "inbox-held"],
      ] as const) {
        const view = createMainWindow({ preloadPath, show: true, runner: true, hash: hash.slice(1) });
        await waitForLoad(view.webContents, 10_000);
        await capture(view, name, [name === "inbox-held" ? "Hold test" : "Gmail check"], index);
        view.close();
      }
      await bridge.link.call("approvals.resolve", { approvalId, decision: "reject" });
      let state = "";
      while (Date.now() < until) {
        const runs: unknown = await bridge.link.call("runs.list", {});
        if (!Array.isArray(runs)) throw new Error("Invalid runs list.");
        const row: unknown = runs.find(
          (candidate: unknown) =>
            typeof candidate === "object" &&
            candidate !== null &&
            "id" in candidate &&
            candidate.id === runId,
        );
        if (
          row &&
          typeof row === "object" &&
          "state" in row &&
          typeof row.state === "string" &&
          terminal.includes(row.state)
        ) {
          state = row.state;
          break;
        }
        await delay(1000);
      }
      if (!state) throw new Error("Timed out waiting for the run to end.");
      const audit = await bridge.link.call("audit.list", { runId });
      process.stdout.write(
        `run ${runId} held\nrun ${runId} ended ${state}\n${auditCounts(audit, ["connector_call", "call_held", "tool_denied"])}\nPictures: ${output}\n`,
      );
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
