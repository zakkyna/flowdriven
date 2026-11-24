import type { ColorMode, WindowPrefs, WindowReply } from "@flowdriven/contracts";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { windowApi } from "../../shell";
import { useLanguage } from "../../shell/language";
import { RadioGroup } from "../../ui/RadioGroup";
import { useToast } from "../../ui/Toast";
import styles from "./Appearance.module.css";

type PartialWindowApi = {
  getPrefs?: () => Promise<unknown>;
  setColorMode?: (mode: ColorMode) => Promise<unknown>;
};

function isColorMode(value: unknown): value is ColorMode {
  return value === "light" || value === "system" || value === "dark";
}

function isWindowReply(value: unknown): value is WindowReply<WindowPrefs> {
  return typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";
}

function readWindowApi(): PartialWindowApi | undefined {
  const full = windowApi();
  if (full) return full;
  return (window as Window & { flowdrivenShell?: { window?: PartialWindowApi } }).flowdrivenShell?.window;
}

function ThemePreview({ mode }: { mode: ColorMode }): ReactElement {
  return (
    <svg className={styles.preview} viewBox="0 0 120 68" aria-hidden="true" focusable="false">
      {mode === "light" && (
        <>
          <rect width="120" height="68" fill="#ffffff" />
          <rect width="34" height="68" fill="#f5f5f5" />
          <rect x="44" y="14" width="60" height="8" rx="3" fill="#e4e4e4" />
          <rect x="44" y="28" width="46" height="6" rx="3" fill="#ececec" />
          <rect x="44" y="42" width="32" height="10" rx="4" fill="#5b46c8" />
        </>
      )}
      {mode === "dark" && (
        <>
          <rect width="120" height="68" fill="#212121" />
          <rect width="34" height="68" fill="#181818" />
          <rect x="44" y="14" width="60" height="8" rx="3" fill="#353535" />
          <rect x="44" y="28" width="46" height="6" rx="3" fill="#2e2e2e" />
          <rect x="44" y="42" width="32" height="10" rx="4" fill="#a597ff" />
        </>
      )}
      {mode === "system" && (
        <>
          <rect width="60" height="68" fill="#ffffff" />
          <rect width="26" height="68" fill="#f5f5f5" />
          <rect x="32" y="14" width="24" height="8" rx="2" fill="#e4e4e4" />
          <rect x="32" y="28" width="20" height="6" rx="2" fill="#ececec" />
          <rect x="32" y="42" width="18" height="10" rx="3" fill="#5b46c8" />
          <rect x="60" width="60" height="68" fill="#212121" />
          <rect x="68" y="14" width="40" height="8" rx="2" fill="#353535" />
          <rect x="68" y="28" width="32" height="6" rx="2" fill="#2e2e2e" />
          <rect x="68" y="42" width="24" height="10" rx="3" fill="#a597ff" />
        </>
      )}
    </svg>
  );
}

export function Appearance(): ReactElement {
  const { t } = useLanguage();
  const toast = useToast();
  const [mode, setMode] = useState<ColorMode>("system");
  const requestIdRef = useRef(0);
  const touchedRef = useRef(false);

  useEffect(() => {
    const api = readWindowApi();
    if (!api || typeof api.getPrefs !== "function") return;
    let active = true;
    void Promise.resolve(api.getPrefs()).then(
      (reply) => {
        if (!active || touchedRef.current) return;
        if (isWindowReply(reply) && reply.ok && isColorMode(reply.result?.colorMode)) {
          setMode(reply.result.colorMode);
        }
      },
      () => {
        /* Unreadable or rejected preferences fall back to system (Auto). */
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const handleChange = (next: ColorMode) => {
    const prev = mode;
    touchedRef.current = true;
    setMode(next);

    const api = readWindowApi();
    if (!api || typeof api.setColorMode !== "function") return;

    const requestId = ++requestIdRef.current;
    void Promise.resolve(api.setColorMode(next)).then(
      (reply) => {
        if (requestIdRef.current !== requestId) return;
        if (isWindowReply(reply)) {
          if (!reply.ok) {
            setMode(prev);
            toast(t("settings.saveFailed"));
            return;
          }
          if (isColorMode(reply.result?.colorMode)) {
            setMode(reply.result.colorMode);
          }
        }
      },
      () => {
        if (requestIdRef.current !== requestId) return;
        setMode(prev);
        toast(t("settings.saveFailed"));
      },
    );
  };

  return (
    <RadioGroup<ColorMode>
      label={t("settings.colorMode")}
      orientation="horizontal"
      className={styles.group}
      value={mode}
      onChange={handleChange}
      options={[
        {
          value: "light",
          label: t("settings.colorLight"),
          preview: <ThemePreview mode="light" />,
        },
        {
          value: "system",
          label: t("settings.colorAuto"),
          description: t("settings.matchesYourComputer"),
          preview: <ThemePreview mode="system" />,
        },
        {
          value: "dark",
          label: t("settings.colorDark"),
          preview: <ThemePreview mode="dark" />,
        },
      ]}
    />
  );
}
