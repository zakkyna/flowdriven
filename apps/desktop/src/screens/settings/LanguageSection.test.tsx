import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "../../App";
import { listLanguages } from "../../i18n/languages";
import { t } from "../../i18n/t";
import { RunnerProvider } from "../../runner/runner-context";
import { renderApp } from "../../test/render";

afterEach(() => {
  cleanup();
});

test("TC-j12-37 Language section lists every registered language and applies Bahasa Indonesia at once", async () => {
  const { client } = renderApp("#/settings", { scenario: "story-v2", language: "en" });

  const heading = await screen.findByRole("heading", { level: 2, name: "Language" });
  const section = heading.closest("section");
  expect(section).not.toBeNull();
  if (!section) return;

  const group = within(section).getByRole("radiogroup", { name: "Language" });
  const radios = within(group).getAllByRole("radio");
  const registered = listLanguages();
  expect(radios.map((radio) => radio.textContent?.trim())).toEqual(registered.map((item) => item.name));

  expect(
    within(section).getByText(
      "Chats and flows keep the words they were written in. FlowDriven answers in the language you write in.",
    ),
  ).toBeTruthy();

  fireEvent.click(within(group).getByRole("radio", { name: "Bahasa Indonesia" }));

  await waitFor(() => {
    expect(client.calls.filter((call) => call.operation === "settings.update")).toEqual([
      { operation: "settings.update", input: { patch: { language: "id" } } },
    ]);
  });

  expect(heading.textContent).toBe(t("settings.language", undefined, "id"));
});

test("LanguageProvider loads initial language from settings.get and falls back to English on failure", async () => {
  const originalHash = window.location.hash;
  const originalLang = document.documentElement.getAttribute("lang");
  try {
    window.location.hash = "#/settings";
    const idClient = createFixtureRunnerClient({ scenario: "story-v2" });
    idClient.state.settings.language = "id";
    const idView = render(
      <RunnerProvider client={idClient}>
        <App />
      </RunnerProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("id");
      expect(
        screen.getByRole("heading", { level: 2, name: t("settings.language", undefined, "id") }),
      ).toBeTruthy();
    });
    idView.unmount();

    const failingClient = createFixtureRunnerClient({ scenario: "story-v2" });
    const baseCall = failingClient.call.bind(failingClient);
    failingClient.call = ((operation, input) => {
      if (operation === "settings.get") return Promise.reject(new Error("Runner unreachable"));
      return baseCall(operation, input);
    }) as typeof failingClient.call;

    render(
      <RunnerProvider client={failingClient}>
        <App />
      </RunnerProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("en");
      expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    });
  } finally {
    if (originalLang === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.lang = originalLang;
    window.location.hash = originalHash;
  }
});
