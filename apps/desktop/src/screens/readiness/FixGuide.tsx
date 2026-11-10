import type { FixGuide as Guide } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/StatusBadge";
import styles from "./Readiness.module.css";

export function FixGuide({ guide, onCheck }: { guide: Guide; onCheck: () => void }): ReactElement {
  return (
    <div className={styles.guide}>
      <h3>How to fix it</h3>
      {!guide.verified && <Badge tone="neutral">Publisher's instructions, not verified</Badge>}
      <ol>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.commands.map((command) => (
        <div key={command} className={styles.command}>
          <pre>{command}</pre>
          <Button variant="quiet" onClick={() => void navigator.clipboard.writeText(command)}>
            Copy
          </Button>
        </div>
      ))}
      <Button onClick={onCheck}>Check again</Button>
    </div>
  );
}
