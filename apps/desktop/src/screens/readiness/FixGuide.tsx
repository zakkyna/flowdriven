import type { FixGuide as Guide } from "@flowdriven/contracts";
import { type ReactElement, useId, useState } from "react";
import { Button } from "../../ui/Button";
import { Badge } from "../../ui/StatusBadge";
import styles from "./Readiness.module.css";

export function FixGuide({ guide, onCheck }: { guide: Guide; onCheck: () => void }): ReactElement {
  const id = useId();
  const [status, setStatus] = useState("");
  return (
    <div className={styles.guide}>
      <h3>How to fix it</h3>
      {!guide.verified && <Badge tone="neutral">Publisher's instructions, not verified</Badge>}
      <ol>
        {guide.steps.map((step, index) => (
          // Steps have no stable identifier and can repeat.
          // biome-ignore lint/suspicious/noArrayIndexKey: position identifies each step.
          <li key={`${index}-${step}`}>{step}</li>
        ))}
      </ol>
      {guide.commands.map((command, index) => (
        // Commands have no stable identifier and can repeat.
        // biome-ignore lint/suspicious/noArrayIndexKey: position identifies each command.
        <div key={`${index}-${command}`} className={styles.command}>
          <pre id={`${id}-${index}`}>{command}</pre>
          <Button
            variant="quiet"
            aria-describedby={`${id}-${index}`}
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(command);
                  setStatus("Copied");
                } catch {
                  setStatus("Could not copy. Select the command and copy it by hand.");
                }
              })();
            }}
          >
            Copy
          </Button>
        </div>
      ))}
      {status && <p role="status">{status}</p>}
      <Button onClick={onCheck}>Check again</Button>
    </div>
  );
}
