import path from "node:path";
import type { WebPreferences } from "electron";

export const APP_SCHEME = "app";
export const APP_HOST = "flowdriven";
export const APP_ORIGIN = "app://flowdriven";
export const MIN_WINDOW = { width: 1100, height: 720 } as const;

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
  };
}
export function isAllowedNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "app:" && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}
export function resolveAppPath(distDir: string, requestUrl: string): string | null {
  if (!requestUrl.startsWith(APP_ORIGIN)) return null;
  const remainder = requestUrl.slice(APP_ORIGIN.length);
  if (remainder && !/^[/?#]/.test(remainder)) return null;
  let pathname = remainder.split(/[?#]/, 1)[0] || "/";
  if (pathname === "/") pathname = "/index.html";
  try {
    const root = path.resolve(distDir);
    const result = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    return result.startsWith(root + path.sep) ? result : null;
  } catch {
    return null;
  }
}
export function isBlockedRequest(url: string): boolean {
  try {
    return ["http:", "https:", "ws:", "wss:", "ftp:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
