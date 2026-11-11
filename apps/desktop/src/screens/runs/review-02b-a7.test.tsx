import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ItemList } from "./ItemList";

test("review: the state of a step inside an item is shown as icon plus words", () => {
  render(
    <ItemList
      title="Review"
      items={[
        {
          key: "j3",
          label: "Job three",
          state: "failed",
          steps: [
            {
              stepId: "rough",
              title: "Score the job",
              do: "agent",
              state: "failed",
              attempts: [],
              maxAttempts: 3,
              checks: [],
            },
          ],
        },
      ]}
    />,
  );
  const row = within(screen.getByRole("list", { name: "Steps of j3" })).getByRole("listitem");
  expect(within(row).getByText("Failed")).toBeTruthy();
  expect(row.querySelector("svg")).not.toBeNull();
});
