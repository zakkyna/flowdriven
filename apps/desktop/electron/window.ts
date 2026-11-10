import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme, net, protocol, session, type WebContents } from "electron";
import { CONTENT_SECURITY_POLICY } from "./csp";
import {
  APP_ORIGIN,
  APP_SCHEME,
  isAllowedNavigation,
  isBlockedRequest,
  MIN_WINDOW,
  resolveAppPath,
  secureWebPreferences,
} from "./security";

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}
export function serveApp(distDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const notFound = () => new Response("Not found", { status: 404 });
    try {
      const file = resolveAppPath(distDir, request.url);
      if (!file) return notFound();
      const root = await realpath(distDir);
      const target = await realpath(file);
      if (!target.startsWith(root + path.sep) || !(await stat(target)).isFile()) return notFound();
      const response = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return notFound();
    }
  });
}
export function lockDownSession(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: isBlockedRequest(details.url) }),
  );
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(
      permission === "clipboard-sanitized-write" &&
        isAllowedNavigation(contents.getURL()) &&
        isAllowedNavigation(details.requestingUrl),
    ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, origin) =>
      permission === "clipboard-sanitized-write" && isAllowedNavigation(origin),
  );
}
export function lockDownWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
  const checkNavigation = (event: { url: string; preventDefault: () => void }) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault();
  };
  contents.on("will-navigate", checkNavigation);
  contents.on("will-frame-navigate", checkNavigation);
  contents.on("will-redirect", checkNavigation);
}
export function registerWebContentsSecurity(): void {
  app.on("web-contents-created", (_event, contents) => lockDownWebContents(contents));
}
export function createMainWindow(options: {
  preloadPath: string;
  show: boolean;
  theme?: "light" | "dark";
  scenario?: string;
  hash?: string;
}): BrowserWindow {
  const dark = options.theme ? options.theme === "dark" : nativeTheme.shouldUseDarkColors;
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    title: "FlowDriven",
    backgroundColor: dark ? "#161918" : "#F3F4F2",
    show: options.show,
    webPreferences: secureWebPreferences(options.preloadPath),
  });
  const query = new URLSearchParams();
  if (options.theme) query.set("theme", options.theme);
  if (options.scenario) query.set("scenario", options.scenario);
  const search = query.toString();
  void window.loadURL(
    `${APP_ORIGIN}/index.html${search ? `?${search}` : ""}${options.hash ? `#${options.hash}` : ""}`,
  );
  return window;
}
