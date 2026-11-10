import { expect, test } from "vitest";
import { formatDateTime, formatDuration, formatTime, formatUsd } from "./format";

test("formats dates, money and durations", () => {
  expect(formatDateTime("2026-11-10T09:12:00.000Z")).toBe("10 Nov, 09:12");
  expect(formatTime("2026-11-10T13:00:00.000Z")).toBe("13:00");
  expect(formatUsd(16.4)).toBe("$16.40");
  expect(formatDuration(38)).toBe("38 s");
  expect(formatDuration(252)).toBe("4 min 12 s");
  expect(formatDuration(3900)).toBe("1 h 5 min");
});
test("rounds fractional duration to whole seconds", () => {
  expect(formatDuration(12.345678)).toBe("12 s");
  expect(formatDuration(59.9)).toBe("1 min");
});
