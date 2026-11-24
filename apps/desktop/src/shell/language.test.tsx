import { createFixtureRunnerClient } from "@flowdriven/fixtures";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "../App";
import { languages } from "../i18n/languages";
import { RunnerProvider } from "../runner/runner-context";
import { renderApp, renderAppBoth } from "../test/render";
import { LanguageProvider, useLanguage } from "./language";

function withNavigatorLanguage<T>(value: string, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(navigator, "language");
  Object.defineProperty(navigator, "language", { value, configurable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(navigator, "language", original);
    else Reflect.deleteProperty(navigator, "language");
  }
}

function withDocumentLang<T>(initial: string | null, fn: () => T): T {
  const original = document.documentElement.getAttribute("lang");
  if (initial === null) document.documentElement.removeAttribute("lang");
  else document.documentElement.lang = initial;
  try {
    return fn();
  } finally {
    if (original === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.lang = original;
  }
}

test("TC-j30-02 sets document.documentElement.lang to en whatever navigator.language says", () => {
  withDocumentLang(null, () => {
    withNavigatorLanguage("id-ID", () => {
      const view = renderApp("#/settings", { scenario: "story-v2" });
      expect(document.documentElement.lang).toBe("en");
      expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
      view.unmount();
    });
  });

  withDocumentLang("id", () => {
    withNavigatorLanguage("id-ID", () => {
      const view = renderApp("#/settings", { scenario: "story-v2" });
      expect(document.documentElement.lang).toBe("en");
      view.unmount();
    });
  });
});

test("TC-j30-02 renderApp language option sets document.documentElement.lang and translates app words", () => {
  withDocumentLang(null, () => {
    const idView = renderApp("#/settings", { scenario: "story-v2", language: "id" });
    expect(document.documentElement.lang).toBe("id");
    expect(screen.getByRole("heading", { level: 1, name: "Pengaturan" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lewati ke konten" })).toBeTruthy();
    expect(document.title).toBe("Pengaturan - FlowDriven");
    idView.unmount();

    const unknownView = renderApp("#/settings", { scenario: "story-v2", language: "xx" });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    unknownView.unmount();
  });
});

test("TC-j30-02 renderAppBoth renders English then Indonesian with matching lang and words", async () => {
  const seen: string[] = [];
  await renderAppBoth("#/settings", { scenario: "story-v2" }, ({ language }) => {
    seen.push(language);
    expect(document.documentElement.lang).toBe(language);
    if (language === "en") {
      expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
    } else {
      expect(screen.getByRole("heading", { level: 1, name: "Pengaturan" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Lewati ke konten" })).toBeTruthy();
    }
  });
  expect(seen).toEqual(["en", "id"]);
});

function LanguageProbe() {
  const { language, t } = useLanguage();
  return <output data-language={language}>{t("rail.settings")}</output>;
}

test("TC-j30-02 LanguageProvider, useLanguage, and App default provider resolve English and fallback safely", () => {
  withDocumentLang(null, () => {
    withNavigatorLanguage("id-ID", () => {
      const view = render(
        <LanguageProvider>
          <LanguageProbe />
        </LanguageProvider>,
      );
      expect(document.documentElement.lang).toBe("en");
      expect(screen.getByRole("status").getAttribute("data-language")).toBe("en");
      expect(screen.getByRole("status").textContent).toBe("Settings");

      view.rerender(
        <LanguageProvider language="id">
          <LanguageProbe />
        </LanguageProvider>,
      );
      expect(document.documentElement.lang).toBe("id");
      expect(screen.getByRole("status").getAttribute("data-language")).toBe("id");
      expect(screen.getByRole("status").textContent).toBe("Pengaturan");

      view.rerender(
        <LanguageProvider language="zz">
          <LanguageProbe />
        </LanguageProvider>,
      );
      expect(document.documentElement.lang).toBe("en");
      expect(screen.getByRole("status").getAttribute("data-language")).toBe("en");
      expect(screen.getByRole("status").textContent).toBe("Settings");
      view.unmount();
    });
  });

  withDocumentLang("id", () => {
    withNavigatorLanguage("id-ID", () => {
      const originalHash = window.location.hash;
      try {
        window.location.hash = "#/settings";
        const client = createFixtureRunnerClient({
          scenario: "story-v2",
          languages: languages.map((language) => language.code),
        });
        const view = render(
          <RunnerProvider client={client}>
            <App />
          </RunnerProvider>,
        );
        expect(document.documentElement.lang).toBe("en");
        expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
        view.unmount();
      } finally {
        window.location.hash = originalHash;
      }
    });
  });

  const bareView = render(<LanguageProbe />);
  expect(screen.getByRole("status").getAttribute("data-language")).toBe("en");
  expect(screen.getByRole("status").textContent).toBe("Settings");
  bareView.unmount();
});
