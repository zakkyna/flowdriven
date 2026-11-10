import { type ReactElement, type ReactNode, useId } from "react";
import { Button } from "./Button";
import styles from "./Dialog.module.css";
export function Dialog({
  title,
  children,
  confirmLabel,
  confirmVariant = "primary",
  cancelLabel = "Cancel",
  confirmDisabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  cancelLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const id = useId();
  return (
    <div className={styles.backdrop}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <h2 id={id}>{title}</h2>
        <div>{children}</div>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button autoFocus variant={confirmVariant} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
