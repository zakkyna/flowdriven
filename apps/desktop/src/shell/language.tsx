import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveLanguage } from "../i18n/languages";
import { type TranslationKey, t as translate } from "../i18n/t";
import { useOptionalRunnerClient } from "../runner/runner-context";

export type TranslationValues = Record<string, string | number>;
export type LanguageContextValue = {
  language: string;
  setLanguage: (code: string) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const defaultValue: LanguageContextValue = {
  language: "en",
  setLanguage: () => {},
  t: (key, values) => translate(key, values, "en"),
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  language,
  children,
}: {
  language?: string;
  children: ReactNode;
}): ReactElement {
  const client = useOptionalRunnerClient();
  const [propLanguage, setPropLanguage] = useState<string | undefined>(language);
  const [activeLanguage, setActiveLanguage] = useState<string>(() => resolveLanguage(language));
  const touchedRef = useRef(false);

  if (propLanguage !== language) {
    setPropLanguage(language);
    setActiveLanguage(resolveLanguage(language));
  }

  const setLanguage = useCallback((code: string) => {
    const next = resolveLanguage(code);
    touchedRef.current = true;
    document.documentElement.lang = next;
    setActiveLanguage(next);
  }, []);

  useEffect(() => {
    if (language !== undefined || !client) return;
    let active = true;
    void Promise.resolve(client.call("settings.get", {})).then(
      (settings) => {
        if (!active || touchedRef.current) return;
        const resolved = resolveLanguage(settings.language);
        document.documentElement.lang = resolved;
        setActiveLanguage(resolved);
      },
      () => {
        /* Unreachable runner falls back to English. */
      },
    );
    return () => {
      active = false;
    };
  }, [client, language]);

  useLayoutEffect(() => {
    document.documentElement.lang = activeLanguage;
  }, [activeLanguage]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language: activeLanguage,
      setLanguage,
      t: (key, values) => translate(key, values, activeLanguage),
    }),
    [activeLanguage, setLanguage],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useHasLanguageProvider(): boolean {
  return useContext(LanguageContext) !== null;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext) ?? defaultValue;
}
