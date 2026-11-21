import type { Playback as PlaybackData } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { Badge } from "../../ui/StatusBadge";
import styles from "./Builder.module.css";

export function Playback({ playback }: { playback: PlaybackData }): ReactElement {
  return (
    <section>
      <div className={styles.titleRow}>
        <h2>What this flow does</h2>
      </div>
      <dl className={styles.playback}>
        <dt>Goal</dt>
        <dd>{playback.goal}</dd>
        <dt>It will touch</dt>
        <dd>
          <div className={styles.touches}>
            {playback.touches.map((item) => (
              <Badge key={item} tone="neutral">
                {item}
              </Badge>
            ))}
          </div>
        </dd>
        <dt>It asks before</dt>
        <dd>
          {playback.asksApprovalFor.length ? (
            <ul>
              {playback.asksApprovalFor.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            "Nothing risky."
          )}
        </dd>
      </dl>
    </section>
  );
}
