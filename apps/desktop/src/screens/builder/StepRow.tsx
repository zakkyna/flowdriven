import type { FlowEdit, HarnessCard, Step, StepRun, StepRunState } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "../../ui/Button";
import { CheckList } from "../../ui/CheckList";
import { Badge, StateIcon } from "../../ui/StatusBadge";
import { statusOf } from "../../ui/status";
import styles from "./Builder.module.css";

export function StepRow({
  step,
  busy,
  harnesses,
  index,
  count,
  status,
  run,
  edit,
  onDelete,
}: {
  step: Step;
  busy: boolean;
  harnesses: HarnessCard[];
  index: number;
  count: number;
  status: StepRunState;
  run?: StepRun;
  edit: (edit: FlowEdit) => void;
  onDelete: (step: Step) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const preferences = [
    step.worker?.prefer?.length
      ? `Prefers ${step.worker.prefer.map((id) => harnesses.find((harness) => harness.id === id)?.name ?? id).join(", ")}.`
      : "",
    step.worker?.effort ? `Effort: ${step.worker.effort}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const checks = step.checks.map((check, i) => {
    const result = run?.checks[i];
    return result && result.type === check.type && result.summary === check.summary ? result : check;
  });
  return (
    <li className={styles.step} data-state={status}>
      <div className={styles.stepNumber}>{index + 1}</div>
      <div className={styles.stepBody}>
        <div className={styles.stepHeader}>
          <StateIcon domain="step" value={status} />
          <button
            type="button"
            className={styles.titleButton}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {step.title}
          </button>
          <span className={styles.stepState} data-muted={status === "pending" || status === "skipped"}>
            {statusOf("step", status).label}
          </span>
        </div>
        <div className={styles.workerLine}>
          <span>
            {step.do === "worker"
              ? preferences || "Any worker."
              : step.do === "agent"
                ? "Done by the brain, no tools."
                : "Done by FlowDriven."}
          </span>
          <Badge tone="neutral">
            {step.do === "worker" ? "Worker" : step.do === "agent" ? "Agent" : "FlowDriven"}
          </Badge>
          <div className={styles.stepActions}>
            <Button
              variant="quiet"
              icon="arrow-up"
              aria-label="Move up"
              disabled={busy || index === 0}
              onClick={() => edit({ kind: "move", stepId: step.id, direction: "up" })}
            />
            <Button
              variant="quiet"
              icon="arrow-down"
              aria-label="Move down"
              disabled={busy || index === count - 1}
              onClick={() => edit({ kind: "move", stepId: step.id, direction: "down" })}
            />
            <Button
              variant="quiet"
              icon="duplicate"
              aria-label="Duplicate"
              disabled={busy}
              onClick={() => edit({ kind: "duplicate", stepId: step.id })}
            />
            <Button
              variant="quiet"
              icon="trash"
              aria-label="Delete"
              disabled={busy}
              onClick={() => onDelete(step)}
            />
          </div>
        </div>
        {step.uses.length > 0 && (
          <div className={styles.uses}>
            Uses{" "}
            {step.uses.map((id) => (
              <code key={id}>{id}</code>
            ))}
          </div>
        )}
        <div className={styles.checks}>
          <CheckList checks={checks} />
        </div>
        {expanded && (
          <div className={styles.details}>
            <h3>Instructions</h3>
            <p className={styles.prewrap}>{step.instructions}</p>
            <h3>Outputs</h3>
            {step.outputs.length ? (
              step.outputs.map((output) => (
                <div key={output.id}>
                  <code>{output.path ?? output.id}</code>
                </div>
              ))
            ) : (
              <p>No declared outputs.</p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
