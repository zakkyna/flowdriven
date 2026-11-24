import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../src/csp.mjs";
import { fakeNativeTheme, fakeSession, fakeShell, fakeWindow } from "./test-helpers/fakes";
import { windowBackground } from "./window-colors";

const state = vi.hoisted(() => ({
  register: vi.fn(),
  handle: vi.fn(),
  nativeTheme: {
    themeSource: "system" as "light" | "system" | "dark",
    shouldUseDarkColors: false,
    on: vi.fn(),
  },
  session: undefined as ReturnType<typeof fakeSession> | undefined,
  windowCalls: [] as { options: Record<string, unknown>; instance: ReturnType<typeof fakeWindow> }[],
}));

vi.mock("electron", () => {
  const activeSession = fakeSession();
  state.session = activeSession;
  class FakeBrowserWindow {
    private readonly inner = fakeWindow();
    constructor(options: Record<string, unknown>) {
      state.windowCalls.push({ options, instance: this.inner });
    }
    loadURL(url: string) {
      return this.inner.loadURL(url);
    }
  }
  return {
    protocol: { registerSchemesAsPrivileged: state.register, handle: state.handle },
    session: {
      defaultSession: activeSession,
    },
    nativeTheme: state.nativeTheme,
    BrowserWindow: FakeBrowserWindow,
  };
});

import {
  createMainWindow,
  lockDownSession,
  lockDownWebContents,
  registerAppScheme,
  serveApp,
} from "./window";

beforeEach(() => {
  vi.clearAllMocks();
  state.nativeTheme.themeSource = "system";
  state.nativeTheme.shouldUseDarkColors = false;
  state.windowCalls.length = 0;
});

