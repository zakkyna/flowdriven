import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { t } from "../../i18n/t";
import { renderApp } from "../../test/render";

type WindowWithShell = Window & {
  flowdrivenShell?: {
    window?: {
      getPrefs?: () => Promise<unknown>;
      setColorMode?: (mode: string) => Promise<unknown>;
      openLink?: (url: string) => Promise<unknown>;
      quit?: () => Promise<unknown>;
    };
  };
};

const originalShell = (window as WindowWithShell).flowdrivenShell;

afterEach(() => {
  cleanup();
  if (originalShell === undefined) Reflect.deleteProperty(window, "flowdrivenShell");
  else (window as WindowWithShell).flowdrivenShell = originalShell;
});

test("TC-j30-04 Settings lists English (checked) and Bahasa Indonesia in order with explanation", async () => {
  renderApp("#/settings", { scenario: "story-v2", language: "en" });

  const heading = await screen.findByRole("heading", { level: 2, name: "Language" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const group = within(section).getByRole("radiogroup", { name: "Language" });
  const radios = within(group).getAllByRole("radio");
  expect(radios.map((radio) => radio.textContent?.trim())).toEqual(["English", "Bahasa Indonesia"]);
  expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
  expect(radios[1]?.getAttribute("aria-checked")).toBe("false");
  expect(
    within(section).getByText(
      "Chats and flows keep the words they were written in. FlowDriven answers in the language you write in.",
    ),
  ).toBeTruthy();
});

test("TC-j30-05 Choosing Bahasa Indonesia changes words at once and preserves route, composer, and Dark mode", async () => {
  const setColorMode = vi.fn();
  const getPrefs = vi.fn().mockResolvedValue({
    ok: true,
    result: { colorMode: "dark", platform: "darwin" },
  });
  (window as WindowWithShell).flowdrivenShell = {
    window: { getPrefs, setColorMode, openLink: vi.fn(), quit: vi.fn() },
  };

  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      const c1 = c.state.chats.find((item) => item.chat.id === "c1");
      if (c1) c1.composerText = "run weekly";
    },
  });

  const darkRadio = await screen.findByRole("radio", { name: "Dark" });
  await waitFor(() => expect(darkRadio.getAttribute("aria-checked")).toBe("true"));

  const langGroup = await screen.findByRole("radiogroup", { name: "Language" });
  fireEvent.click(within(langGroup).getByRole("radio", { name: "Bahasa Indonesia" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      { operation: "settings.update", input: { patch: { language: "id" } } },
    ]);
  });

  expect(document.documentElement.lang).toBe("id");

  const nav = screen.getByRole("navigation", { name: "Menu utama" });
  const items = Array.from(nav.querySelectorAll<HTMLElement>('[data-rail-item="true"]'));
  expect(items).toHaveLength(6);
  expect(within(nav).getByRole("button", { name: "Chat baru" })).toBeTruthy();
  expect(within(nav).getByRole("button", { name: "Cari" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Flow" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: /^Aktivitas/ })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Skill" })).toBeTruthy();
  expect(within(nav).getByRole("link", { name: "Pengaturan" })).toBeTruthy();

  expect(window.location.hash).toBe("#/settings");
  const c1 = await client.call("chats.get", { chatId: "c1" });
  expect(c1.composerText).toBe("run weekly");

  const gelapRadio = screen.getByRole("radio", { name: "Gelap" });
  expect(gelapRadio.getAttribute("aria-checked")).toBe("true");
  expect(setColorMode).not.toHaveBeenCalled();

  expect(
    screen.getByText(
      "Chat dan flow tetap memakai kata-kata saat dibuat. FlowDriven menjawab dalam bahasa yang Anda pakai.",
    ),
  ).toBeTruthy();
});

test("TC-j30-27 Failed language save shows toast and restores English choice and words", async () => {
  renderApp("#/settings", { scenario: "story-v2", language: "en", failSettingsUpdate: true });

  const langGroup = await screen.findByRole("radiogroup", { name: "Language" });
  const english = within(langGroup).getByRole("radio", { name: "English" });
  const indonesian = within(langGroup).getByRole("radio", { name: "Bahasa Indonesia" });

  fireEvent.click(indonesian);

  expect(await screen.findByText("Could not save. Try again.")).toBeTruthy();
  await waitFor(() => expect(english.getAttribute("aria-checked")).toBe("true"));
  expect(indonesian.getAttribute("aria-checked")).toBe("false");
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Language" })).toBeTruthy();
});

test("TC-j30-33 Changing language works with agent signed out while keeping agent name and chat language", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    setup(c) {
      const claude = c.state.agents.find((agent) => agent.id === "claude-code");
      if (claude) claude.state = "needs_login";
      const c1 = c.state.chats.find((item) => item.chat.id === "c1");
      if (c1) c1.chat.language = "en";
    },
  });

  const langGroup = await screen.findByRole("radiogroup", { name: "Language" });
  fireEvent.click(within(langGroup).getByRole("radio", { name: "Bahasa Indonesia" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      { operation: "settings.update", input: { patch: { language: "id" } } },
    ]);
  });

  expect(document.documentElement.lang).toBe("id");
  const agentsHeading = screen.getByRole("heading", { level: 2, name: "Agen AI" });
  const agentsSection = agentsHeading.closest("section");
  expect(agentsSection).not.toBeNull();
  if (!agentsSection) return;
  expect(within(agentsSection).getByText("Claude Code")).toBeTruthy();
  expect(within(agentsSection).getByText("Belum login")).toBeTruthy();
  expect(within(agentsSection).getByRole("button", { name: "Login" })).toBeTruthy();

  const c1 = await client.call("chats.get", { chatId: "c1" });
  expect(c1.chat.language).toBe("en");
});

test("TC-j30-34 Changing language works with permission off and permissionOff line follows app language", async () => {
  const { client } = renderApp("#/settings", {
    scenario: "story-v2",
    language: "en",
    permission: "off",
  });

  const langGroup = await screen.findByRole("radiogroup", { name: "Language" });
  fireEvent.click(within(langGroup).getByRole("radio", { name: "Bahasa Indonesia" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      { operation: "settings.update", input: { patch: { language: "id" } } },
    ]);
  });

  expect(document.documentElement.lang).toBe("id");
  const settings = await client.call("settings.get", {});
  expect(settings.agentPermission).toBe("off");
  expect(t("chat.permissionOff", undefined, "id")).not.toBe("FlowDriven may not run your AI agents.");
});
