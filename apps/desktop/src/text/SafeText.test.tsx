import type { WindowReply } from "@flowdriven/contracts";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { LanguageProvider } from "../shell/language";
import { ToastProvider } from "../ui/Toast";
import { SafeText } from "./SafeText";

type OpenLinkSpy = (url: string) => Promise<WindowReply<{ opened: boolean }>>;

type TestWindow = Window & {
  __hit?: unknown;
  flowdrivenShell?: {
    kind: string;
    window?: {
      openLink?: OpenLinkSpy;
    };
  };
};

const originalShell = (window as TestWindow).flowdrivenShell;
const originalHash = window.location.hash;

afterEach(() => {
  cleanup();
  (window as TestWindow).flowdrivenShell = originalShell;
  window.location.hash = originalHash;
  Reflect.deleteProperty(window, "__hit");
  vi.restoreAllMocks();
});

function setOpenLinkSpy(openLink: OpenLinkSpy): void {
  (window as TestWindow).flowdrivenShell = {
    kind: "electron",
    window: { openLink },
  };
}

function renderSafeText(ui: ReactElement, options?: { language?: string }) {
  return render(
    <LanguageProvider language={options?.language}>
      <ToastProvider>{ui}</ToastProvider>
    </LanguageProvider>,
  );
}

test("TC-UI-01 HTML in agent text is drawn as text", () => {
  const input =
    '<img src=x onerror="window.__hit = 1"><script>window.__hit = 2</script><b>bold</b><a href="https://example.com">x</a>';
  const { container } = renderSafeText(<SafeText text={input} />);

  expect(container.textContent).toBe(input);
  expect(container.querySelector("img, script, b, a, iframe, object, embed, svg, style")).toBeNull();
  expect((window as TestWindow).__hit).toBeUndefined();
  expect(container.innerHTML).toContain("&lt;img");
  expect(container.innerHTML).toContain("&lt;script&gt;");
});

