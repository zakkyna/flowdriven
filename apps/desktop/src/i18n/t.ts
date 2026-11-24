import en from "./en";
import { languages, resolveLanguage } from "./languages";
import { pluralCategories, pluralLocale } from "./plural";
import { formatNumber } from "./when";

type Keys<T> = {
  [K in keyof T & string]: T[K] extends string | { other: string }
    ? K
    : T[K] extends object
      ? `${K}.${Keys<T[K]>}`
      : never;
}[keyof T & string];
export type TranslationKey = Keys<typeof en.words>;
type Values = Record<string, string | number>;
type Language = { code: string; name: string; words: object };

export function fillPlaceholders(text: string, values: Values): string {
  return text.replace(/\{([\w]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function lookup(words: object, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        typeof value === "object" && value !== null && Object.hasOwn(value, part)
          ? (value as Record<string, unknown>)[part]
          : undefined,
      words,
    );
}

export function createT(list: Language[]) {
  return (key: string, values: Values = {}, lang = "en"): string => {
    const code = resolveLanguage(lang, list);
    const selected = list.find((language) => language.code === code);
    const english = list.find((language) => language.code === "en") ?? en;
    let word = lookup(selected?.words ?? english.words, key);
    let wordCode = code;
    if (word === undefined) {
      word = lookup(english.words, key);
      wordCode = "en";
    }
    if (typeof word === "object" && word !== null && "other" in word) {
      const forms = word as Record<string, string>;
      const n = typeof values.n === "number" ? values.n : 0;
      const category = new Intl.PluralRules(pluralLocale(wordCode)).select(n);
      return fillPlaceholders(
        (pluralCategories(wordCode).includes(category) ? forms[category] : undefined) ?? forms.other ?? key,
        { ...values, n: formatNumber(n, wordCode) },
      );
    }
    return typeof word === "string" ? fillPlaceholders(word, values) : key;
  };
}

const translate = createT(languages);
export function t(key: TranslationKey, values?: Values, lang?: string): string {
  return translate(key, values, lang);
}
