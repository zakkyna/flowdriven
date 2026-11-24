import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderApp } from "../../test/render";

afterEach(() => {
  cleanup();
});

test("TC-j12-14 Main AI agent: only a ready agent can be chosen, and the choice saves its default model", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      const claude = c.state.agents.find((agent) => agent.id === "claude-code");
      const codex = c.state.agents.find((agent) => agent.id === "codex");
      if (claude) claude.state = "ready";
      if (codex) {
        codex.state = "needs_login";
        delete codex.defaultModel;
        codex.models = [
          { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", note: "allRound", isDefault: true },
          { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", note: "carefulCoding", isDefault: false },
        ];
      }
      c.state.settings.mainAgent = { agent: "claude-code", model: "sonnet-5.5" };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  expect(within(section).getByText("New chats start with this agent and its default model.")).toBeTruthy();

  const group = within(section).getByRole("radiogroup", { name: "Main AI agent" });
  const claudeRadio = within(group).getByRole("radio", { name: "Claude Code" });
  const codexRadio = within(group).getByRole("radio", { name: /Codex/ });
  expect(claudeRadio).toHaveProperty("disabled", false);
  expect(claudeRadio.getAttribute("aria-checked")).toBe("true");
  expect(codexRadio).toHaveProperty("disabled", true);
  expect(within(codexRadio).getByText("Set up or sign in first")).toBeTruthy();

  const codex = client.state.agents.find((agent) => agent.id === "codex");
  if (codex) codex.state = "ready";
  client.emit({ type: "changed", topics: ["agents"] });

  await waitFor(() => {
    const enabledCodex = within(group).getByRole("radio", { name: "Codex" });
    expect(enabledCodex).toHaveProperty("disabled", false);
  });

  fireEvent.click(within(group).getByRole("radio", { name: "Codex" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "agents.models")).toEqual([
      { operation: "agents.models", input: { agentId: "codex" } },
    ]);
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      {
        operation: "settings.update",
        input: { patch: { mainAgent: { agent: "codex", model: "gpt-6.1-sol" } } },
      },
    ]);
  });

  expect(await screen.findByText("Main AI agent: Codex")).toBeTruthy();
});

test("TC-j12-15 The busy toggle names the agents and shows only when two are ready", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      for (const agent of c.state.agents) agent.state = "ready";
      c.state.settings.mainAgent = { agent: "claude-code", model: "sonnet-5.5" };
      c.state.settings.busyFallback = false;
    },
  });

  const heading1 = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section1 = heading1.closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;

  const toggle1 = within(section1).getByRole("switch", { name: "If Claude Code is busy, use Codex" });
  expect(toggle1.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle1);
  await waitFor(() => {
    expect(first.client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      { operation: "settings.update", input: { patch: { busyFallback: true } } },
    ]);
    expect(toggle1.getAttribute("aria-checked")).toBe("true");
  });
  first.unmount();

  const second = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      for (const agent of c.state.agents) agent.state = "ready";
      c.state.settings.mainAgent = { agent: "codex", model: "gpt-6.1-sol" };
    },
  });

  const heading2 = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section2 = heading2.closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;

  expect(within(section2).getByRole("switch", { name: "If Codex is busy, use Claude Code" })).toBeTruthy();
  second.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      const claude = c.state.agents.find((agent) => agent.id === "claude-code");
      const codex = c.state.agents.find((agent) => agent.id === "codex");
      if (claude) claude.state = "ready";
      if (codex) codex.state = "needs_login";
    },
  });

  const heading3 = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section3 = heading3.closest("section");
  expect(section3).not.toBeNull();
  if (!section3) return;

  expect(within(section3).queryByRole("switch")).toBeNull();
});

test("Failed mainAgent save reverts radio selection and shows toast", async () => {
  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    failSettingsUpdate: true,
    setup(c) {
      for (const agent of c.state.agents) agent.state = "ready";
      c.state.settings.mainAgent = { agent: "claude-code", model: "sonnet-5.5" };
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const group = within(section).getByRole("radiogroup", { name: "Main AI agent" });
  const claudeRadio = within(group).getByRole("radio", { name: "Claude Code" });
  const codexRadio = within(group).getByRole("radio", { name: "Codex" });
  expect(claudeRadio.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(codexRadio);

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(claudeRadio.getAttribute("aria-checked")).toBe("true"));
  expect(codexRadio.getAttribute("aria-checked")).toBe("false");
});

test("Main AI agent section renders in Bahasa Indonesia", async () => {
  const first = renderApp("#/settings", {
    scenario: "story-v2",
    language: "id",
    setup(c) {
      for (const agent of c.state.agents) agent.state = "ready";
      c.state.settings.mainAgent = { agent: "claude-code", model: "sonnet-5.5" };
    },
  });

  const heading1 = await screen.findByRole("heading", { level: 2, name: "Agen AI utama" });
  const section1 = heading1.closest("section");
  expect(section1).not.toBeNull();
  if (!section1) return;

  expect(within(section1).getByText("Chat baru dimulai dengan agen ini dan model bawaannya.")).toBeTruthy();
  expect(within(section1).getByRole("switch", { name: "Jika Claude Code sibuk, pakai Codex" })).toBeTruthy();
  first.unmount();

  renderApp("#/settings", {
    scenario: "story-v2",
    language: "id",
    setup(c) {
      const claude = c.state.agents.find((agent) => agent.id === "claude-code");
      const codex = c.state.agents.find((agent) => agent.id === "codex");
      if (claude) claude.state = "ready";
      if (codex) codex.state = "needs_login";
    },
  });

  const heading2 = await screen.findByRole("heading", { level: 2, name: "Agen AI utama" });
  const section2 = heading2.closest("section");
  expect(section2).not.toBeNull();
  if (!section2) return;

  const group2 = within(section2).getByRole("radiogroup", { name: "Agen AI utama" });
  const codexRadio = within(group2).getByRole("radio", { name: /Codex/ });
  expect(codexRadio).toHaveProperty("disabled", true);
  expect(within(codexRadio).getByText("Siapkan atau login dulu")).toBeTruthy();
});
