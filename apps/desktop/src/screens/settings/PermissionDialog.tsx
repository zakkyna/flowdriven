import { type ReactElement, useEffect, useRef, useState } from "react";
import { useRunnerAction } from "../../runner/runner-context";
import { useLanguage } from "../../shell/language";
import { Dialog } from "../../ui/Dialog";
import { useToast } from "../../ui/Toast";

export type PermissionDialogProps = {
  open: boolean;
  onClose: () => void;
  onGranted?: () => void;
};

export function PermissionDialog({ open, onClose, onGranted }: PermissionDialogProps): ReactElement | null {
  const { t } = useLanguage();
  const action = useRunnerAction();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (!open) return null;

  const handleConfirm = () => {
    setSaving(true);
    void action("settings.update", { patch: { agentPermission: "on" } }).then((result) => {
      if (!mountedRef.current) return;
      setSaving(false);
      if (!result.ok) {
        toast(t("settings.saveFailed"));
      } else {
        onGranted?.();
      }
      onClose();
    });
  };

  return (
    <Dialog
      title={t("settings.beforeYouStart")}
      confirmLabel={t("settings.givePermission")}
      confirmVariant="primary"
      confirmDisabled={saving}
      cancelDisabled={saving}
      onCancel={onClose}
      onConfirm={handleConfirm}
    >
      <p>{t("settings.permissionExplanation")}</p>
    </Dialog>
  );
}
