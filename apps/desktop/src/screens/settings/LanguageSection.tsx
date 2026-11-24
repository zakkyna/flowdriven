import { type ReactElement, useRef } from "react";
import { listLanguages } from "../../i18n/languages";
import { useRunnerAction } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { RadioGroup } from "../../ui/RadioGroup";
import { useToast } from "../../ui/Toast";
import styles from "./SettingsPage.module.css";

export function LanguageSection(): ReactElement {
  const { language, setLanguage, t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const requestIdRef = useRef(0);
  const options = listLanguages().map((item) => ({
    value: item.code,
    label: item.name,
  }));

  const handleChange = (next: string) => {
    const prev = language;
    const saveFailedMessage = t("settings.saveFailed");
    setLanguage(next);
    const requestId = ++requestIdRef.current;
    void action("settings.update", { patch: { language: next } }).then((result) => {
      if (requestIdRef.current !== requestId) return;
      if (!result.ok) {
        setLanguage(prev);
        toast(saveFailedMessage);
      }
    });
  };

  return (
    <>
      <RadioGroup label={t("settings.language")} options={options} value={language} onChange={handleChange} />
      <p className={styles.note}>{t("settings.languageExplanation")}</p>
    </>
  );
}
