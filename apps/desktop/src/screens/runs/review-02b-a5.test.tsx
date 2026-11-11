import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ItemList } from "./ItemList";

test("review: two items with the same key at different positions render without a React key clash", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ItemList
      title="Review"
      items={[
        { key: "j1", label: "Job one", state: "passed", steps: [] },
        { key: "j1", label: "Job one", state: "skipped", skip: "duplicate", steps: [] },
      ]}
    />,
  );
  expect(screen.getByRole("list", { name: "Steps of j1, item 1" })).toBeTruthy();
  expect(screen.getByRole("list", { name: "Steps of j1, item 2" })).toBeTruthy();
  const text = error.mock.calls.map((call) => String(call[0]) + String(call[1] ?? "")).join("\n");
  expect(text).not.toMatch(/same key|unique "key"/);
});
