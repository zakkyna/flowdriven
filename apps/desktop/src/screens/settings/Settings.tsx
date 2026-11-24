import { type ReactElement, useId } from "react";
import { useRunnerQuery } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { Page } from "../../ui/Page";
import { AgentsSection } from "./AgentsSection";
import { Appearance } from "./Appearance";
import { LanguageSection } from "./LanguageSection";
import { MainAgentSection } from "./MainAgentSection";
import { PermissionSection } from "./PermissionSection";
import styles from "./SettingsPage.module.css";

export function Settings(): ReactElement {
  const { t } = useLanguage();
  const baseId = useId();
  const settingsQuery = useRunnerQuery("settings.get", {});
  const agentsQuery = useRunnerQuery("agents.list", {});

  const error = settingsQuery.error ?? agentsQuery.error;
  const ready = !settingsQuery.loading && !agentsQuery.loading && !error && Boolean(settingsQuery.data);

  return (
    <Page screen="settings" ready={ready} title={t("rail.settings")} size="narrow">
      {error ? (
        <p role="alert" className={styles.error}>
          {error.message}
        </p>
      ) : !ready ? (
        <div className={styles.sections} aria-busy="true" />
      ) : (
        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby={`${baseId}-appearance`}>
            <h2 id={`${baseId}-appearance`}>{t("settings.appearance")}</h2>
            <Appearance />
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-language`}>
            <h2 id={`${baseId}-language`}>{t("settings.language")}</h2>
            <LanguageSection />
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-agents`}>
            <h2 id={`${baseId}-agents`}>{t("settings.agents")}</h2>
            <AgentsSection agents={agentsQuery.data ?? []} />
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-permission`}>
            <h2 id={`${baseId}-permission`}>{t("settings.permission")}</h2>
            <PermissionSection settings={settingsQuery.data} />
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-main-agent`}>
            <h2 id={`${baseId}-main-agent`}>{t("settings.mainAgent")}</h2>
            <MainAgentSection settings={settingsQuery.data} agents={agentsQuery.data ?? []} />
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-spending-limit`}>
            <h2 id={`${baseId}-spending-limit`}>{t("settings.spendingLimit")}</h2>
          </section>
          <section className={styles.section} aria-labelledby={`${baseId}-notifications`}>
            <h2 id={`${baseId}-notifications`}>{t("settings.notifications")}</h2>
            <p className={styles.note}>{t("settings.notificationsExplanation")}</p>
          </section>
          <p className={styles.moreLater}>{t("settings.moreLater")}</p>
        </div>
      )}
    </Page>
  );
}
