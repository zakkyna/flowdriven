import type { Settings } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Badge } from "../../ui/StatusBadge";
import { useToast } from "../../ui/Toast";
import { defaultRaisedLimit, formatLimitAmount, formatLimitCents, parseLimit } from "./limit";
import styles from "./SpendingSection.module.css";

export function SpendingSection({ settings: settingsProp }: { settings?: Settings }): ReactElement {
  const { language, t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const settingsQuery = useRunnerQuery("settings.get", {}, { skip: settingsProp !== undefined });
  const settings = settingsProp ?? settingsQuery.data;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentLimit = settings?.spendingLimit ?? 0;
  const defaultAmount = defaultRaisedLimit(currentLimit);
  const parsed = parseLimit(text, currentLimit, language);
  const titleAmount = parsed.ok ? parsed.amount : defaultAmount;
  const errorMessage = !parsed.ok && "message" in parsed ? parsed.message : undefined;
  const confirmDisabled = saving || (!parsed.ok && "disabled" in parsed);

  const openDialog = () => {
    if (!settings) return;
    setText(String(defaultRaisedLimit(settings.spendingLimit)));
    setOpen(true);
  };

  const handleConfirm = () => {
    if (!settings || saving) return;
    const current = parseLimit(text, settings.spendingLimit, language);
    if (!current.ok) return;

    setSaving(true);
    const saveFailedMessage = t("settings.saveFailed");
    void action("settings.update", { patch: { spendingLimit: current.amount } }).then((result) => {
      if (!mountedRef.current) return;
      setSaving(false);
      if (!result.ok) {
        toast(saveFailedMessage);
        setOpen(false);
        return;
      }
      toast(t("notify.limitRaised", { amount: formatLimitAmount(result.data.spendingLimit, language) }));
      setOpen(false);
    });
  };

  return (
    <>
      <div className={styles.row}>
        <div className={styles.summary}>
          {settings && (
            <p className={styles.usage}>
              {t("settings.monthlyUsage", {
                spent: formatLimitCents(settings.spending.spentUsd, language),
                cap: formatLimitCents(settings.spending.limitUsd, language),
              })}
            </p>
          )}
          {settings?.spending.state === "reached" && (
            <Badge tone="bad" icon="alert">
              {t("settings.limitReached")}
            </Badge>
          )}
        </div>
        <Button variant="secondary" size="small" disabled={!settings} onClick={openDialog}>
          {t("settings.raiseLimit")}
        </Button>
      </div>
      {open && settings && (
        <Dialog
          title={t("settings.raiseLimitConfirm", { amount: formatLimitAmount(titleAmount, language) })}
          confirmLabel={t("settings.raise")}
          confirmVariant="primary"
          confirmDisabled={confirmDisabled}
          cancelDisabled={saving}
          onCancel={() => setOpen(false)}
          onConfirm={handleConfirm}
        >
          <form
            className={styles.field}
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmDisabled) handleConfirm();
            }}
          >
            <label htmlFor={inputId} className={styles.label}>
              {t("settings.monthlyLimit")}
            </label>
            <input
              id={inputId}
              type="text"
              inputMode="decimal"
              className={styles.input}
              value={text}
              disabled={saving}
              aria-invalid={errorMessage ? "true" : undefined}
              aria-describedby={errorMessage ? errorId : undefined}
              onChange={(event) => setText(event.target.value)}
            />
            {errorMessage && (
              <p id={errorId} role="alert" className={styles.error}>
                {errorMessage}
              </p>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
