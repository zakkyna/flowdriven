import type { HarnessCard, InventoryItem } from "@flowdriven/contracts/v1";
import type { ReactElement } from "react";
import { Button } from "../../ui/Button";
import { formatTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { RiskBadge } from "../../ui/RiskBadge";
import { StatusBadge } from "../../ui/StatusBadge";
import { Revealed } from "../inbox/PayloadView";
import styles from "./Harnesses.module.css";

export const vendorWarning = "Vendor terms prohibit this; your account could be suspended.";

function Inventory({
  title,
  items,
  connections = false,
}: {
  title: string;
  items: InventoryItem[];
  connections?: boolean;
}): ReactElement {
  return (
    <details>
      <summary>
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
        {title} ({items.length})
      </summary>
      <ul>
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Inventory can contain identical rows.
          <li key={`${item.name}-${item.scope}-${item.source ?? ""}-${index}`}>
            <span className={styles.mono}>
              <Revealed text={item.name} singleLine />
            </span>{" "}
            {item.scope}{" "}
            {connections && item.connection && <StatusBadge domain="connection" value={item.connection} />}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function HarnessCardView({
  card,
  onGive,
  onRevoke,
  busy,
}: {
  card: HarnessCard;
  onGive: () => void;
  onRevoke: () => void;
  busy: boolean;
}): ReactElement {
  const login = { logged_in: "Logged in", logged_out: "Logged out", unknown: "Unknown" }[card.login];
  const quota =
    card.quota.state === "exhausted"
      ? `Exhausted${card.quota.until ? ` until ${formatTime(card.quota.until)}` : ""}`
      : card.quota.state === "available"
        ? "Available"
        : "Unknown";
  const consent = { not_needed: "Not needed", given: "Given", not_given: "Not given", revoked: "Revoked" }[
    card.consent
  ];
  return (
    <article aria-label={card.name} className={styles.card}>
      <div className={styles.cardHeader}>
        <h2>{card.name}</h2>
        <RiskBadge risk={card.risk} />
      </div>
      {card.path && (
        <div className={styles.mono}>
          <Revealed text={card.path} singleLine />
        </div>
      )}
      {card.version && (
        <div className={styles.small}>
          Version <Revealed text={card.version} singleLine />
        </div>
      )}
      {card.vendorProhibited && (
        <p className={styles.warning}>
          <Icon name="alert" />
          {vendorWarning}
        </p>
      )}
      {card.riskNote && <p className={styles.small}>{card.riskNote}</p>}
      <dl className={styles.facts}>
        <dt>Login</dt>
        <dd>{login}</dd>
        <dt>Quota</dt>
        <dd>{quota}</dd>
        <dt>Usage</dt>
        <dd>
          Today: {card.quota.today.calls} {card.quota.today.calls === 1 ? "call" : "calls"}. This week:{" "}
          {card.quota.week.calls} {card.quota.week.calls === 1 ? "call" : "calls"}.
        </dd>
        <dt>Consent</dt>
        <dd>{consent}</dd>
        <dt>Sandbox</dt>
        <dd>{card.sandbox === "os" ? "OS sandbox" : "No sandbox"}</dd>
        <dt>Adapter</dt>
        <dd>{card.adapter === "full" ? "Full adapter" : "Detection only"}</dd>
      </dl>
      {card.quota.windows?.map((window) => (
        <p className={styles.small} key={window.name}>
          <Icon name="clock" />
          <span>{`${window.name === "seven_day" ? "Weekly" : "5-hour"} limit: ${Math.round(window.utilization * 100)}% used${window.resetsAt ? `, resets ${window.name === "seven_day" ? `${new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(window.resetsAt))} ` : ""}${formatTime(window.resetsAt)}` : ""}`}</span>
        </p>
      ))}
      {card.quota.note && <p className={styles.small}>{card.quota.note}</p>}
      {(card.consent === "not_given" || card.consent === "revoked") && (
        <Button disabled={busy} onClick={onGive}>
          Give consent
        </Button>
      )}
      {card.consent === "given" && (
        <Button variant="quiet" disabled={busy} onClick={onRevoke}>
          Revoke consent
        </Button>
      )}
      <div className={styles.inventory}>
        {card.inventory.supported ? (
          <>
            <Inventory title="Skills" items={card.inventory.skills} />
            <Inventory title="Plugins" items={card.inventory.plugins} />
            <Inventory title="MCP servers" items={card.inventory.mcpServers} connections />
          </>
        ) : (
          <p>Inventory not supported yet.</p>
        )}
      </div>
    </article>
  );
}
