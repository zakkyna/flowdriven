import type { FlowEdit, HarnessCard, LeafStep, Step, StepRun, StepRunState } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { Button } from "../../ui/Button";
import { CheckList } from "../../ui/CheckList";
import { Badge, StateIcon } from "../../ui/StatusBadge";
import { statusOf } from "../../ui/status";
import styles from "./Builder.module.css";

function workerDescription(step: LeafStep, harnesses: HarnessCard[]): { line: string; badge: string } {
  switch (step.do) {
    case "worker": {
      const preferences = [
        step.worker?.prefer?.length
          ? `Prefers ${step.worker.prefer.map((id) => harnesses.find((harness) => harness.id === id)?.name ?? id).join(", ")}.`
          : "",
        step.worker?.effort ? `Effort: ${step.worker.effort}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return { line: preferences || "Any worker.", badge: "Worker" };
    }
    case "agent":
      return { line: "Done by the brain, no tools.", badge: "Agent" };
    case "builtin":
      return { line: "Done by FlowDriven.", badge: "FlowDriven" };
    case "skill":
      return { line: `Uses the ${step.skill ?? "skill"} skill.`, badge: "Skill" };
    case "flow":
      return { line: `Runs ${step.flow ?? "another flow"}.`, badge: "Flow" };
    case "ask":
      return { line: "Asks you to choose.", badge: "Ask" };
    case "loop": {
      if (
        !("loop" in step) ||
        !step.loop ||
        typeof step.loop !== "object" ||
        !("as" in step.loop) ||
        typeof step.loop.as !== "string"
      )
        throw new Error("Loop declaration missing.");
      return { line: `Repeats for each ${step.loop.as}.`, badge: "Loop" };
    }
    default:
      throw new Error("Unknown step kind.");
  }
}

function Uses({ step }: { step: LeafStep }): ReactElement | null {
  return step.uses.length > 0 ? (
    <div className={styles.uses}>
      Uses{" "}
      {step.uses.map((id) => (
        <code key={id}>{id}</code>
      ))}
    </div>
  ) : null;
}

function When({ step }: { step: LeafStep }): ReactElement | null {
  return step.when ? (
    <div className={styles.when}>
      Runs only when <code>{step.when}</code>
    </div>
  ) : null;
}

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
  if (step.do === "ask" && !step.ask) throw new Error("Ask declaration missing.");
  const worker = workerDescription(step, harnesses);
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
          <span>{worker.line}</span>
          <Badge tone="neutral">{worker.badge}</Badge>
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
        <When step={step} />
        {step.do === "ask" && step.ask && (
          <>
            <div className={styles.when}>
              Choose from <code>{step.ask.choose_from}</code>, up to {step.ask.max_pick}.
            </div>
            <p>{step.ask.question}</p>
          </>
        )}
        {step.do === "loop" && step.loop && (
          <>
            <div className={styles.when}>
              For each item of <code>{step.loop.for_each}</code>
              {step.loop.key ? (
                <>
                  , keyed by <code>{step.loop.key}</code>
                </>
              ) : null}
              {step.loop.max ? `, at most ${step.loop.max}` : ""}.
            </div>
            <ol aria-label={`Steps in ${step.title}`} className={styles.nested}>
              {step.loop.steps.map((nested) => {
                const description = workerDescription(nested, harnesses);
                return (
                  <li key={nested.id} className={styles.nestedStep}>
                    <span>{nested.title}</span>
                    <div className={styles.workerLine}>
                      <span>{description.line}</span>
                      <Badge tone="neutral">{description.badge}</Badge>
                    </div>
                    <When step={nested} />
                    <Uses step={nested} />
                    {nested.checks.length > 0 && (
                      <div className={styles.checks}>
                        <CheckList checks={nested.checks} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <Uses step={step} />
        {checks.length > 0 && (
          <div className={styles.checks}>
            <CheckList checks={checks} />
          </div>
        )}
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
