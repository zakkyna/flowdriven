import type { TriggerStatus } from "@flowdriven/contracts";
import { type ReactElement, useRef, useState } from "react";
import { AppLink } from "../../nav/AppLink";
import { useRunnerAction } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { formatDateTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import styles from "./Triggers.module.css";

const kinds: Record<TriggerStatus["kind"], string> = {
  manual: "Run by hand",
  schedule: "Schedule",
  file_change: "File change",
  flow_done: "After another flow",
  new_item: "New item",
  link: "Link",
  webhook: "Webhook",
};
const states = {
  on: { icon: "check", words: "On" },
  off: { icon: "dash", words: "Off" },
  needs_ok: { icon: "alert", words: "Needs your OK again" },
  unavailable: { icon: "circle-slash", words: "Not available yet" },
} as const;
function lastWords(last: NonNullable<TriggerStatus["last"]>): string {
  switch (last.outcome) {
    case "started":
      return "Started";
    case "skipped_overlap":
      return "Skipped: an earlier run was still open";
    case "dropped_cap":
      return "Dropped: the daily limit was reached";
    case "dropped_queue_full":
      return "Waited: too many runs are queued";
    case "duplicate":
      return "Skipped: already handled";
    case "needs_ok":
      return "Stopped: needs your OK again";
    case "refused":
      return `Refused: ${last.detail ?? ""}`;
    case "missed":
      return "Missed while FlowDriven was closed";
    case "depth":
      return "Stopped: the chain is too long";
    case "error":
      return "Error";
  }
}
export function TriggersPanel({
  flowId,
  hash,
  triggers,
  reload,
}: {
  flowId: string;
  hash: string;
  triggers: TriggerStatus[];
  reload: () => void;
}): ReactElement {
  const action = useRunnerAction();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  async function toggle(trigger: TriggerStatus) {
    if (
      inFlight.current ||
      trigger.kind === "manual" ||
      trigger.state === "unavailable" ||
      (trigger.state === "off" && !trigger.canEnable)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    const result = await action("triggers.setEnabled", {
      flowId,
      index: trigger.index,
      enabled: trigger.state !== "on",
      hash,
    });
    if (result.ok) {
      setError(undefined);
      reload();
    } else setError(result.error.message);
    inFlight.current = false;
    setBusy(false);
  }
  return (
    <section aria-label="Triggers" className={styles.panel}>
      <h2>Triggers</h2>
      <p className={styles.muted}>
        Triggers fire only while FlowDriven is open. On a Mac you can close the window and leave the app open;
        quitting the app stops them.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          <Icon name="alert" />
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {triggers.map((trigger) => {
          const state = states[trigger.state];
          return (
            <li key={trigger.index} className={styles.row}>
              <div className={styles.header}>
                <div>
                  <strong>{kinds[trigger.kind]}</strong>
                  <div className={styles.muted}>{trigger.summary}</div>
                </div>
                <Button
                  size="small"
                  role="switch"
                  aria-checked={trigger.state === "on"}
                  icon={state.icon}
                  disabled={
                    busy ||
                    trigger.kind === "manual" ||
                    trigger.state === "unavailable" ||
                    (trigger.state === "off" && !trigger.canEnable)
                  }
                  onClick={() => void toggle(trigger)}
                >
                  {state.words}
                </Button>
              </div>
              {trigger.state === "on" && trigger.nextAt && <p>Next run: {formatDateTime(trigger.nextAt)}</p>}
              {trigger.last && (
                <p>
                  Last:{" "}
                  {trigger.last.runId ? (
                    <AppLink to={{ screen: "run", runId: trigger.last.runId }}>
                      {lastWords(trigger.last)} {formatDateTime(trigger.last.at)}
                    </AppLink>
                  ) : (
                    <>
                      {lastWords(trigger.last)} {formatDateTime(trigger.last.at)}
                    </>
                  )}
                </p>
              )}
              <p>
                Today: {trigger.firesToday} of {trigger.dailyCap} runs
                {trigger.droppedToday > 0 && `, ${trigger.droppedToday} dropped`}
              </p>
              {trigger.reason && (
                <p className={styles.muted}>
                  <Icon name="alert" /> {trigger.reason}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
