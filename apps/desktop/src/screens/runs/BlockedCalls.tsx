import type { BlockedCall } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { Icon } from "../../ui/icons";
import { Revealed } from "../inbox/PayloadView";
import styles from "./Runs.module.css";

export function BlockedCalls({ calls }: { calls: BlockedCall[] }): ReactElement {
  return (
    <section aria-label="Blocked calls">
      <h4>Blocked calls</h4>
      <ul>
        {calls.map((call) => (
          <li className={styles.blockedCall} key={JSON.stringify([call.tool, call.reason])}>
            <Icon name="alert" />{" "}
            <span>
              <Revealed text={call.tool} singleLine />
            </span>{" "}
            <span>
              <Revealed text={call.reason} singleLine />
            </span>{" "}
            <span>
              ({call.count} {call.count === 1 ? "time" : "times"})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
