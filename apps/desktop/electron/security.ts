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
    return (
      parsed.protocol === "app:" &&
      parsed.host === APP_HOST &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
    );
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
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0") || decoded.includes("\\")) return null;
    const result = path.resolve(root, `.${decoded}`);
    return result.startsWith(root + path.sep) ? result : null;
  } catch {
    return null;
  }
}
export function isBlockedRequest(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "app:") return !isAllowedNavigation(url);
    if (parsed.protocol === "devtools:") return false;
    if (parsed.protocol === "blob:") return !isAllowedNavigation(url.slice(5));
    return true;
  } catch {
    return true;
  }
}

export function contentTypeFor(filePath: string): string | null {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };
  return types[path.extname(filePath).toLowerCase()] ?? null;
}
