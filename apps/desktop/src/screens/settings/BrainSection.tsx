import { type BrainBackend, budgetStatus, type Settings, sortByRisk } from "@flowdriven/contracts";
import { type ReactElement, useId, useState } from "react";
import { useRunnerAction } from "../../runner/runner-context";
import { RiskBadge } from "../../ui/RiskBadge";
import styles from "./Settings.module.css";

function reason(backend: BrainBackend, level: ReturnType<typeof budgetStatus>["level"]): string | undefined {
  if (backend.kind === "harness" && backend.consent !== "given" && backend.consent !== "not_needed")
    return "Needs consent on the Harnesses screen";
  if (backend.kind === "api_key" && !backend.keyStored) return "No API key stored";
  if (backend.kind === "api_key" && level === "off") return "Off until you set a budget";
  if (backend.kind === "api_key" && level === "stopped") return "Cap reached";
  if (!backend.available) return "Not available";
  return undefined;
}

export function BrainSection({ settings }: { settings: Settings }): ReactElement {
  const id = useId();
  const groupAttributes = { role: "radiogroup" as const, "aria-labelledby": id };
  const action = useRunnerAction();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const choose = async (backend: BrainBackend) => {
    const result = await action("settings.update", { patch: { brain: { main: backend.id } } });
    setError(result.ok ? "" : result.error.message);
    setStatus(result.ok ? `Main brain set to ${backend.name}.` : "");
  };
  return (
    <section className={styles.panel}>
      <h2>Brain</h2>
      <p>The model the agent thinks with. Official routes are listed first.</p>
      <fieldset {...groupAttributes} className={styles.group}>
        <legend id={id}>Main brain</legend>
        {settings.backends.length === 0 && <p>No brain found. Install a harness or add an API key.</p>}
        {sortByRisk(settings.backends).map((backend) => {
          const disabledReason = reason(backend, budgetStatus(settings.budget).level);
          const state =
            backend.kind === "api_key"
              ? backend.keyStored
                ? "Key stored"
                : undefined
              : backend.login === "logged_in"
                ? "Logged in"
                : backend.login === "logged_out"
                  ? "Logged out"
                  : "Login unknown";
          return (
            <label className={styles.brain} key={backend.id}>
              <input
                type="radio"
                name="brain"
                aria-label={backend.name}
                aria-describedby={`${id}-${backend.id}`}
                checked={settings.brain.main === backend.id}
                disabled={Boolean(disabledReason)}
                onChange={() => void choose(backend)}
              />
              <span id={`${id}-${backend.id}`}>
                <span>{backend.name}</span> <RiskBadge risk={backend.risk} />
                {state && <span className={styles.small}>{state}</span>}
                {backend.kind === "harness" && (
                  <span className={styles.small}>
                    {backend.quota === "exhausted"
                      ? "Quota exhausted"
                      : backend.quota === "available"
                        ? "Quota available"
                        : "Quota unknown"}
                  </span>
                )}
                {disabledReason && <span className={styles.small}>{disabledReason}</span>}
              </span>
              {settings.brain.main === backend.id && disabledReason && (
                <span className={styles.small}>
                  {backend.kind === "harness" &&
                  backend.consent !== "given" &&
                  backend.consent !== "not_needed"
                    ? "Needs consent. This brain is not used until you give consent."
                    : `This brain is unavailable: ${disabledReason}.`}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