test("registers only the intended scheme privileges", () => {
  registerAppScheme();
  expect(state.register).toHaveBeenCalledWith([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
});

test("filters requests and permits only app clipboard writes", () => {
  lockDownSession();
  const session = state.session;
  if (
    !session?.onBeforeRequestHandler ||
    !session.permissionRequestHandler ||
    !session.permissionCheckHandler
  ) {
    throw new Error("Missing handlers");
  }
  const cb = vi.fn();
  session.onBeforeRequestHandler({ url: "https://example.com" }, cb);
  expect(cb).toHaveBeenCalledWith({ cancel: true });
  session.permissionRequestHandler(
    { getURL: () => "app://flowdriven/index.html" },
    "clipboard-sanitized-write",
    cb,
    { requestingUrl: "app://flowdriven/index.html" },
  );
  expect(cb).toHaveBeenLastCalledWith(true);
  session.permissionRequestHandler({ getURL: () => "app://flowdriven/index.html" }, "camera", cb, {
    requestingUrl: "app://flowdriven/index.html",
  });
  expect(cb).toHaveBeenLastCalledWith(false);
  session.permissionRequestHandler(
    { getURL: () => "app://flowdriven/index.html" },
    "clipboard-sanitized-write",
    cb,
    { requestingUrl: "https://evil.test" },
  );
  expect(cb).toHaveBeenLastCalledWith(false);
  expect(
    session.permissionCheckHandler(null, "clipboard-sanitized-write", "app://flowdriven/index.html"),
  ).toBe(true);
  expect(session.permissionCheckHandler(null, "clipboard-sanitized-write", "https://evil.test")).toBe(false);
  expect(session.permissionCheckHandler(null, "camera", "app://flowdriven/index.html")).toBe(false);
});

test("locks each web contents against windows, webviews and external navigations and redirects", () => {
  const win = fakeWindow();
  lockDownWebContents(win.webContents as never);
  expect(win.webContents.windowOpenHandler?.()).toEqual({ action: "deny" });
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    const preventDefault = vi.fn();
    win.webContents.emit(name, { preventDefault, url: "https://evil.test" }, "https://evil.test");
    expect(preventDefault, name).toHaveBeenCalled();
  }
});

test("serves build files without network access and rejects invalid paths", async () => {
  await mkdir(path.resolve(".workflow/scratch"), { recursive: true });
  const root = await mkdtemp(path.resolve(".workflow/scratch/flowdriven-"));
  try {
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, "assets"), { recursive: true });
    const files = [
      ["index.html", "<html>ok</html>", "text/html; charset=utf-8"],
      ["assets/app.js", "const x = 1;", "text/javascript; charset=utf-8"],
      ["assets/app.css", "body {}", "text/css; charset=utf-8"],
    ] as const;
    for (const [file, bytes] of files) await writeFile(path.join(dist, file), bytes);
    await writeFile(path.join(dist, "unknown.bin"), "unknown");
    await writeFile(path.join(root, "secret.html"), "secret");
    await symlink(path.join(root, "secret.html"), path.join(dist, "link.html"));
    serveApp(dist);
    const handleCall = state.handle.mock.calls[0];
    if (!handleCall) throw new Error("Missing protocol handler");
    const handler = handleCall[1];
    for (const [file, bytes, type] of files) {
      const response = await handler({ url: `app://flowdriven/${file}?theme=light#/builder` });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(type);
      expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new TextEncoder().encode(bytes));
    }
    for (const suffix of ["assets", "missing.html", "unknown.bin", "link.html", "a%00b.html"]) {
      const result = await handler({ url: `app://flowdriven/${suffix}` });
      expect(result.status).toBe(404);
      expect(await result.text()).toBe("Not found");
      expect(result.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture keeps the app alive between windows and tests are excluded from emit", async () => {
  const { readFile } = await import("node:fs/promises");
  const capture = await readFile(new URL("./capture.ts", import.meta.url), "utf8");
  expect(capture).toMatch(/app\.on\("window-all-closed"/);
  const config = JSON.parse(await readFile(new URL("../tsconfig.electron.json", import.meta.url), "utf8"));
  expect(config.exclude).toContain("electron/**/*.test.ts");
});

test("TC-ELE-02 the main window options are kept", () => {
  const basePrefs = {
    preload: "/preload.js",
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

  state.nativeTheme.shouldUseDarkColors = false;
  createMainWindow({ preloadPath: "/preload.js", runner: true, show: true });
  state.nativeTheme.shouldUseDarkColors = true;
  createMainWindow({ preloadPath: "/preload.js", runner: true, show: true });
  createMainWindow({
    preloadPath: "/preload.js",
    show: false,
    theme: "light",
    scenario: "story-v2",
    hash: "/chat",
  });
  createMainWindow({
    preloadPath: "/preload.js",
    show: false,
    theme: "dark",
    scenario: "story-v2",
    hash: "/chat",
  });

  expect(state.windowCalls).toHaveLength(4);
  const [realLight, realDark, captureLight, captureDark] = state.windowCalls;
  for (const [entry, dark, isReal] of [
    [realLight, false, true],
    [realDark, true, true],
    [captureLight, false, false],
    [captureDark, true, false],
  ] as const) {
    expect(entry?.options.width).toBe(1280);
    expect(entry?.options.height).toBe(800);
    expect(entry?.options.minWidth).toBe(480);
    expect(entry?.options.minHeight).toBe(600);
    expect(entry?.options.title).toBe("FlowDriven");
    expect(entry?.options.backgroundColor).toBe(windowBackground(dark));
    expect(entry?.options.webPreferences).toEqual(
      isReal ? { ...basePrefs, additionalArguments: ["--flowdriven-runner=on"] } : basePrefs,
    );
    expect(entry?.instance.loadedUrls[0]).toMatch(/^app:\/\/flowdriven\/index\.html/);
  }
});

test("TC-ELE-04 every response of the app scheme carries the policy", async () => {
  await mkdir(path.resolve(".workflow/scratch"), { recursive: true });
  const root = await mkdtemp(path.resolve(".workflow/scratch/flowdriven-ele04-"));
  try {
    const dist = path.join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "index.html"), "<html>app</html>");
    await writeFile(path.join(dist, "app.js"), "console.log('ok');");
    await writeFile(path.join(dist, "app.css"), "body{}");
    await writeFile(path.join(dist, "font.woff2"), "woff2-bytes");
    await writeFile(path.join(dist, "a.exe"), "mz");
    await writeFile(path.join(dist, "secret.txt"), "inside-secret");
    await writeFile(path.join(root, "secret.txt"), "top-secret");
    await writeFile(path.join(root, "outside.js"), "outside-secret");
    await symlink(path.join(root, "outside.js"), path.join(dist, "link.js"));

    serveApp(dist);
    const handler = state.handle.mock.calls[0]?.[1];
    if (!handler) throw new Error("Missing protocol handler");

    const allowed: [string, string][] = [
      ["app://flowdriven/", "<html>app</html>"],
      ["app://flowdriven/app.js", "console.log('ok');"],
      ["app://flowdriven/font.woff2", "woff2-bytes"],
    ];
    for (const [url, expectedText] of allowed) {
      const response = await handler({ url });
      expect(response.status, url).toBe(200);
      expect(response.headers.get("content-security-policy"), url).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers.get("x-content-type-options"), url).toBe("nosniff");
      expect(await response.text(), url).toBe(expectedText);
    }

    const refused = [
      "app://flowdriven/a.exe",
      "app://flowdriven/../secret.txt",
      "app://flowdriven/%2e%2e/secret.txt",
      "app://flowdriven/a%5Cb",
      "app://flowdriven/a%00b",
      "app://flowdriven/link.js",
      "app://other/index.html",
    ];
    for (const url of refused) {
      const response = await handler({ url });
      expect([403, 404], url).toContain(response.status);
      const body = await response.text();
      expect(body, url).not.toContain("secret");
      expect(body, url).not.toContain("mz");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TC-ELE-05 no request leaves app://flowdriven", () => {
  lockDownSession();
  const handler = state.session?.onBeforeRequestHandler;
  if (!handler) throw new Error("Missing onBeforeRequestHandler");

  const blocked = [
    "https://example.com/a.png",
    "http://example.com/",
    "file:///etc/hosts",
    "ws://localhost:3000/",
    "wss://example.com/",
    "ftp://example.com/",
    "data:text/html,x",
    "app://other/index.html",
    "app://flowdriven:8080/",
    "app://sam@flowdriven/",
    "blob:https://example.com/id",
  ];
  for (const url of blocked) {
    const cb = vi.fn();
    handler({ url }, cb);
    expect(cb, url).toHaveBeenCalledWith({ cancel: true });
  }

  const allowed = [
    "app://flowdriven/index.html",
    "devtools://devtools/bundled/x.js",
    "blob:app://flowdriven/3f2a",
  ];
  for (const url of allowed) {
    const cb = vi.fn();
    handler({ url }, cb);
    expect(cb, url).toHaveBeenCalledWith({ cancel: false });
  }
});

test("TC-ELE-06 permissions: only a clipboard write from the app", () => {
  lockDownSession();
  const reqHandler = state.session?.permissionRequestHandler;
  const checkHandler = state.session?.permissionCheckHandler;
  if (!reqHandler || !checkHandler) throw new Error("Missing permission handlers");

  const permissions = [
    "clipboard-sanitized-write",
    "clipboard-read",
    "notifications",
    "media",
    "geolocation",
    "midi",
    "openExternal",
    "fullscreen",
  ];
  const origins = ["app://flowdriven/", "https://example.com/"];
  for (const permission of permissions) {
    for (const origin of origins) {
      const expected = permission === "clipboard-sanitized-write" && origin === "app://flowdriven/";
      const cb = vi.fn();
      reqHandler({ getURL: () => origin }, permission, cb, { requestingUrl: origin });
      expect(cb, `request ${permission} ${origin}`).toHaveBeenCalledWith(expected);
      expect(checkHandler(null, permission, origin), `check ${permission} ${origin}`).toBe(expected);
    }
  }
});

test("TC-ELE-07 navigation, new windows and webviews stay denied", () => {
  const win = fakeWindow();
  const shell = fakeShell();
  lockDownWebContents(win.webContents as never);

  const openHandler = win.webContents.windowOpenHandler;
  if (!openHandler) throw new Error("Missing windowOpenHandler");
  expect(openHandler({ url: "https://example.com/" })).toEqual({ action: "deny" });
  expect(openHandler({ url: "app://flowdriven/index.html" })).toEqual({ action: "deny" });

  for (const eventName of ["will-navigate", "will-frame-navigate", "will-redirect"]) {
    const allowedPrevent = vi.fn();
    win.webContents.emit(
      eventName,
      { preventDefault: allowedPrevent, url: "app://flowdriven/index.html#/chat/c1" },
      "app://flowdriven/index.html#/chat/c1",
    );
    expect(allowedPrevent, `${eventName} app`).not.toHaveBeenCalled();

    for (const blockedUrl of ["https://example.com/", "app://flowdriven:8080/", "file:///x"]) {
      const blockedPrevent = vi.fn();
      win.webContents.emit(eventName, { preventDefault: blockedPrevent, url: blockedUrl }, blockedUrl);
      expect(blockedPrevent, `${eventName} ${blockedUrl}`).toHaveBeenCalledOnce();
    }
  }

  const webviewPrevent = vi.fn();
  win.webContents.emit("will-attach-webview", { preventDefault: webviewPrevent });
  expect(webviewPrevent).toHaveBeenCalledOnce();
  expect(shell.opened).toEqual([]);
});
