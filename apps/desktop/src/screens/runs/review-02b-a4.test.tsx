import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "../../test/render";

test("review: a full report opened earlier shows the run's present state after it is hidden and shown again", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  fireEvent.click(await screen.findByRole("button", { name: "Show full report" }));
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Full report" }).textContent).toContain(
      "State: waiting approval",
    ),
  );
  const run = client.state.runs.find((r) => r.id === "run-0008");
  if (!run) throw new Error("missing run");
  run.state = "done";
  fireEvent.click(screen.getByRole("button", { name: "Hide full report" }));
  fireEvent.click(screen.getByRole("button", { name: "Show full report" }));
  expect(screen.queryByRole("region", { name: "Full report" })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Full report" }).textContent).toContain("State: done"),
  );
});
