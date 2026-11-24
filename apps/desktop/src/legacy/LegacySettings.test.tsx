// apps/desktop/src/legacy/LegacySettings.test.tsx
import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { readyState, renderApp } from "./render-legacy";

test("Settings is one narrow column of four plain sections", async () => {
  const { container } = renderApp("#/settings");
  await screen.findByRole("radiogroup", { name: "Main brain" });
  expect(container.querySelector("[data-screen='settings'] [data-size='narrow']")).not.toBeNull();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Brain",
    "Fallback order",
    "Monthly API-key budget",
    "One-time flows",
  ]);
});
test("settings styles: sections have a hairline, no card, and the meter uses state colours", () => {
  const css = readFileSync("apps/desktop/src/screens/settings/Settings.module.css", "utf8");
  expect(css).toMatch(/\.panel\s*\+\s*\.panel\s*\{[^}]*border-top:\s*1px solid var\(--border\)/s);
  expect(css).not.toMatch(/\.panel\s*\{[^}]*(border-radius|background)/s);
  expect(css).toMatch(/\.track\s*\{[^}]*background:\s*var\(--surface-sunken\)/s);
  expect(css).toMatch(/\.fill\s*\{[^}]*background:\s*var\(--text-muted\)/s);
  expect(css).toMatch(/\.warn\s*\{[^}]*background:\s*var\(--wait\)/s);
  expect(css).toMatch(/\.stopped\s*\{[^}]*background:\s*var\(--bad\)/s);
  expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  expect(css).toMatch(/min-width:\s*0\b/);
});

test("keeps the long brain option in a control and details row", async () => {
  renderApp("#/settings");
  const radio = await screen.findByRole("radio", { name: "Antigravity CLI" });
  const row = radio.closest("label");
  const details = screen.getByText("Needs consent on the Harnesses screen").parentElement;
  expect(row?.children).toHaveLength(2);
  expect(details?.parentElement).toBe(row);
  const css = readFileSync("apps/desktop/src/screens/settings/Settings.module.css", "utf8");
  expect(css).toMatch(/\.brain\s*\{[^}]*display:\s*flex/s);
  expect(css).not.toMatch(/\.brain\s*\{[^}]*flex-wrap:\s*wrap/s);
  expect(css).toMatch(/\.brainDetails\s*\{[^}]*flex-wrap:\s*wrap/s);
});
test("aligns both risk tags to the name baseline", async () => {
  renderApp("#/settings");
  const radio = await screen.findByRole("radio", { name: "Antigravity CLI" });
  const brainTag = within(radio.closest("label") as HTMLElement).getByText("Unofficial").parentElement;
  const fallback = screen.getByRole("heading", { name: "Fallback order" }).closest("section");
  const fallbackTag = within(fallback as HTMLElement).getAllByText("Official")[0]?.parentElement;
  expect(brainTag?.parentElement?.className).toContain("risk");
  expect(fallbackTag?.parentElement?.className).toContain("risk");
  const css = readFileSync("apps/desktop/src/screens/settings/Settings.module.css", "utf8");
  expect(css).toMatch(/\.risk\s*>\s*span\s*\{[^}]*align-items:\s*baseline/s);
});
test("sets fallback subheadings one size below section headings", async () => {
  renderApp("#/settings");
  expect(await screen.findByRole("heading", { name: "Subscription harnesses", level: 3 })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "API keys", level: 3 })).toBeTruthy();
  const css = readFileSync("apps/desktop/src/screens/settings/Settings.module.css", "utf8");
  expect(css).toMatch(/\.panel h3\s*\{[^}]*font-size:\s*var\(--text-m\)/s);
  expect(css).toMatch(/\.panel h3\s*\{[^}]*font-weight:\s*600/s);
});

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
test("does not round a warning up to the stopped percentage", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.budget.capUsd = 1000;
  client.state.settings.budget.spentUsd = 996;
  expect(await screen.findByText("99% used")).toBeTruthy();
  expect(screen.queryByText("100% used")).toBeNull();
});
test("turns API keys off at the cap and explains why", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.budget.spentUsd = client.state.settings.budget.capUsd;
  expect(await screen.findByText("Cap reached. API-key calls are stopped.")).toBeTruthy();
  expect(await screen.findByText("Cap reached", { exact: true })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Anthropic API key" })).toHaveProperty("disabled", true);
});
test("updates untouched budget fields when stored values change", async () => {
  const { client } = renderApp("#/settings");
  const input = await screen.findByLabelText("Monthly cap (USD)");
  await client.call("settings.update", { patch: { budget: { capUsd: 50 } } });
  await waitFor(() => expect(input).toHaveProperty("value", "50"));
});
test("asks before removing a per-run cap", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.budget.perRunCapUsd = 5;
  const input = await screen.findByLabelText("Per-run cap (USD, optional)");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});
test("marks a selected and fallback harness when consent is missing", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.brain.main = "claude-cli";
  const claude = client.state.settings.backends.find((item) => item.id === "claude-cli");
  if (!claude) throw new Error("Missing Claude fixture");
  claude.consent = "revoked";
  expect(
    await screen.findByText("Needs consent. This brain is not used until you give consent."),
  ).toBeTruthy();
  expect(screen.getByText("Needs consent before use.")).toBeTruthy();
});
test("disables movement after the last visible fallback", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.brain.subscriptionOrder.push("unknown-backend");
  expect(await screen.findByRole("button", { name: "Move Claude Code CLI down" })).toHaveProperty(
    "disabled",
    true,
  );
});
test("shows a settings update failure", async () => {
  const { client } = renderApp("#/settings");
  const option = await screen.findByRole("radio", { name: "Anthropic API key" });
  vi.spyOn(client, "call").mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(option);
  expect((await screen.findByRole("alert")).textContent).toBe("Save failed");
});
test("exposes both login and quota states through the brain description", async () => {
  const { client } = renderApp("#/settings");
  const claude = client.state.settings.backends.find((item) => item.id === "claude-cli");
  if (!claude) throw new Error("Missing Claude fixture");
  claude.login = "logged_out";
  claude.quota = "exhausted";
  const radio = await screen.findByRole("radio", { name: "Claude Code CLI" });
  const description = document.getElementById(radio.getAttribute("aria-describedby") ?? "");
  expect(description?.textContent).toContain("Logged out");
  expect(description?.textContent).toContain("Quota exhausted");
});
test("shows an off budget on a populated setup", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.budget.capUsd = 0;
  expect(await screen.findByText("API keys are off. Set a monthly cap to turn them on.")).toBeTruthy();
  expect(screen.getByRole("radio", { name: "Anthropic API key" })).toHaveProperty("disabled", true);
});
test("can reorder visible fallbacks when an unknown id is present", async () => {
  const { client } = renderApp("#/settings");
  client.state.settings.brain.subscriptionOrder.unshift("unknown-backend");
  fireEvent.click(await screen.findByRole("button", { name: "Move Claude Code CLI up" }));
  await waitFor(() =>
    expect(client.state.settings.brain.subscriptionOrder).toEqual(["claude-cli", "codex-cli"]),
  );
});
