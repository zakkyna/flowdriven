import { expect, test } from "vitest";

const prefs = { colorMode: "system", platform: "darwin" };
test("TC-CON-31 window API schemas", async () => {
  const { ColorMode, OpenLinkInput, SetColorModeInput, WINDOW_CALLS, WindowPrefs, WindowReply } =
    await import("./window.ts");
  expect(WindowPrefs.safeParse(prefs).success).toBe(true);
  for (const colorMode of ["light", "system", "dark", "auto"])
    expect(ColorMode.safeParse(colorMode).success).toBe(colorMode !== "auto");
  for (const value of ["light", "system", "dark", "auto", { mode: "dark" }, ["dark", "light"]])
    expect(SetColorModeInput.safeParse(value).success).toBe(typeof value === "string" && value !== "auto");
  expect(WINDOW_CALLS).toEqual(["getPrefs", "setColorMode", "openLink", "quit"]);
  expect(OpenLinkInput.safeParse("x".repeat(2048)).success).toBe(true);
  expect(OpenLinkInput.safeParse("x".repeat(2049)).success).toBe(false);
  const reply = WindowReply(WindowPrefs);
  expect(reply.safeParse({ ok: true, result: prefs }).success).toBe(true);
  expect(reply.safeParse({ ok: false, error: { code: "not_allowed", message: "x" } }).success).toBe(true);
  expect(reply.safeParse({ ok: false, error: { code: "conflict", message: "x" } }).success).toBe(false);
});
test("TC-IPC-28 strict window preferences and replies", async () => {
  const { WindowPrefs, WindowReply } = await import("./window.ts");
  expect(WindowPrefs.safeParse(prefs).success).toBe(true);
  for (const value of [
    { ...prefs, colorMode: "auto" },
    { ...prefs, platform: "freebsd" },
    { colorMode: "system" },
    { ...prefs, keepRunning: true },
    { ...prefs, openAtLogin: true },
  ])
    expect(WindowPrefs.safeParse(value).success).toBe(false);
  expect(
    WindowReply(WindowPrefs).safeParse({ ok: false, error: { code: "not_found", message: "x" } }).success,
  ).toBe(false);
});
