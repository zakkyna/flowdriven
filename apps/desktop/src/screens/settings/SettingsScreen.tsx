import { type ReactElement, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../legacy/runner-context";
import { Page } from "../../ui/Page";
import { ScreenState } from "../../ui/ScreenState";
import { BrainSection } from "./BrainSection";
import { BudgetSection } from "./BudgetSection";
import { FallbackSection } from "./FallbackSection";
import styles from "./Settings.module.css";

const description = "Choose the brain, the fallback order and the monthly API-key budget.";
export function SettingsScreen(): ReactElement {
  const query = useRunnerQuery("settings.get", {});
  const action = useRunnerAction();
  const [error, setError] = useState("");
  if (query.loading || query.error || !query.data)
    return (
      <ScreenState
        screen="settings"
        title="Settings"
        description={description}
        loading={query.loading}
        error={query.error}
        reload={query.reload}
      />
    );
  const settings = query.data;
  const toggle = async (value: boolean) => {
    const result = await action("settings.update", { patch: { offerSaveOneTime: value } });
    setError(result.ok ? "" : result.error.message);
  };
  return (
    <Page screen="settings" ready title="Settings" description={description} size="narrow">
      <div className={styles.sections}>
        <BrainSection settings={settings} />
        <FallbackSection settings={settings} />
        <BudgetSection budget={settings.budget} />
        <section className={styles.panel}>
          <h2>One-time flows</h2>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={settings.offerSaveOneTime}
              onChange={(event) => void toggle(event.target.checked)}
            />{" "}
            Offer to save one-time flows as flows
          </label>
          <p className={styles.small}>After a one-off run, the report ends with “Save this as a flow?”</p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </section>
      </div>
    </Page>
  );
}
