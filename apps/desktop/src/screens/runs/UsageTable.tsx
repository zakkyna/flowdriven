import type { UsageRow } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { formatDuration, formatUsd } from "../../ui/format";
import styles from "./Runs.module.css";
export function UsageTable({ usage }: { usage: UsageRow[] }): ReactElement {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {["Harness", "Calls", "Tokens", "Time", "Estimated cost"].map((heading) => (
            <th key={heading}>{heading}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {usage.map((row) => (
          <tr key={row.harnessId}>
            <td>{row.name}</td>
            <td>{row.calls}</td>
            <td>{row.tokens?.toLocaleString("en-US") ?? "Not reported"}</td>
            <td>{formatDuration(row.wallSeconds)}</td>
            <td>{row.estimatedCostUsd === undefined ? "Not reported" : formatUsd(row.estimatedCostUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
