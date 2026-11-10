import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "./test/render";

test("the rail lists the six screens in order with the inbox count", async () => {
  renderApp("#/runs");
  const nav = screen.getByRole("navigation", { name: "Main" });
  const links = within(nav).getAllByRole("link");
  expect(links.map((l) => l.getAttribute("href"))).toEqual([
    "#/builder",
    "#/inbox",
    "#/runs",
    "#/readiness",
    "#/harnesses",
    "#/settings",
  ]);
  expect(await within(nav).findByRole("link", { name: "Inbox, 5 waiting" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByText("Sample data. Nothing here runs yet.")).toBeTruthy();
  expect(screen.getByText("Browser preview")).toBeTruthy();
});
test("navigating changes the screen", async () => {
  renderApp("#/builder");
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
});
test("shows page not found", () => {
  renderApp("#/nowhere");
  expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
  expect(screen.getByText("There is no page at #/nowhere.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Go to Builder" })).toBeTruthy();
});
test("an in-app link changes the hash", async () => {
  renderApp("#/nowhere");
  fireEvent.click(screen.getByRole("link", { name: "Go to Builder" }));
  await waitFor(() => expect(window.location.hash).toBe("#/builder"));
});
test("empty: no count on the inbox once the data has loaded", async () => {
  renderApp("#/builder", { scenario: "empty" });
  const nav = screen.getByRole("navigation", { name: "Main" });
  await waitFor(() => expect(nav.getAttribute("aria-busy")).toBe("false"));
  expect(within(nav).getByRole("link", { name: "Inbox" })).toBeTruthy();
  expect(within(nav).queryByRole("link", { name: /waiting/ })).toBeNull();
});

test("route changes reset scroll, title and focus", async () => {
  renderApp("#/runs");
  const main = screen.getByRole("main");
  main.scrollTop = 200;
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  await waitFor(() => {
    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(main.scrollTop).toBe(0);
    expect(document.title).toBe("Settings - FlowDriven");
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });
});
test("skip link is first and targets the main content without an extra landmark", () => {
  renderApp("#/runs");
  const link = screen.getByRole("link", { name: "Skip to content" });
  expect(document.querySelector("a")).toBe(link);
  expect(link.getAttribute("href")).toBe("#main-content");
  expect(screen.getByRole("main").id).toBe("main-content");
  expect(screen.queryByRole("complementary")).toBeNull();
});
