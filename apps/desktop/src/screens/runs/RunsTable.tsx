import type { RunSummary } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { AppLink } from "../../nav/AppLink";
import { formatDateTime } from "../../ui/format";
import { Badge, StatusBadge } from "../../ui/StatusBadge";
import styles from "./Runs.module.css";
import { WaitingLine } from "./WaitingLine";
export function RunsTable({ runs }: { runs: RunSummary[] }): ReactElement {
  return (
    <table aria-label="Runs" className={styles.table}>
      <thead>
        <tr>
          {["Run", "Flow", "State", "Started", "Project", "Report"].map((heading) => (
            <th key={heading}>{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td className={styles.mono}>
              <AppLink to={{ screen: "run", runId: run.id }}>{run.id}</AppLink>
            </td>
            <td>
              {run.flowName} {run.oneTime && <Badge tone="neutral">One-time</Badge>}
              {run.trigger && <div className={styles.muted}>{run.trigger.words}</div>}
            </td>
            <td>
              {run.waiting ? (
                <WaitingLine waiting={run.waiting} />
              ) : (
                <StatusBadge domain="run" value={run.state} />
              )}
            </td>
            <td>{formatDateTime(run.startedAt)}</td>
            <td className={`${styles.mono} ${styles.truncate}`} title={run.project}>
              {run.project}
            </td>
            <td className={styles.truncate} title={run.reportFirstLine ?? "No report yet"}>
              {run.reportFirstLine ?? <span className={styles.muted}>No report yet</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