test("TC-UI-02 Markdown and remote images are not interpreted", () => {
  const input = "![chart](https://example.com/p.png) **bold** [link](https://example.com) # heading";
  const imageSpy = vi.fn();
  const fetchSpy = vi.fn();
  const xhrSpy = vi.fn();
  vi.stubGlobal("Image", imageSpy);
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("XMLHttpRequest", xhrSpy);

  try {
    const { container } = renderSafeText(<SafeText text={input} />);
    expect(container.textContent).toBe(input);
    expect(container.querySelector("img, strong, em, h1, a")).toBeNull();
    expect(imageSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("TC-UI-03 Line breaks are kept and nothing is trimmed away", () => {
  const input = "Line one\nLine two\n\n  indented";
  const { container } = renderSafeText(<SafeText text={input} />);

  expect(container.textContent).toBe(input);
  const el = container.querySelector<HTMLElement>('[data-wrap="pre"]');
  expect(el).not.toBeNull();
  expect(el?.textContent).toBe(input);
  expect(el?.style.whiteSpace).toBe("pre-wrap");
  expect(container.querySelector("br, p")).toBeNull();
});

test("TC-UI-04 Hidden characters are made visible", () => {
  const hiddenPoints = [0x200b, 0x202e, 0xe0041, 0xfeff];
  const firstInput = `Pay${String.fromCodePoint(0x200b)}now${String.fromCodePoint(0x202e)}x${String.fromCodePoint(0xe0041)}${String.fromCodePoint(0xfeff)}`;

  const first = renderSafeText(<SafeText text={firstInput} />);
  expect(first.container.textContent).toBe(
    "Pay[U+200B hidden character]now[U+202E hidden character]x[U+E0041 hidden character][U+FEFF hidden character]",
  );
  for (const cp of hiddenPoints) {
    expect(first.container.textContent).not.toContain(String.fromCodePoint(cp));
  }

  cleanup();

  const secondInput = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x65e5)}`;
  const second = renderSafeText(<SafeText text={secondInput} />);
  expect(second.container.textContent).toBe(secondInput);
  expect(second.container.textContent).not.toContain("[U+");
  expect(second.container.textContent).not.toContain("hidden character");
});

test("TC-UI-05 Outside text carries the tag once", () => {
  const withOutside = renderSafeText(<SafeText text="Body text" outside />, { language: "en" });
  const enTags = screen.getAllByText("Includes text from an email or web page");
  expect(enTags).toHaveLength(1);
  const enBody = screen.getByText("Body text");
  expect(enTags[0]).not.toBe(enBody);
  expect(withOutside.container.textContent).toContain("Includes text from an email or web page");

  cleanup();

  renderSafeText(<SafeText text="Body text" outside={false} />, { language: "en" });
  expect(screen.queryByText("Includes text from an email or web page")).toBeNull();
  expect(screen.getByText("Body text")).toBeTruthy();

  cleanup();

  renderSafeText(<SafeText text="Body text" outside />, { language: "id" });
  expect(screen.getAllByText("Berisi teks dari email atau halaman web")).toHaveLength(1);
  expect(screen.getByText("Body text")).toBeTruthy();
});

test("TC-UI-06 An address is plain text unless the part asks for clickable links", () => {
  const input =
    "Open https://example.com/a?x=1, then http://example.com and javascript:alert(1) and file:///x and data:text/html,x";

  const textMode = renderSafeText(<SafeText text={input} links="text" />);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(textMode.container.querySelector("a")).toBeNull();
  expect(textMode.container.textContent).toBe(input);

  cleanup();

  const defaultMode = renderSafeText(<SafeText text={input} />);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(defaultMode.container.querySelector("a")).toBeNull();
  expect(defaultMode.container.textContent).toBe(input);

  cleanup();

  const clickableMode = renderSafeText(<SafeText text={input} links="clickable" />);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  const link = screen.getByRole("link", { name: "https://example.com/a?x=1" });
  expect(link.tagName).toBe("BUTTON");
  expect(link.hasAttribute("href")).toBe(false);
  expect(clickableMode.container.querySelector("a")).toBeNull();
  expect(clickableMode.container.textContent).toBe(input);
});

test("TC-UI-07 A click opens the link through main, and only a click", async () => {
  window.location.hash = "#/chat/c-1";
  const openLink = vi.fn<OpenLinkSpy>(() => Promise.resolve({ ok: true, result: { opened: true } }));
  setOpenLinkSpy(openLink);
  const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

  renderSafeText(
    <SafeText text="See https://example.com/a (and https://example.com/b)." links="clickable" />,
  );

  await act(async () => {
    await Promise.resolve();
  });
  expect(openLink).toHaveBeenCalledTimes(0);

  const firstLink = screen.getByRole("link", { name: "https://example.com/a" });
  const secondLink = screen.getByRole("link", { name: "https://example.com/b" });

  await act(async () => {
    fireEvent.click(firstLink);
    await Promise.resolve();
  });
  expect(openLink).toHaveBeenCalledTimes(1);
  expect(openLink).toHaveBeenLastCalledWith("https://example.com/a");

  await act(async () => {
    const enterEvent = createEvent.keyDown(secondLink, { key: "Enter" });
    fireEvent(secondLink, enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    await Promise.resolve();
  });
  expect(openLink).toHaveBeenCalledTimes(2);
  expect(openLink).toHaveBeenLastCalledWith("https://example.com/b");

  await act(async () => {
    fireEvent(firstLink, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    await Promise.resolve();
  });
  expect(openLink).toHaveBeenCalledTimes(3);
  expect(openLink).toHaveBeenLastCalledWith("https://example.com/a");

  await act(async () => {
    fireEvent.click(firstLink, { ctrlKey: true });
    await Promise.resolve();
  });
  expect(openLink).toHaveBeenCalledTimes(4);
  expect(openLink.mock.calls).toEqual([
    ["https://example.com/a"],
    ["https://example.com/b"],
    ["https://example.com/a"],
    ["https://example.com/a"],
  ]);
  expect(windowOpen).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("#/chat/c-1");
});

test("TC-UI-08 The full address is shown, and a refused open is quiet", async () => {
  window.location.hash = "#/chat/c-2";
  const longUrl = `https://example.com/${"a".repeat(280)}`;
  const openLink = vi.fn<OpenLinkSpy>(() => Promise.resolve({ ok: true, result: { opened: false } }));
  setOpenLinkSpy(openLink);

  renderSafeText(<SafeText text={longUrl} links="clickable" />);

  const link = screen.getByRole("link", { name: longUrl });
  expect(link.textContent).toBe(longUrl);
  expect(link.textContent).not.toContain("...");

  await act(async () => {
    fireEvent.click(link);
    await Promise.resolve();
  });

  expect(openLink).toHaveBeenCalledWith(longUrl);
  expect(window.location.hash).toBe("#/chat/c-2");
  expect(screen.getByRole("status").textContent).toContain("The link was not opened.");
});
