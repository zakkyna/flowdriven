import en from "./en";
import id from "./id";

export const languages = [en, id];

type LanguageName = { code: string; name: string };
export function listLanguages(list: LanguageName[] = languages): LanguageName[] {
  return list.map(({ code, name }) => ({ code, name }));
}
export function resolveLanguage(code?: string, list: { code: string }[] = languages): string {
  return list.some((language) => language.code === code) ? (code ?? "en") : "en";
}
export function isValidLanguageCode(code: string): boolean {
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(code);
}
