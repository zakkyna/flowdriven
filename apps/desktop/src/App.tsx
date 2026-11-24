import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures/v1";
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranslationKey } from "./i18n/t";
import { LegacyApp } from "./legacy/LegacyApp";
import {
  RunnerProvider as LegacyRunnerProvider,
  useHasRunnerProvider as useHasLegacyRunnerProvider,
} from "./legacy/runner-context";
import { type Route, routeToHash, useRoute } from "./nav/route";
import { COMPACT_QUERY, Drawer, NARROW_QUERY, useMediaQuery } from "./shell/Drawer";
import { LanguageProvider, useHasLanguageProvider, useLanguage } from "./shell/language";
import { type MorePreferenceStorage, Rail, type SecondaryNavItem } from "./shell/Rail";
import { SearchDialog } from "./shell/SearchDialog";
import styles from "./shell/Shell.module.css";

export type AppProps = {
  now?: () => number;
  zone?: string;
  secondaryItems?: readonly SecondaryNavItem[];
  moreStorage?: MorePreferenceStorage;
};

function legacyScenarioFromSearch(search: string): Scenario {
  const value = new URLSearchParams(search).get("scenario");
  return value === "empty" || value === "long" || value === "looped" ? value : "story";
}

function isLegacyRoute(route: Route): boolean {
  switch (route.screen) {
    case "builder":
    case "inbox":
    case "runs":
    case "run":
    case "readiness":
    case "harnesses":
      return true;
    default:
      return false;
  }
}

function routeTitle(route: Route, t: (key: TranslationKey) => string): string {
  switch (route.screen) {
    case "chat":
      return t("rail.chats");
    case "flows":
    case "flow":
      return t("rail.flows");
    case "activity":
    case "activity_run":
      return t("rail.activity");
    case "skills":
      return t("rail.skills");
    case "settings":
      return t("rail.settings");
    case "welcome":
      return t("welcome.welcome");
    default:
      return t("rail.pageNotFound");
  }
}

function PlaceholderScreen({ route }: { route: Route }): ReactElement {
  const { t } = useLanguage();
  const title = routeTitle(route, t);
  const description = route.screen === "not_found" ? t("rail.notFoundDescription") : undefined;
  return (
    <section data-screen={route.screen} data-screen-ready="true">
      <h1 tabIndex={-1}>{title}</h1>
      {description && <p>{description}</p>}
    </section>
  );
}

function AppContent({ now, zone, secondaryItems, moreStorage }: AppProps): ReactElement {
  const [route] = useRoute();
  const { language, t } = useLanguage();
  const legacy = isLegacyRoute(route);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const hasLegacyProvider = useHasLegacyRunnerProvider();
  const legacyClient = useMemo(
    () =>
      hasLegacyProvider || !legacy
        ? null
        : createFixtureRunnerClient({ scenario: legacyScenarioFromSearch(window.location.search) }),
    [hasLegacyProvider, legacy],
  );
  const mainRef = useRef<HTMLElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const routeKey = routeToHash(route);
  useEffect(() => {
    if (legacy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      if (event.defaultPrevented || searchOpen) return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [legacy, searchOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes must reset the main area.
  useLayoutEffect(() => {
    if (legacy) return;
    const main = mainRef.current;
    if (!main) return;
    for (const zoneEl of main.querySelectorAll<HTMLElement>('[data-scroll="top"]')) zoneEl.scrollTop = 0;
    const heading = main.querySelector("h1");
    if (heading) heading.focus({ preventScroll: true });
  }, [legacy, routeKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: route and language changes update the document title.
  useLayoutEffect(() => {
    if (legacy) return;
    const heading = mainRef.current?.querySelector("h1");
    if (heading) document.title = `${heading.textContent} - FlowDriven`;
  }, [legacy, routeKey, language]);

  if (legacy) {
    if (legacyClient) {
      return (
        <LegacyRunnerProvider client={legacyClient}>
          <LegacyApp />
        </LegacyRunnerProvider>
      );
    }
    return <LegacyApp />;
  }

  return (
    <div className={isNarrow ? styles.narrowFrame : styles.frame}>
      {/* biome-ignore lint/a11y/useValidAnchor: keep the hash route intact while focusing main. */}
      <a
        className={styles.skip}
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        {t("rail.skipToContent")}
      </a>
      {isNarrow ? (
        <Drawer
          route={route}
          pageTitle={routeTitle(route, t)}
          compact={isCompact}
          onOpenSearch={openSearch}
          now={now}
          zone={zone}
          secondaryItems={secondaryItems}
          moreStorage={moreStorage}
        />
      ) : (
        <Rail
          route={route}
          onOpenSearch={openSearch}
          now={now}
          zone={zone}
          secondaryItems={secondaryItems}
          moreStorage={moreStorage}
        />
      )}
      <main id="main-content" tabIndex={-1} ref={mainRef} className={styles.main}>
        <PlaceholderScreen route={route} />
      </main>
      <SearchDialog open={searchOpen} onClose={closeSearch} />
    </div>
  );
}

export function App(props: AppProps = {}): ReactElement {
  const hasLanguageProvider = useHasLanguageProvider();
  if (!hasLanguageProvider) {
    return (
      <LanguageProvider>
        <AppContent {...props} />
      </LanguageProvider>
    );
  }
  return <AppContent {...props} />;
}
