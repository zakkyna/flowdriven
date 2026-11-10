import { type Budget, budgetStatus } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useRunnerAction } from "../../runner/runner-context";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { formatUsd } from "../../ui/format";
import { Badge } from "../../ui/StatusBadge";
import styles from "./Settings.module.css";

export function BudgetSection({ budget }: { budget: Budget }): ReactElement {
  const action = useRunnerAction();
  const [cap, setCap] = useState(String(budget.capUsd));
  const [perRun, setPerRun] = useState(budget.perRunCapUsd === null ? "" : String(budget.perRunCapUsd));
  const [pending, setPending] = useState<{ capUsd: number; perRunCapUsd: number | null }>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [changed, setChanged] = useState(false);
  const previous = useRef({ capUsd: budget.capUsd, perRunCapUsd: budget.perRunCapUsd });
  useEffect(() => {
    if (previous.current.capUsd === budget.capUsd && previous.current.perRunCapUsd === budget.perRunCapUsd)
      return;
    previous.current = { capUsd: budget.capUsd, perRunCapUsd: budget.perRunCapUsd };
    if (dirty) setChanged(true);
    else {
      setCap(String(budget.capUsd));
      setPerRun(budget.perRunCapUsd === null ? "" : String(budget.perRunCapUsd));
      setChanged(false);
    }
  }, [budget.capUsd, budget.perRunCapUsd, dirty]);
  const { level, ratio } = budgetStatus(budget);
  const save = async (value: { capUsd: number; perRunCapUsd: number | null }) => {
    const result = await action("settings.update", { patch: { budget: value } });
    setPending(undefined);
    setError(result.ok ? "" : result.error.message);
    setStatus(result.ok ? "Budget saved." : "");
    if (result.ok) {
      setDirty(false);
      setChanged(false);
    }
  };
  const submit = () => {
    const capUsd = Number(cap);
    const perRunCapUsd = perRun.trim() === "" ? null : Number(perRun);
    if (
      cap.trim() === "" ||
      !Number.isFinite(capUsd) ||
      capUsd < 0 ||
      (perRunCapUsd !== null && (!Number.isFinite(perRunCapUsd) || perRunCapUsd < 0))
    ) {
      setError("Enter an amount of 0 or more.");
      setStatus("");
      return;
    }
    setError("");
    const value = { capUsd, perRunCapUsd };
    if (
      capUsd > budget.capUsd ||
      (budget.perRunCapUsd !== null && (perRunCapUsd === null || perRunCapUsd > budget.perRunCapUsd))
    )
      setPending(value);
    else void save(value);
  };
  return (
    <section className={styles.panel}>
      <h2>Monthly API-key budget</h2>
      <p>API keys stay off until you set a cap. Spending is an estimate from reported token usage.</p>
      <div className={styles.fields}>
        <label>
          Monthly cap (USD)
          <input
            type="number"
            step="0.01"
            value={cap}
            onChange={(event) => {
              setDirty(true);
              setCap(event.target.value);
            }}
          />
        </label>
        <label>
          Per-run cap (USD, optional)
          <input
            type="number"
            step="0.01"
            value={perRun}
            onChange={(event) => {
              setDirty(true);
              setPerRun(event.target.value);
            }}
          />
        </label>
      </div>
      {changed && <p>The stored budget changed while you were editing.</p>}
      <p>
        {level === "off" ? (
          "API keys are off. Set a monthly cap to turn them on."
        ) : (
          <>
            Spent this month: {formatUsd(budget.spentUsd)} of {formatUsd(budget.capUsd)} (estimate)
          </>
        )}
      </p>
      <div className={styles.track}>
        <div
          className={[
            styles.fill,
            level === "warn" ? styles.warn : level === "stopped" ? styles.stopped : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
      {level === "off" && (
        <Badge tone="neutral" icon="dash">
          API keys are off
        </Badge>
      )}
      {level === "warn" && (
        <Badge tone="neutral" icon="alert">
          {Math.floor(ratio * 100)}% used
        </Badge>
      )}
      {level === "stopped" && (
        <Badge tone="bad" icon="stop">
          Cap reached. API-key calls are stopped.
        </Badge>
      )}
      <div className={styles.save}>
        <Button variant="primary" onClick={submit}>
          Save budget
        </Button>
      </div>
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {pending && (
        <Dialog
          title={
            pending.capUsd > budget.capUsd
              ? `Raise the monthly cap to ${formatUsd(pending.capUsd)}?`
              : "Raise the per-run cap?"
          }
          confirmLabel="Raise cap"
          onCancel={() => setPending(undefined)}
          onConfirm={() => void save(pending)}
        >
          <p>Raising the cap is an approval and is written to the audit log.</p>
        </Dialog>
      )}
    </section>
  );
}
