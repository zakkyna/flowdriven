import { pluralLocale } from "../../i18n/plural";
import { t } from "../../i18n/t";

export const MAX_SPENDING_LIMIT = 10000;
const DEFAULT_MINIMUM_LIMIT = 25;
const DEFAULT_STEP_LIMIT = 25;
const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

export type LimitParseResult =
  | { ok: true; amount: number }
  | { ok: false; disabled: true }
  | { ok: false; message: string };

export function formatLimitAmount(amount: number, language = "en"): string {
  return new Intl.NumberFormat(pluralLocale(language)).format(amount);
}

export function formatLimitCents(amount: number, language = "en"): string {
  return new Intl.NumberFormat(pluralLocale(language), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function defaultRaisedLimit(currentLimit: number): number {
  if (currentLimit < DEFAULT_MINIMUM_LIMIT) return DEFAULT_MINIMUM_LIMIT;
  return Math.min(Math.round((currentLimit + DEFAULT_STEP_LIMIT) * 100) / 100, MAX_SPENDING_LIMIT);
}

export function parseLimit(text: string, currentLimit: number, language = "en"): LimitParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, disabled: true };
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      message: t("settings.invalidLimit", { amount: formatLimitAmount(currentLimit, language) }, language),
    };
  }
  const rounded = Math.round(Number(trimmed) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded > MAX_SPENDING_LIMIT) {
    return {
      ok: false,
      message: t(
        "settings.limitTooHigh",
        { amount: formatLimitAmount(MAX_SPENDING_LIMIT, language) },
        language,
      ),
    };
  }
  if (rounded <= currentLimit) {
    return {
      ok: false,
      message: t("settings.invalidLimit", { amount: formatLimitAmount(currentLimit, language) }, language),
    };
  }
  return { ok: true, amount: rounded };
}
