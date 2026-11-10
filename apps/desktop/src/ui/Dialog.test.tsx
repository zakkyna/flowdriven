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

test("focus is contained and restored when confirmation is disabled", () => {
  const onCancel = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const view = render(
    <Dialog title="Edit" confirmLabel="Save" confirmDisabled onConfirm={() => {}} onCancel={onCancel}>
      <input aria-label="Name" />
    </Dialog>,
  );
  const field = screen.getByLabelText("Name");
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
  cancel.focus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(field);
  fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
  view.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

test("keeps dialog actions visible around a scrolling body", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("apps/desktop/src/ui/Dialog.module.css", "utf8");
  expect(css).toMatch(/max-height:\s*calc\(100vh - 48px\)/);
  expect(css).toMatch(/\.body\s*\{[^}]*overflow:\s*auto/s);
  expect(css).toMatch(/\.body\s*\{[^}]*min-width:\s*0[;\s]/s);
  expect(css).toMatch(/\.body\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});
