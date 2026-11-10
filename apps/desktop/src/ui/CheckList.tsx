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
        {!check.required && <span className={styles.optional}>(optional)</span>}
      </div>
      {evidence !== undefined && (
        <pre className={styles.evidence}>{(expanded ? lines : lines.slice(0, 12)).join("\n")}</pre>
      )}
      {lines.length > 12 && (
        <Button variant="quiet" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer lines" : `Show all ${lines.length} lines`}
        </Button>
      )}
    </div>
  );
}
export function CheckList({ checks }: { checks: (Check | CheckResult)[] }): ReactElement {
  return (
    <div role="group" aria-label="Checks" className={styles.list}>
      {checks.map((check, index) => (
        // The position is the identity: checks have no stable IDs.
        // biome-ignore lint/suspicious/noArrayIndexKey: checks have no stable IDs.
        <CheckRow key={index} check={check} />
      ))}
      {isJudgedOnly(checks) && (
        <Badge tone="neutral" icon="half">
          Judged, not verified
        </Badge>
      )}
    </div>
  );
}
