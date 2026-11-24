import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ColorMode as ContractColorMode,
  OpenLinkInput,
  Settings,
  WINDOW_CALLS,
  WindowPrefs,
  WindowReply,
} from "@flowdriven/contracts";
import { expect, test, vi } from "vitest";
import { AppearanceError, createAppearance } from "./appearance";
import { type FrameLike, type IpcLike, RUNNER_CALL_CHANNEL, registerRunnerIpc } from "./runner-ipc";
import { fakeFs, fakeNativeTheme, fakeShell } from "./test-helpers/fakes";
import {
  createWindowApi,
  registerWindowApi,
  WINDOW_CHANNELS,
  WINDOW_GET_PREFS_CHANNEL,
  WINDOW_OPEN_LINK_CHANNEL,
  WINDOW_QUIT_CHANNEL,
  WINDOW_SET_COLOR_MODE_CHANNEL,
} from "./window-api";

test("TC-ELE-25 link opening checks https public addresses and calls shell.openExternal", async () => {
  const shell = fakeShell();
  const api = createWindowApi({
    shell,
    platform: "darwin",
    readColorMode: () => "system",
  });

  expect(await api.openLink("https://example.com/a?x=1")).toEqual({ opened: true });
  expect(await api.openLink("https://EXAMPLE.com/b")).toEqual({ opened: true });
  expect(shell.opened).toEqual(["https://example.com/a?x=1", "https://example.com/b"]);

  for (const refused of [
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://10.0.0.5/x",
    "https://example/x",
    "http://example.com/",
    "javascript:alert(1)",
    "https://sam:pw@example.com/",
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    expect(await api.openLink(refused), refused).toEqual({ opened: false });
  }
  expect(shell.opened).toHaveLength(2);

  shell.setFailure(new Error("boom"));
  expect(await api.openLink("https://example.org/")).toEqual({ opened: false });
  expect(shell.opened).toEqual([
    "https://example.com/a?x=1",
    "https://example.com/b",
    "https://example.org/",
  ]);
});

test("getPrefs returns readColorMode or system fallback and platform", () => {
  const shell = fakeShell();
  const darkPrefs = createWindowApi({
    shell,
    platform: "darwin",
    readColorMode: () => "dark",
  }).getPrefs();
  expect(WindowPrefs.parse(darkPrefs)).toEqual({ colorMode: "dark", platform: "darwin" });

  const fallbackPrefs = createWindowApi({
    shell,
    platform: "linux",
    readColorMode: () => undefined,
  }).getPrefs();
  expect(WindowPrefs.parse(fallbackPrefs)).toEqual({ colorMode: "system", platform: "linux" });
});

const ownFrame: FrameLike = { url: "app://flowdriven/index.html", parent: null };

function setupWindowIpc(overrides?: {
  load?: () => { colorMode: "light" | "system" | "dark" };
  set?: (mode: unknown) => Promise<"light" | "system" | "dark">;
  openLink?: (url: string) => Promise<{ opened: boolean }>;
  quit?: () => void;
  platform?: NodeJS.Platform;
}) {
  const handlers = new Map<string, (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown>();
  const ipc: IpcLike = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
  };
  const appearance = {
    load: vi.fn(overrides?.load ?? (() => ({ colorMode: "system" as const }))),
    set: vi.fn(overrides?.set ?? (async (mode: unknown) => mode as "light" | "system" | "dark")),
  };
  const openLink = vi.fn(overrides?.openLink ?? (async () => ({ opened: true })));
  const quit = vi.fn(overrides?.quit ?? (() => {}));

  registerWindowApi({
    ipc,
    appearance,
    openLink,
    quit,
    platform: overrides?.platform ?? "darwin",
  });

  const invoke = async (channel: string, senderFrame: FrameLike, ...args: unknown[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return await handler({ senderFrame }, ...args);
  };

  return { handlers, ipc, invoke, appearance, openLink, quit };
}

function scanNonTestFilesForTerms(roots: readonly string[], terms: readonly string[]): string[] {
  const findings: string[] = [];
  const patterns = terms.map((term) => ({ term, regex: new RegExp(`\\b${term}\\b`) }));
  for (const root of roots) {
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      const normalized = entry.split(path.sep).join("/");
      if (!/\.(?:ts|tsx|mts)$/.test(normalized) || /\.test\.(?:ts|tsx|mts)$/.test(normalized)) continue;
      if (normalized.split("/").includes("test-helpers")) continue;
      const fullPath = path.join(root, entry);
      const source = readFileSync(fullPath, "utf8");
      for (const { term, regex } of patterns) {
        if (regex.test(source)) findings.push(`${normalized}: ${term}`);
      }
    }
  }
  return findings;
}

test("TC-IPC-23 every window channel checks the sender", async () => {
  const { invoke, appearance, openLink, quit } = setupWindowIpc();

  expect(await invoke(WINDOW_GET_PREFS_CHANNEL, ownFrame)).toEqual({
    ok: true,
    result: { colorMode: "system", platform: "darwin" },
  });
  expect(WindowReply(WindowPrefs).parse(await invoke(WINDOW_GET_PREFS_CHANNEL, ownFrame))).toEqual({
    ok: true,
    result: { colorMode: "system", platform: "darwin" },
  });
  expect(await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, "dark")).toEqual({
    ok: true,
    result: { colorMode: "dark", platform: "darwin" },
  });
  expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, "https://example.com/")).toEqual({
    ok: true,
    result: { opened: true },
  });
  expect(await invoke(WINDOW_QUIT_CHANNEL, ownFrame)).toEqual({ ok: true, result: {} });

  expect(appearance.load).toHaveBeenCalledTimes(2);
  expect(appearance.set).toHaveBeenCalledTimes(1);
  expect(openLink).toHaveBeenCalledTimes(1);
  expect(quit).toHaveBeenCalledTimes(1);

  const calls: [string, unknown[]][] = [
    [WINDOW_GET_PREFS_CHANNEL, []],
    [WINDOW_SET_COLOR_MODE_CHANNEL, ["dark"]],
    [WINDOW_OPEN_LINK_CHANNEL, ["https://example.com/"]],
    [WINDOW_QUIT_CHANNEL, []],
  ];
  const badFrames: FrameLike[] = [
    { url: ownFrame.url, parent: ownFrame },
    null,
    { url: "https://example.com/", parent: null },
  ];
  for (const frame of badFrames) {
    for (const [channel, args] of calls) {
      const reply = await invoke(channel, frame, ...args);
      expect(reply, `${channel} ${JSON.stringify(frame)}`).toMatchObject({
        ok: false,
        error: { code: "not_allowed" },
      });
      expect(WindowReply(WindowPrefs).parse(reply)).toEqual(reply);
    }
  }

  expect(appearance.load).toHaveBeenCalledTimes(2);
  expect(appearance.set).toHaveBeenCalledTimes(1);
  expect(openLink).toHaveBeenCalledTimes(1);
  expect(quit).toHaveBeenCalledTimes(1);
});

