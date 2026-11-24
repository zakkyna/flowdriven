import { act, fireEvent, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "./test/render";

const oldHashPattern = /^#\/(builder|inbox|runs|readiness|harnesses)(\/|$)/;

function oldRouteLinks(): string[] {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((el) => el.getAttribute("href") ?? "")
    .filter((href) => oldHashPattern.test(href));
}

test("TC-UI-30 renders the nine new routes with placeholders, no old-route links, and no redirects", () => {
  const cases: [string, string][] = [
    ["#/chat", "Chats"],
    ["#/chat/chat-1", "Chats"],
    ["#/flows", "Flows"],
    ["#/flows/example.fill-timesheet", "Flows"],
    ["#/activity", "Activity"],
    ["#/activity/run-1", "Activity"],
    ["#/skills", "Skills"],
    ["#/settings", "Settings"],
    ["#/welcome", "Welcome"],
  ];
  for (const [hash, title] of cases) {
    const view = renderApp(hash);
    expect(window.location.hash, hash).toBe(hash);
    const heading = screen.getByRole("heading", { level: 1, name: title });
    expect(heading.getAttribute("tabindex"), hash).toBe("-1");
    expect(document.activeElement, hash).toBe(heading);
    expect(document.title, hash).toBe(`${title} - FlowDriven`);
    expect(oldRouteLinks(), hash).toEqual([]);
    expect(screen.queryByRole("navigation", { name: "Main" }), hash).toBeNull();
    expect(screen.queryByRole("link", { name: "New flow" }), hash).toBeNull();
    expect(screen.queryByRole("link", { name: /Inbox/ }), hash).toBeNull();
    view.unmount();
  }
});

test("TC-UI-30 renders the not-found page for unknown hashes with no old-route link and no redirect", () => {
  renderApp("#/nowhere");
  expect(window.location.hash).toBe("#/nowhere");
  const heading = screen.getByRole("heading", { level: 1, name: "Page not found" });
  expect(heading.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement).toBe(heading);
  expect(document.title).toBe("Page not found - FlowDriven");
  expect(screen.getByText("The page you requested could not be found.")).toBeTruthy();
  expect(oldRouteLinks()).toEqual([]);
});

test("skip link is first, targets main without an extra landmark, and route changes move heading focus", () => {
  renderApp("#/flows");
  const skip = screen.getByRole("link", { name: "Skip to content" });
  expect(document.querySelector("a")).toBe(skip);
  expect(skip.getAttribute("href")).toBe("#main-content");
  const main = screen.getByRole("main");
  expect(main.id).toBe("main-content");
  expect(main.getAttribute("tabindex")).toBe("-1");
  expect(screen.queryByRole("complementary")).toBeNull();

  fireEvent.click(skip);
  expect(window.location.hash).toBe("#/flows");
  expect(document.activeElement).toBe(main);

  act(() => {
    window.location.hash = "#/activity";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  const nextHeading = screen.getByRole("heading", { level: 1, name: "Activity" });
  expect(document.activeElement).toBe(nextHeading);
  expect(document.title).toBe("Activity - FlowDriven");
});

test("TC-UI-30 renders LegacyApp under the legacy provider for old routes, empty hash, and root hash without redirecting", async () => {
  const legacyHashes = [
    "",
    "#/",
    "#/builder",
    "#/inbox",
    "#/runs",
    "#/harnesses",
    "#/readiness/example.fill-timesheet",
  ];
  for (const hash of legacyHashes) {
    const view = renderApp(hash);
    expect(window.location.hash, hash).toBe(hash);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav, hash).toBeTruthy();
    if (hash === "#/runs") {
      expect(await within(nav).findByRole("link", { name: "Inbox, 5 waiting" })).toBeTruthy();
    }
    view.unmount();
  }
});
