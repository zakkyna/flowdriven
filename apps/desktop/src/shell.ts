import type { ColorMode, WindowPrefs, WindowReply } from "@flowdriven/contracts";

export function shellKind(): "electron" | "browser" {
  return (window as Window & { flowdrivenShell?: { kind: string } }).flowdrivenShell?.kind === "electron"
    ? "electron"
    : "browser";
}

export type RunnerBridge = {
  call(method: string, input: unknown): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
};
export function runnerBridge(): RunnerBridge | undefined {
  const runner = (window as Window & { flowdrivenShell?: { runner?: RunnerBridge } }).flowdrivenShell?.runner;
  return runner && typeof runner.call === "function" && typeof runner.subscribe === "function"
    ? runner
    : undefined;
}

export type WindowApi = {
  getPrefs: () => Promise<WindowReply<WindowPrefs>>;
  setColorMode: (mode: ColorMode) => Promise<WindowReply<WindowPrefs>>;
  openLink: (url: string) => Promise<WindowReply<{ opened: boolean }>>;
  quit: () => Promise<WindowReply<Record<string, never>>>;
};

export function windowApi(): WindowApi | undefined {
  const api = (window as Window & { flowdrivenShell?: { window?: Partial<WindowApi> } }).flowdrivenShell
    ?.window;
  return api &&
    typeof api.getPrefs === "function" &&
    typeof api.setColorMode === "function" &&
    typeof api.openLink === "function" &&
    typeof api.quit === "function"
    ? (api as WindowApi)
    : undefined;
}
