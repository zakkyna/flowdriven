import { waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import screens from "../electron/screens.json";
import { parseRoute } from "./nav/route";
import { renderApp } from "./test/render";

test("every captured screen is a real route, once", () => {
  expect(screens).toHaveLength(11);
  expect(new Set(screens.map((s) => s.name)).size).toBe(11);
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
