import type { MessageRow } from "../storage.ts";

export const MAX_SEARCH_TEXT = 16_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatResultValue(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "number" || typeof entry === "boolean") return String(entry);
  if (!isRecord(entry) || typeof entry.type !== "string") return undefined;
  if (entry.type === "secret_ref") return undefined;
  const value = entry.value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join(", ");
  return undefined;
}

/** Extracts plain searchable text from a stored chat message, or null when not searchable. */
export function searchTextOf(message: Pick<MessageRow, "kind" | "text" | "result">): string | null {
  if (message.kind === "text" || message.kind === "reply") {
    return typeof message.text === "string" ? message.text.slice(0, MAX_SEARCH_TEXT) : null;
  }
  if (message.kind === "result") {
    if (!isRecord(message.result) || !Array.isArray(message.result.lines)) return null;
    const values = isRecord(message.result.values) ? message.result.values : {};
    const lines = message.result.lines.filter((line): line is string => typeof line === "string");
    if (lines.length === 0) return null;
    const filled = lines.map((line) =>
      line.replace(/\{([^{}]+)\}/g, (match, key: string) => {
        if (!Object.hasOwn(values, key)) return match;
        return formatResultValue(values[key]) ?? match;
      }),
    );
    return filled.join("\n").slice(0, MAX_SEARCH_TEXT);
  }
  return null;
}
