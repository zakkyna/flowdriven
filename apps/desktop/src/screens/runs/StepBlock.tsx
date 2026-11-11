import type { StepRun } from "@flowdriven/contracts";
import { type ReactElement, useId } from "react";
import { CheckList } from "../../ui/CheckList";
import { Badge, StateIcon } from "../../ui/StatusBadge";
import { statusOf } from "../../ui/status";
import { ItemList } from "./ItemList";
import styles from "./Runs.module.css";
export function StepBlock({ step, index }: { step: StepRun; index: number }): ReactElement {
  const id = useId();
  const required = step.checks.filter((check) => check.required);
  const structural = step.do === "loop" || step.do === "ask";
  const contradiction =
    !structural &&
    step.state === "passed" &&
    (!required.length || required.some((check) => check.verdict !== "passed"));
  return (
    <section aria-labelledby={id} className={styles.step}>
      <div className={styles.stepHeader}>
        <span className={styles.stepNumber}>{index}</span>
        <StateIcon domain="step" value={step.state} />
        <h3 id={id}>{step.title}</h3>
        {contradiction ? (
          <Badge tone="bad" icon="alert">
            Marked passed without a passing check
          </Badge>
        ) : (
          <span
            className={styles.stepState}
            data-muted={step.state === "pending" || step.state === "skipped"}
          >
            {statusOf("step", step.state).label}
          </span>
        )}
      </div>
      <div className={styles.stepDetails}>
        {!structural && (
          <div className={styles.muted}>
            {step.worker && <span>Worker: {step.worker.name}, </span>}
            <span>
              {step.worker ? "attempt" : "Attempt"} {step.attempts.length} of {step.maxAttempts}
            </span>
          </div>
        )}
        {step.note && <p>{step.note}</p>}
        <CheckList checks={step.checks} />
        {step.items && <ItemList title={step.title} items={step.items} />}
        {step.picks &&
          (step.picks.length ? (
            <p>Picked: {step.picks.map((pick) => pick.label).join(", ")}</p>
          ) : (
            step.state === "passed" && <p>Nothing picked.</p>
          ))}
      </div>
    </section>
  );
}
