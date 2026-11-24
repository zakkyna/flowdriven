import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderApp } from "../../legacy/render-legacy";

const OUTSIDE = "Has text from outside";

function topStep(client: ReturnType<typeof renderApp>["client"]) {
  const step = client.state.runs.find((run) => run.id === "run-0008")?.steps.at(0);
  if (!step) throw new Error("Missing top-level step");
  return step;
}

function itemStepRow(key: string, index: number): HTMLElement {
  const list = screen.getAllByRole("list", { name: new RegExp(`^Steps of ${key}`) }).at(0);
  const row = list?.querySelectorAll(":scope > li").item(index);
  if (!(row instanceof HTMLElement)) throw new Error("Missing item step row");
  return row;
}

test("the page step of the first job, inside the loop, shows `Has text from outside` with an icon, `Pages read: 1` and the refused click under Blocked calls with its sentence", async () => {
  renderApp("#/runs/run-0008", { scenario: "looped" });
  await screen.findByRole("list", { name: "Steps of j1" });
  const row = itemStepRow("j1", 1);
  const outside = within(row).getByText(OUTSIDE);
  expect(outside.parentElement?.querySelector("svg")).not.toBeNull();
  expect(within(row).getByText("Pages read: 1")).toBeTruthy();
  const blocked = within(row).getByRole("region", { name: "Blocked calls" });
  expect(within(blocked).getByText("mcp__claude-in-chrome__computer")).toBeTruthy();
  expect(within(blocked).getByText("This step may only read pages.")).toBeTruthy();
});

test("a top-level step marked in client.state shows the same two lines in StepBlock", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const step = topStep(client);
  step.outside = true;
  step.pagesRead = 2;
  const region = await screen.findByRole("region", { name: step.title });
  expect(within(region).getByText(OUTSIDE)).toBeTruthy();
  expect(within(region).getByText("Pages read: 2")).toBeTruthy();
});

test("a step without the mark shows neither line, and `Pages read: 0` is never shown", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const step = topStep(client);
  step.pagesRead = 0;
  const region = await screen.findByRole("region", { name: step.title });
  expect(within(region).queryByText(OUTSIDE)).toBeNull();
  expect(within(region).queryByText(/Pages read/)).toBeNull();
  await screen.findByRole("list", { name: "Steps of j1" });
  const second = itemStepRow("j2", 1);
  expect(within(second).queryByText(OUTSIDE)).toBeNull();
  expect(within(second).queryByText(/Pages read/)).toBeNull();
  expect(screen.queryByText("Pages read: 0")).toBeNull();
});

test("the lines have an icon and words and no colour alone carries them", async () => {
  const { client } = renderApp("#/runs/run-0008", { scenario: "looped" });
  const step = topStep(client);
  step.outside = true;
  step.pagesRead = 3;
  const region = await screen.findByRole("region", { name: step.title });
  const outside = within(region).getByText(OUTSIDE);
  const pages = within(region).getByText("Pages read: 3");
  expect(outside.parentElement?.querySelector("svg")).not.toBeNull();
  expect(outside.textContent?.trim().length).toBeGreaterThan(0);
  expect(pages.textContent?.trim().length).toBeGreaterThan(0);
  const first = screen.getAllByText(OUTSIDE).at(0);
  expect(first?.getAttribute("style")).toBeNull();
});
