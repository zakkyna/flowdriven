import { type Check, type CheckResult, isJudgedOnly } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "./Button";
import styles from "./CheckList.module.css";
import { Badge, StatusBadge } from "./StatusBadge";

function CheckRow({ check }: { check: Check | CheckResult }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const evidence = "evidence" in check ? check.evidence : undefined;
  const lines = evidence?.split("\n") ?? [];
  return (
    <div className={styles.row}>
      <div className={styles.content}>
        {"verdict" in check && <StatusBadge domain="check" value={check.verdict} />}
        <span className={styles.summary}>{check.summary}</span>
        <span className={styles.type}>{check.type}</span>
        {!check.required && <span>(optional)</span>}
      </div>
      {evidence !== undefined && (
        <pre className={styles.evidence}>{(expanded ? lines : lines.slice(0, 12)).join("\n")}</pre>
      )}
      {lines.length > 12 && !expanded && (
        <Button variant="quiet" onClick={() => setExpanded(true)}>
          Show all {lines.length} lines
        </Button>
      )}
    </div>
  );
}
export function CheckList({ checks }: { checks: (Check | CheckResult)[] }): ReactElement {
  const occurrences = new Map<string, number>();
  return (
    <div role="group" aria-label="Checks" className={styles.list}>
      {checks.map((check) => {
        const identity = JSON.stringify(check);
        const count = occurrences.get(identity) ?? 0;
        occurrences.set(identity, count + 1);
        return <CheckRow key={`${identity}-${count}`} check={check} />;
      })}
      {isJudgedOnly(checks) && (
        <Badge tone="neutral" icon="half">
          Judged, not verified
        </Badge>
      )}
    </div>
  );
}
