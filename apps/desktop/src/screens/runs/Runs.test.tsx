import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { readyState, renderApp } from "../../test/render";

const bodyRows = () =>
  within(screen.getByRole("table", { name: "Runs" }))
    .getAllByRole("row")
    .slice(1);
const bodyRow = (i: number) => bodyRows()[i] as HTMLElement;

describe("Runs", () => {
  test("lists every run newest first with its state words", async () => {
    renderApp("#/runs");
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    expect(bodyRows().map((r) => within(r).getAllByRole("cell")[0]?.textContent)).toEqual([
      "run-0007",
      "run-0006",
      "run-0005",
      "run-0004",
      "run-0003",
      "run-0002",
      "run-0001",
    ]);
    expect(within(bodyRow(5)).getByText("One-time")).toBeTruthy();
    expect(within(bodyRow(1)).getByText("Blocked")).toBeTruthy();
  });
  test("filters and clears filters", async () => {
    renderApp("#/runs");
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "~/Reports/q3-suppliers" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "blocked" } });
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "dev.example.lead-follow-up" } });
    expect(await screen.findByText("No runs match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(7));
  });
  test("a blocked run shows why, the failing check and how to resume", async () => {
    renderApp("#/runs/run-0006");
    expect(await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" })).toBeTruthy();
    expect(screen.getByText(/flutter analyze still fails after 4 attempts/)).toBeTruthy();
    const step = screen.getByRole("region", { name: "Build the screens" });
    expect(within(step).getByText("attempt 4 of 4")).toBeTruthy();
    expect(within(step).getByText(/^flutter analyze: 3 errors/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume from step 3" }));
    expect(await screen.findAllByText("Running")).not.toHaveLength(0);
  });
  test("collapses evidence longer than 12 lines", async () => {
    renderApp("#/runs/run-0006");
    fireEvent.click(await screen.findByRole("button", { name: "Show all 20 lines" }));
    expect(screen.queryByRole("button", { name: "Show all 20 lines" })).toBeNull();
  });
  test("a done run shows its report, proofs and estimated cost", async () => {
    renderApp("#/runs/run-0005");
    expect(
      await screen.findByText("Built the Q3 supplier report from 14 files in ~/Reports/q3-suppliers."),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Cross-check every number" })).getByText(
        "Judged, not verified",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Estimated cost: $0.42. This is an estimate.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });
  test("a one-time run offers to save", async () => {
    renderApp("#/runs/run-0002");
    expect(await screen.findByText("Save this as a flow?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save as flow" }));
    expect(
      screen.getByText("Saving one-time flows arrives with the agent. Until then this run stays in history."),
    ).toBeTruthy();
  });
  test("shows run not found", async () => {
    renderApp("#/runs/run-9999");
    expect(await screen.findByRole("heading", { level: 1, name: "Run not found" })).toBeTruthy();
    expect(screen.getByText("There is no run run-9999 on this Mac.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All runs" })).toBeTruthy();
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/runs/run-0006");
    expect(readyState(container, "run")).toBe("false");
    await screen.findByRole("heading", { level: 1, name: "Figma to Flutter" });
    await waitFor(() => expect(readyState(container, "run")).toBe("true"));
  });
  test("empty", async () => {
    renderApp("#/runs", { scenario: "empty" });
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
  });
});
test("run detail joins worker and attempt with a comma", async () => {
  renderApp("#/runs/run-0006");
  const step = await screen.findByRole("region", { name: "Build the screens" });
  expect(step.textContent).toContain("Worker: Codex, attempt 4 of 4");
});
