export function fakeNotifier(draw: (options: { title: string; body: string }) => void) {
  return class FakeNotification {
    static isSupported() {
      return true;
    }
    constructor(options: { title: string; body: string }) {
      draw(options);
    }
    on(_event: "click" | "close", _callback: () => void) {
      return this;
    }
    show() {}
  };
}

export type ThemeSource = "light" | "system" | "dark";

export function fakeNativeTheme(initial?: {
  themeSource?: ThemeSource;
  shouldUseDarkColors?: boolean;
  onThemeSource?: (value: ThemeSource) => void;
}) {
  let themeSource: ThemeSource = initial?.themeSource ?? "system";
  let shouldUseDarkColors = initial?.shouldUseDarkColors ?? false;
  const themeSourceHistory: ThemeSource[] = [];
  const listeners = new Set<() => void>();
  return {
    themeSourceHistory,
    get themeSource() {
      return themeSource;
    },
    set themeSource(value: ThemeSource) {
      themeSource = value;
      if (value === "dark") shouldUseDarkColors = true;
      else if (value === "light") shouldUseDarkColors = false;
      themeSourceHistory.push(value);
      initial?.onThemeSource?.(value);
    },
    get shouldUseDarkColors() {
      return shouldUseDarkColors;
    },
    set shouldUseDarkColors(value: boolean) {
      shouldUseDarkColors = value;
    },
    on(event: "updated", listener: () => void) {
      if (event === "updated") listeners.add(listener);
    },
    emitUpdated() {
      for (const listener of listeners) listener();
    },
  };
}

export type FakeFsOp = "readFileSync" | "mkdir" | "writeFile" | "rename" | "rm";
export type FakeFsEntry = { op: FakeFsOp; path: string; to?: string };

function fsError(code: "ENOENT" | "EISDIR", message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function fakeFs(initial?: { files?: Record<string, string>; dirs?: string[] }) {
  const files = new Map<string, string>(Object.entries(initial?.files ?? {}));
  const dirs = new Set<string>(initial?.dirs ?? []);
  const log: FakeFsEntry[] = [];
  const failures = new Map<FakeFsOp, Error>();

  return {
    files,
    dirs,
    log,
    setFailure(op: FakeFsOp, error: Error | null) {
      if (error) failures.set(op, error);
      else failures.delete(op);
    },
    readFileSync(filePath: string, _encoding: "utf8"): string {
      log.push({ op: "readFileSync", path: filePath });
      const failure = failures.get("readFileSync");
      if (failure) throw failure;
      if (dirs.has(filePath))
        throw fsError("EISDIR", `EISDIR: illegal operation on a directory, read '${filePath}'`);
      const content = files.get(filePath);
      if (content === undefined)
        throw fsError("ENOENT", `ENOENT: no such file or directory, open '${filePath}'`);
      return content;
    },
    async mkdir(dirPath: string, _options?: { recursive?: boolean }): Promise<void> {
      log.push({ op: "mkdir", path: dirPath });
      const failure = failures.get("mkdir");
      if (failure) throw failure;
      dirs.add(dirPath);
    },
    async writeFile(filePath: string, data: string, _encoding?: "utf8"): Promise<void> {
      log.push({ op: "writeFile", path: filePath });
      const failure = failures.get("writeFile");
      if (failure) throw failure;
      if (dirs.has(filePath))
        throw fsError("EISDIR", `EISDIR: illegal operation on a directory, open '${filePath}'`);
      files.set(filePath, data);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      log.push({ op: "rename", path: oldPath, to: newPath });
      const failure = failures.get("rename");
      if (failure) throw failure;
      const content = files.get(oldPath);
      if (content === undefined)
        throw fsError("ENOENT", `ENOENT: no such file or directory, rename '${oldPath}'`);
      files.delete(oldPath);
      files.set(newPath, content);
    },
    async rm(filePath: string, options?: { force?: boolean }): Promise<void> {
      log.push({ op: "rm", path: filePath });
      const failure = failures.get("rm");
      if (failure) throw failure;
      const removedFile = files.delete(filePath);
      const removedDir = dirs.delete(filePath);
      if (!removedFile && !removedDir && !options?.force) {
        throw fsError("ENOENT", `ENOENT: no such file or directory, rm '${filePath}'`);
      }
    },
  };
}

export function fakeShell() {
  const opened: string[] = [];
  let failure: Error | null = null;
  return {
    opened,
    setFailure(error: Error | null) {
      failure = error;
    },
    async openExternal(url: string): Promise<void> {
      opened.push(url);
      if (failure) throw failure;
    },
  };
}

export type BeforeRequestHandler = (
  details: { url: string },
  callback: (response: { cancel: boolean }) => void,
) => void;

export type PermissionRequestHandler = (
  contents: { getURL(): string },
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string },
) => void;

