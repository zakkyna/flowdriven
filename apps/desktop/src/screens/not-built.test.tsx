import { RunnerError } from "@flowdriven/contracts/v1";
import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "../legacy/render-legacy";

function render(hash: string) {
  const result = renderApp(hash, { scenario: "empty" });
  const original = result.client.call.bind(result.client);
  vi.spyOn(result.client, "call").mockImplementation((name, input) => {
    if (name === "harnesses.list") return Promise.resolve([] as never);
    if (name === "settings.get")
      return Promise.resolve({
        brain: { main: null, subscriptionOrder: [], apiKeyOrder: [] },
        backends: [],
        budget: { month: "2026-11", capUsd: 0, perRunCapUsd: null, spentUsd: 0 },
        offerSaveOneTime: true,
      } as never);
    if (name === "flows.build")
      return Promise.reject(
        new RunnerError("unavailable", "Building a flow from chat arrives with the agent."),
      );
    return original(name, input as never);
  });
  return result;
}
test("Harnesses shows its empty state for an empty list", async () => {
  render("#/harnesses");
  expect(await screen.findByText("No harnesses found.")).toBeTruthy();
});
test("Settings shows the defaults without breaking", async () => {
  render("#/settings");
  expect(await screen.findByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
  await screen.findByRole("radiogroup", { name: "Main brain" });
  expect(screen.queryByRole("alert")).toBeNull();
});
test("the Builder chat shows the not-built sentence and keeps the draft", async () => {
  render("#/builder/new");
  const input = await screen.findByLabelText("Message");
  fireEvent.change(input, { target: { value: "Draft flow" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Building a flow from chat arrives with the agent.",
  );
  expect(input).toHaveProperty("value", "Draft flow");
});
