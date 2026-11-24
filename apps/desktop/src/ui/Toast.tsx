import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "./Button";
import styles from "./Toast.module.css";

export const TOAST_DURATION_MS = 5000;
export const MAX_TOASTS = 3;

export type ToastAction = {
  label: string;
  onAction: () => void;
};

export type ToastOptions = {
  action?: ToastAction;
  durationMs?: number;
};

export type ToastFunction = (message: string, options?: ToastOptions) => string;

type ToastItem = {
  id: string;
  message: string;
  action?: ToastAction;
  expiresAt: number;
};

const noopToast: ToastFunction = () => "";

const ToastContext = createContext<ToastFunction | null>(null);

export function ToastProvider({
  children,
  now = Date.now,
}: {
  children: ReactNode;
  now?: () => number;
}): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastFunction>(
    (message, options) => {
      nextIdRef.current += 1;
      const id = `toast-${nextIdRef.current}`;
      const durationMs = options?.durationMs ?? TOAST_DURATION_MS;
      const item: ToastItem = {
        id,
        message,
        action: options?.action,
        expiresAt: now() + durationMs,
      };
      setToasts((prev) => [...prev, item].slice(-MAX_TOASTS));
      return id;
    },
    [now],
  );

  useEffect(() => {
    if (toasts.length === 0) return;
    const earliest = Math.min(...toasts.map((item) => item.expiresAt));
    const delay = Math.max(0, earliest - now());
    const timer = setTimeout(() => {
      const current = now();
      setToasts((prev) => prev.filter((item) => item.expiresAt > current));
    }, delay);
    return () => clearTimeout(timer);
  }, [toasts, now]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="false" className={styles.region}>
        {toasts.map((item) => (
          <div key={item.id} className={styles.toast} data-toast="true">
            <span className={styles.message}>{item.message}</span>
            {item.action && (
              <Button
                size="small"
                variant="quiet"
                onClick={() => {
                  item.action?.onAction();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFunction {
  return useContext(ToastContext) ?? noopToast;
}