test("TC-IPC-24 window channels check the argument count", async () => {
  const { invoke, appearance, openLink, quit } = setupWindowIpc();

  const badCalls: [string, unknown[]][] = [
    [WINDOW_GET_PREFS_CHANNEL, ["x"]],
    [WINDOW_QUIT_CHANNEL, ["x"]],
    [WINDOW_SET_COLOR_MODE_CHANNEL, []],
    [WINDOW_SET_COLOR_MODE_CHANNEL, ["dark", "x"]],
    [WINDOW_OPEN_LINK_CHANNEL, []],
    [WINDOW_OPEN_LINK_CHANNEL, ["https://example.com/a", "x"]],
  ];
  for (const [channel, args] of badCalls) {
    const reply = await invoke(channel, ownFrame, ...args);
    expect(reply, `${channel} args=${args.length}`).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  }

  expect(appearance.load).not.toHaveBeenCalled();
  expect(appearance.set).not.toHaveBeenCalled();
  expect(openLink).not.toHaveBeenCalled();
  expect(quit).not.toHaveBeenCalled();
});

test("TC-IPC-25 the color mode takes only its three values", async () => {
  const { invoke, appearance } = setupWindowIpc();
  expect(ContractColorMode.options).toEqual(["light", "system", "dark"]);

  for (const mode of ["light", "system", "dark"] as const) {
    const reply = await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, mode);
    expect(reply).toEqual({ ok: true, result: { colorMode: mode, platform: "darwin" } });
    expect(WindowReply(WindowPrefs).parse(reply)).toEqual(reply);
  }

  for (const invalid of ["Dark", "auto", "purple", "", undefined, 1, null, {}]) {
    const reply = await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, invalid);
    expect(reply, String(invalid)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(WindowReply(WindowPrefs).parse(reply)).toEqual(reply);
  }
  expect(appearance.set).toHaveBeenCalledTimes(3);

  appearance.set.mockRejectedValueOnce(new AppearanceError("unavailable", "Could not save appearance."));
  const failed = await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, "dark");
  expect(failed).toMatchObject({ ok: false, error: { code: "unavailable" } });
  expect(WindowReply(WindowPrefs).parse(failed)).toEqual(failed);
});

