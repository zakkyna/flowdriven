import { createFixtureRunnerClient, type Scenario } from "@flowdriven/fixtures/v1";
import { type ReactElement, useLayoutEffect, useMemo, useRef } from "react";
import styles from "./App.module.css";
import { t } from "./i18n/t";
import { LegacyApp } from "./legacy/LegacyApp";
import {
  RunnerProvider as LegacyRunnerProvider,
  useHasRunnerProvider as useHasLegacyRunnerProvider,
} from "./legacy/runner-context";
import { type Route, routeToHash, useRoute } from "./nav/route";

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

function PlaceholderScreen({ route }: { route: Route }): ReactElement {
  let title: string;
  let description: string | undefined;
  switch (route.screen) {
    case "chat":
      title = t("rail.chats");
      break;
    case "flows":
    case "flow":
      title = t("rail.flows");
      break;
    case "activity":
    case "activity_run":
      title = t("rail.activity");
      break;
    case "skills":
      title = t("rail.skills");
      break;
    case "settings":
      title = t("rail.settings");
      break;
    case "welcome":
      title = t("welcome.welcome");
      break;
    default:
      title = t("rail.pageNotFound");
      description = t("rail.notFoundDescription");
      break;
  }
  return (
    <section data-screen={route.screen} data-screen-ready="true">
      <h1 tabIndex={-1}>{title}</h1>
      {description && <p>{description}</p>}
    </section>
  );
}

export function App(): ReactElement {
  const [route] = useRoute();
  const legacy = isLegacyRoute(route);
  const hasLegacyProvider = useHasLegacyRunnerProvider();
  const legacyClient = useMemo(
    () =>
      hasLegacyProvider || !legacy
        ? null
        : createFixtureRunnerClient({ scenario: legacyScenarioFromSearch(window.location.search) }),
    [hasLegacyProvider, legacy],
  );
  const mainRef = useRef<HTMLElement>(null);
  const routeKey = routeToHash(route);
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes must reset the main area.
  useLayoutEffect(() => {
    if (legacy) return;
    const main = mainRef.current;
    if (!main) return;
    for (const zone of main.querySelectorAll<HTMLElement>('[data-scroll="top"]')) zone.scrollTop = 0;
    const heading = main.querySelector("h1");
    if (heading) {
      document.title = `${heading.textContent} - FlowDriven`;
      heading.focus({ preventScroll: true });
    }
  }, [legacy, routeKey]);

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
    <div className={styles.frame}>
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
      <main id="main-content" tabIndex={-1} ref={mainRef} className={styles.main}>
        <PlaceholderScreen route={route} />
      </main>
    </div>
  );
}
