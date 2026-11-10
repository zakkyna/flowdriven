import { describe, expect, test } from "vitest";
import {
  APP_ORIGIN,
  isAllowedNavigation,
  isBlockedRequest,
  MIN_WINDOW,
  resolveAppPath,
  secureWebPreferences,
} from "./security";

describe("Electron security helpers", () => {
  test("web preferences keep the secure defaults", () => {
    expect(secureWebPreferences("/x/preload.js")).toMatchObject({
      preload: "/x/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
    expect(MIN_WINDOW).toEqual({ width: 1100, height: 720 });
  });
  test("navigation stays inside the app", () => {
    expect(isAllowedNavigation(`${APP_ORIGIN}/index.html#/runs`)).toBe(true);
    expect(isAllowedNavigation("https://example.com/")).toBe(false);
    expect(isAllowedNavigation("app://other/index.html")).toBe(false);
    expect(isAllowedNavigation("file:///etc/passwd")).toBe(false);
    expect(isAllowedNavigation("app://flowdrivenx/index.html")).toBe(false);
    expect(isAllowedNavigation("not a url")).toBe(false);
  });
  test("app paths cannot leave the build folder", () => {
    expect(resolveAppPath("/d", "app://flowdriven/")).toBe("/d/index.html");
    expect(resolveAppPath("/d", "app://flowdriven/index.html?theme=dark")).toBe("/d/index.html");
    expect(resolveAppPath("/d", "app://flowdriven/assets/a.js")).toBe("/d/assets/a.js");
    expect(resolveAppPath("/d", "app://flowdriven")).toBe("/d/index.html");
    expect(resolveAppPath("/d", "app://flowdriven/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveAppPath("/d", "app://flowdriven/..%2f..%2fetc%2fpasswd")).toBeNull();
    expect(resolveAppPath("/d", "app://flowdriven/assets/%E0%A4%A")).toBeNull();
    expect(resolveAppPath("/d", "app://evil/index.html")).toBeNull();
    expect(resolveAppPath("/d", "app://flowdrivenx/index.html")).toBeNull();
  });
  test("remote requests are blocked", () => {
    expect(isBlockedRequest("https://cdn.example.com/x.js")).toBe(true);
    expect(isBlockedRequest("http://127.0.0.1:5173/")).toBe(true);
    expect(isBlockedRequest("ws://localhost:5173/")).toBe(true);
    expect(isBlockedRequest("app://flowdriven/assets/a.js")).toBe(false);
    expect(isBlockedRequest("devtools://devtools/bundled/x.html")).toBe(false);
  });
});