test("TC-IPC-26 there is no setBackground channel", async () => {
  const { handlers } = setupWindowIpc();
  expect([...handlers.keys()]).toEqual([
    "window:getPrefs",
    "window:setColorMode",
    "window:openLink",
    "window:quit",
  ]);
  const missingChannel = ["window:", "set", "Background"].join("");
  expect(handlers.get(missingChannel)).toBeUndefined();

  const forbiddenTerms = [
    ["set", "Background"].join(""),
    ["keep", "Running"].join(""),
    ["open", "AtLogin"].join(""),
  ];
  const electronDir = path.resolve(__dirname);
  const contractsDir = path.resolve(__dirname, "../../../packages/contracts/src");
  expect(scanNonTestFilesForTerms([electronDir, contractsDir], forbiddenTerms)).toEqual([]);

  const tempDir = mkdtempSync(path.join(tmpdir(), "flowdriven-ipc26-"));
  try {
    writeFileSync(path.join(tempDir, "bad.ts"), `export const x = "${forbiddenTerms[1]}";\n`);
    expect(scanNonTestFilesForTerms([tempDir], forbiddenTerms)).toEqual([`bad.ts: ${forbiddenTerms[1]}`]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("TC-IPC-27 openLink accepts only a short https address with no credentials", async () => {
  const { invoke, openLink } = setupWindowIpc();

  expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, "https://example.com/a?x=1")).toEqual({
    ok: true,
    result: { opened: true },
  });
  expect(openLink).toHaveBeenCalledTimes(1);
  expect(openLink).toHaveBeenCalledWith("https://example.com/a?x=1");

  const maxAllowed = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;
  expect(maxAllowed.length).toBe(2048);
  expect(OpenLinkInput.safeParse(maxAllowed).success).toBe(true);
  expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, maxAllowed)).toEqual({
    ok: true,
    result: { opened: true },
  });
  expect(OpenLinkInput.safeParse(`${maxAllowed}a`).success).toBe(false);

  const refused: unknown[] = [
    "http://example.com/",
    "javascript:alert(1)",
    "file:///etc/hosts",
    "app://flowdriven/",
    "data:text/html,x",
    "https://sam:pw@example.com/",
    "https://sam@example.com/",
    "not a url",
    "",
    `https://example.com/${"a".repeat(2048)}`,
    5,
    null,
  ];
  for (const input of refused) {
    const reply = await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, input);
    expect(reply, String(input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  }
  expect(openLink).toHaveBeenCalledTimes(2);
});

test("TC-SR2-18 the window API takes fixed values and only from the app's main frame", async () => {
  const { handlers, invoke, appearance, openLink, quit } = setupWindowIpc();
  const link = { call: vi.fn().mockResolvedValue({ ok: true }) };
  const runnerIpc: IpcLike = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
  };
  registerRunnerIpc({ ipc: runnerIpc, link });

  const childFrame: FrameLike = { url: ownFrame.url, parent: ownFrame };
  const foreignFrame: FrameLike = { url: "https://example.test/", parent: null };

  for (const frame of [childFrame, foreignFrame]) {
    expect(await invoke(WINDOW_GET_PREFS_CHANNEL, frame)).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
    expect(await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, frame, "dark")).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
    expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, frame, "https://example.com/")).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
    expect(await invoke(WINDOW_QUIT_CHANNEL, frame)).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
    expect(await invoke(RUNNER_CALL_CHANNEL, frame, "flows.list", {})).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
  }

  expect(await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, "neon")).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  expect(await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, {})).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  expect(await invoke(WINDOW_SET_COLOR_MODE_CHANNEL, ownFrame, "dark", "extra")).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, "http://example.com/")).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  expect(await invoke(WINDOW_OPEN_LINK_CHANNEL, ownFrame, "https://sam@example.com/")).toMatchObject({
    ok: false,
    error: { code: "invalid_input" },
  });
  expect(await invoke(RUNNER_CALL_CHANNEL, ownFrame, "flows.notAnOperation", {})).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });

  expect(appearance.load).not.toHaveBeenCalled();
  expect(appearance.set).not.toHaveBeenCalled();
  expect(openLink).not.toHaveBeenCalled();
  expect(quit).not.toHaveBeenCalled();
  expect(link.call).not.toHaveBeenCalled();
});

