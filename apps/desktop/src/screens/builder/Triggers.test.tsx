import { RunnerError } from "@flowdriven/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "../../test/render";

const builder = "#/builder/dev.example.job-review";
async function row(name: string) {
  const section = await screen.findByRole("region", { name: "Triggers" });
  const heading = within(section).getByText(name, { exact: true });
  const item = heading.closest("li");
  if (!item) throw new Error("Missing trigger row");
  return within(item);
}

test("lists the schedule, the file change and the webhook with icon plus words, and no manual row", async () => {
  renderApp(builder, { scenario: "looped" });
  for (const name of ["Schedule", "File change", "Webhook"]) {
    const item = await row(name);
    expect(item.getByRole("switch").querySelector("svg")).not.toBeNull();
  }
  expect(screen.queryByText("Manual", { exact: true })).toBeNull();
  expect((await row("Schedule")).getByText("Every 1h")).toBeTruthy();
  expect((await row("File change")).getByText("Files change in inbox")).toBeTruthy();
  expect((await row("Webhook")).getByText("Called by a webhook")).toBeTruthy();
});
test("the webhook says Not available yet and its switch is disabled", async () => {
  renderApp(builder, { scenario: "looped" });
  const item = await row("Webhook");
  expect(item.getByRole("switch").textContent).toContain("Not available yet");
  expect(item.getByRole("switch")).toHaveProperty("disabled", true);
});
test("turning the schedule on calls triggers.setEnabled with the flow's hash, then shows On and a Next run line", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const item = await row("Schedule");
  const flow = client.state.flows.find((f) => f.manifest.id === "dev.example.job-review");
  if (!flow) throw new Error("Missing flow");
  const spy = vi.spyOn(client, "call");
  fireEvent.click(item.getByRole("switch"));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith("triggers.setEnabled", {
      flowId: flow.manifest.id,
      index: 1,
      enabled: true,
      hash: flow.hash,
    }),
  );
  await waitFor(() => expect(item.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
  expect(item.getByRole("switch").textContent).toContain("On");
  expect(item.getByText(/^Next run:/)).toBeTruthy();
});
test("a refusal shows its reason in an alert and the switch stays Off", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  const item = await row("Schedule");
  vi.spyOn(client, "call").mockRejectedValueOnce(
    new RunnerError("not_allowed", "Cannot enable this trigger."),
  );
  fireEvent.click(item.getByRole("switch"));
  expect((await screen.findByRole("alert")).textContent).toContain("Cannot enable this trigger.");
  expect(item.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  expect(item.getByRole("switch").textContent).toContain("Off");
});
test("a trigger that needs its OK again says so and offers to turn it on again", async () => {
  const { client } = renderApp(builder, { scenario: "looped" });
  client.state.triggerSwitches["dev.example.job-review#2"] = { hash: `sha256:${"1".repeat(64)}` };
  const item = await row("File change");
  expect(item.getByRole("switch").textContent).toContain("Needs your OK again");
  fireEvent.click(item.getByRole("switch"));
  await waitFor(() => expect(item.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
});
test("the honest line about FlowDriven being open is on the screen", async () => {
  renderApp(builder, { scenario: "looped" });
  expect(
    await screen.findByText(
      "Triggers fire only while FlowDriven is open. On a Mac you can close the window and leave the app open; quitting the app stops them.",
    ),
  ).toBeTruthy();
});
test("the last fire shows its words and a link to the run; today's counts show the dropped number only when it is above 0", async () => {
  renderApp(builder, { scenario: "looped" });
  const file = await row("File change");
  expect(file.getByRole("link").parentElement?.textContent).toMatch(/^Last: Started /);
  expect(file.getByRole("link").getAttribute("href")).toBe("#/runs/run-0008");
  expect(file.getByText("Today: 3 of 24 runs, 2 dropped")).toBeTruthy();
  expect((await row("Schedule")).getByText("Today: 0 of 24 runs")).toBeTruthy();
});
test("the Runs table shows the trigger in words for a triggered run and nothing for a manual run; the run detail shows Started by", async () => {
  const view = renderApp("#/runs", { scenario: "looped" });
  const triggered = (await screen.findByRole("link", { name: "run-0008" })).closest("tr");
  const manual = screen.getByRole("link", { name: "run-0005" }).closest("tr");
  if (!triggered || !manual) throw new Error("Missing run rows");
  expect(within(triggered).getByText("Started by its schedule")).toBeTruthy();
  expect(within(manual).queryByText(/Started by/)).toBeNull();
  view.unmount();
  renderApp("#/runs/run-0008", { scenario: "looped" });
  expect(await screen.findByText("Started by: Started by its schedule")).toBeTruthy();
});
