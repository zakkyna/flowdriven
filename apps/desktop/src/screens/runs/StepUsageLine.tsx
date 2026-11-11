import type { StepUsage } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import styles from "./Runs.module.css";

export function StepUsageLine({ usage }: { usage: StepUsage }): ReactElement {
  const n = (value: number) => value.toLocaleString("en-US");
  return (
    <div className={styles.muted}>
      {usage.reported
        ? `Tokens: ${n(usage.input)} in, ${n(usage.output)} out, ${n(usage.cacheRead)} cache read, ${n(usage.cacheWrite)} cache write (${n(usage.turns)} turns, ${n(usage.wallSeconds)} s)`
        : "Tokens: not reported"}
    </div>
  );
}
