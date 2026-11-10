import type { Playback as PlaybackData } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import styles from "./Builder.module.css";

export function Playback({ playback }: { playback: PlaybackData }): ReactElement {
  return (
    <section className={styles.panel}>
      <h2>What this flow does</h2>
      <dl className={styles.playback}>
        <dt>Goal</dt>
        <dd>{playback.goal}</dd>
        <dt>It will touch</dt>
        <dd>
          <ul>
            {playback.touches.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
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
