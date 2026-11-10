import type { RunSummary } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { AppLink } from "../../nav/AppLink";
import { formatDateTime } from "../../ui/format";
import { Badge, StatusBadge } from "../../ui/StatusBadge";
import styles from "./Runs.module.css";
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
            </td>
            <td>
              <StatusBadge domain="run" value={run.state} />
            </td>
            <td>{formatDateTime(run.startedAt)}</td>
            <td className={styles.mono}>{run.project}</td>
            <td>{run.reportFirstLine ?? <span className={styles.muted}>No report yet</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
