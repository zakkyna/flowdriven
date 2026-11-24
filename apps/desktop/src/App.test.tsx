import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "./legacy/render-legacy";

const flowIds = [
  "documents-and-reports",
  "figma-to-flutter",
  "email-triage",
  "lead-follow-up",
  "social-posts",
];
const flowsNav = () => screen.getByRole("navigation", { name: "Flows" });

test("the rail lists five destinations, New flow and the inbox count", async () => {
  renderApp("#/runs");
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href")),
  ).toEqual(["#/inbox", "#/runs", "#/readiness", "#/harnesses", "#/settings"]);
  expect(within(nav).queryByRole("link", { name: "Builder" })).toBeNull();
  expect(await within(nav).findByRole("link", { name: "Inbox, 5 waiting" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Runs" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "New flow" }).getAttribute("href")).toBe("#/builder/new");
  const stops = Array.from(document.querySelectorAll("a[href], button")).slice(0, 3);
  expect(stops.map((el) => el.getAttribute("href"))).toEqual(["#main-content", "#/builder/new", "#/inbox"]);
  expect(await screen.findByText("Sample data. Nothing here runs yet.")).toBeTruthy();
  expect(screen.getByText("Browser preview")).toBeTruthy();
});
test("every flow in the sidebar has an icon and a state word", async () => {
  renderApp("#/builder/dev.example.figma-to-flutter");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links.map((l) => l.getAttribute("href"))).toEqual(
    flowIds.map((id) => `#/builder/dev.example.${id}`),
  );
  const words = ["Done", "Blocked", "Waiting for you", "Interrupted", "Waiting for you"];
  links.forEach((link, i) => {
    expect(link.textContent, flowIds[i]).toContain(words[i]);
    expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(link.getAttribute("aria-current")).toBe(i === 1 ? "page" : null);
  });
});
test("the first flow is current at #/builder, and nothing is current on other screens", async () => {
  const first = renderApp("#/builder");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links[0]?.getAttribute("aria-current")).toBe("page");
  first.unmount();
  renderApp("#/settings");
  const others = await within(flowsNav()).findAllByRole("link");
  expect(others.every((l) => !l.hasAttribute("aria-current"))).toBe(true);
});
test("New flow is current at #/builder/new and no flow is", async () => {
  renderApp("#/builder/new");
  expect(screen.getByRole("link", { name: "New flow" }).getAttribute("aria-current")).toBe("page");
  const links = await within(flowsNav()).findAllByRole("link");
  expect(links.every((l) => !l.hasAttribute("aria-current"))).toBe(true);
});
test("choosing a flow opens it in the Builder", async () => {
  renderApp("#/settings");
  fireEvent.click(await within(flowsNav()).findByRole("link", { name: /Email triage and draft replies/ }));
  await waitFor(() => expect(window.location.hash).toBe("#/builder/dev.example.email-triage"));
  expect(
    await screen.findByRole("heading", { level: 1, name: "Email triage and draft replies" }),
  ).toBeTruthy();
});
test("a long flow name wraps in the sidebar and is never cut off", async () => {
  renderApp("#/builder", { scenario: "long" });
  const links = await within(flowsNav()).findAllByRole("link");
  const last = links.at(-1) as HTMLElement;
  expect(last.textContent).toMatch(/^Quarterly supplier compliance .* northern distribution network/);
  expect(last.textContent).toContain("No runs yet");
  const css = readFileSync("apps/desktop/src/nav/Sidebar.module.css", "utf8");
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
  expect(css).not.toMatch(/text-overflow:\s*ellipsis/);
});
test("with no flows the list says where they will appear", async () => {
  renderApp("#/inbox", { scenario: "empty" });
  expect(await screen.findByText("Flows you make appear here.")).toBeTruthy();
});
test("the frame styles follow the approved layout", () => {
  const app = readFileSync("apps/desktop/src/App.module.css", "utf8");
  const sidebar = readFileSync("apps/desktop/src/nav/Sidebar.module.css", "utf8");
  expect(app).toMatch(/\.frame\s*\{[^}]*grid-template-columns:\s*var\(--rail-width\) minmax\(0, 1fr\)/s);
  expect(sidebar).toMatch(/background:\s*var\(--surface-rail\)/);
  expect(sidebar).toMatch(/\[aria-current="page"\][^{]*\{[^}]*background:\s*var\(--surface-selected\)/s);
  expect(sidebar).toMatch(/\[aria-current="page"\]::before[^{]*\{[^}]*background:\s*var\(--accent\)/s);
  expect(sidebar).toMatch(
    /\.newFlow\[aria-current="page"\]\s*\{[^}]*background:\s*var\(--surface-selected\)/s,
  );
  expect(`${app}${sidebar}`).not.toMatch(/box-shadow/);
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
  renderApp("#/inbox/ap-0011");
  await screen.findByRole("heading", { level: 2, name: "Send a reply to Priya Shah about invoice 1042" });
  const page = document.querySelector<HTMLElement>('section[data-screen="inbox"]');
  if (!page) throw new Error("Missing inbox page");
  const zone = () => page.querySelector<HTMLElement>('[data-scroll="top"]');
  const first = zone();
  if (!first) throw new Error("Missing decision scroller");
  first.scrollTop = 200;
  const item = within(page)
    .getAllByRole("button", { name: /expires/i })
    .find((b) => b.getAttribute("aria-current") !== "true");
  if (!item) throw new Error("Missing inbox item");
  fireEvent.click(item);
  await waitFor(() => expect(window.location.hash).not.toBe("#/inbox/ap-0011"));
  await waitFor(() => expect(zone()?.scrollTop).toBe(0));
  fireEvent.click(screen.getByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  await waitFor(() => {
    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(
      document.querySelector<HTMLElement>('section[data-screen="settings"] [data-scroll="top"]')?.scrollTop,
    ).toBe(0);
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

test("the notice follows runner.info", async () => {
  const first = renderApp("#/runs");
  const original = first.client.call.bind(first.client);
  vi.spyOn(first.client, "call").mockImplementation((name, input) =>
    name === "runner.info"
      ? Promise.resolve({ contractVersion: 1, mode: "demo" } as never)
      : original(name, input as never),
  );
  expect(await screen.findByText("Demo engine. A script plays the steps.")).toBeTruthy();
  first.unmount();
  const second = renderApp("#/runs");
  const other = second.client.call.bind(second.client);
  vi.spyOn(second.client, "call").mockImplementation((name, input) =>
    name === "runner.info"
      ? Promise.resolve({ contractVersion: 1, mode: "live" } as never)
      : other(name, input as never),
  );
  await waitFor(() => expect(second.client.call).toHaveBeenCalledWith("runner.info", {}));
  await screen.findByRole("link", { name: "Inbox, 5 waiting" });
  expect(screen.queryByText("Demo engine. A script plays the steps.")).toBeNull();
  expect(screen.queryByText("Sample data. Nothing here runs yet.")).toBeNull();
  expect(screen.getByText("Browser preview")).toBeTruthy();
});
