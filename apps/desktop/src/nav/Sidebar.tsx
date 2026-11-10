import type { ReactElement } from "react";
import { APP_NAME, SAMPLE_DATA_NOTE } from "../app-info";
import { useRunnerQuery } from "../runner/runner-context";
import { shellKind } from "../shell";
import { flowState } from "../ui/flow-state";
import { Icon, type IconName } from "../ui/icons";
import { ToneIcon } from "../ui/StatusBadge";
import { AppLink } from "./AppLink";
import type { Route } from "./route";
import styles from "./Sidebar.module.css";

const links: { label: string; icon: IconName; to: Route }[] = [
  { label: "Inbox", icon: "inbox", to: { screen: "inbox" } },
  { label: "Runs", icon: "runs", to: { screen: "runs" } },
  { label: "Readiness", icon: "readiness", to: { screen: "readiness" } },
  { label: "Harnesses", icon: "harnesses", to: { screen: "harnesses" } },
  { label: "Settings", icon: "settings", to: { screen: "settings" } },
];

export function Sidebar({ route }: { route: Route }): ReactElement {
  const approvals = useRunnerQuery("approvals.list", { state: "pending" });
  const flows = useRunnerQuery("flows.list", {});
  const count = approvals.data?.length ?? 0;
  const firstFlowId = flows.data?.[0]?.id;
  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Icon name="mark" size={14} />
        </span>
        {APP_NAME}
      </div>
      <AppLink
        to={{ screen: "builder", isNew: true }}
        className={styles.newFlow}
        aria-current={route.screen === "builder" && route.isNew ? "page" : undefined}
      >
        <Icon name="plus" /> New flow
      </AppLink>
      <nav aria-label="Main" aria-busy={approvals.loading} className={styles.mainNav}>
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
            <span className={styles.navIcon}>
              <Icon name={icon} />
            </span>
            <span>{label}</span>
            {label === "Inbox" && count > 0 && (
              <span className={styles.count} aria-hidden="true">
                {count}
              </span>
            )}
          </AppLink>
        ))}
      </nav>
      <div id="flows-label" className={styles.flowsLabel}>
        Flows
      </div>
      <nav aria-label="Flows" aria-busy={flows.loading} className={styles.flowsNav}>
        <ul aria-labelledby="flows-label" className={styles.flowList}>
          {flows.data?.map((flow) => {
            const state = flowState(flow);
            return (
              <li key={flow.id}>
                <AppLink
                  to={{ screen: "builder", flowId: flow.id }}
                  className={styles.flowLink}
                  aria-current={
                    route.screen === "builder" && !route.isNew && flow.id === (route.flowId ?? firstFlowId)
                      ? "page"
                      : undefined
                  }
                >
                  <span className={styles.flowIcon}>
                    <ToneIcon icon={state.icon} tone={state.tone} />
                  </span>
                  <span className={styles.flowText}>
                    <span className={styles.flowName}>{flow.name}</span>
                    <span className={styles.flowState}>{state.label}</span>
                  </span>
                </AppLink>
              </li>
            );
          })}
        </ul>
        {!flows.loading && flows.data?.length === 0 && (
          <p className={styles.empty}>Flows you make appear here.</p>
        )}
      </nav>
      <footer className={styles.footer}>
        <div>{SAMPLE_DATA_NOTE}</div>
        <div>{shellKind() === "electron" ? "Desktop app" : "Browser preview"}</div>
      </footer>
    </div>
  );
}
