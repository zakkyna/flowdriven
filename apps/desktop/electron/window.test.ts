import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../src/csp.mjs";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  handle: vi.fn(),
  request: vi.fn(),
  permission: vi.fn(),
  check: vi.fn(),
}));
vi.mock("electron", () => ({
  protocol: { registerSchemesAsPrivileged: mocks.register, handle: mocks.handle },
  session: {
    defaultSession: {
      webRequest: { onBeforeRequest: mocks.request },
      setPermissionRequestHandler: mocks.permission,
      setPermissionCheckHandler: mocks.check,
    },
  },
  nativeTheme: {},
  BrowserWindow: vi.fn(),
}));

import { lockDownSession, lockDownWebContents, registerAppScheme, serveApp } from "./window";

beforeEach(() => vi.clearAllMocks());
test("registers only the intended scheme privileges", () => {
  registerAppScheme();
  expect(mocks.register).toHaveBeenCalledWith([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
});
test("filters requests and permits only app clipboard writes", () => {
  lockDownSession();
  const cb = vi.fn();
  mocks.request.mock.calls[0][0]({ url: "https://example.com" }, cb);
  expect(cb).toHaveBeenCalledWith({ cancel: true });
  const request = mocks.permission.mock.calls[0][0];
  request({ getURL: () => "app://flowdriven/index.html" }, "clipboard-sanitized-write", cb, {
    requestingUrl: "app://flowdriven/index.html",
  });
  expect(cb).toHaveBeenLastCalledWith(true);
  request({ getURL: () => "app://flowdriven/index.html" }, "camera", cb, {
    requestingUrl: "app://flowdriven/index.html",
  });
  expect(cb).toHaveBeenLastCalledWith(false);
  request({ getURL: () => "app://flowdriven/index.html" }, "clipboard-sanitized-write", cb, {
    requestingUrl: "https://evil.test",
  });
  expect(cb).toHaveBeenLastCalledWith(false);
  const check = mocks.check.mock.calls[0][0];
  expect(check(null, "clipboard-sanitized-write", "app://flowdriven/index.html")).toBe(true);
  expect(check(null, "clipboard-sanitized-write", "https://evil.test")).toBe(false);
  expect(check(null, "camera", "app://flowdriven/index.html")).toBe(false);
});
test("locks each web contents against windows, webviews and external navigations and redirects", () => {
  const events = new Map<string, (event: { preventDefault: () => void }, url: string) => void>();
  const contents = { on: vi.fn((name, handler) => events.set(name, handler)), setWindowOpenHandler: vi.fn() };
  lockDownWebContents(contents as never);
  expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" });
  for (const name of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
    const preventDefault = vi.fn();
    events.get(name)?.({ preventDefault, url: "https://evil.test" } as never, "https://evil.test");
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
    ];
    for (const [file, bytes] of files) await writeFile(path.join(dist, file), bytes);
    await writeFile(path.join(dist, "unknown.bin"), "unknown");
    await writeFile(path.join(root, "secret.html"), "secret");
    await symlink(path.join(root, "secret.html"), path.join(dist, "link.html"));
    serveApp(dist);
    const handler = mocks.handle.mock.calls[0][1];
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
