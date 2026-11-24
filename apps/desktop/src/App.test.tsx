import { createFixtureRunnerClient } from "@flowdriven/fixtures/v1";
import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";
import { RunnerProvider } from "./legacy/runner-context";

test("App mounts LegacyApp under the legacy provider until the new shell lands", async () => {
  window.location.hash = "#/runs";
  const client = createFixtureRunnerClient();
  render(
    <RunnerProvider client={client}>
      <App />
    </RunnerProvider>,
  );
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(await within(nav).findByRole("link", { name: "Inbox, 5 waiting" })).toBeTruthy();
});
