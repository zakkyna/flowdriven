import type { Settings } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import { useRunnerAction, useRunnerQuery } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { Dialog } from "../../ui/Dialog";
import { useToast } from "../../ui/Toast";
import { PermissionDialog } from "./PermissionDialog";
import styles from "./PermissionSection.module.css";

export function PermissionSection({ settings: settingsProp }: { settings?: Settings }): ReactElement {
  const { t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const settingsQuery = useRunnerQuery("settings.get", {}, { skip: settingsProp !== undefined });
  const settings = settingsProp ?? settingsQuery.data;
  const isOn = settings?.agentPermission === "on";
  const [dialog, setDialog] = useState<"on" | "off" | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const mountedRef = useRef(true);
  const labelId = useId();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleTurnOff = () => {
    setTurningOff(true);
    void action("settings.update", { patch: { agentPermission: "off" } }).then((result) => {
      if (!mountedRef.current) return;
      setTurningOff(false);
      if (!result.ok) {
        toast(t("settings.saveFailed"));
      }
      setDialog(null);
    });
  };

  return (
    <>
      <div className={styles.row}>
        <span id={labelId} className={styles.label}>
          {t("settings.agentPermission")}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-labelledby={labelId}
          data-checked={isOn ? "true" : "false"}
          className={styles.switch}
          disabled={!settings}
          onClick={() => setDialog(isOn ? "off" : "on")}
        >
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
          <span className={styles.state}>{isOn ? t("status.on") : t("status.off")}</span>
        </button>
      </div>
      <PermissionDialog open={dialog === "on"} onClose={() => setDialog(null)} />
      {dialog === "off" && (
        <Dialog
          title={t("settings.stopPermissionTitle")}
          confirmLabel={t("settings.turnOff")}
          confirmVariant="danger"
          cancelLabel={t("settings.keepOn")}
          confirmDisabled={turningOff}
          cancelDisabled={turningOff}
          onCancel={() => setDialog(null)}
          onConfirm={handleTurnOff}
        >
          <p>{t("settings.permissionOffEffect")}</p>
        </Dialog>
      )}
    </>
  );
}
