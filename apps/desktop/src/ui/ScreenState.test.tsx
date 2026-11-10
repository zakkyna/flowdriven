import { RunnerError } from "@flowdriven/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ScreenState } from "./ScreenState";

test("shows Loading while not ready, then the error with Try again", () => {
  const reload = vi.fn();
  const { container, rerender } = render(
    <ScreenState screen="runs" title="Runs" loading error={undefined} reload={reload} />,
  );
  expect(screen.getByRole("status").textContent).toBe("Loading");
  expect(container.querySelector('[data-screen="runs"][data-screen-ready="false"]')).not.toBeNull();
  rerender(
    <ScreenState
      screen="runs"
      title="Runs"
      loading={false}
      error={new RunnerError("unavailable", "The runner is not running.")}
      reload={reload}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("The runner is not running.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reload).toHaveBeenCalledOnce();
});
