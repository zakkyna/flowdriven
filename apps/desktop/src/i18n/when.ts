import { pluralLocale } from "./plural";
import { t } from "./t";

export function formatNumber(n: number, code: string): string {
  return new Intl.NumberFormat(pluralLocale(code)).format(n);
}

export function shortDate(at: Date, language: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(pluralLocale(language), {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(at);
  return ["weekday", "day", "month"].map((type) => parts.find((part) => part.type === type)?.value).join(" ");
}

export function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

export function formatDuration(minutes: number, language: string): string {
  if (!Number.isInteger(minutes) || minutes < 0)
    throw new RangeError("Duration must be whole non-negative minutes");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("time.durationMinutes", { n: m }, language);
  if (m === 0) return t("time.durationHours", { n: h }, language);
  return t("time.durationBoth", { h, m }, language);
}
