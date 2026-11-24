import { WINDOW_CALLS, WindowPrefs } from "@flowdriven/contracts";
import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { RunnerProvider } from "../../runner/runner-context";
import { LanguageProvider } from "../../shell/language";
import { readyState, renderApp, renderAppBoth } from "../../test/render";
import { ToastProvider } from "../../ui/Toast";
import { Settings } from "./Settings";

afterEach(() => {
  cleanup();
});

test("TC-j12-01 Settings shows its sections in order and reads settings and agents", async () => {
  await renderAppBoth("#/settings", { scenario: "story-v2" }, async ({ language, container, client }) => {
    const words =
      language === "en"
        ? {
            appearance: "Appearance",
            light: "Light",
            auto: "Auto",
            matches: "Matches your computer",
            dark: "Dark",
            raiseLimit: "Raise limit",
            notifications: "Notifications",
            notificationsBody:
              "FlowDriven only notifies you when it needs a decision or something went wrong. It never notifies you about progress or success.",
            moreLater: "Other items appear when their release ships.",
            background: "Background",
            expectedHeadings: [
              "Appearance",
              "Language",
              "AI agents",
              "Permission",
              "Main AI agent",
              "Spending limit",
              "Notifications",
            ],
          }
        : {
            appearance: "Tampilan",
            light: "Terang",
            auto: "Otomatis",
            matches: "Ikut komputer Anda",
            dark: "Gelap",
            raiseLimit: "Naikkan batas",
            notifications: "Pemberitahuan",
            notificationsBody:
              "FlowDriven hanya memberi tahu saat perlu keputusan Anda atau ada masalah. Tidak ada pemberitahuan untuk perkembangan atau keberhasilan.",
            moreLater: "Item lain muncul saat rilisnya tersedia.",
            background: "Latar belakang",
            expectedHeadings: [
              "Tampilan",
              "Bahasa",
              "Agen AI",
              "Izin",
              "Agen AI utama",
              "Batas biaya",
              "Pemberitahuan",
            ],
          };

    await screen.findByRole("heading", { level: 2, name: words.appearance });
    await waitFor(() => expect(readyState(container, "settings")).toBe("true"));

    expect(
      within(screen.getByRole("main"))
        .getAllByRole("heading", { level: 2 })
        .map((el) => el.textContent),
    ).toEqual(words.expectedHeadings);
    expect(screen.getByRole("button", { name: words.raiseLimit })).toBeTruthy();

    expect(client.calls).toContainEqual({ operation: "settings.get", input: {} });
    expect(client.calls).toContainEqual({ operation: "agents.list", input: {} });
    expect(client.calls.some((call) => call.operation === "usage.summary")).toBe(false);
    const settings = await client.call("settings.get", {});
    expect(typeof settings.spending.spentUsd).toBe("number");

    expect(screen.getByRole("radio", { name: words.light })).toBeTruthy();
    const autoRadio = screen.getByRole("radio", { name: new RegExp(words.auto) });
    expect(within(autoRadio).getByText(words.auto)).toBeTruthy();
    expect(within(autoRadio).getByText(words.matches)).toBeTruthy();
    expect(screen.getByRole("radio", { name: words.dark })).toBeTruthy();

    expect(screen.getByRole("heading", { level: 2, name: words.notifications })).toBeTruthy();
    expect(screen.getByText(words.notificationsBody)).toBeTruthy();
    expect(screen.getByText(words.moreLater)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: words.background })).toBeNull();
  });

  renderApp("#/settings", {
    scenario: "story-v2",
    setup(client) {
      for (const agent of client.state.agents) agent.state = "not_installed";
    },
  });
  await screen.findByRole("heading", { level: 2, name: "Appearance" });
  expect(
    within(screen.getByRole("main"))
      .getAllByRole("heading", { level: 2 })
      .map((el) => el.textContent),
  ).toEqual([
    "Appearance",
    "Language",
    "AI agents",
    "Permission",
    "Main AI agent",
    "Spending limit",
    "Notifications",
  ]);
  expect(screen.getByRole("heading", { level: 2, name: "Notifications" })).toBeTruthy();
  expect(screen.getByText("Other items appear when their release ships.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();

  const standaloneClient = createFixtureRunnerClient({ scenario: "story-v2" });
  render(
    <RunnerProvider client={standaloneClient}>
      <LanguageProvider language="en">
        <ToastProvider>
          <Settings />
        </ToastProvider>
      </LanguageProvider>
    </RunnerProvider>,
  );
  await screen.findAllByRole("heading", { level: 2, name: "Appearance" });
  expect(standaloneClient.calls.map((call) => call.operation).sort()).toEqual([
    "agents.list",
    "settings.get",
  ]);
  expect(standaloneClient.calls.some((call) => call.operation === "activity.summary")).toBe(false);
});

