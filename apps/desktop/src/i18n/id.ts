import type { EnglishWords, TranslationWords } from "./en";

export default {
  code: "id",
  name: "Bahasa Indonesia",
  words: {
    rail: { newChat: "Chat baru" },
    common: { cancel: "Batal" },
    flows: { count: { other: "{n} flow" } },
    chat: { starting: "Memulai {flow}." },
    time: {
      atClock: "jam {time}",
      durationHours: "{n} jam",
      durationMinutes: "{n} menit",
      durationBoth: "{h} jam {m} menit",
    },
  } satisfies TranslationWords<EnglishWords>,
};
