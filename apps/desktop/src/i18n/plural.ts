export type PluralValue = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Words = { [key: string]: string | PluralValue | Words };

export function pluralLocale(code: string): string {
  try {
    return Intl.PluralRules.supportedLocalesOf(code).length ? code : "en";
  } catch {
    return "en";
  }
}

export function pluralCategories(code: string): Intl.LDMLPluralRule[] {
  return new Intl.PluralRules(pluralLocale(code)).resolvedOptions().pluralCategories;
}
