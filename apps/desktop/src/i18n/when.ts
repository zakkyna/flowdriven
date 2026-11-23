import { pluralLocale } from "./plural";

export function formatNumber(n: number, code: string): string {
  return new Intl.NumberFormat(pluralLocale(code)).format(n);
}
