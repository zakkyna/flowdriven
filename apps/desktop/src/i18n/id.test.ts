import { expect, test } from "vitest";
import id from "./id";
import { languages } from "./languages";
import { createT } from "./t";

test("TC-j30-24 Indonesian fixed words and no pukul", () => {
  const translate = createT(languages);
  const expected: Record<string, string> = {
    "common.cancel": "Batal",
    "common.delete": "Hapus",
    "common.edit": "Ubah",
    "common.close": "Tutup",
    "common.back": "Kembali",
    "common.run": "Jalankan",
    "common.runAgain": "Jalankan lagi",
    "common.start": "Mulai",
    "common.stopRun": "Hentikan",
    "common.approve": "Setujui",
    "common.reject": "Tolak",
    "rail.newChat": "Chat baru",
    "rail.search": "Cari",
    "rail.flows": "Flow",
    "rail.activity": "Aktivitas",
    "rail.skills": "Skill",
    "rail.settings": "Pengaturan",
    "settings.language": "Bahasa",
    "flows.saveFlow": "Simpan flow",
    "chat.useForm": "Pakai form",
    "activity.answerInChat": "Jawab di chat",
    "activity.needsYou": "Perlu Anda",
    "schedule.whenItsTime": "Saat waktunya tiba",
    "schedule.askMe": "Tanya saya dulu",
    "schedule.useLast": "Pakai jawaban terakhir saya",
  };
  for (const [key, value] of Object.entries(expected)) expect(translate(key, {}, "id"), key).toBe(value);
  const strings = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(strings)
        : [];
  for (const value of strings(id.words)) expect(value.toLowerCase()).not.toContain("pukul");
});
