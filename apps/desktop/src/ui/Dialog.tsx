import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";
import { useLanguage } from "../shell/language";
import { Button } from "./Button";
import styles from "./Dialog.module.css";

const focusableSelector =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  children,
  confirmLabel,
  confirmVariant = "primary",
  cancelLabel,
  confirmDisabled,
  cancelDisabled,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  cancelLabel?: string;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const id = useId();
  const { t } = useLanguage();
  const effectiveCancelLabel = cancelLabel ?? t("common.cancel");
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmVariantRef = useRef(confirmVariant);
  confirmVariantRef.current = confirmVariant;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;

    const marked: HTMLElement[] = [];
    let node: HTMLElement | null = panel;
    while (node && node !== document.body && node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          marked.push(sibling);
        }
      }
      node = node.parentElement;
    }

    const first = panel.querySelector<HTMLElement>(focusableSelector);
    const confirm = panel.querySelector<HTMLButtonElement>("[data-dialog-confirm]");
    const cancel = panel.querySelector<HTMLButtonElement>("[data-dialog-cancel]");
    if (confirmVariantRef.current === "danger") {
      (cancel && !cancel.disabled ? cancel : (first ?? panel)).focus();
    } else {
      (confirm && !confirm.disabled ? confirm : (first ?? panel)).focus();
    }

    return () => {
      for (const element of marked) {
        element.removeAttribute("inert");
      }
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!cancelDisabled) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancelDisabled, onCancel]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog via keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop scrim closes on click outside panel.
    <div
      className={styles.backdrop}
      data-dialog-scrim="true"
      onClick={(event) => {
        if (event.target === event.currentTarget && !cancelDisabled) onCancel();
      }}
    >
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
            event.preventDefault();
            if (!cancelDisabled) onCancel();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
            ).filter((element) => !element.closest("[hidden], [inert]") && element.tabIndex >= 0);
            event.preventDefault();
            if (controls.length === 0) {
              event.currentTarget.focus();
              return;
            }
            const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const currentIndex = active ? controls.indexOf(active) : -1;
            const len = controls.length;
            const nextIndex =
              currentIndex === -1
                ? event.shiftKey
                  ? len - 1
                  : 0
                : event.shiftKey
                  ? (currentIndex - 1 + len) % len
                  : (currentIndex + 1) % len;
            controls[nextIndex]?.focus();
          }
        }}
      >
        <h2 id={id}>{title}</h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>
          <Button data-dialog-cancel variant="quiet" disabled={cancelDisabled} onClick={onCancel}>
            {effectiveCancelLabel}
          </Button>
          <Button data-dialog-confirm variant={confirmVariant} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
