import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
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

function DeleteDialogHarness({
  onConfirm,
  cancelDisabled,
}: {
  onConfirm: () => void;
  cancelDisabled?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div data-testid="page-behind">
        <button type="button" onClick={() => setOpen(true)}>
          Delete
        </button>
      </div>
      {open && (
        <Dialog
          title="Delete this flow?"
          confirmLabel="Delete"
          confirmVariant="danger"
          cancelDisabled={cancelDisabled}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        >
          This removes the flow from your list.
        </Dialog>
      )}
    </div>
  );
}

test("TC-UI-15 A dialog has the dialog role, a name and a focus trap", () => {
  const view = render(<DeleteDialogHarness onConfirm={vi.fn()} />);
  const opener = screen.getByRole("button", { name: "Delete" });
  opener.focus();
  fireEvent.click(opener);

  const dialogs = screen.getAllByRole("dialog");
  expect(dialogs).toHaveLength(1);
  const dialog = screen.getByRole("dialog", { name: "Delete this flow?" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");

  const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
  const deleteButton = within(dialog).getByRole("button", { name: "Delete" });
  expect(document.activeElement).toBe(cancelButton);

  const pageBehind = screen.getByTestId("page-behind");
  expect(pageBehind.hasAttribute("inert") || pageBehind.getAttribute("aria-hidden") === "true").toBe(true);

  const expectedOrder = [deleteButton, cancelButton, deleteButton, cancelButton];
  for (const expected of expectedOrder) {
    const active = document.activeElement;
    if (!active) throw new Error("Missing active element");
    fireEvent.keyDown(active, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(expected);
  }

  const active = document.activeElement;
  if (!active) throw new Error("Missing active element");
  fireEvent.keyDown(active, { key: "Tab", shiftKey: true });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(deleteButton);

  view.unmount();
});

test("TC-UI-16 Escape closes a dialog and returns focus to its opener", () => {
  const onConfirm = vi.fn();
  const view = render(<DeleteDialogHarness onConfirm={onConfirm} />);
  const opener = screen.getByRole("button", { name: "Delete" });
  const pageBehind = screen.getByTestId("page-behind");

  opener.focus();
  fireEvent.click(opener);
  const dialog1 = screen.getByRole("dialog", { name: "Delete this flow?" });
  fireEvent.keyDown(dialog1, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(pageBehind.hasAttribute("inert")).toBe(false);

  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole("dialog", { name: "Delete this flow?" })).toBeTruthy();
  const scrim = document.querySelector<HTMLElement>('[data-dialog-scrim="true"]');
  expect(scrim).not.toBeNull();
  if (!scrim) throw new Error("Missing dialog scrim");
  fireEvent.click(scrim);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);

  opener.focus();
  fireEvent.click(opener);
  const dialog3 = screen.getByRole("dialog", { name: "Delete this flow?" });
  fireEvent.click(within(dialog3).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);

  expect(onConfirm).not.toHaveBeenCalled();

  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.keyDown(opener, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(onConfirm).not.toHaveBeenCalled();

  view.unmount();
});
