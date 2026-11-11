import { contextBridge, ipcRenderer } from "electron";

const CALL = "runner:call";
const EVENT = "runner:event";
const runner = Object.freeze({
  call: (method: string, input: Record<string, unknown>) => ipcRenderer.invoke(CALL, method, input),
  subscribe: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: unknown) => listener(event);
    ipcRenderer.on(EVENT, handler);
    return () => {
      ipcRenderer.removeListener(EVENT, handler);
    };
  },
});
contextBridge.exposeInMainWorld(
  "flowdrivenShell",
  Object.freeze(
    process.argv.includes("--flowdriven-runner=on") ? { kind: "electron", runner } : { kind: "electron" },
  ),
);
