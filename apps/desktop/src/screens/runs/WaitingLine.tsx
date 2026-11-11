import type { Waiting } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { formatTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import styles from "./Runs.module.css";

export function waitingLabel(w: Waiting): string {
  switch (w.reason) {
    case "memory":
      return "Waiting for memory";
    case "flow_overlap":
      return "Waiting for the earlier run of this flow";
    case "ceiling":
      return w.running !== undefined && w.ceiling !== undefined
        ? `Waiting: ${w.running} of ${w.ceiling} running`
        : "Waiting: all slots are busy";
    case "quota":
      return `Waiting for ${w.harnessId === "claude-code" ? "Claude Code's" : "the harness's"} limit${w.until ? ` (resets ${formatTime(w.until)})` : ""}`;
  }
}
export function WaitingLine({ waiting }: { waiting: Waiting }): ReactElement {
  return (
    <span className={styles.waiting}>
      <Icon name="clock" />
      <span>{waitingLabel(waiting)}</span>
    </span>
  );
}
