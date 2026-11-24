import path from "node:path";
import { windowBackground } from "./window-colors";

export type ColorMode = "light" | "system" | "dark";
export type AppearanceErrorCode = "invalid_input" | "unavailable";

export class AppearanceError extends Error {
  readonly code: AppearanceErrorCode;

  constructor(code: AppearanceErrorCode, message: string) {
    super(message);
    this.name = "AppearanceError";
    this.code = code;
  }
}

export type AppearanceFs = {
  readFileSync(path: string, encoding: "utf8"): string;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { force?: boolean }): Promise<void>;
};

export type AppearanceNativeTheme = {
  themeSource: ColorMode;
  shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): unknown;
};

export type AppearanceWindow = {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
};

export type AppearanceDeps = {
  fs: AppearanceFs;
  nativeTheme: AppearanceNativeTheme;
  userDataDir: string;
};

export type Appearance = {
  load(): { colorMode: ColorMode };
  set(mode: unknown): Promise<ColorMode>;
  track(window: AppearanceWindow): void;
};

export function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "system" || value === "dark";
}

function parseWindowColorMode(raw: string): ColorMode {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "system";
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !Object.hasOwn(parsed, "version") || !Object.hasOwn(parsed, "colorMode")) {
    return "system";
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !isColorMode(record.colorMode)) return "system";
  return record.colorMode;
}

export function createAppearance({ fs, nativeTheme, userDataDir }: AppearanceDeps): Appearance {
  const filePath = path.join(userDataDir, "window.json");
  const tempPath = path.join(userDataDir, "window.json.tmp");
  const tracked = new Set<AppearanceWindow>();
  let notified = false;

  const applyBackgrounds = () => {
    const color = windowBackground(nativeTheme.shouldUseDarkColors);
    for (const window of tracked) {
      if (window.isDestroyed()) tracked.delete(window);
      else window.setBackgroundColor(color);
    }
  };

  nativeTheme.on("updated", () => {
    notified = true;
    applyBackgrounds();
  });

  return {
    load(): { colorMode: ColorMode } {
      let colorMode: ColorMode = "system";
      try {
        colorMode = parseWindowColorMode(fs.readFileSync(filePath, "utf8"));
      } catch {
        colorMode = "system";
      }
      nativeTheme.themeSource = colorMode;
      return { colorMode };
    },
    async set(mode: unknown): Promise<ColorMode> {
      if (!isColorMode(mode)) {
        throw new AppearanceError("invalid_input", "Invalid color mode.");
      }
      const payload = `${JSON.stringify({ version: 1, colorMode: mode })}\n`;
      try {
        await fs.mkdir(userDataDir, { recursive: true });
        await fs.writeFile(tempPath, payload, "utf8");
        await fs.rename(tempPath, filePath);
      } catch {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw new AppearanceError("unavailable", "Could not save appearance.");
      }
      notified = false;
      nativeTheme.themeSource = mode;
      if (!notified) applyBackgrounds();
      return mode;
    },
    track(window: AppearanceWindow): void {
      if (window.isDestroyed()) return;
      tracked.add(window);
      window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors));
    },
  };
}
