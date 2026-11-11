import type { RunItem, SkipReason } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { CheckList } from "../../ui/CheckList";
import { StateIcon } from "../../ui/StatusBadge";
import { statusOf } from "../../ui/status";
import styles from "./Runs.module.css";

const reasons: Record<SkipReason, string> = {
  seen: "Seen in an earlier run",
  duplicate: "Duplicate key",
  capped: "Over the item cap",
  stopped: "Stopped after an item failed",
};
export function ItemList({ title, items }: { title: string; items: RunItem[] }): ReactElement {
  return (
    <ul aria-label={`Items of ${title}`} className={styles.items}>
      {items.map((item) => (
        <li key={item.key}>
          <span className={styles.mono}>{item.key}</span> <span>{item.label}</span>{" "}
          <StateIcon domain="step" value={item.state} /> <span>{statusOf("step", item.state).label}</span>
          {item.skip ? <p>{reasons[item.skip]}</p> : item.note && <p>{item.note}</p>}
          <ul aria-label={`Steps of ${item.key}`}>
            {item.steps.map((step) => (
              <li key={step.stepId}>
                <span>{step.title}</span> {step.worker && <span>{step.worker.name} </span>}
                <span>{statusOf("step", step.state).label}</span>
                {step.checks.length > 0 && <CheckList checks={step.checks} />}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