test("TC-j12-29 Notifications section is one fixed sentence", async () => {
  renderApp("#/settings", { scenario: "story-v2" });
  const heading = await screen.findByRole("heading", { level: 2, name: "Notifications" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;
  expect(
    within(section).getByText(
      "FlowDriven only notifies you when it needs a decision or something went wrong. It never notifies you about progress or success.",
    ),
  ).toBeTruthy();
  expect(within(section).queryAllByRole("switch")).toEqual([]);
  expect(within(section).queryAllByRole("checkbox")).toEqual([]);
  expect(within(section).queryAllByRole("button")).toEqual([]);
});

test("TC-j12-30 V1 has no Background section and no background setting", async () => {
  const { client } = renderApp("#/settings", { scenario: "story-v2" });
  await screen.findByRole("heading", { level: 2, name: "Appearance" });

  expect(screen.queryByRole("heading", { name: "Background" })).toBeNull();
  expect(screen.queryByRole("switch", { name: /menu bar/i })).toBeNull();
  expect(screen.queryByRole("switch", { name: /Open at login/i })).toBeNull();

  const settings = await client.call("settings.get", {});
  expect("background" in settings).toBe(false);

  expect([...WINDOW_CALLS]).toEqual(["getPrefs", "setColorMode", "openLink", "quit"]);
  expect(WindowPrefs.safeParse({ colorMode: "system", platform: "darwin" }).success).toBe(true);
  expect(WindowPrefs.safeParse({ colorMode: "system", platform: "darwin", background: true }).success).toBe(
    false,
  );
});

test('TC-j12-33 A failed save shows "Could not save. Try again." and restores the control', async () => {
  renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    failSettingsUpdate: true,
    setup(client) {
      const codex = client.state.agents.find((agent) => agent.id === "codex");
      if (codex) codex.state = "ready";
      client.state.settings.busyFallback = false;
    },
  });

  const heading = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const toggle = within(section).getByRole("switch", { name: "If Claude Code is busy, use Codex" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(toggle);

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
});

test("TC-j31-32 Settings line under Main AI agent", async () => {
  const { client } = renderApp("#/settings", { scenario: "story-v2" });

  const heading = await screen.findByRole("heading", { level: 2, name: "Main AI agent" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  expect(within(section).getByText("New chats start with this agent and its default model.")).toBeTruthy();

  const codex = client.state.agents.find((agent) => agent.id === "codex");
  if (codex) codex.state = "ready";
  client.emit({ type: "changed", topics: ["agents"] });

  const group = within(section).getByRole("radiogroup", { name: "Main AI agent" });
  await waitFor(() => {
    expect(within(group).getByRole("radio", { name: "Codex" })).toHaveProperty("disabled", false);
  });

  fireEvent.click(within(group).getByRole("radio", { name: "Codex" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      {
        operation: "settings.update",
        input: { patch: { mainAgent: { agent: "codex", model: "gpt-6.1-sol" } } },
      },
    ]);
  });
  expect(client.calls.some((call) => call.operation === "agents.models")).toBe(false);
});
