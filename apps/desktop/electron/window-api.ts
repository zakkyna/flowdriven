import { type Appearance, type ColorMode, isColorMode } from "./appearance";
import { type IpcLike, isOwnMainFrame } from "./runner-ipc";

export type { ColorMode };
export type WindowPlatform = "darwin" | "win32" | "linux";
export type WindowPrefs = { colorMode: ColorMode; platform: WindowPlatform };
export type ShellLike = { openExternal(url: string): Promise<void> };
export type WindowApiDeps = {
  shell: ShellLike;
  platform: WindowPlatform;
  readColorMode: () => ColorMode | undefined;
};
export type WindowApi = {
  getPrefs(): WindowPrefs;
  openLink(url: string): Promise<{ opened: boolean }>;
};

export const WINDOW_GET_PREFS_CHANNEL = "window:getPrefs";
export const WINDOW_SET_COLOR_MODE_CHANNEL = "window:setColorMode";
export const WINDOW_OPEN_LINK_CHANNEL = "window:openLink";
export const WINDOW_QUIT_CHANNEL = "window:quit";
export const WINDOW_CHANNELS = [
  WINDOW_GET_PREFS_CHANNEL,
  WINDOW_SET_COLOR_MODE_CHANNEL,
  WINDOW_OPEN_LINK_CHANNEL,
  WINDOW_QUIT_CHANNEL,
] as const;

export type WindowReply<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: "not_allowed" | "invalid_input" | "unavailable"; message: string } };

export type RegisterWindowApiDeps = {
  ipc: IpcLike;
  appearance: Pick<Appearance, "load" | "set">;
  openLink: (url: string) => Promise<{ opened: boolean }> | { opened: boolean };
  quit: () => Promise<void> | void;
  platform?: NodeJS.Platform;
};

export function normalizeOpenLinkUrl(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.includes(":") || host.startsWith("[") || host.endsWith("]")) return null;
  if (/^\d+(?:\.\d+){3}$/.test(host)) return null;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host.includes("..")) return null;

  const lastLabel = host.split(".").at(-1) ?? "";
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(lastLabel)) return null;

  return parsed.href;
}

export function createOpenLink(shell: ShellLike): (url: string) => Promise<{ opened: boolean }> {
  return async (url: string) => {
    const normalized = normalizeOpenLinkUrl(url);
    if (!normalized) return { opened: false };
    try {
      await shell.openExternal(normalized);
      return { opened: true };
    } catch {
      return { opened: false };
    }
  };
}

export function createWindowApi(deps: WindowApiDeps): WindowApi {
  const openLink = createOpenLink(deps.shell);
  return {
    getPrefs(): WindowPrefs {
      return {
        colorMode: deps.readColorMode() ?? "system",
        platform: deps.platform,
      };
    },
    openLink,
  };
}

function resolvePlatform(platform: NodeJS.Platform = process.platform): WindowPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  return "linux";
}

function notAllowedReply(): WindowReply<never> {
  return { ok: false, error: { code: "not_allowed", message: "This window cannot use the window API." } };
}

function invalidInputReply(message: string): WindowReply<never> {
  return { ok: false, error: { code: "invalid_input", message } };
}

export function registerWindowApi(deps: RegisterWindowApiDeps): void {
  const platform = resolvePlatform(deps.platform);

  deps.ipc.handle(WINDOW_GET_PREFS_CHANNEL, (event, ...args): WindowReply<WindowPrefs> => {
    if (!isOwnMainFrame(event.senderFrame)) return notAllowedReply();
    if (args.length !== 0) return invalidInputReply("Expected no arguments.");
    const { colorMode } = deps.appearance.load();
    return { ok: true, result: { colorMode, platform } };
  });

  deps.ipc.handle(
    WINDOW_SET_COLOR_MODE_CHANNEL,
    async (event, ...args): Promise<WindowReply<WindowPrefs>> => {
      if (!isOwnMainFrame(event.senderFrame)) return notAllowedReply();
      if (args.length !== 1) return invalidInputReply("Expected one argument.");
      const [mode] = args;
      if (!isColorMode(mode)) return invalidInputReply("Invalid color mode.");
      try {
        const colorMode = await deps.appearance.set(mode);
        return { ok: true, result: { colorMode, platform } };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          "message" in error &&
          (error.code === "invalid_input" || error.code === "unavailable") &&
          typeof error.message === "string"
        ) {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        return { ok: false, error: { code: "unavailable", message: "Could not save appearance." } };
      }
    },
  );

  deps.ipc.handle(
    WINDOW_OPEN_LINK_CHANNEL,
    async (event, ...args): Promise<WindowReply<{ opened: boolean }>> => {
      if (!isOwnMainFrame(event.senderFrame)) return notAllowedReply();
      if (args.length !== 1) return invalidInputReply("Expected one argument.");
      const [raw] = args;
      const normalized = typeof raw === "string" ? normalizeOpenLinkUrl(raw) : null;
      if (!normalized) return invalidInputReply("Invalid link.");
      try {
        const result = await deps.openLink(normalized);
        return { ok: true, result: { opened: Boolean(result.opened) } };
      } catch {
        return { ok: false, error: { code: "unavailable", message: "Could not open link." } };
      }
    },
  );

  deps.ipc.handle(
    WINDOW_QUIT_CHANNEL,
    async (event, ...args): Promise<WindowReply<Record<string, never>>> => {
      if (!isOwnMainFrame(event.senderFrame)) return notAllowedReply();
      if (args.length !== 0) return invalidInputReply("Expected no arguments.");
      try {
        await deps.quit();
        return { ok: true, result: {} };
      } catch {
        return { ok: false, error: { code: "unavailable", message: "Could not quit." } };
      }
    },
  );
}
