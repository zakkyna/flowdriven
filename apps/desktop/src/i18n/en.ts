import type { PluralValue, Words } from "./plural";

const en = {
  code: "en",
  name: "English",
  words: {
    rail: { newChat: "New chat" },
    common: { cancel: "Cancel" },
    flows: { count: { one: "{n} flow", other: "{n} flows" } satisfies PluralValue },
    chat: { starting: "Starting {flow}." },
    time: { atClock: "at {time}", durationHours: "{n}h", durationMinutes: "{n}m", durationBoth: "{h}h {m}m" },
  } satisfies Words,
};

export type TranslationWords<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends { other: string }
      ? PluralValue
      : TranslationWords<T[K]>;
};
export type EnglishWords = typeof en.words;
export default en;