test("TC-ELE-13 getPrefs reports the file and the platform, never the store", async () => {
  const windowPath = path.join("U", "window.json");
  const appearance = createAppearance({
    fs: fakeFs({ files: { [windowPath]: JSON.stringify({ version: 1, colorMode: "dark" }) } }),
    nativeTheme: fakeNativeTheme(),
    userDataDir: "U",
  });
  const link = { call: vi.fn() };
  const handlers = new Map<string, (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown>();
  registerWindowApi({
    ipc: { handle: (ch, fn) => handlers.set(ch, fn) },
    appearance,
    openLink: async () => ({ opened: false }),
    quit: () => {},
    platform: "darwin",
  });

  const getPrefs = handlers.get(WINDOW_GET_PREFS_CHANNEL);
  if (!getPrefs) throw new Error("Missing getPrefs handler");
  expect(await getPrefs({ senderFrame: ownFrame })).toEqual({
    ok: true,
    result: { colorMode: "dark", platform: "darwin" },
  });
  expect(link.call).not.toHaveBeenCalled();

  const missingAppearance = createAppearance({
    fs: fakeFs(),
    nativeTheme: fakeNativeTheme(),
    userDataDir: "U",
  });
  const missingHandlers = new Map<
    string,
    (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown
  >();
  registerWindowApi({
    ipc: { handle: (ch, fn) => missingHandlers.set(ch, fn) },
    appearance: missingAppearance,
    openLink: async () => ({ opened: false }),
    quit: () => {},
    platform: "darwin",
  });
  const missingGetPrefs = missingHandlers.get(WINDOW_GET_PREFS_CHANNEL);
  if (!missingGetPrefs) throw new Error("Missing getPrefs handler");
  expect(await missingGetPrefs({ senderFrame: ownFrame })).toEqual({
    ok: true,
    result: { colorMode: "system", platform: "darwin" },
  });
});

test("TC-ELE-15 the window API has no setBackground and holds no background setting", () => {
  const { handlers } = setupWindowIpc();
  expect([...handlers.keys()]).toEqual([...WINDOW_CHANNELS]);
  expect([...handlers.keys()]).toEqual(WINDOW_CALLS.map((name) => `window:${name}`));

  const setBackgroundWord = ["set", "Background"].join("");
  const keepRunningWord = ["keep", "Running"].join("");
  const openAtLoginWord = ["open", "AtLogin"].join("");

  const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
  expect(new RegExp(`\\b${setBackgroundWord}\\b`).test(preloadSource)).toBe(false);

  expect(
    WindowPrefs.safeParse({ colorMode: "system", platform: "darwin", [keepRunningWord]: true }).success,
  ).toBe(false);
  expect(
    WindowPrefs.safeParse({ colorMode: "system", platform: "darwin", [openAtLoginWord]: true }).success,
  ).toBe(false);
  expect("background" in Settings.shape).toBe(false);

  const electronDir = path.resolve(__dirname);
  const windowJsonFiles: string[] = [];
  for (const entry of readdirSync(electronDir, { recursive: true, encoding: "utf8" })) {
    const normalized = entry.split(path.sep).join("/");
    if (!/\.(?:ts|tsx|mts)$/.test(normalized) || /\.test\.(?:ts|tsx|mts)$/.test(normalized)) continue;
    if (normalized.split("/").includes("test-helpers")) continue;
    if (readFileSync(path.join(electronDir, entry), "utf8").includes("window.json")) {
      windowJsonFiles.push(normalized);
    }
  }
  expect(windowJsonFiles).toEqual(["appearance.ts"]);
});

test("TC-ELE-27 the color mode never calls the runner", async () => {
  const fs = fakeFs();
  const nativeTheme = fakeNativeTheme({ shouldUseDarkColors: false });
  const appearance = createAppearance({ fs, nativeTheme, userDataDir: "U" });
  const link = { call: vi.fn() };
  const handlers = new Map<string, (event: { senderFrame: FrameLike }, ...args: unknown[]) => unknown>();

  registerWindowApi({
    ipc: { handle: (ch, fn) => handlers.set(ch, fn) },
    appearance,
    openLink: async () => ({ opened: false }),
    quit: () => {},
    platform: "darwin",
  });

  const setColorMode = handlers.get(WINDOW_SET_COLOR_MODE_CHANNEL);
  if (!setColorMode) throw new Error("Missing setColorMode handler");
  const reply = await setColorMode({ senderFrame: ownFrame }, "dark");
  expect(reply).toEqual({ ok: true, result: { colorMode: "dark", platform: "darwin" } });
  expect(link.call).not.toHaveBeenCalled();
  expect(nativeTheme.themeSource).toBe("dark");
});
