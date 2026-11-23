import { expect, test } from "vitest";
import { withTimeZone } from "../../../../packages/runner/src/test-helpers/time-zone";
import { t } from "./t";
import * as when from "./when";

const instant = (value: string) => new Date(value);

test("TC-j30-15 short dates and clock times", async () => {
  const check = () => {
    const dates = ["2026-11-19", "2026-05-02", "2026-08-17", "2026-10-05", "2026-12-25"];
    expect(dates.map((date) => when.shortDate(instant(`${date}T06:00:00Z`), "en", "Asia/Bangkok"))).toEqual([
      "Thu 19 Nov",
      "Sat 2 May",
      "Mon 17 Aug",
      "Mon 5 Oct",
      "Fri 25 Dec",
    ]);
    expect(dates.map((date) => when.shortDate(instant(`${date}T06:00:00Z`), "id", "Asia/Bangkok"))).toEqual([
      "Kam 19 Nov",
      "Sab 2 Mei",
      "Sen 17 Agu",
      "Sen 5 Okt",
      "Jum 25 Des",
    ]);
    expect(when.clockTime(instant("2026-11-19T06:00:00Z"), "Asia/Bangkok")).toBe("13:00");
  };
  check();
  await withTimeZone("Pacific/Kiritimati", check);
});

test("TC-j30-16 midnight and daylight saving", async () => {
  const check = () => {
    const at = instant("2026-11-19T17:30:00Z");
    expect([
      when.shortDate(at, "en", "Asia/Bangkok"),
      when.clockTime(at, "Asia/Bangkok"),
      when.shortDate(at, "en", "UTC"),
      when.clockTime(at, "UTC"),
    ]).toEqual(["Fri 20 Nov", "00:30", "Thu 19 Nov", "17:30"]);
    const dates = [instant("2027-03-28T00:30:00Z"), instant("2027-03-28T01:30:00Z")];
    expect(dates.map((date) => when.clockTime(date, "Europe/Amsterdam"))).toEqual(["01:30", "03:30"]);
    expect(dates.map((date) => when.shortDate(date, "en", "Europe/Amsterdam"))).toEqual([
      "Sun 28 Mar",
      "Sun 28 Mar",
    ]);
  };
  check();
  await withTimeZone("Pacific/Kiritimati", check);
});

test("TC-j30-17 durations clock phrases and numbers", () => {
  expect([120, 30, 90, 960].map((n) => when.formatDuration(n, "en"))).toEqual(["2h", "30m", "1h 30m", "16h"]);
  expect([120, 30, 90, 960].map((n) => when.formatDuration(n, "id"))).toEqual([
    "2 jam",
    "30 menit",
    "1 jam 30 menit",
    "16 jam",
  ]);
  expect([t("time.atClock", { time: "17:00" }, "en"), t("time.atClock", { time: "17:00" }, "id")]).toEqual([
    "at 17:00",
    "jam 17:00",
  ]);
  expect([when.formatNumber(1240, "en"), when.formatNumber(1240, "id")]).toEqual(["1,240", "1.240"]);
});

test("TC-I18N-09 duration edge values", () => {
  const values = [0, 1, 59, 60, 61, 90, 1440, 1500];
  expect(values.map((n) => when.formatDuration(n, "en"))).toEqual([
    "0m",
    "1m",
    "59m",
    "1h",
    "1h 1m",
    "1h 30m",
    "24h",
    "25h",
  ]);
  expect(values.map((n) => when.formatDuration(n, "id"))).toEqual([
    "0 menit",
    "1 menit",
    "59 menit",
    "1 jam",
    "1 jam 1 menit",
    "1 jam 30 menit",
    "24 jam",
    "25 jam",
  ]);
  for (const n of [-1, 1.5]) expect(() => when.formatDuration(n, "en")).toThrow(RangeError);
});

test("TC-I18N-10 dates use the given zone", async () => {
  const check = () => {
    const at = instant("2026-11-19T17:30:00Z");
    expect([
      when.shortDate(at, "en", "Asia/Bangkok"),
      when.shortDate(at, "en", "UTC"),
      when.clockTime(at, "Asia/Bangkok"),
      when.clockTime(at, "UTC"),
    ]).toEqual(["Fri 20 Nov", "Thu 19 Nov", "00:30", "17:30"]);
  };
  check();
  await withTimeZone("UTC", check);
  await withTimeZone("America/Chicago", check);
  const missingZonesAreTypeErrors = () => {
    // @ts-expect-error A zone is required.
    when.shortDate(new Date(), "en");
    // @ts-expect-error A zone is required.
    when.clockTime(new Date());
  };
  expect(typeof missingZonesAreTypeErrors).toBe("function");
});

test("TC-I18N-11 numbers follow the language", () => {
  const values = [1240, 0, 1234567, 2.5];
  expect(values.map((n) => when.formatNumber(n, "en"))).toEqual(["1,240", "0", "1,234,567", "2.5"]);
  expect(values.map((n) => when.formatNumber(n, "id"))).toEqual(["1.240", "0", "1.234.567", "2,5"]);
});

test("TC-I18N-12 Intl month and weekday names", () => {
  const dates = ["2026-03-02", "2026-06-01", "2026-09-15", "2026-12-31"];
  expect(dates.map((date) => when.shortDate(instant(`${date}T05:00:00Z`), "id", "Asia/Bangkok"))).toEqual([
    "Sen 2 Mar",
    "Sen 1 Jun",
    "Sel 15 Sep",
    "Kam 31 Des",
  ]);
});
