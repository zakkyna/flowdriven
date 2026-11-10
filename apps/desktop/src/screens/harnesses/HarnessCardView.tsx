import type { HarnessCard, InventoryItem } from "@flowdriven/contracts";
import type { ReactElement } from "react";
import { Button } from "../../ui/Button";
import { formatTime } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { RiskBadge } from "../../ui/RiskBadge";
import { StatusBadge } from "../../ui/StatusBadge";
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
        {title} ({items.length})
      </summary>
      <ul>
        {items.map((item) => (
          <li key={`${item.name}-${item.scope}-${item.source ?? ""}`}>
            <span className={styles.mono}>{item.name}</span> {item.scope}{" "}
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
      {card.path && <div className={styles.mono}>{card.path}</div>}
      {card.version && <div className={styles.small}>Version {card.version}</div>}
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
