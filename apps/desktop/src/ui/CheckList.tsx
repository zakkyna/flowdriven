import { type Check, type CheckResult, isJudgedOnly } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "./Button";
import styles from "./CheckList.module.css";
import { Badge, ToneIcon } from "./StatusBadge";
import { statusOf } from "./status";

function CheckRow({ check }: { check: Check | CheckResult }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const rawEvidence = "evidence" in check ? check.evidence : undefined;
  const evidence = rawEvidence?.trim() ? rawEvidence : undefined;
  const lines = evidence ? evidence.replace(/\r?\n$/, "").split("\n") : [];
  const verdict = "verdict" in check ? check.verdict : "pending";
  const { icon, tone, label } = statusOf("check", verdict);
  return (
    <div className={styles.row} data-verdict={verdict}>
      <ToneIcon icon={icon} tone={tone} size={14} />
      <div className={styles.content}>
        <span className={styles.summary}>{check.summary}</span>
        {check.summary !== check.type && <span className={styles.type}>{check.type}</span>}
        {!check.required && <span className={styles.optional}>(optional)</span>}
      </div>
      <span className={styles.result}>{label}</span>
      {evidence && (
        <pre className={styles.evidence}>{(expanded ? lines : lines.slice(0, 12)).join("\n")}</pre>
      )}
      {"verdict" in check && check.verdict === "passed" && !evidence && (
        <p className={styles.detail}>No evidence recorded</p>
      )}
      {lines.length > 12 && (
        <Button
          className={styles.detail}
          variant="quiet"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
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
