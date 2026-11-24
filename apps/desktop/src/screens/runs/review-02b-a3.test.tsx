import { act, fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "../../legacy/render-legacy";

test("review: the full report button is usable again after leaving a run while its report loads and coming back", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const original = client.call.bind(client);
  let release: (() => void) | undefined;
  vi.spyOn(client, "call").mockImplementation((name, input) =>
    name === "runs.export"
      ? new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => original(name, input as never))
      : original(name, input as never),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Show full report" }));
  await act(async () => {
    window.location.hash = "#/runs/run-0005";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await screen.findByRole("heading", { level: 2, name: "Report" });
  await act(async () => release?.());
  await act(async () => {
    window.location.hash = "#/runs/run-0006";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  const button = await screen.findByRole("button", { name: /full report/ });
  expect(button).toHaveProperty("disabled", false);
});
