import { type ReactElement, useLayoutEffect, useRef } from "react";
import styles from "../App.module.css";
import { NotFoundPage } from "../nav/NotFoundPage";
import { type Route, routeToHash, useRoute } from "../nav/route";
import { Sidebar } from "../nav/Sidebar";
import { BuilderScreen } from "../screens/builder/BuilderScreen";
import { HarnessesScreen } from "../screens/harnesses/HarnessesScreen";
import { InboxScreen } from "../screens/inbox/InboxScreen";
import { ReadinessScreen } from "../screens/readiness/ReadinessScreen";
import { RunDetailScreen } from "../screens/runs/RunDetailScreen";
import { RunsScreen } from "../screens/runs/RunsScreen";
import { SettingsScreen } from "../screens/settings/SettingsScreen";

function Screen({ route }: { route: Route }): ReactElement {
  switch (route.screen) {
    case "builder":
      return <BuilderScreen key={route.isNew ? "new" : "flow"} flowId={route.flowId} isNew={route.isNew} />;
    case "inbox":
      return <InboxScreen approvalId={route.approvalId} />;
    case "runs":
      return <RunsScreen />;
    case "run":
      return <RunDetailScreen runId={route.runId} />;
    case "readiness":
      return <ReadinessScreen flowId={route.flowId} />;
    case "harnesses":
      return <HarnessesScreen />;
    case "settings":
      return <SettingsScreen />;
    default:
      return (
        <NotFoundPage
          screen="not_found"
          title="Page not found"
          text={`There is no page at ${routeToHash(route)}.`}
          linkLabel="Go to Builder"
          to={{ screen: "builder" }}
        />
      );
  }
}
export function LegacyApp(): ReactElement {
  const [route] = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const routeKey = routeToHash(route);
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes must reset the main area.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    for (const zone of main.querySelectorAll<HTMLElement>('[data-scroll="top"]')) zone.scrollTop = 0;
    const heading = main.querySelector("h1");
    if (heading) {
      document.title = `${heading.textContent} - FlowDriven`;
      heading.focus({ preventScroll: true });
    }
  }, [routeKey]);
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
        Skip to content
      </a>
      <Sidebar route={route} />
      <main id="main-content" tabIndex={-1} ref={mainRef} className={styles.main}>
        <Screen route={route} />
      </main>
    </div>
  );
}
