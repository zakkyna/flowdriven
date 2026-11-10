import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
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
test("flags passed steps with missing or unsuccessful required checks and empty sections", async () => {
  const { client } = renderApp("#/runs/run-0005");
  const run = client.state.runs.find((item) => item.id === "run-0005");
  if (!run || !run.steps[0] || !run.steps[1]) throw new Error("Missing fixture steps");
  run.steps[0].state = "passed";
  run.steps[0].checks = [];
  run.steps[1].state = "passed";
  run.steps[1].checks = [{ type: "command", required: true, summary: "Failed check", verdict: "failed" }];
  run.inputs = [];
  run.usage = [];
  expect(await screen.findAllByText("Marked passed without a passing check")).toHaveLength(2);
  expect(screen.getByText("No inputs.")).toBeTruthy();
  expect(screen.getByText("No usage reported yet.")).toBeTruthy();
});
test("warns before resuming an interrupted step and ignores duplicate clicks", async () => {
  const { client } = renderApp("#/runs/run-0003");
  await screen.findByText("This step was stopped part-way. Resuming runs it again.");
  const original = client.call.bind(client);
  let resolve: (() => void) | undefined;
  let calls = 0;
  client.call = ((name, input) => {
    if (name === "runs.resume") {
      calls++;
      return new Promise((done) => {
        resolve = () => {
          void original(name, input).then(done);
        };
      });
    }
    return original(name, input);
  }) as typeof client.call;
  const button = screen.getByRole("button", { name: /Resume from step/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(calls).toBe(1);
  resolve?.();
});
test("keeps filters when returning from a run", async () => {
  renderApp("#/runs");
  await waitFor(() => expect(bodyRows()).toHaveLength(7));
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "blocked" } });
  fireEvent.click(within(bodyRow(0)).getByRole("link"));
  fireEvent.click(await screen.findByRole("link", { name: "All runs" }));
  await waitFor(() => expect(screen.getByLabelText("State")).toHaveProperty("value", "blocked"));
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "" } });
});
test("sorts timestamps by instant when fractional precision differs", async () => {
  const { client } = renderApp("#/runs");
  const first = client.state.runs.find((run) => run.id === "run-0001");
  const second = client.state.runs.find((run) => run.id === "run-0002");
  if (!first || !second) throw new Error("Missing runs");
  first.startedAt = "2026-11-11T00:00:00Z";
  second.startedAt = "2026-11-11T00:00:00.100Z";
  await waitFor(() => expect(bodyRow(0).textContent).toContain("run-0002"));
});
test("shows a failed resume", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const button = await screen.findByRole("button", { name: /Resume from step/ });
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Resume failed"));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toBe("Resume failed");
});
test("groups reported usage calls", async () => {
  const { client } = renderApp("#/runs/run-0006");
  const run = client.state.runs.find((item) => item.id === "run-0006");
  if (!run) throw new Error("Missing run fixture");
  run.usage = [{ harnessId: "codex", name: "Codex", calls: 1234, wallSeconds: 1 }];
  expect(await screen.findByText("1,234")).toBeTruthy();
});
test("links a waiting run's approvals to the inbox", async () => {
  renderApp("#/runs/run-0007");
  const links = await screen.findAllByRole("link", { name: "Open in Inbox" });
  expect(links.length).toBeGreaterThan(0);
  expect(links.every((link) => link.getAttribute("href")?.startsWith("#/inbox/"))).toBe(true);
});
