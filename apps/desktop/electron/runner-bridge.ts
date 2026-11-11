import { broadcastRunnerEvent, type IpcLike, registerRunnerIpc, type WindowLike } from "./runner-ipc";
import { RunnerLink, type SpawnFn } from "./runner-link";
import { dataDirFor, isDemo, runnerEntry } from "./runner-paths";
export type RunnerBridgeOptions = {
  ipc: IpcLike;
  spawn: SpawnFn;
  env: Record<string, string | undefined>;
  appData: string;
  dirname: string;
  windows: () => WindowLike[];
  execPath?: string;
  log?: (line: string) => void;
  now?: () => number;
};
export function startRunnerBridge(options: RunnerBridgeOptions): {
  link: RunnerLink;
  dataDir: string;
  stop(): Promise<void>;
} {
  const dataDir = dataDirFor(options.env, options.appData);
  const link = new RunnerLink({
    spawn: options.spawn,
    execPath: options.execPath ?? process.execPath,
    entry: runnerEntry(options.dirname),
    dataDir,
    demo: isDemo(options.env),
    env: options.env,
    onEvent: (event) => broadcastRunnerEvent(options.windows(), event),
    log: options.log,
    now: options.now,
  });
  registerRunnerIpc({ ipc: options.ipc, link });
  link.start();
  return { link, dataDir, stop: () => link.stop() };
}
