import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import screens from "../electron/screens.json";
import { parseRoute } from "./nav/route";
import { renderApp } from "./test/render";

test("every captured screen is a real route, once", () => {
  expect(screens).toHaveLength(13);
  expect(new Set(screens.map((s) => s.name)).size).toBe(13);
  for (const s of screens) expect(s.name).toMatch(/^[a-z0-9-]+$/);
  for (const s of screens) expect(parseRoute(`#${s.hash}`).screen).not.toBe("not_found");
});

test("every captured screen becomes ready and never shows Loading once ready", {
  timeout: 30_000,
}, async () => {
  for (const entry of screens) {
    const view = renderApp(`#${entry.hash}`, { scenario: entry.scenario as "long" | "looped" | undefined });
    await waitFor(() =>
      expect(view.container.querySelector('[data-screen-ready="true"]'), entry.name).not.toBeNull(),
    );
    expect(view.container.querySelector('[role="status"]'), entry.name).toBeNull();
    view.unmount();
  }
});

test("every scrollTo names an element of its ready screen", { timeout: 30_000 }, async () => {
  const scrolled = screens.filter((entry) => "scrollTo" in entry);
  expect(scrolled.map((entry) => entry.name)).toEqual(["builder-triggers", "builder-capabilities"]);
  for (const entry of scrolled) {
    const id = "scrollTo" in entry ? entry.scrollTo : "";
    expect(id).toBe(entry.name === "builder-triggers" ? "triggers-heading" : "capabilities-heading");
    const view = renderApp(`#${entry.hash}`, { scenario: entry.scenario as "long" | "looped" | undefined });
    await waitFor(() =>
      expect(view.container.querySelector('[data-screen-ready="true"]'), entry.name).not.toBeNull(),
    );
    expect(view.container.querySelector(`#${id}`), entry.name).not.toBeNull();
    view.unmount();
  }
});

test("the readiness screen of the job-alert flow shows the Chrome row as OK with the unofficial route", async () => {
  renderApp("#/readiness/dev.example.job-review", { scenario: "looped" });
  const row = await screen.findByRole("listitem", { name: "web:upwork-jobs" });
  expect(within(row).getByText("OK")).toBeTruthy();
  expect(within(row).getByText("Unofficial")).toBeTruthy();
  expect(within(row).getByText("Route: Claude in Chrome inside Claude Code")).toBeTruthy();
  expect(within(row).getByText(/personal browser/)).toBeTruthy();
});
