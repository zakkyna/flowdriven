import type { StepRun } from "@flowdriven/contracts";
import { type ReactElement, useId } from "react";
import { CheckList } from "../../ui/CheckList";
import { StatusBadge } from "../../ui/StatusBadge";
import styles from "./Runs.module.css";
export function StepBlock({ step, index }: { step: StepRun; index: number }): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className={styles.step}>
      <div className={styles.stepHeader}>
        <span>{index}</span>
        <h3 id={id}>{step.title}</h3>
        <StatusBadge domain="step" value={step.state} />
      </div>
      <div className={styles.muted}>
        {step.worker && <span>Worker: {step.worker.name} </span>}
        <span>
          Attempt {step.attempts.length} of {step.maxAttempts}
        </span>
      </div>
      {step.note && <p>{step.note}</p>}
      <CheckList checks={step.checks} />
    </section>
  );
}
