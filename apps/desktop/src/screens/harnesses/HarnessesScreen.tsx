import type { HarnessCard } from "@flowdriven/contracts";
import { type ReactElement, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import { ConsentDialog } from "./ConsentDialog";
import { HarnessCardView } from "./HarnessCardView";
import styles from "./Harnesses.module.css";

const description = "AI agents found on this Mac. FlowDriven hands them steps to do as workers.";
export function HarnessesScreen(): ReactElement {
  const query = useRunnerQuery("harnesses.list", {});
  const action = useRunnerAction();
  const [selected, setSelected] = useState<HarnessCard>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  if (query.loading || query.error)
    return (
      <ScreenState
        screen="harnesses"
        title="Harnesses"
        description={description}
        loading={query.loading}
        error={query.error}
        reload={query.reload}
      />
    );
  const cards = query.data ?? [];
  const detected = cards.filter((card) => card.detected);
  const missing = cards.filter((card) => !card.detected);
  const rescan = async () => {
    setBusy(true);
    const result = await action("harnesses.rescan", {});
    setBusy(false);
    if (result.ok) {
      const count = result.data.filter((card) => card.detected).length;
      setStatus(`Scan finished. Found ${count} ${count === 1 ? "harness" : "harnesses"}.`);
      setError("");
    } else {
      setError(result.error.message);
      setStatus("");
    }
  };
  const setConsent = async (card: HarnessCard, consent: "given" | "revoked") => {
    setBusy(true);
    const result = await action("harnesses.setConsent", { harnessId: card.id, consent });
    setBusy(false);
    if (result.ok) {
      setSelected(undefined);
      setStatus(consent === "revoked" ? `Consent revoked for ${card.name}.` : "");
      setError("");
    } else {
      setSelected(undefined);
      setError(result.error.message);
      setStatus("");
    }
  };
  return (
    <Page
      screen="harnesses"
      ready
      title="Harnesses"
      description={description}
      actions={
        <Button disabled={busy} onClick={() => void rescan()}>
          Re-scan
        </Button>
      }
    >
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className={styles.warning}>
          {error}
        </p>
      )}
      {detected.length === 0 ? (
        <div>
          <h2>No harnesses found.</h2>
          <p>Install Codex, Claude Code or another AI agent, then choose Re-scan.</p>
        </div>
      ) : (
        <div className={styles.grid}>
          {detected.map((card) => (
            <HarnessCardView
              key={card.id}
              card={card}
              busy={busy}
              onGive={() => setSelected(card)}
              onRevoke={() => void setConsent(card, "revoked")}
            />
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <section className={styles.missing}>
          <h2>Not found on this Mac</h2>
          <ul>
            {missing.map((card) => (
              <li key={card.id}>
                {card.name} ({card.binary})
              </li>
            ))}
          </ul>
        </section>
      )}
      {selected && (
        <ConsentDialog
          card={selected}
          busy={busy}
          onCancel={() => setSelected(undefined)}
          onConfirm={() => void setConsent(selected, "given")}
        />
      )}
    </Page>
  );
}
