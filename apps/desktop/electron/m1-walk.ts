import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification } from "electron";
import {
  M1_FLOW_ID,
  type M1_OPERATIONS,
  M1_WALK_STEPS,
  m1WalkPaths,
  runRequest,
  summaryLine,
  walkConfig,
} from "./m1-walk-steps";
import { electronNoticeHandler } from "./notifier";
import { startRunnerBridge } from "./runner-bridge";
import { APP_ORIGIN } from "./security";
import {
  createMainWindow,
  lockDownSession,
  registerAppScheme,
  registerWebContentsSecurity,
  serveApp,
} from "./window";

const config = walkConfig(process.env.M1_FLOW_DIR, process.env.M1_WALK_MODE);
if ("error" in config) {
  process.stderr.write(`${config.error}\n`);
  app.exit(1);
} else {
  registerAppScheme();
  registerWebContentsSecurity();
  app.on("window-all-closed", () => {});
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  void app
    .whenReady()
    .then(async () => {
      lockDownSession();
      serveApp(path.join(__dirname, "../dist"));
      const { dataDir, output } = m1WalkPaths(path.resolve(__dirname, "../../.."));
      if (config.mode === "attended") await rm(dataDir, { recursive: true, force: true });
      await mkdir(dataDir, { recursive: true });
      await mkdir(output, { recursive: true });
      const env: Record<string, string | undefined> = { ...process.env, FLOWDRIVEN_DATA_DIR: dataDir };
      delete env.FLOWDRIVEN_DEMO;
      const preloadPath = path.join(__dirname, "preload.js");
      const onNotice = electronNoticeHandler({
        Notification,
        windows: () => BrowserWindow.getAllWindows(),
        open: (hash) => {
          const target = BrowserWindow.getAllWindows()[0];
          if (!target) {
            createMainWindow({ preloadPath, show: true, runner: true, hash });
            return;
          }
          if (target.isMinimized()) target.restore();
          target.show();
          target.focus();
          void target.loadURL(`${APP_ORIGIN}/index.html#${hash}`);
        },
      });
      const bridge = startRunnerBridge({
        ipc: ipcMain,
        spawn: (command, args, options) => spawn(command, args, options),
        env,
        appData: app.getPath("appData"),
        dirname: __dirname,
        windows: () => BrowserWindow.getAllWindows(),
        onNotice,
      });
      const call = (operation: (typeof M1_OPERATIONS)[number], input: Record<string, unknown>) =>
        bridge.link.call(operation, input);
      const wait = async (label: string, ms: number, check: () => Promise<boolean>) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
          if (await check()) return;
          await delay(1000);
        }
        throw new Error(`Timed out waiting for ${label}.`);
      };
      try {
        await wait(M1_WALK_STEPS[0].waitFor, 10_000, async () => {
          try {
            await call("harnesses.rescan", {});
            return true;
          } catch {
            return false;
          }
        });
        const window = createMainWindow({
          preloadPath,
          show: true,
          runner: true,
          hash: "/harnesses",
        });
        await wait(M1_WALK_STEPS[1].waitFor, 600_000, async () => {
          const cards = await call("harnesses.list", {});
          return (
            Array.isArray(cards) &&
            cards.some(
              (card: unknown) =>
                typeof card === "object" &&
                card !== null &&
                "id" in card &&
                card.id === "claude-code" &&
                "consent" in card &&
                card.consent === "given",
            )
          );
        });
        const imported = await call("flows.import", { path: config.flowDir });
        if (
          typeof imported !== "object" ||
          imported === null ||
          !("flow" in imported) ||
          !imported.flow ||
          typeof imported.flow !== "object" ||
          !("manifest" in imported.flow) ||
          typeof imported.flow.manifest !== "object" ||
          imported.flow.manifest === null ||
          !("id" in imported.flow.manifest) ||
          imported.flow.manifest.id !== M1_FLOW_ID
        )
          throw new Error("Could not import the M1 flow.");
        await window.loadURL(`${APP_ORIGIN}/index.html#/builder/${M1_FLOW_ID}`);
        await wait(M1_WALK_STEPS[3].waitFor, 600_000, async () => {
          const caps = await call("flows.capabilities", { flowId: M1_FLOW_ID });
          return typeof caps === "object" && caps !== null && "consent" in caps && caps.consent === "given";
        });
        const existing = await call("runs.list", { flowId: M1_FLOW_ID });
        if (!Array.isArray(existing)) throw new Error("Invalid runs list.");
        const previous = new Set(
          existing.flatMap((row: unknown) =>
            typeof row === "object" && row !== null && "id" in row && typeof row.id === "string"
              ? [row.id]
              : [],
          ),
        );
        let runId = "";
        const request = runRequest(config.mode);
        if (request) {
          const started = await call("flows.run", request);
          if (
            typeof started !== "object" ||
            started === null ||
            !("id" in started) ||
            typeof started.id !== "string"
          )
            throw new Error("The run did not start.");
          runId = started.id;
        } else {
          await wait(M1_WALK_STEPS[4].waitFor, 7_200_000, async () => {
            const runs = await call("runs.list", { flowId: M1_FLOW_ID });
            if (!Array.isArray(runs)) throw new Error("Invalid runs list.");
            const run: unknown = runs.find(
              (row: unknown) =>
                typeof row === "object" &&
                row !== null &&
                "id" in row &&
                typeof row.id === "string" &&
                !previous.has(row.id) &&
                "trigger" in row &&
                typeof row.trigger === "object" &&
                row.trigger !== null &&
                "kind" in row.trigger &&
                row.trigger.kind === "schedule",
            );
            if (typeof run === "object" && run !== null && "id" in run && typeof run.id === "string")
              runId = run.id;
            return runId !== "";
          });
        }
        await window.loadURL(`${APP_ORIGIN}/index.html#/runs/${encodeURIComponent(runId)}`);
        const states = new Map<string, string>();
        let waitingId = "";
        let waitingSince = 0;
        let finalState = "";
        while (!finalState) {
          const run = await call("runs.status", { runId });
          if (
            typeof run !== "object" ||
            run === null ||
            !("state" in run) ||
            typeof run.state !== "string" ||
            !("steps" in run) ||
            !Array.isArray(run.steps)
          )
            throw new Error("Invalid run status.");
          const visit = (steps: unknown[], prefix = "") => {
            for (const step of steps) {
              if (
                typeof step !== "object" ||
                step === null ||
                !("stepId" in step) ||
                typeof step.stepId !== "string" ||
                !("state" in step) ||
                typeof step.state !== "string"
              )
                continue;
              const key = `${prefix}${step.stepId}`;
              if (states.get(key) !== step.state) {
                states.set(key, step.state);
                process.stdout.write(`step ${key}: ${step.state}\n`);
              }
              if ("items" in step && Array.isArray(step.items))
                for (const item of step.items as unknown[]) {
                  if (
                    typeof item === "object" &&
                    item !== null &&
                    "key" in item &&
                    typeof item.key === "string" &&
                    "steps" in item &&
                    Array.isArray(item.steps)
                  )
                    visit(item.steps, `${key}/${item.key}/`);
                }
            }
          };
          visit(run.steps);
          if (["done", "failed", "blocked", "interrupted", "cancelled"].includes(run.state)) {
            finalState = run.state;
            break;
          }
          if (run.state === "waiting_approval") {
            const approvals = await call("approvals.list", { state: "pending" });
            if (!Array.isArray(approvals)) throw new Error("Invalid approvals list.");
            const approval: unknown = approvals.find(
              (row: unknown) =>
                typeof row === "object" &&
                row !== null &&
                "runId" in row &&
                row.runId === runId &&
                "id" in row &&
                typeof row.id === "string",
            );
            if (
              typeof approval === "object" &&
              approval !== null &&
              "id" in approval &&
              typeof approval.id === "string"
            ) {
              if (waitingId !== approval.id) {
                waitingId = approval.id;
                waitingSince = Date.now();
              }
              if (Date.now() - waitingSince >= 86_400_000)
                throw new Error(`Timed out waiting for owner approval ${waitingId}.`);
            } else throw new Error("Missing pending approval.");
          } else waitingId = "";
          await delay(1000);
        }
        const audit = await call("audit.list", { runId });
        if (!Array.isArray(audit)) throw new Error("Invalid audit list.");
        process.stdout.write(`${summaryLine(runId, finalState, audit)}\n`);
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
}
