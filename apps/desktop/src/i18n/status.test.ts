import { ApprovalState, RunState, StepRunState, TouchRule } from "@flowdriven/contracts";
import { expect, test } from "vitest";
import { languages } from "./languages";
import { STATUS_KEYS } from "./status";
import { createT } from "./t";

test("TC-j30-23 every state and touch rule has words in both languages", () => {
  const codes = [
    ...new Set([
      ...RunState.options,
      ...StepRunState.options,
      ...ApprovalState.options,
      ...TouchRule.options,
    ]),
  ];
  const translate = createT(languages);
  for (const code of codes) {
    for (const language of ["en", "id"]) {
      const key = `status.${code}`;
      expect(translate(key, {}, language), `${language}: ${key}`).not.toBe(key);
      expect(translate(key, {}, language), `${language}: ${key}`).not.toBe("");
    }
  }
  expect([...STATUS_KEYS].sort()).toEqual(codes.map((code) => `status.${code}`).sort());
  for (const [code, en, id] of [
    ["waiting_approval", "Needs you", "Menunggu persetujuan"],
    ["needs_login", "Waiting for sign-in", "Perlu login"],
    ["done", "Finished", "Selesai"],
    ["failed", "Failed", "Gagal"],
    ["running", "Running", "Berjalan"],
    ["waitingForYou", "Waiting for you", "Menunggu Anda"],
  ]) {
    expect(translate(`status.${code}`, {}, "en")).toBe(en);
    expect(translate(`status.${code}`, {}, "id")).toBe(id);
  }
  expect(translate("status.stopped", {}, "en")).toBe("Stopped by you");
});
