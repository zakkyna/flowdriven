// apps/desktop/src/screens/settings/Settings.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { readyState, renderApp } from "../../test/render";

describe("Settings", () => {
  test("lists brains official first, with reasons for disabled ones", async () => {
    renderApp("#/settings");
    const group = await screen.findByRole("radiogroup", { name: "Main brain" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("aria-label")),
    ).toEqual(["Codex CLI", "Anthropic API key", "OpenAI API key", "Claude Code CLI", "Antigravity CLI"]);
    expect((within(group).getByRole("radio", { name: "Codex CLI" }) as HTMLInputElement).checked).toBe(true);
    expect(within(group).getByRole("radio", { name: "Antigravity CLI" })).toHaveProperty("disabled", true);
    expect(within(group).getByText("Needs consent on the Harnesses screen")).toBeTruthy();
    expect(within(group).getByText("No API key stored")).toBeTruthy();
  });
  test("choosing a brain saves at once", async () => {
    const { client } = renderApp("#/settings");
    fireEvent.click(await screen.findByRole("radio", { name: "Anthropic API key" }));
    expect(await screen.findByText("Main brain set to Anthropic API key.")).toBeTruthy();
    expect((await client.call("settings.get", {})).brain.main).toBe("anthropic-api");
  });
  test("fallback order moves", async () => {
    const { client } = renderApp("#/settings");
    fireEvent.click(await screen.findByRole("button", { name: "Move Claude Code CLI up" }));
    await waitFor(async () =>
      expect((await client.call("settings.get", {})).brain.subscriptionOrder).toEqual([
        "claude-cli",
        "codex-cli",
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Claude Code CLI up" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
  });
  test("budget shows the estimate and asks before raising the cap", async () => {
    const { client } = renderApp("#/settings");
    expect(await screen.findByText("Spent this month: $16.40 of $20.00 (estimate)")).toBeTruthy();
    expect(screen.getByText("82% used")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Monthly cap (USD)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Raise the monthly cap to $30.00?" })).getByRole("button", {
        name: "Raise cap",
      }),
    );
    expect(await screen.findByText("Budget saved.")).toBeTruthy();
    expect((await client.call("settings.get", {})).budget.capUsd).toBe(30);
  });
  test("lowering the cap needs no dialog; a negative cap is refused", async () => {
    const { client } = renderApp("#/settings");
    const cap = await screen.findByLabelText("Monthly cap (USD)");
    fireEvent.change(cap, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect(screen.getByText("Enter an amount of 0 or more.")).toBeTruthy();
    fireEvent.change(cap, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText("Budget saved.")).toBeTruthy();
    expect((await client.call("settings.get", {})).budget.capUsd).toBe(10);
  });
  test("one-time save offer toggles", async () => {
    const { client } = renderApp("#/settings");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Offer to save one-time flows as flows" }));
    await screen.findByRole("checkbox", { name: "Offer to save one-time flows as flows", checked: false });
    expect((await client.call("settings.get", {})).offerSaveOneTime).toBe(false);
  });
  test("consent given on the Harnesses screen unlocks the brain option", async () => {
    const { client } = renderApp("#/settings");
    const antigravity = await screen.findByRole("radio", { name: "Antigravity CLI" });
    expect(antigravity).toHaveProperty("disabled", true);
    await client.call("harnesses.setConsent", { harnessId: "antigravity", consent: "given" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Antigravity CLI" })).toHaveProperty("disabled", false),
    );
  });
  test("is not ready until its data has arrived", async () => {
    const { container } = renderApp("#/settings");
    expect(readyState(container, "settings")).toBe("false");
    await screen.findByRole("radiogroup", { name: "Main brain" });
    await waitFor(() => expect(readyState(container, "settings")).toBe("true"));
  });
  test("empty", async () => {
    renderApp("#/settings", { scenario: "empty" });
    expect(await screen.findByText("No brain found. Install a harness or add an API key.")).toBeTruthy();
    expect(screen.getByText("API keys are off")).toBeTruthy();
  });
});