export type PermissionCheckHandler = (contents: unknown, permission: string, origin: string) => boolean;

export function fakeSession() {
  let onBeforeRequestHandler: BeforeRequestHandler | undefined;
  let permissionRequestHandler: PermissionRequestHandler | undefined;
  let permissionCheckHandler: PermissionCheckHandler | undefined;
  return {
    get onBeforeRequestHandler() {
      return onBeforeRequestHandler;
    },
    get permissionRequestHandler() {
      return permissionRequestHandler;
    },
    get permissionCheckHandler() {
      return permissionCheckHandler;
    },
    webRequest: {
      onBeforeRequest(handler: BeforeRequestHandler) {
        onBeforeRequestHandler = handler;
      },
    },
    setPermissionRequestHandler(handler: PermissionRequestHandler) {
      permissionRequestHandler = handler;
    },
    setPermissionCheckHandler(handler: PermissionCheckHandler) {
      permissionCheckHandler = handler;
    },
  };
}

export type WindowOpenHandler = (details?: { url: string }) => { action: "allow" | "deny" };
export type WebContentsListener = (...args: never[]) => void;

export function fakeWindow(options?: {
  focused?: boolean;
  destroyed?: boolean;
  minimized?: boolean;
  url?: string;
}) {
  let focused = options?.focused ?? false;
  let destroyed = options?.destroyed ?? false;
  let minimized = options?.minimized ?? false;
  const currentUrl = options?.url ?? "app://flowdriven/index.html";
  const loadedUrls: string[] = [];
  const backgroundColors: string[] = [];
  const listeners = new Map<string, WebContentsListener[]>();
  const sent: { channel: string; args: unknown[] }[] = [];
  let windowOpenHandler: WindowOpenHandler | undefined;

  return {
    loadedUrls,
    backgroundColors,
    setFocused(value: boolean) {
      focused = value;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    isFocused() {
      return focused;
    },
    isDestroyed() {
      return destroyed;
    },
    isMinimized() {
      return minimized;
    },
    restore() {
      minimized = false;
    },
    focus() {
      focused = true;
    },
    setBackgroundColor(color: string) {
      backgroundColors.push(color);
    },
    hide() {},
    show() {},
    async loadURL(url: string): Promise<void> {
      loadedUrls.push(url);
    },
    webContents: {
      mainFrame: { url: currentUrl },
      sent,
      get windowOpenHandler() {
        return windowOpenHandler;
      },
      get listeners() {
        return listeners;
      },
      getURL() {
        return currentUrl;
      },
      setWindowOpenHandler(handler: WindowOpenHandler) {
        windowOpenHandler = handler;
      },
      on(event: string, listener: WebContentsListener) {
        const list = listeners.get(event) ?? [];
        list.push(listener);
        listeners.set(event, list);
      },
      emit(event: string, ...args: unknown[]) {
        for (const listener of listeners.get(event) ?? []) {
          (listener as (...callArgs: unknown[]) => void)(...args);
        }
      },
      send(channel: string, ...args: unknown[]) {
        sent.push({ channel, args });
      },
    },
  };
}
