import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderApp } from "../../test/render";

afterEach(() => {
  cleanup();
});

test("TC-j12-21 Raising the limit: live question, valid amount, toast and new total", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 9.2,
        limitUsd: 10,
        state: "warning",
        allOnPlans: false,
      };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  expect(within(section).getByText("Used $9.20 of $10.00 this month")).toBeTruthy();

  fireEvent.click(within(section).getByRole("button", { name: "Raise limit" }));

  const dialog = screen.getByRole("dialog", { name: "Raise the limit to $25?" });
  const input = within(dialog).getByLabelText("Monthly limit ($)") as HTMLInputElement;
  expect(input.value).toBe("25");

  fireEvent.change(input, { target: { value: "30" } });
  expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Raise the limit to $30?");

  fireEvent.change(input, { target: { value: "" } });
  expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Raise the limit to $25?");

  fireEvent.change(input, { target: { value: "25" } });
  expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe("Raise the limit to $25?");

  fireEvent.click(within(dialog).getByRole("button", { name: "Raise" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
    { operation: "settings.update", input: { patch: { spendingLimit: 25 } } },
  ]);
  expect(await screen.findByText("Limit raised to $25.")).toBeTruthy();
  await waitFor(() => expect(within(section).getByText("Used $9.20 of $25.00 this month")).toBeTruthy());

  fireEvent.click(within(section).getByRole("button", { name: "Raise limit" }));
  const secondDialog = screen.getByRole("dialog", { name: "Raise the limit to $50?" });
  const secondInput = within(secondDialog).getByLabelText("Monthly limit ($)") as HTMLInputElement;
  expect(secondInput.value).toBe("50");
  fireEvent.click(within(secondDialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(client.calls.filter((call) => call.operation === "settings.update")).toHaveLength(1);
});

test("TC-j12-23 An invalid amount shows the line in the dialog and makes no call", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 3,
        limitUsd: 10,
        state: "ok",
        allOnPlans: false,
      };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  fireEvent.click(within(section).getByRole("button", { name: "Raise limit" }));

  const dialog = screen.getByRole("dialog", { name: "Raise the limit to $25?" });
  const input = within(dialog).getByLabelText("Monthly limit ($)");
  const raiseButton = within(dialog).getByRole("button", { name: "Raise" });

  fireEvent.change(input, { target: { value: "" } });
  expect(raiseButton).toHaveProperty("disabled", true);

  fireEvent.change(input, { target: { value: "10" } });
  expect(within(dialog).getByText("Enter an amount above $10.")).toBeTruthy();

  fireEvent.change(input, { target: { value: "5" } });
  expect(within(dialog).getByText("Enter an amount above $10.")).toBeTruthy();

  fireEvent.click(raiseButton);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(within(dialog).getByText("Enter an amount above $10.")).toBeTruthy();
  expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([]);
});

test('TC-j12-28 The limit line and "Limit reached"; V1 shows no per-agent usage and no plan note', async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 10,
        limitUsd: 10,
        state: "reached",
        allOnPlans: false,
      };
    },
  });

  const headingA = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const sectionA = headingA.closest("section");
  expect(sectionA).not.toBeNull();
  if (!sectionA) return;
  expect(within(sectionA).getByText("Used $10.00 of $10.00 this month")).toBeTruthy();
  expect(within(sectionA).getByText("Limit reached")).toBeTruthy();
  expect(sectionA.textContent).not.toMatch(/Claude Code|Codex|plan limit|subscription/i);
  first.unmount();

  const second = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 3,
        limitUsd: 10,
        state: "ok",
        allOnPlans: true,
      };
    },
  });

  const headingB = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const sectionB = headingB.closest("section");
  expect(sectionB).not.toBeNull();
  if (!sectionB) return;
  expect(within(sectionB).getByText("Used $3.00 of $10.00 this month")).toBeTruthy();
  expect(within(sectionB).queryByText("Limit reached")).toBeNull();
  expect(sectionB.textContent).not.toMatch(/Claude Code|Codex|plan limit|subscription/i);
  second.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 3,
        limitUsd: 10,
        state: "ok",
        allOnPlans: false,
      };
    },
  });

  const headingC = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const sectionC = headingC.closest("section");
  expect(sectionC).not.toBeNull();
  if (!sectionC) return;
  expect(within(sectionC).getByText("Used $3.00 of $10.00 this month")).toBeTruthy();
  expect(within(sectionC).queryByText("Limit reached")).toBeNull();
  expect(sectionC.textContent).not.toMatch(/Claude Code|Codex|plan limit|subscription/i);
});

test('Failed spending limit save shows "Could not save. Try again." and keeps old limit', async () => {
  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    failSettingsUpdate: true,
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 9.2,
        limitUsd: 10,
        state: "warning",
        allOnPlans: false,
      };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Spending limit" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  fireEvent.click(within(section).getByRole("button", { name: "Raise limit" }));
  const dialog = screen.getByRole("dialog", { name: "Raise the limit to $25?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Raise" }));

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(section).getByText("Used $9.20 of $10.00 this month")).toBeTruthy();
});

test("Spending limit section and dialog render in Bahasa Indonesia", async () => {
  renderApp("#/settings", {
    scenario: "story-v2",
    language: "id",
    setup(c) {
      c.state.settings.spendingLimit = 10;
      c.state.settings.spending = {
        month: "2026-11",
        spentUsd: 10,
        limitUsd: 10,
        state: "reached",
        allOnPlans: false,
      };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Batas biaya" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  expect(within(section).getByText("Terpakai $10,00 dari $10,00 bulan ini")).toBeTruthy();
  expect(within(section).getByText("Batas tercapai")).toBeTruthy();

  fireEvent.click(within(section).getByRole("button", { name: "Naikkan batas" }));
  const dialog = screen.getByRole("dialog", { name: "Naikkan batas menjadi $25?" });
  const input = within(dialog).getByLabelText("Batas bulanan ($)");

  fireEvent.change(input, { target: { value: "10" } });
  expect(within(dialog).getByText("Masukkan jumlah di atas $10.")).toBeTruthy();

  fireEvent.change(input, { target: { value: "10001" } });
  expect(within(dialog).getByText("Masukkan jumlah maksimal $10.000.")).toBeTruthy();

  fireEvent.change(input, { target: { value: "25" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Naikkan" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByText("Batas dinaikkan menjadi $25.")).toBeTruthy();
});
