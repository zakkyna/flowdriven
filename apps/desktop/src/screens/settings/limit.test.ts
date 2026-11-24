import { expect, test } from "vitest";
import { defaultRaisedLimit, parseLimit } from "./limit";

test("TC-j12-22 The limit field validates every case and saves nothing on error", () => {
  expect(parseLimit("", 10)).toEqual({ ok: false, disabled: true });
  expect(parseLimit("   ", 10)).toEqual({ ok: false, disabled: true });

  for (const invalid of ["abc", "0", "-5", "10", "9.99", "10.001"]) {
    expect(parseLimit(invalid, 10)).toEqual({ ok: false, message: "Enter an amount above $10." });
  }

  expect(parseLimit("25", 10)).toEqual({ ok: true, amount: 25 });
  expect(parseLimit("25.678", 10)).toEqual({ ok: true, amount: 25.68 });
  expect(parseLimit("10000", 10)).toEqual({ ok: true, amount: 10000 });

  expect(parseLimit("10000.01", 10)).toEqual({ ok: false, message: "Enter an amount up to $10,000." });
  expect(parseLimit("10001", 10)).toEqual({ ok: false, message: "Enter an amount up to $10,000." });
});

test("parseLimit formats Indonesian error messages and rounds to cents before comparing", () => {
  expect(parseLimit("10", 10, "id")).toEqual({ ok: false, message: "Masukkan jumlah di atas $10." });
  expect(parseLimit("10001", 10, "id")).toEqual({ ok: false, message: "Masukkan jumlah maksimal $10.000." });
  expect(parseLimit("10000.001", 10)).toEqual({ ok: true, amount: 10000 });
  expect(parseLimit(" 25 ", 10)).toEqual({ ok: true, amount: 25 });
});

test("defaultRaisedLimit uses 25 below 25 and limit + 25 capped at 10000", () => {
  expect(defaultRaisedLimit(10)).toBe(25);
  expect(defaultRaisedLimit(24.99)).toBe(25);
  expect(defaultRaisedLimit(25)).toBe(50);
  expect(defaultRaisedLimit(100)).toBe(125);
  expect(defaultRaisedLimit(9990)).toBe(10000);
  expect(defaultRaisedLimit(10000)).toBe(10000);
});
