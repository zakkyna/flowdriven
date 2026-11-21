import { expect, test } from "vitest";
import { flow } from "../test-data/flows.ts";
import { parseManifest } from "./parse.ts";

test("TC-SR9-11 rejects limits and settings from a flow", () => {
  for (const extra of [{ limits: { budget_usd: 9999 } }, { spendingLimit: 9999 }, { settings: {} }]) {
    const result = parseManifest({ ...flow(), ...extra });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.code).toBe("unknown_field");
  }
});
