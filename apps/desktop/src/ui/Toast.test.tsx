import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ToastProvider, useToast } from "./Toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function SingleToastHarness(): ReactElement {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast("Approved. The run continues.")}>
      Approve
    </button>
  );
}

test("TC-UI-21 A toast is a polite live region and takes no focus", () => {
  let nowMs = 1_700_000_000_000;
  const now = () => nowMs;
  render(
    <ToastProvider now={now}>
      <SingleToastHarness />
    </ToastProvider>,
  );

  const button = screen.getByRole("button", { name: "Approve" });
  button.focus();
  fireEvent.click(button);

  const statuses = screen.getAllByRole("status");
  expect(statuses).toHaveLength(1);
  const status = statuses[0];
  if (!status) throw new Error("Missing status element");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toContain("Approved. The run continues.");
  expect(document.activeElement).toBe(button);

  act(() => {
    nowMs += 1000;
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByText("Approved. The run continues.")).toBeTruthy();

  act(() => {
    nowMs += 4000;
    vi.advanceTimersByTime(4000);
  });
  expect(screen.queryByText("Approved. The run continues.")).toBeNull();
});

function StackAndActionHarness({ onAction }: { onAction: () => void }): ReactElement {
  const toast = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          toast("One");
          toast("Two");
          toast("Three");
          toast("Four");
        }}
      >
        Stack four
      </button>
      <button
        type="button"
        onClick={() => toast("Permission is off.", { action: { label: "Open Settings", onAction } })}
      >
        Raise action
      </button>
      <button type="button" onClick={() => toast("<b>Hi</b>")}>
        Raise html
      </button>
    </div>
  );
}

test("TC-UI-22 Toasts stack to three, may carry one action, and show text only", () => {
  const onAction = vi.fn();
  render(
    <ToastProvider>
      <StackAndActionHarness onAction={onAction} />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Stack four" }));
  const status = screen.getByRole("status");
  expect(within(status).queryByText("One")).toBeNull();
  const stackTexts = Array.from(status.querySelectorAll("[data-toast='true']")).map((el) => el.textContent);
  expect(stackTexts).toEqual(["Two", "Three", "Four"]);

  fireEvent.click(screen.getByRole("button", { name: "Raise action" }));
  const actionButton = within(status).getByRole("button", { name: "Open Settings" });
  expect(actionButton.tabIndex).toBeGreaterThanOrEqual(0);
  fireEvent.click(actionButton);
  expect(onAction).toHaveBeenCalledOnce();
  expect(within(status).queryByRole("button", { name: "Open Settings" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Raise html" }));
  expect(within(status).getByText("<b>Hi</b>")).toBeTruthy();
  expect(status.querySelector("b")).toBeNull();
});
