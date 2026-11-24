import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { resolveLanguage } from "../i18n/languages";
import { type TranslationKey, t as translate } from "../i18n/t";

export type TranslationValues = Record<string, string | number>;
export type LanguageContextValue = {
  language: string;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const defaultValue: LanguageContextValue = {
  language: "en",
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
  const resolved = resolveLanguage(language);
  useLayoutEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);
  const value = useMemo<LanguageContextValue>(
    () => ({
      language: resolved,
      t: (key, values) => translate(key, values, resolved),
    }),
    [resolved],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useHasLanguageProvider(): boolean {
  return useContext(LanguageContext) !== null;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext) ?? defaultValue;
}
