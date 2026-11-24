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

export function fakeNativeTheme(initial?: { themeSource?: ThemeSource; shouldUseDarkColors?: boolean }) {
  const listeners = new Set<() => void>();
  return {
    themeSource: initial?.themeSource ?? ("system" as ThemeSource),
    shouldUseDarkColors: initial?.shouldUseDarkColors ?? false,
    on(event: "updated", listener: () => void) {
      if (event === "updated") listeners.add(listener);
    },
    emitUpdated() {
      for (const listener of listeners) listener();
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

export function fakeWindow(options?: { focused?: boolean; destroyed?: boolean; url?: string }) {
  let focused = options?.focused ?? false;
  let destroyed = options?.destroyed ?? false;
  const currentUrl = options?.url ?? "app://flowdriven/index.html";
  const loadedUrls: string[] = [];
  const listeners = new Map<string, WebContentsListener[]>();
  const sent: { channel: string; args: unknown[] }[] = [];
  let windowOpenHandler: WindowOpenHandler | undefined;

  return {
    loadedUrls,
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
