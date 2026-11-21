import type { LeafStepRun } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { Icon } from "../../ui/icons";
import styles from "./Runs.module.css";

export function StepWeb({ step }: { step: Pick<LeafStepRun, "outside" | "pagesRead"> }): ReactElement | null {
  const pages = step.pagesRead ?? 0;
  if (step.outside !== true && !(pages > 0)) return null;
  return (
    <div className={styles.webLines}>
      {step.outside === true && (
        <div className={styles.webLine}>
          <Icon name="post" /> <span>Has text from outside</span>
        </div>
      )}
      {pages > 0 && (
        <div className={styles.webLine}>
          <span>Pages read: {pages}</span>
        </div>
      )}
    </div>
  );
}
