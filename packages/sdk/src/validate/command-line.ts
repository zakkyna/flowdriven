import { commandAllowed } from "./risky.ts";

export const COMMAND_LIMITS = { chars: 1000, words: 64 };

export function parseCommandLine(
  text: string,
): { ok: true; words: string[] } | { ok: false; reason: string } {
  if (text.length > COMMAND_LIMITS.chars) return { ok: false, reason: "The command line is too long." };
  const words = text.split(" ");
  if (
    words.length > COMMAND_LIMITS.words ||
    !words.every((word) => /^[A-Za-z0-9._/=:@%+,-]+$/.test(word) && !word.startsWith("=")) ||
    !/^[A-Za-z0-9._-]+$/.test(words[0] ?? "")
  )
    return { ok: false, reason: "The command line must contain only plain words." };
  return { ok: true, words };
}

export function commandLineAllowed(patterns: string[], words: string[]): boolean {
  const parsed = parseCommandLine(words.join(" "));
  if (!parsed.ok || parsed.words.length !== words.length) return false;
  const program = words[0];
  if (!program) return false;
  return patterns.some((pattern) => {
    const wildcard = pattern.endsWith(" *");
    const fixed = wildcard ? pattern.slice(0, -2) : pattern;
    if (!parseCommandLine(fixed).ok || !commandAllowed(pattern, program, words.slice(1))) return false;
    return (
      !wildcard ||
      words
        .slice(fixed.split(" ").length)
        .every(
          (word) =>
            !word.startsWith("-") &&
            !word.startsWith("/") &&
            !word.includes("..") &&
            !/[=:,@%+]\//.test(word),
        )
    );
  });
}
