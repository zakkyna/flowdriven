import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CheckList } from "./CheckList";

test("shows the verdict next to the check that proved it", () => {
  render(
    <CheckList
      checks={[{ type: "command", required: true, summary: "flutter analyze exits 0", verdict: "passed" }]}
    />,
  );
  expect(screen.getByText("flutter analyze exits 0")).toBeTruthy();
  expect(screen.getByText("Passed")).toBeTruthy();
  expect(screen.getByText("command")).toBeTruthy();
});
test("marks judge-only steps and optional checks", () => {
  render(
    <CheckList
      checks={[
        { type: "judge", required: true, summary: "Numbers match" },
        { type: "files", required: false, summary: "Extra" },
      ]}
    />,
  );
  expect(screen.getByText("Judged, not verified")).toBeTruthy();
  expect(screen.getByText("(optional)")).toBeTruthy();
});
test("collapses evidence longer than 12 lines", () => {
  const evidence = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  render(
    <CheckList
      checks={[
        { type: "command", required: true, summary: "flutter test exits 0", verdict: "failed", evidence },
      ]}
    />,
  );
  expect(screen.queryByText(/line 13/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 20 lines" }));
  expect(screen.getByText(/line 20/)).toBeTruthy();
});
