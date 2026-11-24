import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "../test/render";

function withMatchMedia(matcher: (query: string) => boolean, fn: () => void): void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  try {
    fn();
  } finally {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: original });
  }
}

test("TC-UI-28 narrow window uses a drawer with top bar, route close, Close menu, scrim, and Escape focus return", () => {
  withMatchMedia(
    (query) => query.includes("767px"),
    () => {
      renderApp("#/chat", { scenario: "story-v2" });
      const topBar = screen.getByRole("banner");
      const menuButton = within(topBar).getByRole("button", { name: "Menu" });
      expect(within(topBar).getByText("Chats")).toBeTruthy();
      expect(within(topBar).getByRole("link", { name: /^Activity/ })).toBeTruthy();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Main menu" })).toBeNull();

      fireEvent.click(menuButton);
      const drawer = screen.getByRole("dialog", { name: "Menu" });
      const nav = within(drawer).getByRole("navigation", { name: "Main menu" });
      fireEvent.click(within(nav).getByRole("link", { name: "Flows" }));
      expect(window.location.hash).toBe("#/flows");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(within(screen.getByRole("banner")).getByText("Flows")).toBeTruthy();

      fireEvent.click(menuButton);
      const closeButton = within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", {
        name: "Close menu",
      });
      fireEvent.click(closeButton);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(menuButton);

      fireEvent.click(menuButton);
      const scrim = document.querySelector<HTMLElement>('[data-drawer-scrim="true"]');
      expect(scrim).toBeTruthy();
      if (!scrim) throw new Error("Missing drawer scrim");
      fireEvent.click(scrim);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(menuButton);

      fireEvent.click(menuButton);
      expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(menuButton);
    },
  );
});

test("TC-UI-29 below 400 px the menu shows icons while preserving accessible names", () => {
  withMatchMedia(
    (query) => query.includes("767px") || query.includes("399px"),
    () => {
      renderApp("#/chat", { scenario: "story-v2" });
      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      const nav = screen.getByRole("navigation", { name: "Main menu" });
      expect(nav.getAttribute("data-compact")).toBe("true");
      for (const name of ["New chat", "Search", "Flows", "Activity", "Skills", "Settings"]) {
        const control =
          within(nav).queryByRole("button", { name }) ?? within(nav).queryByRole("link", { name });
        expect(control, name).toBeTruthy();
        expect(control?.querySelector("svg"), `${name} svg`).toBeTruthy();
      }
    },
  );
});
