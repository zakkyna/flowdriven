import type { RunItem, SkipReason } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { CheckList } from "../../ui/CheckList";
import { StateIcon } from "../../ui/StatusBadge";
import { statusOf } from "../../ui/status";
import { BlockedCalls } from "./BlockedCalls";
import styles from "./Runs.module.css";
import { StepUsageLine } from "./StepUsageLine";
import { StepWeb } from "./StepWeb";
import { WaitingLine } from "./WaitingLine";

const reasons: Record<SkipReason, string> = {
  seen: "Seen in an earlier run",
  duplicate: "Duplicate key",
  capped: "Over the item cap",
  stopped: "Stopped after an item failed",
};
export function ItemList({ title, items }: { title: string; items: RunItem[] }): ReactElement {
  return (
    <ul aria-label={`Items of ${title}`} className={styles.items}>
      {items.map((item, index) => (
        // The position distinguishes items with the same key.
        // biome-ignore lint/suspicious/noArrayIndexKey: duplicate item keys require the position.
        <li key={`${index}-${item.key}`}>
          <div className={styles.itemHeader}>
            <div>
              <div>
                <span className={styles.mono}>{item.key}</span> <span>{item.label}</span>
              </div>
              {item.skip ? (
                <p className={styles.muted}>{reasons[item.skip]}</p>
              ) : (
                item.note && <p className={styles.muted}>{item.note}</p>
              )}
            </div>
            <span className={styles.itemState}>
              <StateIcon domain="step" value={item.state} /> <span>{statusOf("step", item.state).label}</span>
            </span>
          </div>
          <ul
            aria-label={`Steps of ${item.key}${items.filter((other) => other.key === item.key).length > 1 ? `, item ${index + 1}` : ""}`}
          >
            {item.steps.map((step) => (
              <li key={step.stepId}>
                <div className={styles.itemHeader}>
                  <div>
                    <div>{step.title}</div>
                    {step.do !== "loop" && step.do !== "ask" && (
                      <div className={styles.muted}>
                        {step.worker && <span>Worker: {step.worker.name}, </span>}
                        <span>
                          {step.worker ? "attempt" : "Attempt"} {step.attempts.length} of {step.maxAttempts}
                        </span>
                      </div>
                    )}
                  </div>
                  {step.waiting ? (
                    <WaitingLine waiting={step.waiting} />
                  ) : (
                    <span className={styles.itemState}>
                      <StateIcon domain="step" value={step.state} />{" "}
                      <span>{statusOf("step", step.state).label}</span>
                    </span>
                  )}
                </div>
                {step.usage && <StepUsageLine usage={step.usage} />}
                <StepWeb step={step} />
                {step.checks.length > 0 && <CheckList checks={step.checks} />}
                {step.blocked && <BlockedCalls calls={step.blocked} />}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
