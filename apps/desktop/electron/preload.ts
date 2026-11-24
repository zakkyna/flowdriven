import { contextBridge, ipcRenderer } from "electron";

const RUNNER_CALL = "runner:call";
const RUNNER_EVENT = "runner:event";
const WINDOW_GET_PREFS = "window:getPrefs";
const WINDOW_SET_COLOR_MODE = "window:setColorMode";
const WINDOW_OPEN_LINK = "window:openLink";
const WINDOW_QUIT = "window:quit";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const runner = Object.freeze({
  call: (method: string, input: Record<string, unknown>) => {
    if (typeof method !== "string" || !isPlainObject(input)) {
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_input", message: "Invalid call." },
      });
    }
    return ipcRenderer.invoke(RUNNER_CALL, method, input);
  },
  subscribe: (listener: (event: unknown) => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("Listener must be a function.");
    }
    const handler = (_event: Electron.IpcRendererEvent, event: unknown) => listener(event);
    ipcRenderer.on(RUNNER_EVENT, handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      ipcRenderer.removeListener(RUNNER_EVENT, handler);
    };
  },
});

const windowApi = Object.freeze({
  getPrefs: () => ipcRenderer.invoke(WINDOW_GET_PREFS),
  setColorMode: (mode: unknown) => ipcRenderer.invoke(WINDOW_SET_COLOR_MODE, mode),
  openLink: (url: unknown) => ipcRenderer.invoke(WINDOW_OPEN_LINK, url),
  quit: () => ipcRenderer.invoke(WINDOW_QUIT),
});

contextBridge.exposeInMainWorld(
  "flowdrivenShell",
  Object.freeze(
    process.argv.includes("--flowdriven-runner=on")
      ? { kind: "electron", runner, window: windowApi }
      : { kind: "electron", window: windowApi },
  ),
);
