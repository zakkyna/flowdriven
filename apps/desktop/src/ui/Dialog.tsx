import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";
import styles from "./Dialog.module.css";

const focusableSelector =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
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
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(focusableSelector);
    const confirm = panel.querySelector<HTMLButtonElement>("[data-dialog-confirm]");
    (confirm && !confirm.disabled ? confirm : (first ?? panel)).focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className={styles.backdrop}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
            ).filter((element) => !element.closest("[hidden], [inert]") && element.tabIndex >= 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) {
              event.preventDefault();
              event.currentTarget.focus();
            } else if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id={id}>{title}</h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          <Button variant="quiet" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button data-dialog-confirm variant={confirmVariant} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
