import { type ReactElement, useLayoutEffect, useRef } from "react";
import styles from "./App.module.css";
import { APP_NAME, SAMPLE_DATA_NOTE } from "./app-info";
import { AppLink } from "./nav/AppLink";
import { NotFoundPage } from "./nav/NotFoundPage";
import { type Route, routeToHash, useRoute } from "./nav/route";
import { useRunnerQuery } from "./runner/runner-context";
import { BuilderScreen } from "./screens/builder/BuilderScreen";
import { HarnessesScreen } from "./screens/harnesses/HarnessesScreen";
import { InboxScreen } from "./screens/inbox/InboxScreen";
import { ReadinessScreen } from "./screens/readiness/ReadinessScreen";
import { RunDetailScreen } from "./screens/runs/RunDetailScreen";
import { RunsScreen } from "./screens/runs/RunsScreen";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { shellKind } from "./shell";
import { Icon, type IconName } from "./ui/icons";

const links: { label: string; icon: IconName; to: Route }[] = [
  { label: "Builder", icon: "builder", to: { screen: "builder" } },
  { label: "Inbox", icon: "inbox", to: { screen: "inbox" } },
  { label: "Runs", icon: "runs", to: { screen: "runs" } },
  { label: "Readiness", icon: "readiness", to: { screen: "readiness" } },
  { label: "Harnesses", icon: "harnesses", to: { screen: "harnesses" } },
  { label: "Settings", icon: "settings", to: { screen: "settings" } },
];
function Screen({ route }: { route: Route }): ReactElement {
  switch (route.screen) {
    case "builder":
      return <BuilderScreen flowId={route.flowId} />;
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
    case "not_found":
      return (
        <NotFoundPage
          screen="not_found"
          title="Page not found"
          text={`There is no page at ${route.hash}.`}
          linkLabel="Go to Builder"
          to={{ screen: "builder" }}
        />
      );
  }
}
export function App(): ReactElement {
  const [route] = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const routeKey = routeToHash(route);
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes must reset the main area.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    const heading = main.querySelector("h1");
    if (heading) {
      document.title = `${heading.textContent} - FlowDriven`;
      heading.focus({ preventScroll: true });
    }
  }, [routeKey]);
  const { data, loading } = useRunnerQuery("approvals.list", { state: "pending" });
  const count = data?.length ?? 0;
  return (
    <div className={styles.frame}>
      <aside className={styles.rail}>
        <div className={styles.brand}>{APP_NAME}</div>
        <nav aria-label="Main" aria-busy={loading}>
          <div className={styles.links}>
            {links.map(({ label, icon, to }) => (
              <AppLink
                key={label}
                to={to}
                className={styles.link}
                aria-current={
                  route.screen === to.screen || (route.screen === "run" && to.screen === "runs")
                    ? "page"
                    : undefined
                }
                aria-label={label === "Inbox" && count ? `Inbox, ${count} waiting` : label}
              >
                <Icon name={icon} />
                <span>{label}</span>
                {label === "Inbox" && count > 0 && (
                  <span className={styles.count} aria-hidden="true">
                    {count}
                  </span>
                )}
              </AppLink>
            ))}
          </div>
        </nav>
        <footer className={styles.footer}>
          <div>{SAMPLE_DATA_NOTE}</div>
          <div>{shellKind() === "electron" ? "Desktop app" : "Browser preview"}</div>
        </footer>
      </aside>
      <main ref={mainRef} className={styles.main}>
        <Screen route={route} />
      </main>
    </div>
  );
}
