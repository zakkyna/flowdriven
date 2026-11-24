import { createFixtureRunnerClient, type FixtureRunnerClient, type Scenario } from "@flowdriven/fixtures";
import { cleanup, type RenderResult, render } from "@testing-library/react";
import { App } from "../App";
import { languages } from "../i18n/languages";
import { RunnerProvider } from "../runner/runner-context";
import { LanguageProvider } from "../shell/language";

export type SecondaryNavId = "skills" | "memory" | "marketplace" | "phone";
export type SecondaryNavItem = {
  id: SecondaryNavId;
  href: string;
  current?: boolean;
  needsYou?: boolean;
};
export type MorePreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type RenderAppOptions = {
  scenario?: Scenario;
  language?: string;
  permission?: "on" | "off" | "unset";
  failSettingsUpdate?: boolean;
  setup?: (client: FixtureRunnerClient) => void;
  now?: () => number;
  zone?: string;
  secondaryItems?: readonly SecondaryNavItem[];
  moreStorage?: MorePreferenceStorage;
};

export function renderApp(
  hash: string,
  options?: RenderAppOptions,
): RenderResult & { client: FixtureRunnerClient } {
  window.location.hash = hash;
  const client = createFixtureRunnerClient({
    scenario: options?.scenario,
    languages: languages.map((language) => language.code),
    permission: options?.permission,
    failSettingsUpdate: options?.failSettingsUpdate,
  });
  options?.setup?.(client);
  return {
    ...render(
      <RunnerProvider client={client}>
        <LanguageProvider language={options?.language}>
          <App
            now={options?.now}
            zone={options?.zone}
            secondaryItems={options?.secondaryItems}
            moreStorage={options?.moreStorage}
          />
        </LanguageProvider>
      </RunnerProvider>,
    ),
    client,
  };
}
export function readyState(container: HTMLElement, screenName: string): "true" | "false" | null {
  const value = container.querySelector(`[data-screen="${screenName}"]`)?.getAttribute("data-screen-ready");
  return value === "true" || value === "false" ? value : null;
}

export const BOTH_LANGUAGES_SCREENS: { screen: string; hash: string; testFile: string; builtIn: boolean }[] =
  [
    {
      screen: "welcome",
      hash: "#/welcome",
      testFile: "apps/desktop/src/screens/welcome/Welcome.test.tsx",
      builtIn: true,
    },
    {
      screen: "empty chat",
      hash: "#/chat",
      testFile: "apps/desktop/src/screens/chat/EmptyChat.test.tsx",
      builtIn: true,
    },
    ...["PlanCard", "RunCard", "DecisionCard", "DraftCard", "ChangeCard", "ScheduleCard", "InputsForm"].map(
      (screen) => ({
        screen,
        hash: "#/chat",
        testFile: `apps/desktop/src/screens/chat/${screen}.test.tsx`,
        builtIn: true,
      }),
    ),
    {
      screen: "picker",
      hash: "#/chat",
      testFile: "apps/desktop/src/screens/chat/ModelPicker.test.tsx",
      builtIn: true,
    },
    ...(
      [
        ["FlowsList", "#/flows"],
        ["FlowPage", "#/flows/example"],
        ["MakeFlowDialog", "#/flows"],
        ["ConfirmDialog", "#/flows/example"],
      ] as const
    ).map(([screen, hash]) => ({
      screen,
      hash,
      testFile: `apps/desktop/src/screens/flows/${screen}.test.tsx`,
      builtIn: true,
    })),
    ...(
      [
        ["ActivityScreen", "#/activity"],
        ["RunPage", "#/activity/example"],
        ["DecisionCard", "#/activity"],
        ["SimilarDialog", "#/activity"],
      ] as const
    ).map(([screen, hash]) => ({
      screen,
      hash,
      testFile: `apps/desktop/src/screens/activity/${screen}.test.tsx`,
      builtIn: true,
    })),
    {
      screen: "Settings",
      hash: "#/settings",
      testFile: "apps/desktop/src/screens/settings/Settings.test.tsx",
      builtIn: true,
    },
    {
      screen: "Skills",
      hash: "#/skills",
      testFile: "apps/desktop/src/screens/skills/SkillsScreen.test.tsx",
      builtIn: true,
    },
    {
      screen: "Search dialog",
      hash: "#/chat",
      testFile: "apps/desktop/src/shell/SearchDialog.test.tsx",
      builtIn: true,
    },
  ];

export async function renderAppBoth(
  hash: string,
  options: RenderAppOptions,
  body: (result: ReturnType<typeof renderApp> & { language: string }) => void | Promise<void>,
): Promise<void> {
  const originalHash = window.location.hash;
  const originalLang = document.documentElement.getAttribute("lang");
  try {
    for (const { code: language } of languages) {
      document.documentElement.lang = language;
      try {
        await body({ language, ...renderApp(hash, { ...options, language }) });
      } catch (error) {
        throw new Error(`${language}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      } finally {
        cleanup();
        window.location.hash = originalHash;
      }
    }
  } finally {
    if (originalLang === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.lang = originalLang;
    window.location.hash = originalHash;
  }
}
