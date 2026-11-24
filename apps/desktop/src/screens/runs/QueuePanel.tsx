import type { ReactElement } from "react";
import { useRunnerAction, useRunnerQuery } from "../../legacy/runner-context";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons";
import styles from "./Runs.module.css";
import { WaitingLine } from "./WaitingLine";

export function QueuePanel(): ReactElement {
  const queue = useRunnerQuery("queue.list", {});
  const action = useRunnerAction();
  const data = queue.data;
  return (
    <section className={styles.queue}>
      {queue.error && <p role="alert">{queue.error.message}</p>}
      {data && (
        <>
          <p>
            {data.running === 0 && data.waiting === 0
              ? "No steps running or waiting."
              : `${data.running} ${data.running === 1 ? "step" : "steps"} running, ${data.waiting} waiting`}
          </p>
          <ul aria-label="Queue" className={styles.rows}>
            {data.rows.map((row) => (
              <li key={`${row.runId}-${row.stepId ?? ""}-${row.itemKey ?? ""}`}>
                <span>
                  {row.flowName}
                  {row.stepTitle && `: ${row.stepTitle}`}
                </span>
                {row.state === "running" ? (
                  <span className={styles.waiting}>
                    <Icon name="runs" />
                    <span>Running</span>
                  </span>
                ) : (
                  row.waiting && <WaitingLine waiting={row.waiting} />
                )}
                {row.state === "waiting" && (
                  <Button
                    onClick={() => {
                      void action("queue.move", { runId: row.runId }).then(() => queue.reload());
                    }}
                  >
                    Move to front
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
