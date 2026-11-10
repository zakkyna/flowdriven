import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Dialog } from "./Dialog";

test("is a labelled modal that confirms and cancels", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <Dialog title="Install FFmpeg?" confirmLabel="Install" onConfirm={onConfirm} onCancel={onCancel}>
      Body
    </Dialog>,
  );
  const dialog = screen.getByRole("dialog", { name: "Install FFmpeg?" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Install" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
