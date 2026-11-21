import type { CapabilityRow, FlowCapabilities } from "@flowdriven/contracts/v1";
import { type ReactElement, useRef, useState } from "react";
import { useRunnerAction } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/icons";
import { Badge, ToneIcon } from "../../ui/StatusBadge";
import styles from "./Builder.module.css";

function capsLine(caps: FlowCapabilities["caps"]): string {
  return caps.maxItems === undefined
    ? `Up to ${caps.maxRunsPerDay} runs a day.`
    : `Up to ${caps.maxRunsPerDay} runs a day and ${caps.maxItems} items a run.`;
}
function RowView({ row }: { row: CapabilityRow }): ReactElement {
  if (!row.routed)
    return (
      <li className={styles.capRow}>
        <p className={styles.capSentence}>
          <ToneIcon icon="circle-slash" tone="neutral" />
          <span>{row.sentence}</span>
        </p>
        <p className={styles.capLine}>Not available: {row.reason ?? "No route can provide this."}</p>
      </li>
    );
  // Only an official label is shown as official; anything else is shown as unofficial.
  const official = row.label === "official";
  return (
    <li className={styles.capRow}>
      <p className={styles.capSentence}>
        <ToneIcon icon="check" tone="ok" />
        <span>{row.sentence}</span>
      </p>
      <p className={styles.capLine}>Provider: {row.provider ?? "unknown"}</p>
      <p className={styles.capLine}>Enforced by: {row.enforcedBy ?? "not enforced"}</p>
      <p className={styles.capLine}>
        <Badge tone={official ? "ok" : "wait"} icon={official ? "shield" : "alert"}>
          {official ? "Official" : "Unofficial"}
        </Badge>
      </p>
      {row.labelSentence && <p className={styles.capLine}>{row.labelSentence}</p>}
      <p className={styles.capLine}>Can run while you are away: {row.away ? "yes" : "no"}</p>
      {row.cost && <p className={styles.capLine}>{row.cost}</p>}
      {row.details.length > 0 && (
        <details className={styles.capDetails}>
          <summary>Details</summary>
          {row.details.map((detail, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the templates are a fixed list that may repeat.
            <p key={index} className={styles.capTemplate}>
              <code>{detail}</code>
            </p>
          ))}
        </details>
      )}
    </li>
  );
}
export function CapabilitiesNotice({ message }: { message: string }): ReactElement {
  return (
    <section aria-label="What this flow may touch" className={styles.capPanel}>
      <h2 id="capabilities-heading">What this flow may touch</h2>
      <p role="alert" className={styles.capError}>
        <Icon name="alert" />
        {message}
      </p>
    </section>
  );
}
export function CapabilitiesPanel({
  flowId,
  hash,
  capabilities,
  reload,
}: {
  flowId: string;
  hash: string;
  capabilities: FlowCapabilities;
  reload: () => void;
}): ReactElement {
  const action = useRunnerAction();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  async function change(kind: "allow" | "withdraw") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const pins = Object.fromEntries(
      capabilities.rows.flatMap((row) => (row.pin ? [[row.requirementId, row.pin]] : [])),
    );
    const result =
      kind === "allow"
        ? await action("flows.allowCapabilities", {
            flowId,
            hash,
            ...(Object.keys(pins).length ? { pins } : {}),
          })
        : await action("flows.withdrawCapabilities", { flowId });
    if (result.ok) {
      setError(undefined);
      reload();
    } else setError(result.error.message);
    inFlight.current = false;
    setBusy(false);
  }
  const { consent } = capabilities;
  const { allowBlocked } = capabilities;
  return (
    <section aria-label="What this flow may touch" className={styles.capPanel}>
      <h2 id="capabilities-heading">What this flow may touch</h2>
      <ul className={styles.capList}>
        {capabilities.rows.map((row) => (
          <RowView key={row.requirementId} row={row} />
        ))}
      </ul>
      <p className={styles.capMuted}>{capsLine(capabilities.caps)}</p>
      {capabilities.hasTriggers && (
        <p className={styles.capMuted}>
          A new version of this flow turns its triggers off until you OK them again.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.capError}>
          <Icon name="alert" />
          {error}
        </p>
      )}
      {capabilities.needsAllow && (
        <div className={styles.capState}>
          {consent === "given" ? (
            <>
              <span className={styles.capGiven}>
                <ToneIcon icon="check" tone="ok" />
                Allowed for this version
              </span>
              <Button size="small" icon="dash" disabled={busy} onClick={() => void change("withdraw")}>
                Withdraw
              </Button>
            </>
          ) : allowBlocked !== undefined ? (
            <span className={styles.capGiven}>
              <ToneIcon icon="circle-slash" tone="neutral" />
              {allowBlocked}
            </span>
          ) : (
            <>
              <span className={styles.capGiven}>
                <ToneIcon icon="alert" tone="wait" />
                {consent === "stale"
                  ? "This flow changed. Allow again."
                  : "This flow cannot run until you allow this."}
              </span>
              <Button variant="primary" size="small" disabled={busy} onClick={() => void change("allow")}>
                Allow
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
