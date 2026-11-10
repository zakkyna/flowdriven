import { pathToFileURL } from "node:url";
import { BrowserWindow, nativeTheme, net, protocol, session } from "electron";
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
  protocol.handle(APP_SCHEME, (request) => {
    const file = resolveAppPath(distDir, request.url);
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response("Not found", { status: 404 });
  });
}
export function lockDownSession(): void {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: isBlockedRequest(details.url) }),
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
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
