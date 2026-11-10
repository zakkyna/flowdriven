import type { Approval } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { formatDateTime } from "../../ui/format";
import { Icon, type IconName } from "../../ui/icons";
import { StatusBadge } from "../../ui/StatusBadge";
import styles from "./Inbox.module.css";

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
            className={`${styles.item} ${a.state === "pending" ? styles.waiting : ""} ${a.id === selected ? styles.selected : ""}`}
            onClick={() => select(a.id)}
          >
            <Icon name={icon(a)} />
            <span className={styles.itemText}>
              <span className={styles.summary}>{a.summary}</span>
              <span className={styles.muted}>
                {a.flowName}
                {a.stepTitle ? `, ${a.stepTitle}` : ""}
              </span>
              {a.state === "pending" ? (
                <span className={styles.small}>Expires {formatDateTime(a.expiresAt)}</span>
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
