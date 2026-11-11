import type { Approval } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { formatDateTime } from "../../ui/format";
import { Icon, type IconName } from "../../ui/icons";
import { StatusBadge } from "../../ui/StatusBadge";
import styles from "./Inbox.module.css";
import { Revealed } from "./PayloadView";

export function actionName(a: Approval): string {
  if (a.kind === "risky_action")
    return { send: "Send", post: "Post", pay: "Pay", delete: "Delete", merge: "Merge" }[
      a.riskyAction ?? "send"
    ];
  return {
    flow_sign_off: "Flow sign-off",
    result_sign_off: "Result sign-off",
    budget_raise: "Budget raise",
    requirement_addition: "New requirement",
    ask: "Choice",
  }[a.kind];
}
export function noun(a: Approval): string {
  if (a.kind === "risky_action")
    return { send: "send", post: "post", pay: "payment", delete: "deletion", merge: "merge" }[
      a.riskyAction ?? "send"
    ];
  return {
    flow_sign_off: "change",
    result_sign_off: "result",
    budget_raise: "budget raise",
    requirement_addition: "requirement",
    ask: "choice",
  }[a.kind];
}
function icon(a: Approval): IconName {
  if (a.kind === "risky_action")
    return { send: "send", post: "post", pay: "coin", delete: "trash", merge: "builder" }[
      a.riskyAction ?? "send"
    ] as IconName;
  return {
    flow_sign_off: "builder",
    result_sign_off: "check",
    budget_raise: "coin",
    requirement_addition: "plus",
    ask: "list",
  }[a.kind] as IconName;
}
export function ApprovalList({
  items,
  selected,
  select,
}: {
  items: Approval[];
  selected?: string;
  select: (id: string) => void;
}): ReactElement {
  return (
    <ul aria-label="Decisions" className={styles.list}>
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className={styles.item}
            aria-current={a.id === selected ? "true" : undefined}
            onClick={() => select(a.id)}
          >
            <span className={styles.itemIcon}>
              <Icon name={icon(a)} />
            </span>
            <span className={styles.itemText}>
              <span className={styles.summary}>
                <Revealed text={a.summary} />
              </span>
              <span className={styles.flow}>
                <Revealed text={a.flowName} />
                {a.stepTitle && (
                  <>
                    , <Revealed text={a.stepTitle} />
                  </>
                )}
              </span>
              {a.state === "pending" ? (
                <span className={styles.expiry}>
                  <Icon name="clock" size={13} /> Expires {formatDateTime(a.expiresAt)}
                </span>
              ) : (
                <StatusBadge domain="approval" value={a.state} />
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
