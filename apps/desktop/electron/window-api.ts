export type ColorMode = "light" | "system" | "dark";
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

export function createWindowApi(deps: WindowApiDeps): WindowApi {
  return {
    getPrefs(): WindowPrefs {
      return {
        colorMode: deps.readColorMode() ?? "system",
        platform: deps.platform,
      };
    },
    async openLink(url: string): Promise<{ opened: boolean }> {
      const normalized = normalizeOpenLinkUrl(url);
      if (!normalized) return { opened: false };
      try {
        await deps.shell.openExternal(normalized);
        return { opened: true };
      } catch {
        return { opened: false };
      }
    },
  };
}
